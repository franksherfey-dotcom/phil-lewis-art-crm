require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const jwt = require('jsonwebtoken')

const pool = require('./lib/db')

const app = express()
const PORT = process.env.PORT || 3000
if (!process.env.JWT_SECRET && process.env.VERCEL) {
  throw new Error('JWT_SECRET environment variable must be set in production')
}
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret'
const JWT_EXPIRES = '30d'

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ─── SCHEMA ──────────────────────────────────────────────────────────────────
// The schema is stable. The old on-boot migration/seed block ran ~10 queries on
// every serverless cold start; it was removed 2026-07. Run one-off migrations in
// the Supabase SQL editor instead.
const migrationReady = Promise.resolve()

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

// ─── MOUNT ROUTE MODULES ─────────────────────────────────────────────────────
const authRouter = require('./routes/auth')
authRouter.setMigrationReady(migrationReady)

app.use('/api/auth', authRouter)
app.use('/api/users', requireAdmin, require('./routes/users'))
app.use('/api/dashboard', require('./routes/dashboard'))
app.use('/api/companies', require('./routes/companies'))
app.use('/api/contacts', require('./routes/contacts'))
app.use('/api/sequences', require('./routes/sequences'))
app.use('/api/enrollments', require('./routes/enrollments'))
app.use('/api/new-leads', require('./routes/new-leads'))
app.use('/api/queue', require('./routes/queue'))
app.use('/api/activities', require('./routes/activities'))
app.use('/api/settings', requireAdmin, require('./routes/settings'))  // holds SMTP credentials
app.use('/api', require('./routes/pipeline'))
app.use('/api', require('./routes/inbox'))
app.use('/api/art', require('./routes/art'))
app.use('/api/reply-templates', require('./routes/templates'))
app.use('/api/import', require('./routes/import'))
app.use('/api', require('./routes/news'))
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
