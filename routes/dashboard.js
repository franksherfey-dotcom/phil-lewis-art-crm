const express = require('express')
const { one, all, getQueueItems } = require('../lib/helpers')

const router = express.Router()

// GET /api/dashboard
router.get('/', async (req, res) => {
  try {
    const [c, ct, ae, es, recent] = await Promise.all([
      one("SELECT COUNT(*)::int AS n FROM companies"),
      one("SELECT COUNT(*)::int AS n FROM contacts"),
      one("SELECT COUNT(*)::int AS n FROM enrollments WHERE status='active'"),
      one("SELECT COUNT(*)::int AS n FROM activities WHERE type='email'"),
      all(`
        SELECT DISTINCT ON (a.contact_id)
          a.id, a.contact_id, a.subject, a.body, a.sent_at, a.notes, a.sentiment,
          c.first_name, c.last_name, co.name AS company_name, co.id AS company_id,
          e.id AS enrollment_id, e.status AS enrollment_status
        FROM activities a
        LEFT JOIN contacts c ON a.contact_id = c.id
        LEFT JOIN companies co ON c.company_id = co.id
        LEFT JOIN LATERAL (
          SELECT id, status FROM enrollments
          WHERE contact_id = a.contact_id AND status = 'active'
          ORDER BY started_at DESC LIMIT 1
        ) e ON true
        WHERE a.type = 'received_email'
          AND (a.notes IS NULL OR a.notes NOT IN ('archived'))
        ORDER BY a.contact_id, a.sent_at DESC
      `),
    ])
    const queue = await getQueueItems()
    const queueCount = queue.length
    res.json({
      totalCompanies: c.n, totalContacts: ct.n,
      activeEnrollments: ae.n, emailsSent: es.n,
      queueCount, recentActivity: recent,
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// GET /api/dashboard/priorities
router.get('/priorities', async (req, res) => {
  try {
    // 1. Unread replies that need a response (highest priority)
    var unreplied = await all(`
      SELECT DISTINCT ON (a.contact_id)
        a.id, a.contact_id, a.subject, a.sent_at, a.sentiment,
        c.first_name, c.last_name, co.name AS company_name, co.id AS company_id
      FROM activities a
      JOIN contacts c ON a.contact_id = c.id
      LEFT JOIN companies co ON c.company_id = co.id
      WHERE a.type = 'received_email'
        AND (a.notes IS NULL OR a.notes NOT IN ('archived','read'))
      ORDER BY a.contact_id, a.sent_at DESC
    `)

    // 2. First-touch emails waiting for manual review (step 1 items in queue)
    var queue = await getQueueItems()
    var firstTouches = queue.filter(function(q) { return q.current_step === 1 })
    var autoSendPending = queue.filter(function(q) { return q.auto_send && q.current_step > 1 })
    var manualFollowUps = queue.filter(function(q) { return !q.auto_send && q.current_step > 1 })

    // 3. Companies going cold (last activity > 14 days, still has active enrollments or is 'active' status)
    var goingCold = await all(`
      SELECT c.id, c.name, c.last_activity_at, c.next_step, c.next_step_date, c.status,
        (SELECT COUNT(*)::int FROM enrollments e JOIN contacts ct ON e.contact_id = ct.id WHERE ct.company_id = c.id AND e.status = 'active') AS active_enrollments
      FROM companies c
      WHERE c.last_activity_at < NOW() - INTERVAL '14 days'
        AND c.status IN ('active','prospect')
      ORDER BY c.last_activity_at ASC
      LIMIT 10
    `)

    // 4. Recently auto-sent (last 24h) so Frank knows what went out
    var recentAutoSent = await all(`
      SELECT a.id, a.subject, a.sent_at, c.first_name, c.last_name, co.name AS company_name
      FROM activities a
      JOIN contacts c ON a.contact_id = c.id
      LEFT JOIN companies co ON c.company_id = co.id
      WHERE a.type = 'email' AND a.status = 'sent'
        AND a.sent_at > NOW() - INTERVAL '24 hours'
      ORDER BY a.sent_at DESC
      LIMIT 20
    `)

    // 5. Overdue next-steps on companies
    var overdue = await all(`
      SELECT id, name, next_step, next_step_date, status
      FROM companies
      WHERE next_step_date < CURRENT_DATE
        AND next_step IS NOT NULL AND next_step != ''
        AND status IN ('active','prospect')
      ORDER BY next_step_date ASC
      LIMIT 10
    `)

    res.json({
      unreplied: unreplied,
      firstTouches: firstTouches,
      autoSendPending: autoSendPending.length,
      manualFollowUps: manualFollowUps,
      goingCold: goingCold,
      recentAutoSent: recentAutoSent,
      overdue: overdue,
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// GET /api/dashboard/weekly-summary
router.get('/weekly-summary', async (req, res) => {
  try {
    var [sent, replies, newCos, completed, replied] = await Promise.all([
      one("SELECT COUNT(*)::int AS n FROM activities WHERE type='email' AND sent_at > NOW() - INTERVAL '7 days'"),
      one("SELECT COUNT(*)::int AS n FROM activities WHERE type='received_email' AND sent_at > NOW() - INTERVAL '7 days'"),
      one("SELECT COUNT(*)::int AS n FROM companies WHERE created_at > NOW() - INTERVAL '7 days'"),
      one("SELECT COUNT(*)::int AS n FROM enrollments WHERE status='completed' AND completed_at > NOW() - INTERVAL '7 days'"),
      one("SELECT COUNT(*)::int AS n FROM enrollments WHERE status='replied' AND completed_at > NOW() - INTERVAL '7 days'"),
    ])
    var positiveReplies = await all(`
      SELECT a.sent_at, c.first_name, c.last_name, co.name AS company_name, co.id AS company_id
      FROM activities a JOIN contacts c ON a.contact_id = c.id LEFT JOIN companies co ON c.company_id = co.id
      WHERE a.type = 'received_email' AND a.sentiment = 'positive' AND a.sent_at > NOW() - INTERVAL '7 days'
      ORDER BY a.sent_at DESC LIMIT 5
    `)
    var replyRate = sent.n > 0 ? Math.round((replies.n / sent.n) * 100) : 0
    res.json({
      emailsSent: sent.n, repliesReceived: replies.n, newCompanies: newCos.n,
      completedSequences: completed.n, repliedSequences: replied.n,
      positiveReplies: positiveReplies, replyRate: replyRate,
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
