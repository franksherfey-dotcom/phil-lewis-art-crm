require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const multer = require('multer')
const { parse } = require('csv-parse/sync')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')

const pool = require('./lib/db')
const { sendEmail, syncInbox, testConnection, interpolate } = require('./emailer')

const app = express()
const PORT = process.env.PORT || 3000
const JWT_SECRET = process.env.JWT_SECRET || 'pla-crm-secret-please-set-JWT_SECRET-env-var'
const JWT_EXPIRES = '30d'

// Store CSV files in memory — no disk writes (required for Vercel)
const upload = multer({ storage: multer.memoryStorage() })

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ── PHIL LEWIS ART IMAGE MAP (for embedding in outreach emails) ─────────
// Now uses database art_images table instead of hardcoded map
async function getArtForCompany(company) {
  const fallback = { url: 'https://phillewisart.com/cdn/shop/articles/Phil_Lewis_Product5843WEB_fadcaa8c-3b21-462c-b8be-26b402bc6f94_600x.jpg?v=1747320948', alt: 'Phil Lewis Art — Collaboration Products' }
  try {
    if (company && company.tags) {
      const companyTags = company.tags.toLowerCase().split(',').map(t => t.trim())
      const artRows = await all('SELECT * FROM art_images ORDER BY id')
      for (const tag of companyTags) {
        const match = artRows.find(a => a.tags && a.tags.toLowerCase().split(',').some(at => at.trim() === tag))
        if (match) return { url: match.url, alt: 'Phil Lewis Art × ' + match.title }
      }
      // Fall back to default image
      const defaultImg = artRows.find(a => a.is_default)
      if (defaultImg) return { url: defaultImg.url, alt: 'Phil Lewis Art × ' + defaultImg.title }
    }
    return fallback
  } catch { return fallback }
}

function buildArtEmailBlock(artImg) {
  return `
<div style="margin:24px 0;text-align:center;padding:16px;background:#fafafa;border-radius:8px">
  <div style="margin-bottom:8px;font-size:13px;color:#666;font-style:italic">Recent Collaboration</div>
  <img src="${artImg.url}" alt="${artImg.alt}" style="max-width:100%;width:480px;border-radius:8px;border:1px solid #e0e0e0" />
  <div style="margin-top:8px;font-size:12px;color:#999">${artImg.alt}</div>
  <div style="margin-top:4px"><a href="https://phillewisart.com/blogs/collaborations" style="font-size:12px;color:#4f46e5;text-decoration:none">View more collaborations →</a></div>
</div>`
}

// ─── USERS TABLE MIGRATION ───────────────────────────────────────────────────
// Exposed as a promise so auth routes can await it before querying the users table
const migrationReady = (async () => {
  try {
    // If public.users exists but is missing the 'username' column, drop and recreate it.
    // Filter table_schema='public' to avoid matching Supabase's internal auth.users table.
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name='users' AND table_schema='public'
        )
        AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='users' AND column_name='username' AND table_schema='public'
        ) THEN
          DROP TABLE public.users CASCADE;
        END IF;
      END $$
    `)

    // Create fresh table (no-op if already correct)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.users (
        id BIGSERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT,
        email TEXT,
        password_hash TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user','readonly')),
        force_password_change BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ
      )
    `)

    // Seed admin if none exists
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM public.users WHERE role='admin'`)
    if (rows[0].n === 0) {
      const hash = await bcrypt.hash('ChangeMe123!', 10)
      await pool.query(
        `INSERT INTO public.users (username, display_name, role, password_hash, force_password_change)
         VALUES ('frank', 'Frank Sherfey', 'admin', $1, TRUE)
         ON CONFLICT (username) DO UPDATE
           SET password_hash = $1, role = 'admin', force_password_change = TRUE`,
        [hash]
      )
      console.log('✅ Seeded initial admin user: frank / ChangeMe123!')
    }
    console.log('✅ Users table ready.')

    // Art gallery table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS art_images (
        id BIGSERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        tags TEXT DEFAULT '',
        category TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    console.log('✅ Art gallery table ready.')

    // Add type column if missing (art = original art, product = product photos)
    await pool.query(`ALTER TABLE art_images ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'art'`)

    // Seed Phil's art collection — re-seed if fewer than 40 art pieces
    const artCount = await one("SELECT COUNT(*)::int AS n FROM art_images WHERE type='art'")
    if (artCount.n < 40) {
      await pool.query("DELETE FROM art_images WHERE type='art'")
      const S = 'https://phillewisart.com/cdn/shop/'
      const ART_SEEDS = [
        // ── OCEAN / MARINE ──
        { title: 'Angel Fish', url: S+'files/Angel-Fish-1500.jpg', tags: 'drinkware,apparel,outdoor,puzzles,cards', category: 'Ocean', notes: 'Vibrant tropical fish' },
        { title: 'Dolphins', url: S+'files/Dolphins-1500.jpg', tags: 'surf,drinkware,outdoor,apparel,cards', category: 'Ocean', notes: 'Playful dolphins' },
        { title: 'Orcas', url: S+'files/Orcas-1500.jpg', tags: 'surf,drinkware,outdoor,apparel,hard-goods', category: 'Ocean', notes: 'Orca whales' },
        { title: 'Octopus', url: S+'files/Octopus-1500.jpg', tags: 'surf,drinkware,apparel,skateboard,fabric', category: 'Ocean', notes: 'Psychedelic octopus' },
        { title: 'Sharks', url: S+'files/Sharks-1500.jpg', tags: 'surf,skateboard,apparel,hard-goods,drinkware', category: 'Ocean', notes: 'Bold shark composition' },
        { title: 'Whales', url: S+'files/Whales-1500.jpg', tags: 'surf,outdoor,drinkware,apparel,cards', category: 'Ocean', notes: 'Majestic whales' },
        { title: 'Sea Turtles', url: S+'files/Sea-Turtles-1500.jpg', tags: 'surf,outdoor,drinkware,apparel,lifestyle', category: 'Ocean', notes: 'Sea turtles' },
        { title: 'Sea Horses', url: S+'files/Sea-Horses-1500.jpg', tags: 'apparel,fabric,cards,drinkware,lifestyle', category: 'Ocean', notes: 'Ornate sea horses' },
        { title: 'Sea Lions', url: S+'files/Sea-Lions-1500.jpg', tags: 'surf,outdoor,drinkware,apparel,lifestyle', category: 'Ocean', notes: 'Playful sea lions' },
        { title: 'Crocodiles', url: S+'files/Crocodile-1500.jpg', tags: 'apparel,skateboard,hard-goods,lifestyle,fabric', category: 'Ocean', notes: 'Psychedelic crocodiles' },
        { title: 'Sting Rays', url: S+'files/Sting-Rays-1500.jpg', tags: 'surf,drinkware,apparel,outdoor,fabric', category: 'Ocean', notes: 'Sting rays' },
        { title: 'Pelicans', url: S+'files/Pelicans-1500.jpg', tags: 'surf,outdoor,cards,drinkware,apparel', category: 'Ocean', notes: 'Coastal pelicans' },
        { title: 'Let It Flow', url: S+'products/fish-1500.jpg', tags: 'surf,drinkware,apparel,cards,puzzles', category: 'Ocean', notes: 'Flowing fish scene' },
        { title: 'Over the Falls', url: S+'products/ducks.jpg', tags: 'surf,skateboard,apparel,hard-goods,outdoor', category: 'Ocean', notes: 'Dynamic waterfall with fish' },
        // ── WILDLIFE ──
        { title: 'Bison', url: S+'products/Bison-Web.jpg', tags: 'outdoor,hard-goods,apparel,lifestyle,cards', category: 'Wildlife', notes: 'Iconic American bison' },
        { title: 'Buffalo', url: S+'products/buffalo.jpg', tags: 'outdoor,hard-goods,apparel,lifestyle,cards', category: 'Wildlife', notes: 'Psychedelic buffalo' },
        { title: 'Wolf Song', url: S+'products/wolf.jpg', tags: 'outdoor,hard-goods,apparel,snowboard,lifestyle', category: 'Wildlife', notes: 'Howling wolf' },
        { title: 'Chameleon', url: S+'products/chameleon.jpg', tags: 'apparel,fabric,lifestyle,cards,puzzles', category: 'Wildlife', notes: 'Colorful chameleon' },
        { title: 'Black Swan', url: S+'products/blackswan.jpg', tags: 'apparel,fabric,cards,lifestyle,puzzles', category: 'Wildlife', notes: 'Elegant black swan' },
        { title: 'Electric Fox', url: S+'products/electricfox.jpg', tags: 'apparel,skateboard,snowboard,fabric,lifestyle', category: 'Wildlife', notes: 'Vibrant electric fox' },
        { title: 'Elephants', url: S+'products/elephants.jpg', tags: 'apparel,fabric,cards,puzzles,lifestyle', category: 'Wildlife', notes: 'Ornate elephants' },
        { title: 'Foxy', url: S+'products/foxy1.jpg', tags: 'apparel,cards,fabric,lifestyle,puzzles', category: 'Wildlife', notes: 'Psychedelic fox portrait' },
        { title: 'Jaguar Vision', url: S+'products/LB-PLA-Jaguar-Final-green-IG.jpg', tags: 'apparel,skateboard,hard-goods,fabric,lifestyle', category: 'Wildlife', notes: 'Jaguar vision mandala' },
        { title: 'Mountain Lion', url: S+'products/mountainlion.jpg', tags: 'outdoor,hard-goods,apparel,snowboard,lifestyle', category: 'Wildlife', notes: 'Mountain lion portrait' },
        { title: 'Moose on the Loose', url: S+'products/moose1.jpg', tags: 'outdoor,hard-goods,apparel,drinkware,lifestyle', category: 'Wildlife', notes: 'Playful moose' },
        { title: 'Red Tailed Hawk', url: S+'products/hawk.jpg', tags: 'outdoor,apparel,hard-goods,cards,lifestyle', category: 'Wildlife', notes: 'Red tailed hawk' },
        { title: 'Rocky Mountain Goats', url: S+'products/goats.jpg', tags: 'outdoor,hard-goods,apparel,drinkware,lifestyle', category: 'Wildlife', notes: 'Mountain goats' },
        { title: 'Giraffe Project', url: S+'products/giraffes.jpg', tags: 'apparel,cards,puzzles,fabric,lifestyle', category: 'Wildlife', notes: 'Ornate giraffe' },
        { title: 'Zebra', url: S+'products/zebra.jpg', tags: 'apparel,fabric,cards,lifestyle,puzzles', category: 'Wildlife', notes: 'Psychedelic zebra' },
        { title: 'Peacocks', url: S+'products/peacocks.jpg', tags: 'apparel,fabric,cards,puzzles,lifestyle', category: 'Wildlife', notes: 'Ornate peacock pair' },
        { title: 'Night Owls', url: S+'products/nightowls.jpg', tags: 'apparel,cards,puzzles,fabric,lifestyle', category: 'Wildlife', notes: 'Psychedelic owls' },
        // ── NATURE & LANDSCAPES ──
        { title: 'Aspens', url: S+'products/aspens11x14.jpg', tags: 'outdoor,lifestyle,cards,calendars,fabric', category: 'Nature', notes: 'Colorado aspens' },
        { title: 'Red Rocks', url: S+'products/redrocks1.jpg', tags: 'outdoor,lifestyle,apparel,cards,puzzles', category: 'Nature', notes: 'Red Rocks Amphitheatre' },
        { title: 'Flatirons', url: S+'products/flatirons.jpg', tags: 'outdoor,lifestyle,hard-goods,cards,calendars', category: 'Nature', notes: 'Boulder Flatirons' },
        { title: 'Colorado Sand Dunes', url: S+'products/dunes.jpg', tags: 'outdoor,lifestyle,cards,calendars,puzzles', category: 'Nature', notes: 'Great Sand Dunes' },
        { title: 'Boulder Rez', url: S+'products/res.jpg', tags: 'outdoor,lifestyle,cards,calendars,puzzles', category: 'Nature', notes: 'Boulder Reservoir sunset' },
        { title: 'Confluence', url: S+'products/Confluence-1500.jpg', tags: 'outdoor,skateboard,snowboard,apparel,fabric', category: 'Nature', notes: 'River confluence' },
        { title: 'Birdhouse', url: S+'products/birdhouse.jpg', tags: 'cards,outdoor,lifestyle,puzzles,fabric', category: 'Nature', notes: 'Colorful birdhouse' },
        { title: 'High Sierra', url: S+'products/highsierra.jpg', tags: 'outdoor,hard-goods,apparel,lifestyle,drinkware', category: 'Nature', notes: 'High Sierra mountains' },
        { title: 'Pow Days', url: S+'products/Pow-Days1500.jpg', tags: 'snowboard,outdoor,hard-goods,apparel,lifestyle', category: 'Nature', notes: 'Powder day mountain scene' },
        { title: 'Pollinate', url: S+'products/pollinate-1000.jpg', tags: 'cards,fabric,apparel,lifestyle,outdoor', category: 'Nature', notes: 'Bee pollination scene' },
        { title: 'Magnolia Moonrise', url: S+'products/magnolia.jpg', tags: 'cards,fabric,apparel,lifestyle,outdoor', category: 'Nature', notes: 'Magnolia moonrise scene' },
        { title: 'Up on the Blue Ridge', url: S+'files/Blue-Ridge-1500.jpg', tags: 'outdoor,lifestyle,cards,calendars,puzzles', category: 'Nature', notes: 'Blue Ridge Mountain vista' },
        { title: 'Lone Cypress', url: S+'products/cypress.jpg', tags: 'outdoor,lifestyle,cards,calendars,puzzles', category: 'Nature', notes: 'Lone Cypress tree' },
        { title: 'Marshall Mesa', url: S+'products/marshall.jpg', tags: 'outdoor,lifestyle,cards,calendars,apparel', category: 'Nature', notes: 'Marshall Mesa landscape' },
        // ── PSYCHEDELIC & MANDALA ──
        { title: '3rd Eye Chakra Eagle', url: S+'products/6_39f2a2eb-a929-4150-bffd-f30a69b73c94.jpg', tags: 'apparel,skateboard,snowboard,fabric,lifestyle', category: 'Psychedelic', notes: 'Spiritual eagle mandala' },
        { title: 'Crown Chakra Lotus', url: S+'products/7_63003917-b094-4b51-ad52-25a29fa73e8b.jpg', tags: 'apparel,fabric,lifestyle,cards,drinkware', category: 'Psychedelic', notes: 'Lotus mandala' },
        { title: 'Bluegrass Mandala', url: S+'products/bluegrass-mandala-stickercopy.jpg', tags: 'apparel,drinkware,lifestyle,fabric,hard-goods', category: 'Psychedelic', notes: 'Intricate bluegrass mandala' },
        { title: 'Magpie Mandala', url: S+'products/mandala.jpg', tags: 'apparel,fabric,cards,lifestyle,outdoor', category: 'Psychedelic', notes: 'Magpie mandala' },
        { title: 'One Love', url: S+'products/one-love-1200.jpg', tags: 'apparel,fabric,lifestyle,cards,drinkware', category: 'Psychedelic', notes: 'Unity mandala' },
        { title: 'Frequency 1', url: S+'products/freq1PT-1200.jpg', tags: 'skateboard,snowboard,apparel,fabric,lifestyle', category: 'Psychedelic', notes: 'Abstract frequency wave' },
        // ── FANTASY & MYTHICAL ──
        { title: 'Azure Dragon', url: S+'files/Azure-Dragon-1500.jpg', tags: 'apparel,fabric,skateboard,snowboard,lifestyle', category: 'Fantasy', notes: 'Psychedelic dragon' },
        { title: 'Three Headed Dragon', url: S+'files/story-1920x1080.jpg', tags: 'skateboard,snowboard,apparel,hard-goods,fabric', category: 'Fantasy', notes: 'Three-headed dragon' },
        { title: 'Phoenix', url: S+'products/phoenix.jpg', tags: 'skateboard,snowboard,apparel,fabric,lifestyle', category: 'Fantasy', notes: 'Fiery phoenix' },
        { title: 'The Red Dragon', url: S+'products/dragon.jpg', tags: 'skateboard,snowboard,apparel,fabric,hard-goods', category: 'Fantasy', notes: 'Red dragon' },
        { title: 'Merlin', url: S+'products/merlin.jpg', tags: 'apparel,puzzles,cards,lifestyle,fabric', category: 'Fantasy', notes: 'Merlin wizard' },
        { title: 'Jellyfish Nimbus', url: S+'products/jellyfishnimbus.jpg', tags: 'surf,fabric,apparel,drinkware,lifestyle', category: 'Fantasy', notes: 'Jellyfish nimbus cloud' },
        // ── WHIMSICAL ──
        { title: 'Best Buds', url: S+'products/gnomes.jpg', tags: 'cards,puzzles,lifestyle,apparel,fabric', category: 'Whimsical', notes: 'Garden gnomes' },
        { title: 'Frog Pond', url: S+'products/frogs1.jpg', tags: 'cards,puzzles,lifestyle,fabric,outdoor', category: 'Whimsical', notes: 'Whimsical frog scene' },
        { title: 'Parrots in a Palm Tree', url: S+'products/parrots.jpg', tags: 'apparel,cards,fabric,lifestyle,drinkware', category: 'Whimsical', notes: 'Tropical parrots' },
        { title: 'Woodpeckers', url: S+'products/woodpeckers.jpg', tags: 'cards,outdoor,lifestyle,puzzles,fabric', category: 'Whimsical', notes: 'Woodpecker pair' },
      ]
      for (const a of ART_SEEDS) {
        await run(
          "INSERT INTO art_images (title, url, tags, category, notes, is_default, type) VALUES ($1,$2,$3,$4,$5,FALSE,'art')",
          [a.title, a.url, a.tags, a.category, a.notes]
        )
      }
      console.log('✅ Seeded Phil Lewis art collection (' + ART_SEEDS.length + ' pieces)')
    }

    // Seed product photos — Phil's art on actual products for prospect outreach
    const prodCount = await one("SELECT COUNT(*)::int AS n FROM art_images WHERE type='product'")
    if (prodCount.n < 20) {
      await pool.query("DELETE FROM art_images WHERE type='product'")
      const S = 'https://phillewisart.com/cdn/shop/'
      const PRODUCT_SEEDS = [
        // ── DRINKWARE ──
        { title: 'Prism Tumblers', url: S+'files/2_28b0a853-eb82-4cfb-ab66-a995f5e1c229.jpg', category: 'Drinkware', notes: 'Limited-edition prism tumblers' },
        { title: 'Insulated Wine Tumblers', url: S+'products/IMG_1886.jpg', category: 'Drinkware', notes: 'Wine tumblers with art wrap' },
        { title: 'Ceramic Mugs', url: S+'files/IMG_1657.jpg', category: 'Drinkware', notes: 'Ceramic mugs with art' },
        { title: 'Alpha Elephant Bottle', url: S+'products/IMG_2491.jpg', category: 'Drinkware', notes: '32oz Polar Camel bottle' },
        { title: 'Alpha Grizzly Bottle', url: S+'products/IMG_2349.jpg', category: 'Drinkware', notes: '32oz Polar Camel bottle' },
        { title: 'Jellyfish Flask', url: S+'products/IMG_2273.jpg', category: 'Drinkware', notes: 'Laser/UV combo 32oz flask' },
        { title: 'Octopus Flask', url: S+'products/PhilLewisProduct6556.jpg', category: 'Drinkware', notes: '32oz stainless steel flask' },
        { title: 'Owl Eyes Flask', url: S+'products/PhilLewisProduct6552.jpg', category: 'Drinkware', notes: '32oz stainless steel flask' },
        { title: 'Red Rocks Flask', url: S+'products/red-rocks-bottle.jpg', category: 'Drinkware', notes: '32oz stainless steel flask' },
        { title: 'Frequency 1 Flask', url: S+'products/IMG_2783.jpg', category: 'Drinkware', notes: '32oz stainless steel flask' },
        { title: 'Jaguar Vision Flask', url: S+'products/20210715_PhilLewis0280.jpg', category: 'Drinkware', notes: '32oz stainless steel flask' },
        { title: 'Sea Turtles Nalgene', url: S+'files/7E4607EF-AE84-4CDC-B418-410C646532EB.jpg', category: 'Drinkware', notes: '24oz Nalgene water bottle' },
        { title: 'Pollinate Flask', url: S+'products/pollinatebottle-2.jpg', category: 'Drinkware', notes: 'Laser/UV combo flask' },
        // ── APPAREL ──
        { title: 'Pollinate Sun Hoodie', url: S+'files/PollinateUPFMockup.jpg', category: 'Apparel', notes: 'UPF 50+ sun hoodie' },
        { title: 'Let it Flow Sun Hoodie', url: S+'files/LetitFlowUPFMockup.jpg', category: 'Apparel', notes: 'UPF 50+ sun hoodie' },
        { title: 'Three Headed Dragon Hoodie', url: S+'files/DragonUPFMockup.jpg', category: 'Apparel', notes: 'UPF 50+ sun hoodie' },
        { title: 'Octopus Sun Hoodie', url: S+'files/OctopusUPFMockup.jpg', category: 'Apparel', notes: 'UPF 50+ sun hoodie' },
        { title: 'Sea Turtles Sun Hoodie', url: S+'files/TurtlesUPFMockup.jpg', category: 'Apparel', notes: 'UPF 50+ sun hoodie' },
        { title: 'Sting Rays Sun Hoodie', url: S+'files/StingRaysUPFMockup.jpg', category: 'Apparel', notes: 'UPF 50+ sun hoodie' },
        { title: 'Ice Fox Hoodie', url: S+'products/PhilLewisProduct4905WEB.jpg', category: 'Apparel', notes: 'Full print zip hoodie' },
        { title: 'Grizzly Hoodie', url: S+'products/PhilLewisProduct4889WEB.jpg', category: 'Apparel', notes: 'Full print zip hoodie' },
        { title: 'Let it Flow Boardshorts', url: S+'files/Shorts3.jpg', category: 'Apparel', notes: 'Boardshorts by Nomadic Movement' },
        // ── BOARD SPORTS ──
        { title: 'Skateboard Decks', url: S+'products/skateboard-mock-up-frequency.jpg', category: 'Board Sports', notes: 'Custom skateboard deck graphics' },
        { title: 'Dragon Grip Tape', url: S+'files/three-headed-dragon_3903ccd9-da88-4bf2-86d5-2feabf344e40.jpg', category: 'Board Sports', notes: 'Skateboard grip tape' },
        { title: 'Custom Surfboards', url: S+'products/surfboard2.jpg', category: 'Board Sports', notes: 'Soulcraft custom surfboards' },
        { title: 'Custom Skis & Snowboards', url: S+'products/Lion_b6cb10a9-5a27-4689-9e32-8f7711633841.jpg', category: 'Board Sports', notes: 'Meier custom skis & snowboards' },
        { title: 'Custom Traction Pads', url: S+'files/10-cropped.jpg', category: 'Board Sports', notes: 'Surf/snow traction pads' },
        // ── GREETING CARDS ──
        { title: 'Sea Turtles Card', url: S+'files/sea-turtles-card-mockup.jpg', category: 'Cards & Stationery', notes: 'Greeting card mockup' },
        { title: 'Orcas Card', url: S+'files/orcas-card-mockup.jpg', category: 'Cards & Stationery', notes: 'Greeting card mockup' },
        { title: 'Dolphins Card', url: S+'files/dolphins-card-mockup.jpg', category: 'Cards & Stationery', notes: 'Greeting card mockup' },
        { title: 'Sharks Card', url: S+'files/sharks-card-mockup.jpg', category: 'Cards & Stationery', notes: 'Greeting card mockup' },
        { title: 'Angel Fish Card', url: S+'files/angel-fish-card-mockup.jpg', category: 'Cards & Stationery', notes: 'Greeting card mockup' },
        { title: 'Octopus Card', url: S+'files/octopus-card-mockup.jpg', category: 'Cards & Stationery', notes: 'Greeting card mockup' },
        { title: 'Pelicans Card', url: S+'files/pelicans-card-mockup.jpg', category: 'Cards & Stationery', notes: 'Greeting card mockup' },
        { title: 'Crocodiles Card', url: S+'files/crocodiles-card-mockup.jpg', category: 'Cards & Stationery', notes: 'Greeting card mockup' },
        // ── BOOKS ──
        { title: 'Coloring Book Combo (5 editions)', url: S+'products/PhilLewisProduct4501WEB.jpg', category: 'Books', notes: 'Coloring book combo set' },
        { title: 'Coloring Book - 5th Edition', url: S+'products/cover1-1200x1200.jpg', category: 'Books', notes: 'Latest coloring book edition' },
        { title: 'Animal Friends Children\'s Book', url: S+'products/PhilLewisProduct4451WEB_e363927b-ffe8-41d0-ac28-c75e7d59f548.jpg', category: 'Books', notes: 'Children\'s book' },
        { title: 'Journals', url: S+'products/IMG_2981.jpg', category: 'Books', notes: 'Art journals' },
        // ── HOME & LIFESTYLE ──
        { title: 'Jellyfish Nimbus Tapestry', url: S+'products/Lewis_Jellyfish_T.png', category: 'Home & Lifestyle', notes: 'Wall tapestry' },
        { title: 'Red Rocks Tapestry', url: S+'products/Lewis_Redrocks_T.png', category: 'Home & Lifestyle', notes: 'Wall tapestry' },
        { title: 'Phoenix Tapestry', url: S+'products/Lewis_Phoenix_T.png', category: 'Home & Lifestyle', notes: 'Wall tapestry' },
        { title: 'Elephants Tapestry', url: S+'products/Lewis_Elephants_T.png', category: 'Home & Lifestyle', notes: 'Wall tapestry' },
        { title: 'Lion Sherpa Blanket', url: S+'products/IMG_0851.jpg', category: 'Home & Lifestyle', notes: 'Sherpa blanket' },
        { title: 'Lotus Sherpa Blanket', url: S+'products/IMG_0844.jpg', category: 'Home & Lifestyle', notes: 'Sherpa blanket' },
        { title: 'XL Desk Mat - Lion', url: S+'files/Lion.jpg', category: 'Home & Lifestyle', notes: 'Extra-large desk mat' },
        { title: 'XL Desk Mat - Let it Flow', url: S+'files/Let-it-Flow_35b1bfb4-66c7-4e02-9066-dfc01ce50357.jpg', category: 'Home & Lifestyle', notes: 'Extra-large desk mat' },
        // ── DISC SPORTS ──
        { title: 'Octopus Golf Disc', url: S+'files/octopus-canyon.jpg', category: 'Disc Sports', notes: 'Canyon golf disc' },
        { title: 'Azure Dragon Golf Disc', url: S+'files/dragon2.jpg', category: 'Disc Sports', notes: 'Canyon golf disc' },
        { title: 'Elephant Golf Disc', url: S+'files/elephant1.jpg', category: 'Disc Sports', notes: 'Canyon golf disc' },
        { title: 'Jellyfish Nimbus Golf Disc', url: S+'files/IMG_2006.jpg', category: 'Disc Sports', notes: 'Canyon golf disc' },
        { title: 'Rainbow Vortex Foil Disc', url: S+'products/20210715_PhilLewis0397.jpg', category: 'Disc Sports', notes: 'Full foil golf disc' },
        { title: 'Pollinate Foil Disc', url: S+'products/pollinate-foil-mock-up.jpg', category: 'Disc Sports', notes: 'Full foil golf disc' },
        // ── STICKERS ──
        { title: 'XXL Octopus Foil Sticker', url: S+'files/XXL-Oxtopus-Foil-Sticker.jpg', category: 'Stickers', notes: 'Oversized foil sticker' },
        { title: 'Go Fish Sticker Sheets', url: S+'files/1-web.jpg', category: 'Stickers', notes: 'Multi-sticker sheets' },
        { title: 'Lotus Glitter Sticker', url: S+'files/Lotus-Foil-Sticker1500.jpg', category: 'Stickers', notes: 'Glitter foil sticker' },
        { title: '7 Chakras Sticker Pack', url: S+'products/stickerpack3.jpg', category: 'Stickers', notes: 'Chakra sticker set' },
      ]
      for (const p of PRODUCT_SEEDS) {
        await run(
          "INSERT INTO art_images (title, url, tags, category, notes, is_default, type) VALUES ($1,$2,$3,$4,$5,FALSE,'product')",
          [p.title, p.url, '', p.category, p.notes]
        )
      }
      console.log('✅ Seeded product collection (' + PRODUCT_SEEDS.length + ' pieces)')
    }

    // Reply templates table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reply_templates (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        subject TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    console.log('✅ Reply templates table ready.')

    // One-time: clean quoted tags in companies (strip literal " characters)
    await pool.query(`
      UPDATE companies SET tags = REPLACE(tags, '"', '')
      WHERE tags LIKE '%"%'
    `)
  } catch (e) { console.error('Users migration error:', e.message) }
})()

// ─── AUTH HELPERS ─────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET)
    next()
  } catch { res.status(401).json({ error: 'Session expired — please log in again.' }) }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' })
  next()
}

function blockReadonly(req, res, next) {
  if (req.user?.role === 'readonly' && req.method !== 'GET')
    return res.status(403).json({ error: 'Your account is read-only.' })
  next()
}

// Protect all /api/* routes except /api/auth/*
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next()
  requireAuth(req, res, next)
})
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next()
  blockReadonly(req, res, next)
})

// ─── AUTH ROUTES ─────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    await migrationReady  // ensure table exists before first login attempt
    const { username, password } = req.body
    if (!username || !password) return res.status(400).json({ error: 'Username and password required.' })
    const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(username)=LOWER($1)', [username])
    const user = rows[0]
    if (!user) return res.status(401).json({ error: 'Invalid username or password.' })
    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) return res.status(401).json({ error: 'Invalid username or password.' })
    await pool.query('UPDATE users SET last_login_at=NOW() WHERE id=$1', [user.id])
    const token = jwt.sign(
      { userId: user.id, username: user.username, display_name: user.display_name, role: user.role, force_password_change: user.force_password_change },
      JWT_SECRET, { expiresIn: JWT_EXPIRES }
    )
    res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role, force_password_change: user.force_password_change } })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    await migrationReady
    const { rows } = await pool.query('SELECT id,username,display_name,email,role,force_password_change,last_login_at FROM users WHERE id=$1', [req.user.userId])
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' })
    res.json(rows[0])
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' })
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.userId])
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' })
    // Skip current password check for forced change
    if (!req.user.force_password_change) {
      if (!currentPassword) return res.status(400).json({ error: 'Current password required.' })
      const valid = await bcrypt.compare(currentPassword, rows[0].password_hash)
      if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' })
    }
    const hash = await bcrypt.hash(newPassword, 10)
    await pool.query('UPDATE users SET password_hash=$1, force_password_change=FALSE, updated_at=NOW() WHERE id=$2', [hash, req.user.userId])
    // Re-issue token with forcePasswordChange=false
    const { rows: updated } = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.userId])
    const token = jwt.sign(
      { userId: updated[0].id, username: updated[0].username, display_name: updated[0].display_name, role: updated[0].role, force_password_change: false },
      JWT_SECRET, { expiresIn: JWT_EXPIRES }
    )
    res.json({ ok: true, token })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── USER MANAGEMENT (admin only) ────────────────────────────────────────────
app.get('/api/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id,username,display_name,email,role,force_password_change,created_at,last_login_at FROM users ORDER BY id ASC')
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, displayName, email, role, password } = req.body
    if (!username || !password) return res.status(400).json({ error: 'Username and password required.' })
    if (!['admin','user','readonly'].includes(role)) return res.status(400).json({ error: 'Invalid role.' })
    const hash = await bcrypt.hash(password, 10)
    const { rows } = await pool.query(
      `INSERT INTO users (username, display_name, email, role, password_hash, force_password_change)
       VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING id`,
      [username, displayName||username, email||null, role, hash]
    )
    res.json({ id: rows[0].id })
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Username already exists.' })
    res.status(500).json({ error: err.message })
  }
})

app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { display_name, displayName, email, role, password } = req.body
    const name = display_name || displayName  // accept both casings
    if (role && !['admin','user','readonly'].includes(role)) return res.status(400).json({ error: 'Invalid role.' })
    const existing = (await pool.query('SELECT * FROM users WHERE id=$1', [req.params.id])).rows[0]
    if (!existing) return res.status(404).json({ error: 'User not found.' })
    const hash = password ? await bcrypt.hash(password, 10) : existing.password_hash
    const forcePwChange = password ? true : existing.force_password_change
    await pool.query(
      `UPDATE users SET display_name=$1, email=$2, role=$3, password_hash=$4, force_password_change=$5, updated_at=NOW() WHERE id=$6`,
      [name||existing.display_name, email||existing.email, role||existing.role, hash, forcePwChange, req.params.id]
    )
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.userId) return res.status(400).json({ error: 'Cannot delete your own account.' })
    await pool.query('DELETE FROM users WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/users/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { password } = req.body
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' })
    const hash = await bcrypt.hash(password, 10)
    const { rowCount } = await pool.query(
      'UPDATE users SET password_hash=$1, force_password_change=TRUE, updated_at=NOW() WHERE id=$2',
      [hash, req.params.id]
    )
    if (!rowCount) return res.status(404).json({ error: 'User not found.' })
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── Query helpers ────────────────────────────────────────────────────────────
const run  = (sql, p = []) => pool.query(sql, p)
const one  = async (sql, p = []) => (await pool.query(sql, p)).rows[0]
const all  = async (sql, p = []) => (await pool.query(sql, p)).rows

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

app.get('/api/dashboard', async (req, res) => {
  try {
    const [c, ct, ae, es, recent] = await Promise.all([
      one("SELECT COUNT(*)::int AS n FROM companies"),
      one("SELECT COUNT(*)::int AS n FROM contacts"),
      one("SELECT COUNT(*)::int AS n FROM enrollments WHERE status='active'"),
      one("SELECT COUNT(*)::int AS n FROM activities WHERE type='email'"),
      all(`
        SELECT DISTINCT ON (a.contact_id)
          a.id, a.contact_id, a.subject, a.body, a.sent_at, a.notes, a.sentiment,
          c.first_name, c.last_name, co.name AS company_name, co.id AS company_id,
          e.id AS enrollment_id, e.status AS enrollment_status
        FROM activities a
        LEFT JOIN contacts c ON a.contact_id = c.id
        LEFT JOIN companies co ON c.company_id = co.id
        LEFT JOIN LATERAL (
          SELECT id, status FROM enrollments
          WHERE contact_id = a.contact_id AND status = 'active'
          ORDER BY started_at DESC LIMIT 1
        ) e ON true
        WHERE a.type = 'received_email'
          AND (a.notes IS NULL OR a.notes NOT IN ('archived'))
        ORDER BY a.contact_id, a.sent_at DESC
      `),
    ])
    const queueCount = (await getQueueItems()).length
    res.json({
      totalCompanies: c.n, totalContacts: ct.n,
      activeEnrollments: ae.n, emailsSent: es.n,
      queueCount, recentActivity: recent,
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── COMPANIES ───────────────────────────────────────────────────────────────

app.get('/api/companies', async (req, res) => {
  try {
    const { search, type, status, tag } = req.query
    let sql = `
      SELECT c.*, COUNT(ct.id)::int AS contact_count
      FROM companies c
      LEFT JOIN contacts ct ON c.id = ct.company_id
      WHERE 1=1
    `
    const params = []
    let i = 1
    if (search) {
      const s = `%${search}%`
      sql += ` AND (c.name ILIKE $${i} OR c.category ILIKE $${i+1} OR c.city ILIKE $${i+2} OR c.tags ILIKE $${i+3})`
      params.push(s, s, s, s); i += 4
    }
    if (type) {
      const types = type.split(',').filter(Boolean)
      if (types.length === 1) { sql += ` AND c.type=$${i}`; params.push(types[0]); i++ }
      else if (types.length > 1) { sql += ` AND c.type IN (${types.map((_,j) => `$${i+j}`).join(',')})`; types.forEach(t => params.push(t)); i += types.length }
    }
    if (status) {
      const statuses = status.split(',').filter(Boolean)
      if (statuses.length === 1) { sql += ` AND c.status=$${i}`; params.push(statuses[0]); i++ }
      else if (statuses.length > 1) { sql += ` AND c.status IN (${statuses.map((_,j) => `$${i+j}`).join(',')})`; statuses.forEach(s => params.push(s)); i += statuses.length }
    }
    if (tag) {
      const tags = tag.split(',').filter(Boolean)
      if (tags.length === 1) { sql += ` AND (',' || c.tags || ',') ILIKE $${i}`; params.push(`%,${tags[0]},%`); i++ }
      else if (tags.length > 1) {
        sql += ` AND (${tags.map((_,j) => `(',' || c.tags || ',') ILIKE $${i+j}`).join(' OR ')})`
        tags.forEach(t => params.push(`%,${t},%`)); i += tags.length
      }
    }
    sql += ' GROUP BY c.id ORDER BY c.name ASC'
    res.json(await all(sql, params))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/tags', async (req, res) => {
  try {
    const rows = await all("SELECT tags FROM companies WHERE tags IS NOT NULL AND tags != ''")
    const tagSet = new Set()
    rows.forEach(r => r.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => tagSet.add(t)))
    res.json([...tagSet].sort())
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/companies/:id', async (req, res) => {
  try {
    const company = await one('SELECT * FROM companies WHERE id=$1', [req.params.id])
    if (!company) return res.status(404).json({ error: 'Not found' })
    const contacts = await all(
      'SELECT * FROM contacts WHERE company_id=$1 ORDER BY is_primary DESC, first_name ASC',
      [req.params.id]
    )
    res.json({ ...company, contacts })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/companies', async (req, res) => {
  try {
    const { name, type, website, phone, address, city, state, country, category, notes, status, tags } = req.body
    if (!name) return res.status(400).json({ error: 'Name required' })
    const r = await one(`
      INSERT INTO companies (name, type, website, phone, address, city, state, country, category, notes, status, tags)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id
    `, [name, type||'manufacturer', website||'', phone||'', address||'', city||'', state||'', country||'USA',
        category||'', notes||'', status||'prospect', tags||''])
    res.json({ id: r.id })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.put('/api/companies/:id', async (req, res) => {
  try {
    const {
      name, type, website, phone, address, city, state, country, category, notes, status, tags,
      pipeline_stage, opportunity_value, next_step, next_step_date,
    } = req.body
    await run(`
      UPDATE companies SET
        name=$1, type=$2, website=$3, phone=$4, address=$5, city=$6, state=$7, country=$8,
        category=$9, notes=$10, status=$11, tags=$12,
        pipeline_stage=$13, opportunity_value=$14, next_step=$15, next_step_date=$16,
        updated_at=NOW()
      WHERE id=$17
    `, [name, type, website||'', phone||'', address||'', city||'', state||'', country||'USA',
        category||'', notes||'', status, tags||'',
        pipeline_stage||'Prospect', opportunity_value||0, next_step||null, next_step_date||null,
        req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/companies/:id', async (req, res) => {
  try {
    const allowed = ['pipeline_stage','opportunity_value','next_step','next_step_date','last_activity_at','status','notes','tags']
    const sets = []
    const vals = []
    let i = 1
    for (const [k, v] of Object.entries(req.body)) {
      if (allowed.includes(k)) { sets.push(`${k}=$${i}`); vals.push(v); i++ }
    }
    if (!sets.length) return res.status(400).json({ error: 'No valid fields' })
    sets.push('updated_at=NOW()')
    vals.push(req.params.id)
    await run(`UPDATE companies SET ${sets.join(',')} WHERE id=$${i}`, vals)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/companies/:id', async (req, res) => {
  try {
    await run('DELETE FROM companies WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── CONTACTS ────────────────────────────────────────────────────────────────

app.get('/api/contacts', async (req, res) => {
  try {
    const { search, company_id, category, tag, not_in_sequence } = req.query
    let sql = `
      SELECT ct.*,
             co.name AS company_name, co.type AS company_type,
             co.category AS company_category, co.tags AS company_tags,
             e.status AS enrollment_status, s.name AS sequence_name, e.id AS enrollment_id
      FROM contacts ct
      LEFT JOIN companies co ON ct.company_id = co.id
      LEFT JOIN LATERAL (
        SELECT id, sequence_id, status FROM enrollments
        WHERE contact_id = ct.id
        ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'replied' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END
        LIMIT 1
      ) e ON true
      LEFT JOIN sequences s ON s.id = e.sequence_id
      WHERE 1=1
    `
    const params = []
    let i = 1
    if (search) {
      const s = `%${search}%`
      sql += ` AND (ct.first_name ILIKE $${i} OR ct.last_name ILIKE $${i+1} OR ct.email ILIKE $${i+2} OR co.name ILIKE $${i+3})`
      params.push(s, s, s, s); i += 4
    }
    if (company_id) { sql += ` AND ct.company_id=$${i}`; params.push(company_id); i++ }
    if (category) {
      const cats = category.split(',').filter(Boolean)
      if (cats.length === 1) { sql += ` AND co.category ILIKE $${i}`; params.push(cats[0]); i++ }
      else if (cats.length > 1) { sql += ` AND co.category ILIKE ANY(ARRAY[${cats.map((_,j)=>`$${i+j}`).join(',')}])`; cats.forEach(c => params.push(c)); i += cats.length }
    }
    if (tag) {
      const tags = tag.split(',').filter(Boolean)
      if (tags.length === 1) { sql += ` AND (',' || co.tags || ',') ILIKE $${i}`; params.push(`%,${tags[0]},%`); i++ }
      else if (tags.length > 1) {
        sql += ` AND (${tags.map((_,j) => `(',' || co.tags || ',') ILIKE $${i+j}`).join(' OR ')})`
        tags.forEach(t => params.push(`%,${t},%`)); i += tags.length
      }
    }
    if (not_in_sequence === 'true') {
      sql += ` AND NOT EXISTS (SELECT 1 FROM enrollments WHERE contact_id=ct.id AND status='active')`
    }
    sql += ' ORDER BY co.name ASC, ct.first_name ASC'
    res.json(await all(sql, params))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Distinct categories for filter dropdown
app.get('/api/contacts/categories', async (req, res) => {
  try {
    const rows = await all(`SELECT DISTINCT category FROM companies WHERE category IS NOT NULL AND category != '' ORDER BY category ASC`)
    res.json(rows.map(r => r.category))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/contacts/:id', async (req, res) => {
  try {
    const c = await one(`
      SELECT ct.*, co.name AS company_name
      FROM contacts ct
      LEFT JOIN companies co ON ct.company_id = co.id
      WHERE ct.id=$1
    `, [req.params.id])
    if (!c) return res.status(404).json({ error: 'Not found' })
    res.json(c)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/contacts', async (req, res) => {
  try {
    const { company_id, first_name, last_name, email, phone, title, linkedin, notes, is_primary } = req.body
    if (!first_name) return res.status(400).json({ error: 'First name required' })
    const r = await one(`
      INSERT INTO contacts (company_id, first_name, last_name, email, phone, title, linkedin, notes, is_primary)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
    `, [company_id||null, first_name, last_name||'', email||'', phone||'', title||'', linkedin||'', notes||'', is_primary?1:0])
    res.json({ id: r.id })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.put('/api/contacts/:id', async (req, res) => {
  try {
    const { company_id, first_name, last_name, email, phone, title, linkedin, notes, is_primary } = req.body
    await run(`
      UPDATE contacts SET
        company_id=$1, first_name=$2, last_name=$3, email=$4, phone=$5,
        title=$6, linkedin=$7, notes=$8, is_primary=$9, updated_at=NOW()
      WHERE id=$10
    `, [company_id||null, first_name, last_name||'', email||'', phone||'', title||'', linkedin||'', notes||'', is_primary?1:0, req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/contacts/:id', async (req, res) => {
  try {
    await run('DELETE FROM contacts WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── SEQUENCES ───────────────────────────────────────────────────────────────

app.get('/api/sequences', async (req, res) => {
  try {
    const seqs = await all('SELECT * FROM sequences ORDER BY name ASC')
    await Promise.all(seqs.map(async s => {
      s.steps = await all(
        'SELECT * FROM sequence_steps WHERE sequence_id=$1 ORDER BY step_number ASC',
        [s.id]
      )
      // Enrollment stats by status
      const stats = await all(
        "SELECT status, COUNT(*)::int AS n FROM enrollments WHERE sequence_id=$1 GROUP BY status",
        [s.id]
      )
      s.stats = { active: 0, replied: 0, completed: 0, stopped: 0, paused: 0, total: 0 }
      stats.forEach(r => { s.stats[r.status] = r.n; s.stats.total += r.n })
      s.enrollment_count = s.stats.active
    }))
    res.json(seqs)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/sequences/:id', async (req, res) => {
  try {
    const seq = await one('SELECT * FROM sequences WHERE id=$1', [req.params.id])
    if (!seq) return res.status(404).json({ error: 'Not found' })
    seq.steps = await all(
      'SELECT * FROM sequence_steps WHERE sequence_id=$1 ORDER BY step_number ASC',
      [seq.id]
    )
    res.json(seq)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Sequence roster: enrolled contacts + suggested contacts not yet in this sequence
app.get('/api/sequences/:id/roster', async (req, res) => {
  try {
    const seqId = req.params.id

    // Enrolled contacts with their status
    const enrolled = await all(`
      SELECT ct.id, ct.first_name, ct.last_name, ct.email, ct.title,
             co.name AS company_name, co.category AS company_category,
             e.id AS enrollment_id, e.status AS enrollment_status,
             e.current_step, e.started_at
      FROM enrollments e
      JOIN contacts ct ON ct.id = e.contact_id
      LEFT JOIN companies co ON co.id = ct.company_id
      WHERE e.sequence_id = $1
      ORDER BY CASE e.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'replied' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END,
               e.started_at DESC
    `, [seqId])

    // Suggested: contacts NOT in this sequence, have email, prioritise those not in any active sequence
    const suggestions = await all(`
      SELECT ct.id, ct.first_name, ct.last_name, ct.email, ct.title,
             co.name AS company_name, co.category AS company_category,
             (SELECT status FROM enrollments WHERE contact_id=ct.id ORDER BY
               CASE status WHEN 'active' THEN 0 ELSE 1 END LIMIT 1) AS other_enrollment_status
      FROM contacts ct
      LEFT JOIN companies co ON co.id = ct.company_id
      WHERE ct.email IS NOT NULL AND ct.email != ''
        AND NOT EXISTS (
          SELECT 1 FROM enrollments WHERE contact_id=ct.id AND sequence_id=$1
        )
      ORDER BY
        CASE WHEN NOT EXISTS (SELECT 1 FROM enrollments WHERE contact_id=ct.id AND status='active') THEN 0 ELSE 1 END,
        co.name ASC, ct.first_name ASC
      LIMIT 50
    `, [seqId])

    res.json({ enrolled, suggestions })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/sequences', async (req, res) => {
  try {
    const { name, description, steps } = req.body
    if (!name) return res.status(400).json({ error: 'Name required' })
    const { id: seqId } = await one(
      'INSERT INTO sequences (name, description) VALUES ($1,$2) RETURNING id',
      [name, description||'']
    )
    if (steps && steps.length) {
      await Promise.all(steps.map((step, idx) =>
        run('INSERT INTO sequence_steps (sequence_id, step_number, delay_days, subject, body) VALUES ($1,$2,$3,$4,$5)',
          [seqId, idx+1, step.delay_days||0, step.subject||'', step.body||''])
      ))
    }
    res.json({ id: seqId })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.put('/api/sequences/:id', async (req, res) => {
  try {
    const { name, description, steps } = req.body
    await run('UPDATE sequences SET name=$1, description=$2 WHERE id=$3', [name, description||'', req.params.id])
    if (steps) {
      await run('DELETE FROM sequence_steps WHERE sequence_id=$1', [req.params.id])
      await Promise.all(steps.map((step, idx) =>
        run('INSERT INTO sequence_steps (sequence_id, step_number, delay_days, subject, body) VALUES ($1,$2,$3,$4,$5)',
          [req.params.id, idx+1, step.delay_days||0, step.subject||'', step.body||''])
      ))
    }
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/sequences/:id', async (req, res) => {
  try {
    await run('DELETE FROM sequences WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── ENROLLMENTS ─────────────────────────────────────────────────────────────

app.post('/api/enrollments', async (req, res) => {
  try {
    const { contact_ids, sequence_id } = req.body
    if (!contact_ids || !sequence_id) return res.status(400).json({ error: 'contact_ids and sequence_id required' })
    const ids = Array.isArray(contact_ids) ? contact_ids : [contact_ids]
    let enrolled = 0
    await Promise.all(ids.map(async cid => {
      const r = await run(`
        INSERT INTO enrollments (contact_id, sequence_id, current_step, status)
        VALUES ($1,$2,1,'active')
        ON CONFLICT (contact_id, sequence_id) DO NOTHING
      `, [cid, sequence_id])
      if (r.rowCount > 0) enrolled++
    }))
    res.json({ enrolled })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/enrollments/:id', async (req, res) => {
  try {
    await run("UPDATE enrollments SET status='stopped' WHERE id=$1", [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/enrollments/:id/reply', async (req, res) => {
  try {
    await run("UPDATE enrollments SET status='replied', completed_at=NOW() WHERE id=$1", [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── OUTREACH QUEUE ───────────────────────────────────────────────────────────

async function getQueueItems() {
  // Single query — avoids N+1 pattern that caused Vercel timeouts
  const rows = await all(`
    SELECT
      e.id AS enrollment_id, e.contact_id, e.sequence_id, e.current_step, e.started_at,
      s.name AS sequence_name,
      ss.subject AS step_subject, ss.body AS step_body, ss.delay_days,
      (SELECT COUNT(*)::int FROM sequence_steps WHERE sequence_id = e.sequence_id) AS total_steps,
      c.first_name, c.last_name, c.email, c.title, c.company_id,
      co.name AS company_name, co.type AS company_type, co.website,
      (SELECT MAX(sent_at) FROM activities WHERE enrollment_id = e.id) AS last_activity_at
    FROM enrollments e
    JOIN sequences s ON e.sequence_id = s.id
    JOIN sequence_steps ss ON ss.sequence_id = e.sequence_id AND ss.step_number = e.current_step
    JOIN contacts c ON e.contact_id = c.id
    LEFT JOIN companies co ON c.company_id = co.id
    WHERE e.status = 'active'
  `)

  const now = new Date()
  const queue = []
  for (const row of rows) {
    let dueDate
    if (row.current_step === 1) {
      dueDate = new Date(new Date(row.started_at).getTime() + row.delay_days * 86400000)
    } else {
      if (!row.last_activity_at) continue
      dueDate = new Date(new Date(row.last_activity_at).getTime() + row.delay_days * 86400000)
    }
    if (dueDate <= now) {
      queue.push({
        enrollment_id: row.enrollment_id,
        contact_id: row.contact_id,
        sequence_id: row.sequence_id,
        sequence_name: row.sequence_name,
        current_step: row.current_step,
        total_steps: row.total_steps,
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
        title: row.title,
        company_id: row.company_id,
        company_name: row.company_name,
        company_type: row.company_type,
        website: row.website,
        step_subject: row.step_subject,
        step_body: row.step_body,
        due_date: dueDate.toISOString(),
      })
    }
  }
  return queue
}

app.get('/api/queue', async (req, res) => {
  try { res.json(await getQueueItems()) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/queue/send', async (req, res) => {
  try {
    const { enrollment_id, custom_subject, custom_body } = req.body

    const enr = await one(`
      SELECT e.*, c.first_name, c.last_name, c.email, c.title, c.company_id
      FROM enrollments e JOIN contacts c ON e.contact_id = c.id
      WHERE e.id=$1
    `, [enrollment_id])
    if (!enr) return res.status(404).json({ error: 'Enrollment not found' })
    if (enr.status !== 'active') return res.status(400).json({ error: 'Enrollment not active' })
    if (!enr.email) return res.status(400).json({ error: 'Contact has no email address' })

    const step = await one(
      'SELECT * FROM sequence_steps WHERE sequence_id=$1 AND step_number=$2',
      [enr.sequence_id, enr.current_step]
    )
    if (!step) return res.status(404).json({ error: 'Step not found' })

    const company = enr.company_id ? await one('SELECT * FROM companies WHERE id=$1', [enr.company_id]) : null
    const contact = { first_name: enr.first_name, last_name: enr.last_name, email: enr.email, title: enr.title }

    // Embed Phil's art in every other step (1,3,5…) and the closing step
    const { n: totalSteps } = await one(
      'SELECT COUNT(*)::int AS n FROM sequence_steps WHERE sequence_id=$1',
      [enr.sequence_id]
    )
    const isArtStep = (enr.current_step % 2 === 1) || (enr.current_step >= totalSteps)
    let emailBody = custom_body || step.body
    if (isArtStep) {
      const artImg = await getArtForCompany(company)
      emailBody = emailBody + '\n' + buildArtEmailBlock(artImg)
    }

    const { resolvedSubject, resolvedBody } = await sendEmail({
      toEmail: enr.email,
      toName: [enr.first_name, enr.last_name].filter(Boolean).join(' '),
      subject: custom_subject || step.subject,
      body: emailBody,
      isHtml: isArtStep,
      contact,
      company,
    })

    await run(
      "INSERT INTO activities (enrollment_id, contact_id, type, subject, body, status, sent_at) VALUES ($1,$2,'email',$3,$4,'sent',NOW())",
      [enrollment_id, enr.contact_id, resolvedSubject, resolvedBody]
    )
    if (enr.company_id) await run("UPDATE companies SET last_activity_at=NOW() WHERE id=$1", [enr.company_id])

    if (enr.current_step >= totalSteps) {
      await run("UPDATE enrollments SET status='completed', completed_at=NOW() WHERE id=$1", [enrollment_id])
    } else {
      await run("UPDATE enrollments SET current_step=current_step+1 WHERE id=$1", [enrollment_id])
    }

    res.json({ ok: true, subject: resolvedSubject })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/queue/send-all', async (req, res) => {
  try {
    const queue = await getQueueItems()
    const results = []
    for (const item of queue) {
      try {
        const enr = await one(`
          SELECT e.*, c.first_name, c.last_name, c.email, c.title, c.company_id
          FROM enrollments e JOIN contacts c ON e.contact_id = c.id
          WHERE e.id=$1
        `, [item.enrollment_id])
        if (!enr || !enr.email) {
          results.push({ enrollment_id: item.enrollment_id, ok: false, error: 'No email' }); continue
        }

        const step = await one(
          'SELECT * FROM sequence_steps WHERE sequence_id=$1 AND step_number=$2',
          [enr.sequence_id, enr.current_step]
        )
        const company = enr.company_id ? await one('SELECT * FROM companies WHERE id=$1', [enr.company_id]) : null
        const contact = { first_name: enr.first_name, last_name: enr.last_name, email: enr.email, title: enr.title }

        // Embed Phil's art in every other step (1,3,5…) and the closing step
        const { n: totalSteps } = await one(
          'SELECT COUNT(*)::int AS n FROM sequence_steps WHERE sequence_id=$1',
          [enr.sequence_id]
        )
        const isArtStep = (enr.current_step % 2 === 1) || (enr.current_step >= totalSteps)
        let emailBody = step.body
        if (isArtStep) {
          const artImg = await getArtForCompany(company)
          emailBody = emailBody + '\n' + buildArtEmailBlock(artImg)
        }

        const { resolvedSubject, resolvedBody } = await sendEmail({
          toEmail: enr.email,
          toName: [enr.first_name, enr.last_name].filter(Boolean).join(' '),
          subject: step.subject,
          body: emailBody,
          isHtml: isArtStep,
          contact,
          company,
        })

        await run(
          "INSERT INTO activities (enrollment_id, contact_id, type, subject, body, status, sent_at) VALUES ($1,$2,'email',$3,$4,'sent',NOW())",
          [item.enrollment_id, enr.contact_id, resolvedSubject, resolvedBody]
        )
        if (enr.company_id) await run("UPDATE companies SET last_activity_at=NOW() WHERE id=$1", [enr.company_id])

        if (enr.current_step >= totalSteps) {
          await run("UPDATE enrollments SET status='completed', completed_at=NOW() WHERE id=$1", [item.enrollment_id])
        } else {
          await run("UPDATE enrollments SET current_step=current_step+1 WHERE id=$1", [item.enrollment_id])
        }

        results.push({ enrollment_id: item.enrollment_id, ok: true, subject: resolvedSubject })
      } catch (err) {
        results.push({ enrollment_id: item.enrollment_id, ok: false, error: err.message })
      }
    }
    res.json({
      results,
      sent: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/queue/preview/:enrollment_id', async (req, res) => {
  try {
    const enr = await one(`
      SELECT e.*, c.first_name, c.last_name, c.email, c.title, c.company_id
      FROM enrollments e JOIN contacts c ON e.contact_id = c.id
      WHERE e.id=$1
    `, [req.params.enrollment_id])
    if (!enr) return res.status(404).json({ error: 'Not found' })

    const step = await one(
      'SELECT * FROM sequence_steps WHERE sequence_id=$1 AND step_number=$2',
      [enr.sequence_id, enr.current_step]
    )
    if (!step) return res.status(404).json({ error: 'Step not found' })

    const company = enr.company_id ? await one('SELECT * FROM companies WHERE id=$1', [enr.company_id]) : null
    const contact = { first_name: enr.first_name, last_name: enr.last_name, email: enr.email, title: enr.title }
    res.json({
      subject: interpolate(step.subject, contact, company),
      body:    interpolate(step.body,    contact, company),
      step_number: enr.current_step,
      company_tags: company ? company.tags : null,
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── PIPELINE ─────────────────────────────────────────────────────────────────

app.get('/api/pipeline', async (req, res) => {
  try {
    const contacts = await all(`
      SELECT
        ct.id, ct.first_name, ct.last_name, ct.email, ct.title, ct.is_primary,
        co.id AS company_id, co.name AS company_name, co.status AS company_status,
        e.id AS enrollment_id, e.current_step, e.status AS enrollment_status, e.started_at,
        s.id AS sequence_id, s.name AS sequence_name,
        (SELECT COUNT(*)::int FROM sequence_steps WHERE sequence_id = e.sequence_id) AS total_steps,
        (SELECT COUNT(*)::int FROM activities WHERE contact_id = ct.id AND type='email') AS emails_sent,
        (SELECT MAX(sent_at) FROM activities WHERE contact_id = ct.id) AS last_contact_at
      FROM contacts ct
      LEFT JOIN companies co ON ct.company_id = co.id
      LEFT JOIN enrollments e ON e.contact_id = ct.id
        AND e.id = (
          SELECT id FROM enrollments
          WHERE contact_id = ct.id
          ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END ASC, started_at DESC
          LIMIT 1
        )
      LEFT JOIN sequences s ON e.sequence_id = s.id
      ORDER BY co.name ASC, ct.first_name ASC
    `)
    res.json(contacts)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── ACTIVITIES ───────────────────────────────────────────────────────────────

app.get('/api/activities', async (req, res) => {
  try {
    const { contact_id, limit } = req.query
    let sql = `
      SELECT a.*, c.first_name, c.last_name, c.email, c.title,
             co.name AS company_name, co.id AS company_id,
             e.id AS enrollment_id, e.current_step, e.status AS enrollment_status,
             s.name AS sequence_name,
             (SELECT COUNT(*) FROM sequence_steps ss WHERE ss.sequence_id = e.sequence_id)::int AS sequence_total_steps,
             a.sent_at AS created_at
      FROM activities a
      LEFT JOIN contacts c ON a.contact_id = c.id
      LEFT JOIN companies co ON c.company_id = co.id
      LEFT JOIN enrollments e ON a.enrollment_id = e.id
      LEFT JOIN sequences s ON e.sequence_id = s.id
      WHERE 1=1
    `
    const params = []
    let i = 1
    if (contact_id) { sql += ` AND a.contact_id=$${i}`; params.push(contact_id); i++ }
    sql += ' ORDER BY a.sent_at DESC'
    if (limit) { sql += ` LIMIT $${i}`; params.push(parseInt(limit)); i++ }
    res.json(await all(sql, params))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/activities', async (req, res) => {
  try {
    const { contact_id, type, subject, body, status, notes } = req.body
    const r = await one(
      'INSERT INTO activities (contact_id, type, subject, body, status, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [contact_id, type||'note', subject||'', body||'', status||'sent', notes||'']
    )
    res.json({ id: r.id })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/activities/:id', async (req, res) => {
  try {
    await run('DELETE FROM activities WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/activities/:id/archive', async (req, res) => {
  try {
    await run("UPDATE activities SET notes='archived' WHERE id=$1", [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/activities/:id/toggle-read', async (req, res) => {
  try {
    const a = await one("SELECT notes FROM activities WHERE id=$1", [req.params.id])
    if (!a) return res.status(404).json({ error: 'Not found' })
    const newNotes = a.notes === 'read' ? null : 'read'
    await run("UPDATE activities SET notes=$2 WHERE id=$1", [req.params.id, newNotes])
    res.json({ ok: true, notes: newNotes })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── SETTINGS ─────────────────────────────────────────────────────────────────

app.get('/api/settings', async (req, res) => {
  try {
    const rows = await all('SELECT key, value FROM settings')
    const s = {}
    rows.forEach(r => { s[r.key] = r.value })
    if (s.smtp_pass) s.smtp_pass = '••••••••'
    res.json(s)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/settings', async (req, res) => {
  try {
    const fields = [
      'smtp_host','smtp_port','smtp_user','smtp_from_name','smtp_secure',
      'imap_host','imap_port','imap_secure','imap_sent_folder',
      'email_signature',
    ]
    await Promise.all(
      fields
        .filter(k => req.body[k] !== undefined)
        .map(k => run(
          'INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
          [k, req.body[k]]
        ))
    )
    if (req.body.smtp_pass && !req.body.smtp_pass.startsWith('••')) {
      await run(
        'INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
        ['smtp_pass', req.body.smtp_pass]
      )
    }
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── INBOX ───────────────────────────────────────────────────────────────────

app.get('/api/inbox', async (req, res) => {
  try {
    const { search, limit, tab } = req.query
    const activityType = tab === 'sent' ? 'email' : 'received_email'
    let sql = `
      SELECT a.id, a.contact_id, a.subject, a.body, a.status, a.sent_at, a.notes, a.sentiment,
             c.first_name, c.last_name, c.email, c.title,
             co.id AS company_id, co.name AS company_name, co.type AS company_type,
             co.opportunity_value, co.pipeline_stage, co.status AS company_status
      FROM activities a
      LEFT JOIN contacts c ON a.contact_id = c.id
      LEFT JOIN companies co ON c.company_id = co.id
      WHERE a.type = '${activityType}'
    `
    const params = []
    let i = 1
    if (search) {
      const s = `%${search}%`
      sql += ` AND (a.subject ILIKE $${i} OR c.first_name ILIKE $${i+1} OR c.last_name ILIKE $${i+2} OR co.name ILIKE $${i+3})`
      params.push(s, s, s, s); i += 4
    }
    sql += ' ORDER BY a.sent_at DESC'
    if (limit) { sql += ` LIMIT $${i}`; params.push(parseInt(limit)); i++ }
    const messages = await all(sql, params)
    const unread = await one("SELECT COUNT(*)::int AS n FROM activities WHERE type='received_email' AND (notes IS NULL OR notes != 'read')")
    res.json({ messages, unreadCount: unread.n })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/inbox/:id/read', async (req, res) => {
  try {
    await run("UPDATE activities SET notes='read' WHERE id=$1", [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Delete (dismiss) an inbox message — removes from CRM only, not from email server
app.delete('/api/inbox/:id', async (req, res) => {
  try {
    await run("DELETE FROM activities WHERE id=$1", [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Set sentiment (positive / neutral / negative) on an inbox message
app.patch('/api/inbox/:id/sentiment', async (req, res) => {
  try {
    const { sentiment } = req.body // 'positive', 'neutral', 'negative', or null
    await run("UPDATE activities SET sentiment=$1 WHERE id=$2", [sentiment || null, req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Bulk delete inbox messages
app.post('/api/inbox/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !ids.length) return res.status(400).json({ error: 'No message IDs provided.' })
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',')
    await run(`DELETE FROM activities WHERE id IN (${placeholders})`, ids)
    res.json({ ok: true, deleted: ids.length })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/inbox/not-in-sequence', async (req, res) => {
  try {
    const { search, limit } = req.query
    let sql = `
      SELECT c.id, c.first_name, c.last_name, c.email, c.title,
             co.id AS company_id, co.name AS company_name, co.type AS company_type,
             co.status AS company_status, co.pipeline_stage,
             (SELECT MAX(a.sent_at) FROM activities a WHERE a.contact_id = c.id) AS last_activity_at
      FROM contacts c
      LEFT JOIN companies co ON c.company_id = co.id
      WHERE c.email IS NOT NULL AND c.email != ''
        AND NOT EXISTS (
          SELECT 1 FROM enrollments e WHERE e.contact_id = c.id
            AND e.status IN ('active', 'replied', 'completed')
        )
    `
    const params = []
    let i = 1
    if (search) {
      const s = `%${search}%`
      sql += ` AND (c.first_name ILIKE $${i} OR c.last_name ILIKE $${i+1} OR c.email ILIKE $${i+2} OR co.name ILIKE $${i+3})`
      params.push(s, s, s, s); i += 4
    }
    sql += ' ORDER BY last_activity_at DESC NULLS LAST'
    if (limit) { sql += ` LIMIT $${i}`; params.push(parseInt(limit)); i++ }
    const contacts = await all(sql, params)
    res.json({ contacts })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Deduplicate existing inbox messages — keeps the newest copy, removes older dupes
app.post('/api/inbox/dedup', async (req, res) => {
  try {
    const result = await run(`
      DELETE FROM activities WHERE id IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY contact_id, subject, DATE_TRUNC('day', sent_at)
            ORDER BY sent_at DESC
          ) AS rn
          FROM activities
          WHERE type = 'received_email'
        ) dupes WHERE rn > 1
      )
    `)
    const removed = result.rowCount || 0
    res.json({ ok: true, removed })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/inbox/sync', async (req, res) => {
  try {
    const rows = await all('SELECT key, value FROM settings')
    const settings = {}
    rows.forEach(r => { settings[r.key] = r.value })

    // Build set of known contact emails for matching
    const contacts = await all('SELECT id, email, company_id FROM contacts WHERE email IS NOT NULL AND email != \'\'')
    const emailToContact = {}
    contacts.forEach(c => { emailToContact[c.email.toLowerCase()] = c })
    const knownEmails = new Set(Object.keys(emailToContact))

    const received = await syncInbox(settings, knownEmails)

    let imported = 0
    let autoStopped = 0
    let opportunitiesCreated = 0
    for (const msg of received) {
      const contact = emailToContact[msg.from_email]
      if (!contact) continue
      const contactId = contact.id
      // Avoid duplicates — check if this subject already logged from this contact
      // within a 24-hour window (handles auto-replies with slightly different timestamps)
      const existing = await one(
        `SELECT id FROM activities WHERE contact_id=$1 AND type='received_email' AND subject=$2
         AND sent_at BETWEEN ($3::timestamptz - INTERVAL '24 hours') AND ($3::timestamptz + INTERVAL '24 hours')`,
        [contactId, msg.subject, msg.received_at]
      )
      if (existing) continue
      await run(
        `INSERT INTO activities (contact_id, type, subject, body, status, sent_at)
         VALUES ($1,'received_email',$2,$3,'received',$4)`,
        [contactId, msg.subject, msg.body, msg.received_at]
      )
      imported++
      // Auto-remove from active sequences when a reply is received
      const activeEnrollments = await all(
        `SELECT id FROM enrollments WHERE contact_id=$1 AND status='active'`,
        [contactId]
      )
      for (const enr of activeEnrollments) {
        await run(
          `UPDATE enrollments SET status='replied', completed_at=NOW() WHERE id=$1`,
          [enr.id]
        )
        autoStopped++
      }
      // Auto-create opportunity on reply — $5k placeholder if company has no opp value
      if (contact.company_id) {
        const co = await one('SELECT opportunity_value, status FROM companies WHERE id=$1', [contact.company_id])
        if (co && (!co.opportunity_value || parseFloat(co.opportunity_value) === 0)) {
          await run(
            `UPDATE companies SET opportunity_value=5000, pipeline_stage='Interested', status='interested', last_activity_at=NOW(), updated_at=NOW() WHERE id=$1`,
            [contact.company_id]
          )
          opportunitiesCreated++
        } else if (co && co.status !== 'licensed' && co.status !== 'interested') {
          await run("UPDATE companies SET status='interested', last_activity_at=NOW(), updated_at=NOW() WHERE id=$1", [contact.company_id])
        }
      }
    }
    res.json({ ok: true, found: received.length, imported, autoStopped, opportunitiesCreated })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Send a reply (or forward) directly from the CRM inbox
// Body: { toEmail, toName, subject, body, isHtml, contactId, companyId, inReplyTo, references }
app.post('/api/inbox/reply', async (req, res) => {
  try {
    const { toEmail, toName, subject, body, isHtml, contactId, companyId, inReplyTo, references } = req.body
    if (!toEmail || !subject || !body) {
      return res.status(400).json({ error: 'toEmail, subject, and body are required.' })
    }

    // Fetch contact + company for interpolation (optional — gracefully handles missing)
    let contact = {}
    let company = null
    if (contactId) {
      const row = await one('SELECT * FROM contacts WHERE id=$1', [contactId])
      if (row) contact = row
    }
    if (companyId) {
      const row = await one('SELECT * FROM companies WHERE id=$1', [companyId])
      if (row) company = row
    }

    const { resolvedSubject, resolvedBody } = await sendEmail({
      toEmail,
      toName: toName || null,
      subject,
      body,
      isHtml: !!isHtml,
      contact,
      company,
      inReplyTo: inReplyTo || null,
      references: references || null,
    })

    // Log the outbound reply as an activity so it appears in the CRM timeline
    await run(
      `INSERT INTO activities (contact_id, type, subject, body, status, sent_at)
       VALUES ($1, 'email', $2, $3, 'sent', NOW())`,
      [contactId || null, resolvedSubject, resolvedBody]
    )

    // Update contact's last_activity_at
    if (contactId) {
      await run(
        `UPDATE contacts SET last_activity_at=NOW(), updated_at=NOW() WHERE id=$1`,
        [contactId]
      )
    }

    res.json({ ok: true, subject: resolvedSubject })
  } catch (err) {
    console.error('inbox/reply error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/settings/test-email', async (req, res) => {
  try {
    await testConnection()
    res.json({ ok: true, message: 'Connection successful!' })
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

// ─── CSV IMPORT ───────────────────────────────────────────────────────────────

app.post('/api/import/companies', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  try {
    const content = req.file.buffer.toString('utf8')
    const records = parse(content, { columns: true, skip_empty_lines: true, trim: true })
    let imported = 0
    for (const row of records) {
      const name = row.name || row.company || row.Company || row.Name
      if (!name) continue
      await run(`
        INSERT INTO companies (name, type, website, phone, city, state, category, notes, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [
        name,
        row.type  || row.Type     || 'manufacturer',
        row.website || row.Website || '',
        row.phone   || row.Phone   || '',
        row.city    || row.City    || '',
        row.state   || row.State   || '',
        row.category || row.Category || '',
        row.notes   || row.Notes   || '',
        row.status  || row.Status  || 'prospect',
      ])
      imported++
    }
    res.json({ imported })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/import/contacts', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  try {
    const content = req.file.buffer.toString('utf8')
    const records = parse(content, { columns: true, skip_empty_lines: true, trim: true })
    let imported = 0
    for (const row of records) {
      const first_name = row.first_name || row['First Name'] || row.firstname || row.name || row.Name
      if (!first_name) continue
      let company_id = null
      const companyName = row.company || row.Company || row.company_name
      if (companyName) {
        const co = await one('SELECT id FROM companies WHERE name ILIKE $1 LIMIT 1', [`%${companyName}%`])
        if (co) company_id = co.id
      }
      await run(`
        INSERT INTO contacts (company_id, first_name, last_name, email, phone, title, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [
        company_id,
        first_name,
        row.last_name || row['Last Name'] || row.lastname || '',
        row.email || row.Email || '',
        row.phone || row.Phone || '',
        row.title || row.Title || row.role || '',
        row.notes || row.Notes || '',
      ])
      imported++
    }
    res.json({ imported })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── NEWS FEED ────────────────────────────────────────────────────────────────

const https = require('https')
const http  = require('http')

function fetchURL(urlStr, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'))
    try {
      const u = new URL(urlStr)
      const mod = u.protocol === 'https:' ? https : http
      const req = mod.get({
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PhilLewisArtCRM/1.0)' },
        timeout: 8000,
      }, (res) => {
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : u.origin + res.headers.location
          res.resume()
          return resolve(fetchURL(next, redirects + 1))
        }
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => resolve(data))
        res.on('error', reject)
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')) })
    } catch(e) { reject(e) }
  })
}

function parseRSS(xml) {
  const items = []
  const itemRx = /<item>([\s\S]*?)<\/item>/g
  let m
  while ((m = itemRx.exec(xml)) !== null) {
    const block = m[1]
    const get = tag => {
      const rx  = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i')
      const rx2 = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
      const f = block.match(rx) || block.match(rx2)
      return f ? f[1].replace(/<[^>]+>/g, '').trim() : ''
    }
    const title   = get('title')
    const linkM   = block.match(/<link\s*\/?>\s*([^\s<]+)/i) || block.match(/<link[^>]*>([^<]+)<\/link>/i)
    const link    = linkM ? linkM[1].trim() : ''
    const pubDate = get('pubDate')
    const source  = get('source')
    if (title && title.toLowerCase() !== 'title') {
      items.push({ title, link, source, pubDate, date: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString() })
    }
  }
  return items
}

let _newsCache = {}
const NEWS_TTL = 45 * 60 * 1000

async function fetchNewsFor(query) {
  const now = Date.now()
  if (_newsCache[query] && (now - _newsCache[query].ts) < NEWS_TTL) return _newsCache[query].items
  try {
    const xml = await fetchURL(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`)
    const items = parseRSS(xml)
    _newsCache[query] = { items, ts: now }
    return items
  } catch(e) { return [] }
}

// Keyword → CRM tag mappings (used server-side to tag articles)
const NEWS_TAG_KEYWORDS = {
  'apparel':      ['apparel','clothing','fashion','wear','garment','t-shirt','hoodie'],
  'hard-goods':   ['hard goods','equipment','gear','accessories','hardware','tools'],
  'outdoor':      ['outdoor','nature','wildlife','adventure','hiking','mountain','national park','fishing','fish','angler','tackle','bass','fly fishing','camping','camp','backpacking','tent','rv','overlanding'],
  'board-sports': ['skateboard','skate','skating','skater','street sport','snowboard','snow sport','ski','winter sport','surf','surfing','ocean','wave','beach','coastal'],
  'drinkware':    ['drinkware','beverage','bottle','cup','mug','tumbler','hydration','corkcicle','yeti','stanley'],
  'footwear':     ['footwear','shoes','boots','sneakers','shoe','sandal'],
  'puzzles':      ['puzzle','jigsaw','puzzles'],
  'stationery':   ['calendar','planner','agenda','wall art','desk calendar','greeting card','stationery','gift wrap','paper goods','card','cards'],
  'fabric':       ['fabric','textile','quilt','upholstery','material','sewing','pattern'],
  'lifestyle':    ['lifestyle','home decor','gift','collectible','housewares','interior','decor'],
  'licensing-opp': ['seeking artist','looking for artist','artist wanted','call for artists','licensing program','licensing opportunity','open call','artist submission','submit your art','brand collaboration opportunity','looking for illustrator','seeking illustrator','artist partnership','license your art','art licensing program'],
}

function autoTagArticle(item) {
  const text = (item.title + ' ' + (item.source || '') + ' ' + (item.query || '')).toLowerCase()
  const tags = []
  for (const [tag, keywords] of Object.entries(NEWS_TAG_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) tags.push(tag)
  }
  return tags
}

app.get('/api/news', async (req, res) => {
  try {
    const company = req.query.company || null
    let results
    if (company) {
      results = await fetchNewsFor(`"${company}" art licensing OR collaboration OR artist`)
    } else {
      const queries = [
        { q: 'art licensing outdoor brands collaboration',           tags: ['outdoor','lifestyle'] },
        { q: 'artist collaboration skateboard surf snowboard brand', tags: ['skateboard','surf','snowboard'] },
        { q: 'art licensing puzzle calendar greeting cards gift',    tags: ['puzzles','calendars','cards'] },
        { q: 'nature wildlife art brand collaboration',              tags: ['outdoor','lifestyle'] },
        { q: 'drinkware artist collaboration brand licensing',       tags: ['drinkware'] },
        { q: 'apparel fashion artist collaboration licensing',       tags: ['apparel'] },
        { q: 'fishing camping outdoor gear art collaboration',       tags: ['fishing','camping'] },
        { q: 'footwear shoe brand artist collaboration',             tags: ['footwear'] },
        { q: 'fabric textile artist print licensing',                tags: ['fabric'] },
        { q: 'hard goods equipment brand art licensing',             tags: ['hard-goods'] },
        { q: '"seeking artists" OR "call for artists" OR "artist submissions" licensing program brand', tags: ['licensing-opp'] },
      ]
      const allItems = []
      await Promise.all(queries.map(async ({ q, tags }) => {
        const items = await fetchNewsFor(q)
        items.forEach(i => { i.query = q; i.queryTags = tags; allItems.push(i) })
      }))
      const seen = new Set()
      results = allItems
        .filter(i => { if (seen.has(i.title)) return false; seen.add(i.title); return true })
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 80)
    }
    // Auto-tag each article
    results = results.map(i => ({ ...i, tags: autoTagArticle(i) }))
    res.json(results)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ─── LEAD HEAT MAP ───────────────────────────────────────────────────────────

app.get('/api/leads/heatmap', async (req, res) => {
  try {
    const leads = await all(`
      SELECT c.id, c.name, c.type, c.category, c.tags, c.status,
             c.pipeline_stage, c.opportunity_value, c.next_step, c.next_step_date,
             c.last_activity_at, c.updated_at, c.created_at,
             COUNT(ct.id)::int AS contact_count,
             (SELECT COUNT(*)::int FROM enrollments e
                JOIN contacts ct2 ON e.contact_id = ct2.id
                WHERE ct2.company_id = c.id AND e.status = 'active') AS active_sequences,
             (SELECT COUNT(*)::int FROM activities a
                JOIN contacts ct3 ON a.contact_id = ct3.id
                WHERE ct3.company_id = c.id AND a.type = 'received_email') AS reply_count,
             (SELECT COUNT(*)::int FROM activities a
                JOIN contacts ct4 ON a.contact_id = ct4.id
                WHERE ct4.company_id = c.id AND a.type = 'email') AS emails_sent,
             (SELECT MAX(a.sent_at) FROM activities a
                JOIN contacts ct5 ON a.contact_id = ct5.id
                WHERE ct5.company_id = c.id AND a.type = 'received_email') AS last_reply_at,
             (SELECT a.sentiment FROM activities a
                JOIN contacts ct6 ON a.contact_id = ct6.id
                WHERE ct6.company_id = c.id AND a.type = 'received_email' AND a.sentiment IS NOT NULL
                ORDER BY a.sent_at DESC LIMIT 1) AS latest_sentiment
      FROM companies c
      LEFT JOIN contacts ct ON c.id = ct.company_id
      WHERE c.status != 'dead'
      GROUP BY c.id
      ORDER BY c.name ASC
    `)
    res.json(leads)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── STUCK COUNT ─────────────────────────────────────────────────────────────

app.get('/api/pipeline/stuck-count', async (req, res) => {
  try {
    const result = await one(`
      SELECT COUNT(*)::int AS count
      FROM enrollments e
      WHERE e.status = 'active'
        AND (
          (SELECT MAX(sent_at) FROM activities WHERE contact_id = e.contact_id) < NOW() - INTERVAL '14 days'
          OR (
            (SELECT MAX(sent_at) FROM activities WHERE contact_id = e.contact_id) IS NULL
            AND e.started_at < NOW() - INTERVAL '14 days'
          )
        )
    `)
    res.json({ count: result.count })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── ART GALLERY ────────────────────────────────────────────────────────────

const ART_SEEDS = [
  // ── Collaborations (original) ──
  { title: 'Soulcraft Wake Surf Boards', url: 'https://phillewisart.com/cdn/shop/articles/soulcraft-header2_600x.jpg?v=1630337503', tags: 'skateboard,surf', category: 'boards' },
  { title: 'Meier Skis', url: 'https://phillewisart.com/cdn/shop/articles/Final_3_wood_demo_8041b6df-1fe3-4780-98f7-802164043715_600x.jpg?v=1645204598', tags: 'snowboard,outdoor', category: 'boards' },
  { title: 'Epic Water Filters', url: 'https://phillewisart.com/cdn/shop/articles/epic-hero2_600x.jpg?v=1604016747', tags: 'drinkware,camping,fishing', category: 'drinkware' },
  { title: 'Liberty Puzzles', url: 'https://phillewisart.com/cdn/shop/articles/Phil_Lewis_Product4423WEB_600x.jpg?v=1603909822', tags: 'puzzles,calendars,cards', category: 'print' },
  { title: 'Third Eye Tapestries', url: 'https://phillewisart.com/cdn/shop/articles/Phil_Lewis_Product4973WEB_768653d3-f5fc-42a1-8a97-c2929961780a_600x.jpg?v=1603909864', tags: 'fabric,lifestyle', category: 'home-decor' },
  { title: 'LogoJET UV Products', url: 'https://phillewisart.com/cdn/shop/articles/Phil_Lewis_Product5843WEB_fadcaa8c-3b21-462c-b8be-26b402bc6f94_600x.jpg?v=1747320948', tags: 'hard-goods', category: 'hard-goods', is_default: true },
  { title: 'Grassroots California', url: 'https://phillewisart.com/cdn/shop/articles/Phil_Lewis_Product4389WEB_600x.jpg?v=1603909818', tags: 'apparel,footwear', category: 'apparel' },
  { title: 'Minute Key', url: 'https://phillewisart.com/cdn/shop/articles/minute-key-collab-hero_600x.jpg?v=1603909120', tags: 'hard-goods,lifestyle', category: 'hard-goods' },
  { title: 'PAMP Silver Coins', url: 'https://phillewisart.com/cdn/shop/articles/package-open_600x.jpg?v=1623250937', tags: 'hard-goods,lifestyle', category: 'collectibles' },
  // ── Stickers & Collectibles ──
  { title: 'Sticker Pack — 7 Chakras', url: 'https://phillewisart.com/cdn/shop/products/stickerpack3.jpg?v=1618612977', tags: 'stickers,collectibles', category: 'stickers' },
  { title: 'Pop Sockets', url: 'https://phillewisart.com/cdn/shop/products/PhilLewisProduct4471WEB.jpg?v=1651449244', tags: 'collectibles,tech,accessories', category: 'collectibles' },
  // ── Apparel ──
  { title: 'Ice Fox Hoodie', url: 'https://phillewisart.com/cdn/shop/products/PhilLewisProduct4906WEB_600x.jpg?v=1603406278', tags: 'apparel,hoodie', category: 'apparel' },
  { title: 'Jellyfish Nimbus Hat', url: 'https://phillewisart.com/cdn/shop/products/PhilLewisProduct4406WEB_600x.jpg?v=1603403562', tags: 'apparel,hat,accessories', category: 'apparel' },
  { title: 'Winter Carnival Hoodie', url: 'https://phillewisart.com/cdn/shop/files/MainPic_2Phil2_600x.jpg?v=1730044303', tags: 'apparel,hoodie', category: 'apparel' },
  { title: 'Orcas Hat', url: 'https://phillewisart.com/cdn/shop/files/IMG_5121_600x.jpg?v=1752704659', tags: 'apparel,hat,accessories', category: 'apparel' },
  { title: 'Phil Lewis Socks', url: 'https://phillewisart.com/cdn/shop/products/peace-socks-mockup_600x.jpg?v=1603403450', tags: 'apparel,socks,accessories', category: 'apparel' },
  // ── Drinkware ──
  { title: 'Limited-Edition Prism Tumblers', url: 'https://phillewisart.com/cdn/shop/files/2_28b0a853-eb82-4cfb-ab66-a995f5e1c229_600x.jpg?v=1764110919', tags: 'drinkware,tumbler', category: 'drinkware' },
  { title: 'Insulated Wine Tumblers', url: 'https://phillewisart.com/cdn/shop/products/IMG_1886_600x.jpg?v=1658670818', tags: 'drinkware,tumbler', category: 'drinkware' },
  { title: 'Sea Turtles — 24oz Nalgene', url: 'https://phillewisart.com/cdn/shop/files/7E4607EF-AE84-4CDC-B418-410C646532EB_600x.jpg?v=1731084916', tags: 'drinkware,bottle', category: 'drinkware' },
  { title: 'Ceramic Mugs', url: 'https://phillewisart.com/cdn/shop/files/IMG_1657_600x.jpg?v=1702159686', tags: 'drinkware,mug', category: 'drinkware' },
  { title: 'Owl Eyes — 32oz Flask', url: 'https://phillewisart.com/cdn/shop/products/PhilLewisProduct6552_600x.jpg?v=1603496408', tags: 'drinkware,flask', category: 'drinkware' },
  { title: 'Let it Flow — CamelBak Bottle', url: 'https://phillewisart.com/cdn/shop/files/4_6af829a9-f8ed-42be-8f33-5bdda2fbfb0c_600x.jpg?v=1767798332', tags: 'drinkware,bottle', category: 'drinkware' },
  // ── Boardsports ──
  { title: 'Skateboard Decks', url: 'https://phillewisart.com/cdn/shop/products/IMG_0896_600x.jpg?v=1646926505', tags: 'skateboard,boardsports', category: 'boards' },
  { title: 'Skateboard Grip Tape', url: 'https://phillewisart.com/cdn/shop/files/three-headed-dragon_3903ccd9-da88-4bf2-86d5-2feabf344e40_600x.jpg?v=1762356481', tags: 'skateboard,boardsports', category: 'boards' },
  { title: 'Custom Traction Pads', url: 'https://phillewisart.com/cdn/shop/files/1_69101f2a-4b32-4f2d-9646-06617f1596b6_600x.jpg?v=1775862568', tags: 'surf,boardsports', category: 'boards' },
  { title: 'Soulcraft Custom Surfboards', url: 'https://phillewisart.com/cdn/shop/products/surfboard1_600x.jpg?v=1639755792', tags: 'surf,boardsports', category: 'boards' },
  { title: 'Meier Custom Skis & Snowboards', url: 'https://phillewisart.com/cdn/shop/products/Pow-Days_600x.jpg?v=1701384339', tags: 'snowboard,ski,boardsports,outdoor', category: 'boards' },
  // ── Tech ──
  { title: 'XL Desk Mat — Lion', url: 'https://phillewisart.com/cdn/shop/files/Lion2_600x.jpg?v=1767200990', tags: 'tech,desk,accessories', category: 'tech' },
  { title: 'XL Desk Mat — Let it Flow', url: 'https://phillewisart.com/cdn/shop/files/Let-it-Flow2_fad4d1c7-72b5-42ad-afc7-b6227aec4be8_600x.jpg?v=1767201092', tags: 'tech,desk,accessories', category: 'tech' },
  { title: 'XL Desk Mat — Owl Eyes', url: 'https://phillewisart.com/cdn/shop/files/owl-eyes2_8bbdbdf0-ad30-4573-89c8-fa52b14fe1a0_600x.jpg?v=1767201037', tags: 'tech,desk,accessories', category: 'tech' },
  { title: 'XL Desk Mat — Red Rocks Remix', url: 'https://phillewisart.com/cdn/shop/files/Red-Rocks2_dd97a344-1c71-436b-8086-374f2f368717_600x.jpg?v=1767201062', tags: 'tech,desk,accessories', category: 'tech' },
  // ── Custom Engraving ──
  { title: 'Custom Engraving Projects', url: 'https://phillewisart.com/cdn/shop/products/Engravings-custom_items_-_57_of_113_1024x.jpg?v=1573872914', tags: 'engraving,custom,hard-goods,laser', category: 'engraving' },
  { title: 'Custom Engraving — Sample 1', url: 'https://phillewisart.com/cdn/shop/products/Engravings-custom_items_-_1_of_113_800x.jpg?v=1573872914', tags: 'engraving,custom,hard-goods,laser', category: 'engraving' },
  { title: 'Custom Engraving — Sample 2', url: 'https://phillewisart.com/cdn/shop/products/Engravings-custom_items_-_3_of_113_800x.jpg?v=1573872914', tags: 'engraving,custom,hard-goods,laser', category: 'engraving' },
  // ── Kids & Games ──
  { title: 'Go Fish Card Game', url: 'https://phillewisart.com/cdn/shop/files/deck_600x.jpg?v=1729436140', tags: 'kids,games,cards,family', category: 'kids-games' },
  { title: 'Animal Friends — Children\'s Book', url: 'https://phillewisart.com/cdn/shop/products/PhilLewisProduct4454WEB_32da098a-f2c6-4ab2-8edb-9eb36a96d273_600x.jpg?v=1603403270', tags: 'kids,books,children,family', category: 'kids-games' },
  { title: 'Coloring Book Combo', url: 'https://phillewisart.com/cdn/shop/products/PhilLewisProduct4501WEB_600x.jpg?v=1603404713', tags: 'kids,books,coloring,family', category: 'kids-games' },
  // ── Pets ──
  { title: 'Engraved Dog Tags', url: 'https://phillewisart.com/cdn/shop/products/PhilLewisProduct4667WEB_600x.jpg?v=1603405298', tags: 'pets,dog,tags,engraving,accessories', category: 'pets' },
  // ── Disc Sports ──
  { title: 'Octopus — Canyon Golf Disc', url: 'https://phillewisart.com/cdn/shop/files/octopus-canyon_600x.jpg?v=1752184951', tags: 'golf,disc,sports,outdoor', category: 'disc-sports' },
  { title: 'Trash Panda Golf Discs', url: 'https://phillewisart.com/cdn/shop/files/River-Dance_600x.jpg?v=1702851822', tags: 'golf,disc,sports,outdoor', category: 'disc-sports' },
  { title: 'Lotus Ultimate Frisbee', url: 'https://phillewisart.com/cdn/shop/files/lotus-ultimate-mock-up_600x.jpg?v=1695057826', tags: 'frisbee,disc,sports,outdoor', category: 'disc-sports' },
  // ── Home Decor (tapestries, blankets) ──
  { title: 'Jellyfish Nimbus Tapestry', url: 'https://phillewisart.com/cdn/shop/products/Lewis_Jellyfish_T_600x.png?v=1573872900', tags: 'tapestry,fabric,home-decor,lifestyle', category: 'home-decor' },
  { title: 'Red Rocks Tapestry', url: 'https://phillewisart.com/cdn/shop/products/Lewis_Redrocks_T_600x.png?v=1573872912', tags: 'tapestry,fabric,home-decor,lifestyle', category: 'home-decor' },
  { title: 'Lion — Sherpa Blanket', url: 'https://phillewisart.com/cdn/shop/products/IMG_0851_600x.jpg?v=1646014118', tags: 'blanket,home-decor,lifestyle,fabric', category: 'home-decor' },
  { title: 'Foxy — Woven Blanket', url: 'https://phillewisart.com/cdn/shop/products/IMG_2680_600x.jpeg?v=1603563608', tags: 'blanket,home-decor,lifestyle,fabric', category: 'home-decor' },
  // ── Pins, Patches & Accessories ──
  { title: 'Giraffes — Embroidered Patch', url: 'https://phillewisart.com/cdn/shop/products/PhilLewisProduct4487WEB_600x.jpg?v=1603404560', tags: 'pins,patches,accessories,collectibles', category: 'accessories' },
  { title: 'Lord Gush Pin', url: 'https://phillewisart.com/cdn/shop/products/PhilLewisProduct4749WEB_600x.jpg?v=1603405656', tags: 'pins,accessories,collectibles', category: 'accessories' },
  { title: 'Jellyfish Moodmat', url: 'https://phillewisart.com/cdn/shop/products/PhilLewisProduct4636WEB_600x.jpg?v=1603405200', tags: 'accessories,barware,lifestyle', category: 'accessories' },
  // ── Barware ──
  { title: 'Engraved Bottle Openers', url: 'https://phillewisart.com/cdn/shop/products/PhilLewisProduct4665WEB_600x.jpg?v=1603405259', tags: 'barware,bottle-opener,engraving,hard-goods', category: 'barware' },
  { title: 'Printed Bottle Openers', url: 'https://phillewisart.com/cdn/shop/products/IMG_0918_600x.jpg?v=1647372872', tags: 'barware,bottle-opener,hard-goods', category: 'barware' },
  // ── Greeting Cards ──
  { title: 'Greeting Cards', url: 'https://phillewisart.com/cdn/shop/products/wolfsong_a006b5ab-91cb-415e-aaf9-e7941f54d75f_600x.jpg?v=1602521191', tags: 'cards,greeting,stationery,print', category: 'print' },
  { title: 'Sea Turtles — Greeting Card', url: 'https://phillewisart.com/cdn/shop/files/sea-turtles-card-mockup_600x.jpg?v=1729892058', tags: 'cards,greeting,stationery,print', category: 'print' },
  // ── Books & Journals ──
  { title: 'Phil Lewis Journals', url: 'https://phillewisart.com/cdn/shop/products/IMG_2981_600x.jpg?v=1672265639', tags: 'books,journals,stationery,print', category: 'print' },
  // ── Apparel extras (boardshorts) ──
  { title: 'Let it Flow — Boardshorts', url: 'https://phillewisart.com/cdn/shop/files/Shorts3_600x.jpg?v=1721420070', tags: 'apparel,boardshorts,surf,outdoor', category: 'apparel' },
]

async function seedArtIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM art_images')
  if (rows[0].n === 0) {
    for (const s of ART_SEEDS) {
      await pool.query(
        'INSERT INTO art_images (title, url, tags, category, is_default) VALUES ($1,$2,$3,$4,$5)',
        [s.title, s.url, s.tags, s.category, s.is_default || false]
      )
    }
  }
}

app.get('/api/art', async (req, res) => {
  try {
    await migrationReady
    await seedArtIfEmpty()
    res.json(await all('SELECT * FROM art_images ORDER BY created_at DESC'))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/art', async (req, res) => {
  try {
    const { title, url, tags, category, notes, is_default } = req.body
    if (!title || !url) return res.status(400).json({ error: 'Title and URL are required' })
    // If marking as default, clear others
    if (is_default) await run('UPDATE art_images SET is_default=FALSE WHERE is_default=TRUE')
    const row = await one(
      'INSERT INTO art_images (title, url, tags, category, notes, is_default) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [title, url, tags || '', category || '', notes || '', is_default || false]
    )
    res.json(row)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.put('/api/art/:id', async (req, res) => {
  try {
    const { title, url, tags, category, notes, is_default } = req.body
    if (is_default) await run('UPDATE art_images SET is_default=FALSE WHERE is_default=TRUE')
    const row = await one(
      'UPDATE art_images SET title=$1, url=$2, tags=$3, category=$4, notes=$5, is_default=$6 WHERE id=$7 RETURNING *',
      [title, url, tags || '', category || '', notes || '', is_default || false, req.params.id]
    )
    res.json(row)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/art/:id', async (req, res) => {
  try {
    await run('DELETE FROM art_images WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Returns art images matching given tags (for sequence editor auto-pick)
app.get('/api/art/match', async (req, res) => {
  try {
    const tagsParam = (req.query.tags || '').toLowerCase().split(',').map(t => t.trim()).filter(Boolean)
    const artRows = await all('SELECT * FROM art_images ORDER BY id')
    const matched = []
    const rest = []
    for (const a of artRows) {
      const artTags = (a.tags || '').toLowerCase().split(',').map(t => t.trim())
      if (tagsParam.some(t => artTags.includes(t))) matched.push(a)
      else rest.push(a)
    }
    res.json({ matched, rest })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── REPLY TEMPLATES ────────────────────────────────────────────────────────

const REPLY_SEEDS = [
  {
    name: 'Interested — Send Licensing Deck',
    category: 'interested',
    subject: 'Re: {{original_subject}}',
    body: `Hi {{first_name}},

Great to hear from you! I'd love to explore what a collaboration between Phil Lewis Art and {{company}} could look like.

I've attached our licensing overview — it covers how we typically work with partners, usage terms, and a few examples of past collaborations.

{{art_block}}

I'd be happy to jump on a quick call to walk through ideas whenever works for you. What does your schedule look like this week or next?

Best,
Phil Lewis`,
    sort_order: 1,
  },
  {
    name: 'Pricing & Terms',
    category: 'pricing',
    subject: 'Re: {{original_subject}}',
    body: `Hi {{first_name}},

Thanks for asking — happy to share how licensing works with Phil Lewis Art.

Licensing terms are flexible depending on the product type, run size, and distribution. Most of our partnerships are royalty-based, though we also do flat-fee arrangements for limited runs.

Here's an example of what Phil's art looks like on a product in your space:

{{art_block}}

Want to set up a quick call to talk specifics? I can put together a custom proposal based on what {{company}} has in mind.

Best,
Phil Lewis`,
    sort_order: 2,
  },
  {
    name: 'Not Now — Stay in Touch',
    category: 'later',
    subject: 'Re: {{original_subject}}',
    body: `Hi {{first_name}},

Totally understand — timing is everything. I appreciate you letting me know.

I'll circle back in a few months to see if things have opened up. In the meantime, here's a look at one of Phil's recent collaborations to keep on your radar:

{{art_block}}

Feel free to reach out anytime if something comes up sooner. Wishing {{company}} a great rest of the year!

Best,
Phil Lewis`,
    sort_order: 3,
  },
  {
    name: 'Product Fit — Show Examples',
    category: 'examples',
    subject: 'Re: {{original_subject}}',
    body: `Hi {{first_name}},

Great question! Phil's art works beautifully across a range of product types. Here's an example that I think lines up well with what {{company}} does:

{{art_block}}

The art is available in high-resolution formats and we can adapt it to fit any product spec — packaging, all-over prints, spot graphics, you name it.

Would you like to see a few mockups tailored to your product line? I'd love to put something together.

Best,
Phil Lewis`,
    sort_order: 4,
  },
  {
    name: 'Follow Up — Checking In',
    category: 'follow-up',
    subject: 'Re: {{original_subject}}',
    body: `Hi {{first_name}},

Just wanted to circle back and see if you've had a chance to think about a potential collaboration with Phil Lewis Art.

Here's a quick look at Phil's work on a product similar to yours — always a good conversation starter:

{{art_block}}

No pressure at all — just wanted to keep the door open. Let me know if you'd like to chat.

Best,
Phil Lewis`,
    sort_order: 5,
  },
  {
    name: 'Thank You — Post-Meeting',
    category: 'thanks',
    subject: 'Re: {{original_subject}}',
    body: `Hi {{first_name}},

Really enjoyed our conversation — thanks for taking the time to chat about what a Phil Lewis Art × {{company}} collaboration could look like.

As a reminder, here's one of the pieces we discussed:

{{art_block}}

I'll get that proposal over to you by end of week. In the meantime, don't hesitate to reach out with any questions.

Looking forward to working together!

Best,
Phil Lewis`,
    sort_order: 6,
  },
]

async function seedReplyTemplatesIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM reply_templates')
  if (rows[0].n === 0) {
    for (const t of REPLY_SEEDS) {
      await pool.query(
        'INSERT INTO reply_templates (name, category, subject, body, sort_order) VALUES ($1,$2,$3,$4,$5)',
        [t.name, t.category, t.subject, t.body, t.sort_order]
      )
    }
  }
}

app.get('/api/reply-templates', async (req, res) => {
  try {
    await seedReplyTemplatesIfEmpty()
    res.json(await all('SELECT * FROM reply_templates ORDER BY sort_order, id'))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/reply-templates', async (req, res) => {
  try {
    const { name, category, subject, body, sort_order } = req.body
    if (!name) return res.status(400).json({ error: 'Name is required' })
    const row = await one(
      'INSERT INTO reply_templates (name, category, subject, body, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [name, category || 'general', subject || '', body || '', sort_order || 0]
    )
    res.json(row)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.put('/api/reply-templates/:id', async (req, res) => {
  try {
    const { name, category, subject, body, sort_order } = req.body
    const row = await one(
      'UPDATE reply_templates SET name=$1, category=$2, subject=$3, body=$4, sort_order=$5 WHERE id=$6 RETURNING *',
      [name, category || 'general', subject || '', body || '', sort_order || 0, req.params.id]
    )
    res.json(row)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/reply-templates/:id', async (req, res) => {
  try {
    await run('DELETE FROM reply_templates WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── QUICK REPLY (send a templated reply to a prospect) ────────────────────

app.post('/api/quick-reply', async (req, res) => {
  try {
    const { activity_id, subject, body } = req.body
    if (!activity_id || !body) return res.status(400).json({ error: 'activity_id and body required' })

    // Look up the original inbound activity
    const orig = await one(`
      SELECT a.*, c.email AS contact_email, c.first_name, c.last_name, c.id AS cid,
             co.name AS company_name
      FROM activities a
      LEFT JOIN contacts c ON a.contact_id = c.id
      LEFT JOIN companies co ON c.company_id = co.id
      WHERE a.id = $1
    `, [activity_id])
    if (!orig) return res.status(404).json({ error: 'Activity not found' })
    if (!orig.contact_email) return res.status(400).json({ error: 'Contact has no email address' })

    // Get SMTP settings
    const settings = {}
    const sRows = await all('SELECT key, value FROM settings')
    sRows.forEach(r => { settings[r.key] = r.value })

    if (!settings.smtp_host || !settings.smtp_user || !settings.smtp_pass) {
      return res.status(400).json({ error: 'SMTP not configured. Set up email in Settings first.' })
    }

    const nodemailer = require('nodemailer')
    const transport = nodemailer.createTransport({
      host: settings.smtp_host,
      port: parseInt(settings.smtp_port || '587'),
      secure: (settings.smtp_port || '587') === '465',
      auth: { user: settings.smtp_user, pass: settings.smtp_pass },
    })

    const fromName = settings.from_name || 'Phil Lewis Art'
    const fromEmail = settings.smtp_user

    await transport.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: orig.contact_email,
      subject: subject || `Re: ${orig.subject || ''}`,
      html: body.replace(/\n/g, '<br>'),
    })

    // Log the reply as an activity
    await one(
      'INSERT INTO activities (contact_id, type, subject, body, status, sent_at) VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING id',
      [orig.cid, 'email', subject || `Re: ${orig.subject || ''}`, body, 'sent']
    )

    // Mark the original as read
    await run("UPDATE activities SET notes='read' WHERE id=$1", [activity_id])

    res.json({ ok: true, to: orig.contact_email })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── CATCH ALL (SPA) ─────────────────────────────────────────────────────────

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// Export for Vercel serverless; listen locally when run directly
if (require.main === module) {
  app.listen(PORT, () => console.log(`\n  Phil Lewis Art CRM running at http://localhost:${PORT}\n`))
}

module.exports = app
