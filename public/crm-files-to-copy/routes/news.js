const express = require('express')
const http = require('http')
const https = require('https')
const router = express.Router()

// ── HTTP fetch with redirect following ────────────────────────────────────
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

// ── RSS parser ────────────────────────────────────────────────────────────
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

// ── Cached news fetcher ───────────────────────────────────────────────────
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

// ── Article auto-tagging ──────────────────────────────────────────────────
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

// Keywords that flag an article as "must read" for licensing opportunities
const MUST_READ_KEYWORDS = [
  'seeking artist','looking for artist','artist wanted','call for artists',
  'licensing program','licensing opportunity','open call','artist submission',
  'submit your art','looking for illustrator','seeking illustrator',
  'artist partnership','license your art','art licensing program',
  'brand collaboration opportunity','new licensing','accepting submissions',
  'artist roster','seeking creative','looking for creative',
]

function autoTagArticle(item) {
  const text = (item.title + ' ' + (item.source || '') + ' ' + (item.query || '')).toLowerCase()
  const tags = []
  for (const [tag, keywords] of Object.entries(NEWS_TAG_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) tags.push(tag)
  }
  return tags
}

function isMustRead(item) {
  const text = (item.title + ' ' + (item.source || '')).toLowerCase()
  return MUST_READ_KEYWORDS.some(kw => text.includes(kw))
}

// ── API endpoint ──────────────────────────────────────────────────────────
router.get('/news', async (req, res) => {
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
    // Auto-tag each article and flag must-reads
    results = results.map(i => ({
      ...i,
      tags: autoTagArticle(i),
      mustRead: isMustRead(i),
    }))
    // Sort must-reads to top
    results.sort((a, b) => {
      if (a.mustRead && !b.mustRead) return -1
      if (!a.mustRead && b.mustRead) return 1
      return new Date(b.date) - new Date(a.date)
    })
    res.json(results)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
