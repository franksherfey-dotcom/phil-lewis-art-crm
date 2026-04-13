const express = require('express')
const { one, run, getArtForCompany, buildArtEmailBlock } = require('../lib/helpers')
const { sendEmail } = require('../emailer')
const router = express.Router()

router.post('/send-portfolio', async (req, res) => {
  try {
    const { contact_id, subject, body } = req.body
    if (!contact_id) return res.status(400).json({ error: 'contact_id required' })
    
    const contact = await one('SELECT * FROM contacts WHERE id=$1', [contact_id])
    if (!contact || !contact.email) return res.status(400).json({ error: 'Contact not found or no email' })
    
    const company = contact.company_id ? await one('SELECT * FROM companies WHERE id=$1', [contact.company_id]) : null
    
    const artImg = await getArtForCompany(company)
    let emailBody = (body || 'Hi {{first_name}},\n\nHere are some designs I think would be great for you...') + '\n' + buildArtEmailBlock(artImg)
    
    const { resolvedSubject, resolvedBody } = await sendEmail({
      toEmail: contact.email,
      toName: [contact.first_name, contact.last_name].filter(Boolean).join(' '),
      subject: subject || 'Phil Lewis Art — Curated Designs for {{company}}',
      body: emailBody,
      isHtml: true,
      contact: { first_name: contact.first_name, last_name: contact.last_name, email: contact.email },
      company,
    })
    
    await run('INSERT INTO activities (contact_id, type, subject, body, status, sent_at) VALUES ($1,$2,$3,$4,$5,NOW())',
      [contact_id, 'portfolio', resolvedSubject, resolvedBody, 'sent'])
    
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.get('/portfolio-preview', async (req, res) => {
  try {
    const { contact_id } = req.query
    if (!contact_id) return res.status(400).json({ error: 'contact_id required' })
    
    const contact = await one('SELECT * FROM contacts WHERE id=$1', [contact_id])
    if (!contact) return res.status(404).json({ error: 'Contact not found' })
    
    const company = contact.company_id ? await one('SELECT * FROM companies WHERE id=$1', [contact.company_id]) : null
    const artImg = await getArtForCompany(company)
    
    res.json({
      contact_name: [contact.first_name, contact.last_name].filter(Boolean).join(' '),
      company_name: company?.name,
      preview: buildArtEmailBlock(artImg),
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/quick-reply', async (req, res) => {
  try {
    const { activity_id, subject, body } = req.body
    if (!activity_id || !body) return res.status(400).json({ error: 'activity_id and body required' })
    
    const orig = await one(`SELECT a.*, c.email, c.first_name, c.last_name FROM activities a
      LEFT JOIN contacts c ON a.contact_id = c.id WHERE a.id=$1`, [activity_id])
    if (!orig || !orig.email) return res.status(400).json({ error: 'Activity not found or no email' })
    
    const { resolvedSubject, resolvedBody } = await sendEmail({
      toEmail: orig.email,
      toName: [orig.first_name, orig.last_name].filter(Boolean).join(' '),
      subject: subject || `Re: ${orig.subject || ''}`,
      body,
      isHtml: false,
      contact: { first_name: orig.first_name, last_name: orig.last_name, email: orig.email },
    })
    
    await run('INSERT INTO activities (contact_id, type, subject, body, status, sent_at) VALUES ($1,$2,$3,$4,$5,NOW())',
      [orig.contact_id, 'email', subject || `Re: ${orig.subject || ''}`, body, 'sent'])
    
    res.json({ ok: true, to: orig.email })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
