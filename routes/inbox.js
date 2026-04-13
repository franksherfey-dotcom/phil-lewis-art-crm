const express = require('express')
const { one, all, run, autoSetNextStep } = require('../lib/helpers')
const { sendEmail, syncInbox } = require('../emailer')
const router = express.Router()

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

function classifySentiment(subject, body) {
  const text = ((subject || '') + ' ' + (body || '')).toLowerCase()
  const neg = [/not interested/i,/no thanks/i,/unsubscribe/i,/remove me/i,/stop (contact|email|reach)/i,/don'?t (contact|email|reach)/i,/please remove/i,/not (looking|seeking|accepting)/i,/take me off/i,/opt out/i,/not at this time/i,/no longer/i,/cease/i,/do not (want|wish)/i]
  const later = [/maybe later/i,/not right now/i,/check back/i,/reach out (later|again|next)/i,/touch base (later|next|in)/i,/revisit/i,/try (again|back|next)/i,/circle back/i,/not a good time/i,/another time/i,/not now/i,/down the (road|line)/i,/few months/i,/next (quarter|year|season)/i]
  const pos = [/interested/i,/love to/i,/would like/i,/tell me more/i,/send (me |us )?(more|info|details|samples)/i,/let'?s (talk|chat|connect|discuss|schedule|set up)/i,/sounds (great|good)/i,/looking forward/i,/excited/i,/great fit/i,/absolutely/i,/set up (a |an )?(call|meeting|time)/i,/schedule (a |an )?(call|meeting|time)/i,/I'?d (love|like) to/i,/can you send/i,/please send/i,/want to (learn|see|hear)/i,/we'?re interested/i]
  for (const p of neg) if (p.test(text)) return 'negative'
  for (const p of later) if (p.test(text)) return 'neutral'
  for (const p of pos) if (p.test(text)) return 'positive'
  return null
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
    let imported = 0, autoStopped = 0, opportunitiesCreated = 0
    for (const msg of received) {
      const contact = emailToContact[msg.from_email]
      if (!contact) continue
      const contactId = contact.id
      const existing = await one(
        `SELECT id FROM activities WHERE contact_id=$1 AND type='received_email' AND subject=$2
         AND sent_at BETWEEN ($3::timestamptz - INTERVAL '24 hours') AND ($3::timestamptz + INTERVAL '24 hours')`,
        [contactId, msg.subject, msg.received_at]
      )
      if (existing) continue
      if (msg.body && msg.body.length > 20) {
        const bodyPrefix = msg.body.substring(0, 100)
        const dupe = await one(`SELECT id FROM activities WHERE contact_id=$1 AND type='received_email' AND LEFT(COALESCE(body,''), 100) = $2 LIMIT 1`, [contactId, bodyPrefix])
        if (dupe) continue
      }
      const sentiment = classifySentiment(msg.subject, msg.body)
      await run(`INSERT INTO activities (contact_id, type, subject, body, status, sent_at, sentiment) VALUES ($1,'received_email',$2,$3,'received',$4,$5)`,
        [contactId, msg.subject, msg.body, msg.received_at, sentiment])
      imported++
      const actives = await all(`SELECT id FROM enrollments WHERE contact_id=$1 AND status='active'`, [contactId])
      for (const enr of actives) {
        await run(`UPDATE enrollments SET status='replied', completed_at=NOW() WHERE id=$1`, [enr.id])
        autoStopped++
      }
      if (contact.company_id && typeof autoSetNextStep === 'function') {
        try { await autoSetNextStep(contact.company_id, 'reply_received') } catch (e) {}
      }
      if (contact.company_id) {
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
