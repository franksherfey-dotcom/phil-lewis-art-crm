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
        SELECT a.*, c.first_name, c.last_name, co.name AS company_name
        FROM activities a
        LEFT JOIN contacts c ON a.contact_id = c.id
        LEFT JOIN companies co ON c.company_id = co.id
        ORDER BY a.sent_at DESC LIMIT 10
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
    if (type)   { sql += ` AND c.type=$${i}`;   params.push(type);   i++ }
    if (status) { sql += ` AND c.status=$${i}`; params.push(status); i++ }
    if (tag)    { sql += ` AND (',' || c.tags || ',') LIKE $${i}`; params.push(`%,${tag},%`); i++ }
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
    if (category)   { sql += ` AND co.category ILIKE $${i}`; params.push(category); i++ }
    if (tag)        { sql += ` AND (',' || co.tags || ',') LIKE $${i}`; params.push(`%,${tag},%`); i++ }
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
      const { n } = await one(
        "SELECT COUNT(*)::int AS n FROM enrollments WHERE sequence_id=$1 AND status='active'",
        [s.id]
      )
      s.enrollment_count = n
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
      WHERE NOT EXISTS (
        SELECT 1 FROM enrollments e WHERE e.contact_id = c.id AND e.status = 'active'
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
      // Avoid duplicates — check if this subject+sent_at already logged
      const existing = await one(
        `SELECT id FROM activities WHERE contact_id=$1 AND type='received_email' AND subject=$2 AND sent_at=$3`,
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
  'apparel':    ['apparel','clothing','fashion','wear','garment','t-shirt','hoodie'],
  'hard-goods': ['hard goods','equipment','gear','accessories','hardware','tools'],
  'outdoor':    ['outdoor','nature','wildlife','adventure','hiking','mountain','national park'],
  'skateboard': ['skateboard','skate','skating','skater','street sport'],
  'snowboard':  ['snowboard','snow sport','ski','winter sport'],
  'surf':       ['surf','surfing','ocean','wave','beach','coastal'],
  'fishing':    ['fishing','fish','angler','tackle','bass','fly fishing'],
  'camping':    ['camping','camp','backpacking','tent','rv','overlanding'],
  'drinkware':  ['drinkware','beverage','bottle','cup','mug','tumbler','hydration','corkcicle','yeti','stanley'],
  'footwear':   ['footwear','shoes','boots','sneakers','shoe','sandal'],
  'puzzles':    ['puzzle','jigsaw','puzzles'],
  'calendars':  ['calendar','planner','agenda','wall art','desk calendar'],
  'fabric':     ['fabric','textile','quilt','upholstery','material','sewing','pattern'],
  'cards':      ['greeting card','stationery','gift wrap','paper goods','card'],
  'lifestyle':  ['lifestyle','home decor','gift','collectible','housewares','interior','decor'],
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
  { title: 'Soulcraft Wake Surf Boards', url: 'https://phillewisart.com/cdn/shop/articles/soulcraft-header2_600x.jpg?v=1630337503', tags: 'skateboard,surf', category: 'boards' },
  { title: 'Meier Skis', url: 'https://phillewisart.com/cdn/shop/articles/Final_3_wood_demo_8041b6df-1fe3-4780-98f7-802164043715_600x.jpg?v=1645204598', tags: 'snowboard,outdoor', category: 'boards' },
  { title: 'Epic Water Filters', url: 'https://phillewisart.com/cdn/shop/articles/epic-hero2_600x.jpg?v=1604016747', tags: 'drinkware,camping,fishing', category: 'drinkware' },
  { title: 'Liberty Puzzles', url: 'https://phillewisart.com/cdn/shop/articles/Phil_Lewis_Product4423WEB_600x.jpg?v=1603909822', tags: 'puzzles,calendars,cards', category: 'print' },
  { title: 'Third Eye Tapestries', url: 'https://phillewisart.com/cdn/shop/articles/Phil_Lewis_Product4973WEB_768653d3-f5fc-42a1-8a97-c2929961780a_600x.jpg?v=1603909864', tags: 'fabric,lifestyle', category: 'home-decor' },
  { title: 'LogoJET UV Products', url: 'https://phillewisart.com/cdn/shop/articles/Phil_Lewis_Product5843WEB_fadcaa8c-3b21-462c-b8be-26b402bc6f94_600x.jpg?v=1747320948', tags: 'hard-goods', category: 'hard-goods', is_default: true },
  { title: 'Grassroots California', url: 'https://phillewisart.com/cdn/shop/articles/Phil_Lewis_Product4389WEB_600x.jpg?v=1603909818', tags: 'apparel,footwear', category: 'apparel' },
  { title: 'Minute Key', url: 'https://phillewisart.com/cdn/shop/articles/minute-key-collab-hero_600x.jpg?v=1603909120', tags: 'hard-goods,lifestyle', category: 'hard-goods' },
  { title: 'PAMP Silver Coins', url: 'https://phillewisart.com/cdn/shop/articles/package-open_600x.jpg?v=1623250937', tags: 'hard-goods,lifestyle', category: 'collectibles' },
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

// ─── CATCH ALL (SPA) ─────────────────────────────────────────────────────────

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// Export for Vercel serverless; listen locally when run directly
if (require.main === module) {
  app.listen(PORT, () => console.log(`\n  Phil Lewis Art CRM running at http://localhost:${PORT}\n`))
}

module.exports = app
