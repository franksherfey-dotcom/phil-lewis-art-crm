const express = require('express')
const { one, all, run } = require('../lib/helpers')

const router = express.Router()

// GET /api/activities
router.get('/', async (req, res) => {
  try {
    const { contact_id, enrollment_id, type } = req.query
    let sql = 'SELECT * FROM activities WHERE 1=1'
    const params = []
    if (contact_id) { sql += ' AND contact_id=$1'; params.push(contact_id) }
    if (enrollment_id) { sql += ` AND enrollment_id=$${params.length+1}`; params.push(enrollment_id) }
    if (type) { sql += ` AND type=$${params.length+1}`; params.push(type) }
    sql += ' ORDER BY sent_at DESC LIMIT 200'
    res.json(await all(sql, params))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// POST /api/activities
router.post('/', async (req, res) => {
  try {
    const { contact_id, enrollment_id, type, subject, body, notes } = req.body
    if (!contact_id || !type) return res.status(400).json({ error: 'contact_id and type required' })
    const r = await one(`
      INSERT INTO activities (contact_id, enrollment_id, type, subject, body, notes, status, sent_at)
      VALUES ($1,$2,$3,$4,$5,$6,'logged',NOW()) RETURNING id
    `, [contact_id, enrollment_id||null, type, subject||'', body||'', notes||''])
    res.json({ id: r.id })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// DELETE /api/activities/:id
router.delete('/:id', async (req, res) => {
  try {
    await run('DELETE FROM activities WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// PATCH /api/activities/:id/archive
router.patch('/:id/archive', async (req, res) => {
  try {
    await run("UPDATE activities SET notes='archived' WHERE id=$1", [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// PATCH /api/activities/:id/toggle-read
router.patch('/:id/toggle-read', async (req, res) => {
  try {
    const act = await one('SELECT notes FROM activities WHERE id=$1', [req.params.id])
    if (!act) return res.status(404).json({ error: 'Not found' })
    const newNotes = (act.notes === 'read') ? null : 'read'
    await run("UPDATE activities SET notes=$1 WHERE id=$2", [newNotes, req.params.id])
    res.json({ ok: true, notes: newNotes })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
