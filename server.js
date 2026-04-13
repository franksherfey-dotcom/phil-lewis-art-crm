require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const multer = require('multer')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')

const pool = require('./lib/db')
const { sendEmail, syncInbox, testConnection, interpolate } = require('./emailer')
const { run, one, all, getArtForCompany, buildArtEmailBlock } = require('./lib/helpers')

const app = express()
const PORT = process.env.PORT || 3000
const JWT_SECRET = process.env.JWT_SECRET || 'pla-crm-secret-please-set-JWT_SECRET-env-var'
const JWT_EXPIRES = '30d'

// Store CSV files in memory — no disk writes (required for Vercel)
const upload = multer({ storage: multer.memoryStorage() })

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

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
        type TEXT NOT NULL DEFAULT 'art',
        priority INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    console.log('✅ Art gallery table ready.')

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

    // Tag known licensing partners
    var licensingPartners = ['MinuteKey', 'Minute Key', 'Meier', 'Soulcraft']
    for (var lp of licensingPartners) {
      await pool.query(`
        UPDATE companies SET tags = CASE
          WHEN tags IS NULL OR tags = '' THEN 'licensing'
          WHEN tags NOT LIKE '%licensing%' THEN tags || ',licensing'
          ELSE tags
        END
        WHERE LOWER(name) LIKE LOWER($1)
      `, ['%' + lp + '%'])
    }
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

// Apply admin requirement where needed
function requireAdminRoute(req, res, next) {
  requireAdmin(req, res, next)
}

// ─── MOUNT ROUTE MODULES ─────────────────────────────────────────────────────
const authRouter = require('./routes/auth')
authRouter.setMigrationReady(migrationReady)

app.use('/api/auth', authRouter)
app.use('/api/users', requireAdminRoute, require('./routes/users'))
app.use('/api/dashboard', require('./routes/dashboard'))
app.use('/api/companies', require('./routes/companies'))
app.use('/api/contacts', require('./routes/contacts'))
app.use('/api/sequences', require('./routes/sequences'))
app.use('/api/enrollments', require('./routes/enrollments'))
app.use('/api/queue', require('./routes/queue'))
app.use('/api/activities', require('./routes/activities'))
app.use('/api/settings', require('./routes/settings'))
app.use('/api', require('./routes/pipeline'))
app.use('/api', require('./routes/inbox'))
app.use('/api/art', require('./routes/art'))
app.use('/api/reply-templates', require('./routes/templates'))
app.use('/api/import', require('./routes/import'))
app.use('/api', require('./routes/news'))
app.use('/api', require('./routes/cron'))
app.use('/api', require('./routes/portfolio'))

// ─── CATCH ALL (SPA) ─────────────────────────────────────────────────────────
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// Export for Vercel serverless; listen locally when run directly
if (require.main === module) {
  app.listen(PORT, () => console.log(`\n  Phil Lewis Art CRM running at http://localhost:${PORT}\n`))
}

module.exports = app
