const express = require('express')
const { one, all, run, autoSetNextStep } = require('../lib/helpers')
const { sendEmail, syncInbox } = require('../emailer')
const router = express.Router()

router.get('/inbox', async (req, res) => {
  try {
    const { search, limit, tab } = req.query
    const activityType = tab === 'sent' ? 'email' : 'received_email'
    let sql = `
      SELECT a.id, a.contact_id, a.subject, a.body, a.status, a.sent_at, a.notes, a.sentiment,
             a.is_automated,
             c.first_name, c.last_name, c.email, c.title,
             co.id AS company_id, co.name AS company_name, co.type AS company_type,
             co.opportunity_value, co.pipeline_stage, co.status AS company_status
      FROM activities a
      LEFT JOIN contacts c ON a.contact_id = c.id
      LEFT JOIN companies co ON c.company_id = co.id
      WHERE a.type = $1 AND (a.notes IS NULL OR a.notes NOT IN ('archived'))
    `
    const params = [activityType]
    let i = 2
    const view = req.query.view || (activityType === 'received_email' ? 'human' : 'all')
    if (view === 'human') sql += ' AND COALESCE(a.is_automated, FALSE) = FALSE'
    if (view === 'automated') sql += ' AND COALESCE(a.is_automated, FALSE) = TRUE'
    if (search) {
      const s = `%${search}%`
      sql += ` AND (a.subject ILIKE $${i} OR c.first_name ILIKE $${i+1} OR c.last_name ILIKE $${i+2} OR co.name ILIKE $${i+3})`
      params.push(s, s, s, s); i += 4
    }
    sql += ' ORDER BY a.sent_at DESC'
    const lim = parseInt(limit)
    if (lim && lim > 0) { sql += ` LIMIT $${i}`; params.push(lim); i++ }
    const messages = await all(sql, params)
    const unread = await one("SELECT COUNT(*)::int AS n FROM activities WHERE type='received_email' AND COALESCE(is_automated, FALSE) = FALSE AND (notes IS NULL OR notes NOT IN ('read','archived'))")
    res.json({ messages, unreadCount: unread.n })
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

function classifySentiment(subject, body) {
  const text = ((subject || '') + ' ' + (body || '')).toLowerCase()
  const negPatterns = [/not interested/i, /no thanks/i, /unsubscribe/i, /remove me/i, /stop (contact|email|reach)/i, /please remove/i, /opt out/i, /do not (want|wish)/i]
  const posPatterns = [/interested/i, /love to/i, /would like/i, /tell me more/i, /let'?s (talk|chat|connect|discuss)/i, /sounds great/i, /looking forward/i, /schedule (a |an )?(call|meeting)/i]
  for (const p of negPatterns) { if (p.test(text)) return 'negative' }
  for (const p of posPatterns) { if (p.test(text)) return 'positive' }
  return null
}

// ── AUTOMATED MAIL DETECTION ────────────────────────────────────────────────
const AUTO_SUBJECT_RX = /(auto|automatic).{0,10}reply|we'?ve received|received your (request|message|email|note)|out of office|conversation #/i
const AUTO_BODY_RX = /unsubscribe|view (this email )?in (your |the )?browser|email preferences|manage preferences|please type your reply above this line|this is an automated (response|reply|message)|thank you for contacting|we have received your (email|message|request)|outside of business hours/i
function isAutomatedMessage(subject, body) {
  return AUTO_SUBJECT_RX.test(subject || '') || AUTO_BODY_RX.test((body || '').slice(0, 4000))
}
function senderBlocked(patterns, email) {
  const e = (email || '').toLowerCase()
  const domain = '@' + (e.split('@')[1] || '')
  return patterns.some(p => p === e || p === domain)
}

router.post('/inbox/sync', async (req, res) => {
  try {
    const rows = await all('SELECT key, value FROM settings')
    const settings = {}
    rows.forEach(r => { settings[r.key] = r.value })
    const contacts = await all("SELECT id, email, company_id FROM contacts WHERE email IS NOT NULL AND email != ''")
    const emailToContact = {}
    contacts.forEach(c => { emailToContact[c.email.toLowerCase()] = c })
    const knownEmails = new Set(Object.keys(emailToContact))
    const received = await syncInbox(settings, knownEmails)
    const blockedPatterns = (await all('SELECT pattern FROM blocked_senders')).map(r => r.pattern)
    let imported = 0, autoStopped = 0, opportunitiesCreated = 0
    for (const msg of received) {
      const contact = emailToContact[msg.from_email]
      if (!contact) continue
      if (senderBlocked(blockedPatterns, msg.from_email)) continue
      const contactId = contact.id
      const existing = await one(
        `SELECT id FROM activities WHERE contact_id=$1 AND type='received_email' AND subject=$2
         AND sent_at BETWEEN ($3::timestamptz - INTERVAL '24 hours') AND ($3::timestamptz + INTERVAL '24 hours')`,
        [contactId, msg.subject, msg.received_at]
      )
      if (existing) continue
      if (msg.body && msg.body.length > 20) {
        const bodyPrefix = msg.body.substring(0, 100)
        const dupe = await one(
          `SELECT id FROM activities WHERE contact_id=$1 AND type='received_email' AND LEFT(COALESCE(body,''), 100) = $2 LIMIT 1`,
          [contactId, bodyPrefix]
        )
        if (dupe) continue
      }
      const automated = isAutomatedMessage(msg.subject, msg.body)
      const sentiment = automated ? null : classifySentiment(msg.subject, msg.body)
      await run(
        `INSERT INTO activities (contact_id, type, subject, body, status, sent_at, sentiment, is_automated)
         VALUES ($1,'received_email',$2,$3,'received',$4,$5,$6)`,
        [contactId, msg.subject, msg.body, msg.received_at, sentiment, automated]
      )
      imported++
      const active = automated ? [] : await all(`SELECT id FROM enrollments WHERE contact_id=$1 AND status='active'`, [contactId])
      for (const enr of active) {
        await run(`UPDATE enrollments SET status='replied', completed_at=NOW() WHERE id=$1`, [enr.id])
        autoStopped++
      }
      if (!automated && contact.company_id && typeof autoSetNextStep === 'function') {
        try { await autoSetNextStep(contact.company_id, 'reply_received') } catch (e) {}
      }
      if (!automated && contact.company_id) {
        const co = await one('SELECT opportunity_value, status FROM companies WHERE id=$1', [contact.company_id])
        if (co && (!co.opportunity_value || parseFloat(co.opportunity_value) === 0)) {
          await run(`UPDATE companies SET opportunity_value=5000, pipeline_stage='Interested', status='interested', last_activity_at=NOW(), updated_at=NOW() WHERE id=$1`, [contact.company_id])
          opportunitiesCreated++
        } else if (co && co.status !== 'licensed' && co.status !== 'interested') {
          await run("UPDATE companies SET status='interested', last_activity_at=NOW(), updated_at=NOW() WHERE id=$1", [contact.company_id])
        }
      }
    }
    res.json({ ok: true, found: received.length, imported, autoStopped, opportunitiesCreated })
  } catch (err) {
    console.error('inbox/sync error:', err)
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/inbox/:id/automated — manually toggle robot/human
router.patch('/inbox/:id/automated', async (req, res) => {
  try {
    await run('UPDATE activities SET is_automated=$1 WHERE id=$2', [!!req.body.automated, req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// POST /api/inbox/block — block a sender email or their whole domain.
// Also marks matching contacts do-not-contact, stops their active enrollments,
// and sweeps their past inbound into the Automated tab.
router.post('/inbox/block', async (req, res) => {
  try {
    const { email, scope } = req.body
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'email required' })
    const pattern = scope === 'domain' ? '@' + email.toLowerCase().split('@')[1] : email.toLowerCase()
    await run('INSERT INTO blocked_senders (pattern, reason) VALUES ($1,$2) ON CONFLICT (pattern) DO NOTHING', [pattern, 'Blocked from inbox'])
    const matchSql = scope === 'domain' ? "LOWER(email) LIKE '%' || $1" : 'LOWER(email) = $1'
    const affected = await all(`SELECT id FROM contacts WHERE ${matchSql}`, [pattern])
    const ids = affected.map(r => r.id)
    if (ids.length) {
      await run('UPDATE contacts SET do_not_contact=TRUE WHERE id = ANY($1::bigint[])', [ids])
      await run(`UPDATE enrollments SET status='stopped', completed_at=NOW() WHERE status='active' AND contact_id = ANY($1::bigint[])`, [ids])
      await run(`UPDATE activities SET is_automated=TRUE WHERE type='received_email' AND contact_id = ANY($1::bigint[])`, [ids])
    }
    res.json({ ok: true, pattern, contactsBlocked: ids.length })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/inbox/reply', async (req, res) => {
  try {
    const { toEmail, toName, subject, body, isHtml, contactId, companyId, inReplyTo, references } = req.body
    if (!toEmail || !subject || !body) return res.status(400).json({ error: 'toEmail, subject, and body are required.' })
    let contact = {}, company = null
    if (contactId) { const row = await one('SELECT * FROM contacts WHERE id=$1', [contactId]); if (row) contact = row }
    if (companyId) { const row = await one('SELECT * FROM companies WHERE id=$1', [companyId]); if (row) company = row }
    const { resolvedSubject, resolvedBody } = await sendEmail({
      toEmail, toName: toName || null, subject, body, isHtml: !!isHtml, contact, company,
      inReplyTo: inReplyTo || null, references: references || null,
    })
    await run(`INSERT INTO activities (contact_id, type, subject, body, status, sent_at) VALUES ($1, 'email', $2, $3, 'sent', NOW())`,
      [contactId || null, resolvedSubject, resolvedBody])
    res.json({ ok: true, subject: resolvedSubject })
  } catch (err) {
    console.error('inbox/reply error:', err)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
