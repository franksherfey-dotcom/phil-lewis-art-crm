const express = require('express')
const { all } = require('../lib/helpers')

const router = express.Router()

// GET /api/new-leads?hours=24
// Returns companies created within the last N hours (default 24), with their
// contacts and each contact's active enrollment (if any). Designed for the
// "New Leads" button — shows what the morning finder added overnight.
router.get('/', async (req, res) => {
  try {
    const hours = Math.max(1, Math.min(168, parseInt(req.query.hours, 10) || 24))
    const companies = await all(`
      SELECT id, name, type, website, city, state, country, category, tags, notes,
             status, created_at, updated_at
      FROM companies
      WHERE created_at > NOW() - ($1 || ' hours')::interval
      ORDER BY created_at DESC
    `, [hours])

    if (!companies.length) return res.json({ hours, companies: [] })

    const ids = companies.map(c => c.id)
    const contacts = await all(`
      SELECT c.id, c.company_id, c.first_name, c.last_name, c.title, c.email,
             c.is_primary,
             e.id AS enrollment_id, e.status AS enrollment_status, e.current_step,
             e.sequence_id, s.name AS sequence_name
      FROM contacts c
      LEFT JOIN LATERAL (
        SELECT e2.id, e2.status, e2.current_step, e2.sequence_id
        FROM enrollments e2
        WHERE e2.contact_id = c.id
        ORDER BY CASE e2.status WHEN 'active' THEN 0 WHEN 'replied' THEN 1 ELSE 2 END,
                 e2.started_at DESC
        LIMIT 1
      ) e ON true
      LEFT JOIN sequences s ON e.sequence_id = s.id
      WHERE c.company_id = ANY($1)
      ORDER BY c.is_primary DESC, c.first_name ASC
    `, [ids])

    // Group contacts under their company
    const byCompany = {}
    contacts.forEach(ct => {
      if (!byCompany[ct.company_id]) byCompany[ct.company_id] = []
      byCompany[ct.company_id].push(ct)
    })

    const result = companies.map(c => ({ ...c, contacts: byCompany[c.id] || [] }))
    res.json({ hours, companies: result })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
