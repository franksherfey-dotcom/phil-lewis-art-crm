const express = require('express')
const { one, all, run, autoSetNextStep } = require('../lib/helpers')

const router = express.Router()

// POST /api/enrollments
router.post('/', async (req, res) => {
  try {
    const { contact_ids, sequence_id } = req.body
    if (!contact_ids || !sequence_id) return res.status(400).json({ error: 'contact_ids and sequence_id required' })
    const ids = Array.isArray(contact_ids) ? contact_ids : [contact_ids]
    let enrolled = 0
    let skipped = 0
    for (const cid of ids) {
      try {
        // Skip contacts without an email address — they can't receive sequence emails
        const contact = await one('SELECT email FROM contacts WHERE id=$1', [cid])
        if (!contact || !contact.email) { skipped++; continue }

        // Check if there's an existing enrollment
        const existing = await one(
          'SELECT id, status FROM enrollments WHERE contact_id=$1 AND sequence_id=$2',
          [cid, sequence_id]
        )
        if (existing) {
          if (existing.status === 'active') continue // already active, skip
          // Re-activate stopped/completed/replied enrollment
          await run(
            "UPDATE enrollments SET status='active', current_step=1, started_at=NOW(), completed_at=NULL WHERE id=$1",
            [existing.id]
          )
          enrolled++
        } else {
          await run(
            "INSERT INTO enrollments (contact_id, sequence_id, current_step, status) VALUES ($1,$2,1,'active')",
            [cid, sequence_id]
          )
          enrolled++
        }
      } catch(e) {
        // If unique constraint or exclusion constraint fires, try update instead
        try {
          await run(
            "UPDATE enrollments SET status='active', current_step=1, started_at=NOW(), completed_at=NULL WHERE contact_id=$1 AND sequence_id=$2 AND status != 'active'",
            [cid, sequence_id]
          )
          enrolled++
        } catch(e2) { /* skip this contact */ }
      }
    }
    res.json({ enrolled, skipped })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// DELETE /api/enrollments/:id
router.delete('/:id', async (req, res) => {
  try {
    await run("UPDATE enrollments SET status='stopped' WHERE id=$1", [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// GET /api/contacts/:contact_id/enrollments
router.get('/contact/:contact_id', async (req, res) => {
  try {
    var rows = await all(`
      SELECT e.id, e.status, e.current_step, e.started_at, e.completed_at,
             e.sequence_id, s.name AS sequence_name,
             (SELECT COUNT(*)::int FROM sequence_steps WHERE sequence_id=e.sequence_id) AS total_steps
      FROM enrollments e JOIN sequences s ON e.sequence_id = s.id
      WHERE e.contact_id = $1 ORDER BY e.started_at DESC
    `, [req.params.contact_id])
    // Attach activity timeline for each enrollment
    for (var enr of rows) {
      enr.activities = await all(`
        SELECT id, type, subject, status, sent_at
        FROM activities WHERE enrollment_id=$1
        ORDER BY sent_at ASC NULLS LAST
      `, [enr.id])
    }
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// POST /api/companies/:company_id/stop-sequences
router.post('/company/:company_id/stop', async (req, res) => {
  try {
    const result = await run(`
      UPDATE enrollments SET status='stopped'
      WHERE status='active' AND contact_id IN (SELECT id FROM contacts WHERE company_id=$1)
    `, [req.params.company_id])
    res.json({ ok: true, stopped: result.rowCount || 0 })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// PATCH /api/enrollments/:id/reply
router.patch('/:id/reply', async (req, res) => {
  try {
    await run("UPDATE enrollments SET status='replied', completed_at=NOW() WHERE id=$1", [req.params.id])
    // Auto-set next step: reply to this prospect
    const enr = await one(`
      SELECT c.company_id FROM enrollments e
      JOIN contacts c ON e.contact_id = c.id
      WHERE e.id=$1
    `, [req.params.id])
    if (enr && enr.company_id) await autoSetNextStep(enr.company_id, 'reply_received')
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
