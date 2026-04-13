const express = require('express')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const pool = require('../lib/db')

const router = express.Router()

const JWT_SECRET = process.env.JWT_SECRET || 'pla-crm-secret-please-set-JWT_SECRET-env-var'
const JWT_EXPIRES = '30d'

// Migration promise from server.js
let migrationReady

// Called from server.js to set migrationReady
router.setMigrationReady = (promise) => {
  migrationReady = promise
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
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

// GET /api/auth/me
router.get('/me', async (req, res) => {
  try {
    await migrationReady
    const { rows } = await pool.query('SELECT id,username,display_name,email,role,force_password_change,last_login_at FROM users WHERE id=$1', [req.user.userId])
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' })
    res.json(rows[0])
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// POST /api/auth/change-password
router.post('/change-password', async (req, res) => {
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

module.exports = router
