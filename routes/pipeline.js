const express = require('express')
const { one, all } = require('../lib/helpers')

const router = express.Router()

// GET /api/pipeline — returns contacts with enrollment + company data for pipeline view
router.get('/pipeline', async (req, res) => {
  try {
    const contacts = await all(`
      SELECT ct.id, ct.first_name, ct.last_name, ct.email, ct.is_primary,
             ct.last_contact_at,
             co.name AS company_name, co.tags AS company_tags,
             e.status AS enrollment_status, e.id AS enrollment_id,
             e.started_at, e.current_step, e.emails_sent,
             s.name AS sequence_name,
             (SELECT COUNT(*)::int FROM sequence_steps WHERE sequence_id = s.id) AS total_steps
      FROM contacts ct
      LEFT JOIN companies co ON ct.company_id = co.id
      LEFT JOIN LATERAL (
        SELECT id, sequence_id, status, started_at, current_step, emails_sent
        FROM enrollments
        WHERE contact_id = ct.id
        ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'replied' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END
        LIMIT 1
      ) e ON true
      LEFT JOIN sequences s ON s.id = e.sequence_id
      ORDER BY
        CASE e.status
          WHEN 'replied' THEN 0
          WHEN 'active' THEN 1
          WHEN 'paused' THEN 2
          WHEN 'completed' THEN 3
          WHEN 'stopped' THEN 4
          ELSE 5
        END,
        ct.last_contact_at DESC NULLS LAST
    `)
    res.json(contacts)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// GET /api/pipeline/stuck-count — contacts in active sequences with no activity for 14+ days
router.get('/pipeline/stuck-count', async (req, res) => {
  try {
    const result = await one(`
      SELECT COUNT(*)::int AS count
      FROM enrollments e
      JOIN contacts ct ON ct.id = e.contact_id
      WHERE e.status = 'active'
        AND (ct.last_contact_at IS NULL OR ct.last_contact_at < NOW() - INTERVAL '14 days')
    `)
    res.json({ count: result.count })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// GET /api/leads/heatmap — companies with activity metrics for lead scoring
router.get('/leads/heatmap', async (req, res) => {
  try {
    const leads = await all(`
      SELECT
        co.id, co.name, co.tags, co.pipeline_stage, co.opportunity_value,
        co.last_activity_at, co.status,
        COALESCE(stats.emails_sent, 0)::int AS emails_sent,
        COALESCE(stats.reply_count, 0)::int AS reply_count,
        stats.last_reply_at,
        stats.latest_sentiment,
        COALESCE(seq.active_sequences, 0)::int AS active_sequences
      FROM companies co
      LEFT JOIN LATERAL (
        SELECT
          COUNT(CASE WHEN a.direction = 'outbound' THEN 1 END)::int AS emails_sent,
          COUNT(CASE WHEN a.direction = 'inbound' THEN 1 END)::int AS reply_count,
          MAX(CASE WHEN a.direction = 'inbound' THEN a.sent_at END) AS last_reply_at,
          (ARRAY_AGG(a.sentiment ORDER BY a.sent_at DESC) FILTER (WHERE a.sentiment IS NOT NULL))[1] AS latest_sentiment
        FROM activities a
        JOIN contacts ct ON ct.id = a.contact_id
        WHERE ct.company_id = co.id
      ) stats ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS active_sequences
        FROM enrollments e2
        JOIN contacts ct2 ON ct2.id = e2.contact_id
        WHERE ct2.company_id = co.id AND e2.status = 'active'
      ) seq ON true
      WHERE co.status IN ('active','prospect','interested')
      ORDER BY co.name
    `)
    res.json(leads)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
