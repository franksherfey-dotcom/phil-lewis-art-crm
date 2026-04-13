const express = require('express')
const { one, all, run, getQueueItems, getArtForCompany, buildArtEmailBlock, autoSetNextStep } = require('../lib/helpers')
const { sendEmail } = require('../emailer')

const router = express.Router()

// GET /api/queue
router.get('/', async (req, res) => {
  try {
    res.json(await getQueueItems())
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// POST /api/queue/send
router.post('/send', async (req, res) => {
  try {
    const { enrollment_id, custom_subject, custom_body, custom_art_id } = req.body

    const enr = await one(`
      SELECT e.*, c.first_name, c.last_name, c.email, c.title, c.company_id
      FROM enrollments e JOIN contacts c ON e.contact_id = c.id
      WHERE e.id=$1
    `, [enrollment_id])
    if (!enr) return res.status(404).json({ error: 'Enrollment not found' })
    if (enr.status !== 'active') return res.status(400).json({ error: 'Enrollment not active' })
    if (!enr.email) return res.status(400).json({ error: 'Contact has no email address' })

    const step = await one(
      'SELECT * FROM sequence_steps WHERE sequence_id=$1 AND step_number=$2',
      [enr.sequence_id, enr.current_step]
    )
    if (!step) return res.status(404).json({ error: 'Step not found' })

    const company = enr.company_id ? await one('SELECT * FROM companies WHERE id=$1', [enr.company_id]) : null
    const contact = { first_name: enr.first_name, last_name: enr.last_name, email: enr.email, title: enr.title }

    const { n: totalSteps } = await one(
      'SELECT COUNT(*)::int AS n FROM sequence_steps WHERE sequence_id=$1',
      [enr.sequence_id]
    )
    const isArtStep = (enr.current_step % 2 === 1) || (enr.current_step >= totalSteps)
    let emailBody = custom_body || step.body
    if (custom_art_id === 'none') {
      // User explicitly chose no art
    } else if (custom_art_id) {
      const artRow = await one('SELECT * FROM art_images WHERE id=$1', [custom_art_id])
      if (artRow) emailBody = emailBody + '\n' + buildArtEmailBlock({ url: artRow.url, alt: 'Phil Lewis Art × ' + artRow.title })
    } else if (isArtStep) {
      const artImg = await getArtForCompany(company)
      emailBody = emailBody + '\n' + buildArtEmailBlock(artImg)
    }

    const { resolvedSubject, resolvedBody } = await sendEmail({
      toEmail: enr.email,
      toName: [enr.first_name, enr.last_name].filter(Boolean).join(' '),
      subject: custom_subject || step.subject,
      body: emailBody,
      isHtml: isArtStep,
      contact,
      company,
    })

    await run(
      "INSERT INTO activities (enrollment_id, contact_id, type, subject, body, status, sent_at) VALUES ($1,$2,'email',$3,$4,'sent',NOW())",
      [enrollment_id, enr.contact_id, resolvedSubject, resolvedBody]
    )
    if (enr.company_id) await run("UPDATE companies SET last_activity_at=NOW() WHERE id=$1", [enr.company_id])

    if (enr.current_step >= totalSteps) {
      await run("UPDATE enrollments SET status='completed', completed_at=NOW() WHERE id=$1", [enrollment_id])
      await autoSetNextStep(enr.company_id, 'sequence_completed')
    } else {
      await run("UPDATE enrollments SET current_step=current_step+1 WHERE id=$1", [enrollment_id])
      const nextStepNum = enr.current_step + 1
      const nextStepRow = await one('SELECT * FROM sequence_steps WHERE sequence_id=$1 AND step_number=$2', [enr.sequence_id, nextStepNum])
      const nextDate = nextStepRow ? new Date(Date.now() + (nextStepRow.delay_days||0) * 86400000).toISOString().slice(0,10) : null
      await autoSetNextStep(enr.company_id, 'email_sent', {
        nextStep: nextStepRow ? 'Send Step ' + nextStepNum + ': ' + (nextStepRow.subject || '').slice(0, 60) : 'Continue sequence',
        nextStepDate: nextDate
      })
    }

    res.json({ ok: true, subject: resolvedSubject })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// POST /api/queue/send-all
router.post('/send-all', async (req, res) => {
  try {
    const queue = await getQueueItems()
    const results = []
    for (const item of queue) {
      try {
        const enr = await one(`
          SELECT e.*, c.first_name, c.last_name, c.email, c.title, c.company_id
          FROM enrollments e JOIN contacts c ON e.contact_id = c.id
          WHERE e.id=$1
        `, [item.enrollment_id])
        if (!enr || !enr.email) {
          results.push({ enrollment_id: item.enrollment_id, ok: false, error: 'No email' }); continue
        }

        const step = await one(
          'SELECT * FROM sequence_steps WHERE sequence_id=$1 AND step_number=$2',
          [enr.sequence_id, enr.current_step]
        )
        const company = enr.company_id ? await one('SELECT * FROM companies WHERE id=$1', [enr.company_id]) : null
        const contact = { first_name: enr.first_name, last_name: enr.last_name, email: enr.email, title: enr.title }

        const { n: totalSteps } = await one(
          'SELECT COUNT(*)::int AS n FROM sequence_steps WHERE sequence_id=$1',
          [enr.sequence_id]
        )
        const isArtStep = (enr.current_step % 2 === 1) || (enr.current_step >= totalSteps)
        let emailBody = step.body
        if (isArtStep) {
          const artImg = await getArtForCompany(company)
          emailBody = emailBody + '\n' + buildArtEmailBlock(artImg)
        }

        const { resolvedSubject, resolvedBody } = await sendEmail({
          toEmail: enr.email,
          toName: [enr.first_name, enr.last_name].filter(Boolean).join(' '),
          subject: step.subject,
          body: emailBody,
          isHtml: isArtStep,
          contact,
          company,
        })

        await run(
          "INSERT INTO activities (enrollment_id, contact_id, type, subject, body, status, sent_at) VALUES ($1,$2,'email',$3,$4,'sent',NOW())",
          [item.enrollment_id, enr.contact_id, resolvedSubject, resolvedBody]
        )
        if (enr.company_id) await run("UPDATE companies SET last_activity_at=NOW() WHERE id=$1", [enr.company_id])

        if (enr.current_step >= totalSteps) {
          await run("UPDATE enrollments SET status='completed', completed_at=NOW() WHERE id=$1", [item.enrollment_id])
          await autoSetNextStep(enr.company_id, 'sequence_completed')
        } else {
          await run("UPDATE enrollments SET current_step=current_step+1 WHERE id=$1", [item.enrollment_id])
          const nextStepNum = enr.current_step + 1
          const nextStepRow = await one('SELECT * FROM sequence_steps WHERE sequence_id=$1 AND step_number=$2', [enr.sequence_id, nextStepNum])
          const nextDate = nextStepRow ? new Date(Date.now() + (nextStepRow.delay_days||0) * 86400000).toISOString().slice(0,10) : null
          await autoSetNextStep(enr.company_id, 'email_sent', {
            nextStep: nextStepRow ? 'Send Step ' + nextStepNum + ': ' + (nextStepRow.subject || '').slice(0, 60) : 'Continue sequence',
            nextStepDate: nextDate
          })
        }

        results.push({ enrollment_id: item.enrollment_id, ok: true, subject: resolvedSubject })
      } catch (err) {
        results.push({ enrollment_id: item.enrollment_id, ok: false, error: err.message })
      }
    }
    res.json({
      results,
      sent: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// GET /api/queue/preview/:enrollment_id
router.get('/preview/:enrollment_id', async (req, res) => {
  try {
    const enr = await one(`
      SELECT e.*, c.first_name, c.last_name, c.email, c.title, c.company_id,
             co.name AS company_name, co.website
      FROM enrollments e
      JOIN contacts c ON e.contact_id = c.id
      LEFT JOIN companies co ON c.company_id = co.id
      WHERE e.id=$1
    `, [req.params.enrollment_id])
    if (!enr) return res.status(404).json({ error: 'Enrollment not found' })

    const step = await one(
      'SELECT * FROM sequence_steps WHERE sequence_id=$1 AND step_number=$2',
      [enr.sequence_id, enr.current_step]
    )
    if (!step) return res.status(404).json({ error: 'Step not found' })

    const company = enr.company_id ? await one('SELECT * FROM companies WHERE id=$1', [enr.company_id]) : null
    const contact = { first_name: enr.first_name, last_name: enr.last_name, email: enr.email, title: enr.title }

    const { n: totalSteps } = await one(
      'SELECT COUNT(*)::int AS n FROM sequence_steps WHERE sequence_id=$1',
      [enr.sequence_id]
    )
    const isArtStep = (enr.current_step % 2 === 1) || (enr.current_step >= totalSteps)
    let body = step.body
    let artBlock = null
    if (isArtStep) {
      const artImg = await getArtForCompany(company)
      artBlock = buildArtEmailBlock(artImg)
    }

    // Get available art images for this company
    const artImages = await all('SELECT id, title, url FROM art_images WHERE type=\'art\' LIMIT 20')

    res.json({
      enrollment_id: enr.id,
      contact_name: [enr.first_name, enr.last_name].filter(Boolean).join(' '),
      contact_email: enr.email,
      company_name: enr.company_name,
      current_step: enr.current_step,
      total_steps: totalSteps,
      subject: step.subject,
      body: body,
      art_block: artBlock,
      is_art_step: isArtStep,
      available_art: artImages,
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
