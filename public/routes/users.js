const express = require('express')
const bcrypt = require('bcryptjs')
const pool = require('../lib/db')

const router = express.Router()

// GET /api/users
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id,username,display_name,email,role,force_password_change,created_at,last_login_at FROM users ORDER BY id ASC')
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// POST /api/users
router.post('/', async (req, res) => {
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

// PUT /api/users/:id
router.put('/:id', async (req, res) => {
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

// DELETE /api/users/:id
router.delete('/:id', async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.userId) return res.status(400).json({ error: 'Cannot delete your own account.' })
    await pool.query('DELETE FROM users WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// POST /api/users/:id/reset-password
router.post('/:id/reset-password', async (req, res) => {
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

module.exports = router
