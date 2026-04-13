const express = require('express')
const { one, all, run } = require('../lib/helpers')
const router = express.Router()

// All inbox endpoints — routes GET /api/inbox, PATCH /api/inbox/:id/*, POST /api/inbox/*
router.get('/inbox', async (req, res) => {
  try {
    const rows = await all(`
      SELECT a.id, a.contact_id, a.subject, a.body, a.sent_at, a.sentiment, a.notes,
             c.first_name, c.last_name, c.email, co.name AS company_name, co.id AS company_id
      FROM activities a
      LEFT JOIN contacts c ON a.contact_id = c.id
      LEFT JOIN companies co ON c.company_id = co.id
      WHERE a.type='received_email' AND (a.notes IS NULL OR a.notes NOT IN ('archived'))
      ORDER BY a.sent_at DESC LIMIT 100
    `)
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.patch('/inbox/:id/read', async (req, res) => {
  try {
    await run("UPDATE activities SET notes='read' WHERE id=$1", [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/inbox/:id', async (req, res) => {
  try {
    await run("UPDATE activities SET notes='archived' WHERE id=$1", [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.patch('/inbox/:id/sentiment', async (req, res) => {
  try {
    const { sentiment } = req.body
    await run("UPDATE activities SET sentiment=$1 WHERE id=$2", [sentiment, req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/inbox/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body
    if (!ids || !ids.length) return res.status(400).json({ error: 'ids required' })
    await run(`UPDATE activities SET notes='archived' WHERE id = ANY($1::bigint[])`, [ids])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.get('/inbox/not-in-sequence', async (req, res) => {
  try {
    const rows = await all(`
      SELECT DISTINCT a.id, a.contact_id, a.subject, a.sent_at,
             c.first_name, c.last_name, co.name AS company_name
      FROM activities a
      LEFT JOIN contacts c ON a.contact_id = c.id
      LEFT JOIN companies co ON c.company_id = co.id
      WHERE a.type='received_email' AND (a.notes IS NULL OR a.notes NOT IN ('archived'))
        AND NOT EXISTS (SELECT 1 FROM enrollments WHERE contact_id=c.id AND status='active')
      ORDER BY a.sent_at DESC LIMIT 50
    `)
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/inbox/dedup', async (req, res) => {
  try {
    await run(`DELETE FROM activities a WHERE a.id NOT IN (
      SELECT MIN(id) FROM activities GROUP BY contact_id, subject
    ) AND type='received_email'`)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/inbox/sync', async (req, res) => {
  try {
    res.json({ ok: true, synced: 0 })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/inbox/reply', async (req, res) => {
  try {
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
