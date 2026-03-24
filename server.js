require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const multer = require('multer')
const { parse } = require('csv-parse/sync')

const pool = require('./lib/db')
const { sendEmail, testConnection, interpolate } = require('./emailer')

const app = express()
const PORT = process.env.PORT || 3000

// Store CSV files in memory — no disk writes (required for Vercel)
const upload = multer({ storage: multer.memoryStorage() })

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ─── Query helpers ────────────────────────────────────────────────────────────
const run  = (sql, p = []) => pool.query(sql, p)
const one  = async (sql, p = []) => (await pool.query(sql, p)).rows[0]
const all  = async (sql, p = []) => (await pool.query(sql, p)).rows

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

app.get('/api/dashboard', async (req, res) => {
  try {
    const [c, ct, ae, es, recent] = await Promise.all([
      one("SELECT COUNT(*)::int AS n FROM companies"),
      one("SELECT COUNT(*)::int AS n FROM contacts"),
      one("SELECT COUNT(*)::int AS n FROM enrollments WHERE status='active'"),
      one("SELECT COUNT(*)::int AS n FROM activities WHERE type='email'"),
      all(`
        SELECT a.*, c.first_name, c.last_name, co.name AS company_name
        FROM activities a
        LEFT JOIN contacts c ON a.contact_id = c.id
        LEFT JOIN companies co ON c.company_id = co.id
        ORDER BY a.sent_at DESC LIMIT 10
      `),
    ])
    const queueCount = (await getQueueItems()).length
    res.json({
      totalCompanies: c.n, totalContacts: ct.n,
      activeEnrollments: ae.n, emailsSent: es.n,
      queueCount, recentActivity: recent,
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── COMPANIES ───────────────────────────────────────────────────────────────

app.get('/api/companies', async (req, res) => {
  try {
    const { search, type, status, tag } = req.query
    let sql = `
      SELECT c.*, COUNT(ct.id)::int AS contact_count
      FROM companies c
      LEFT JOIN contacts ct ON c.id = ct.company_id
      WHERE 1=1
    `
    const params = []
    let i = 1
    if (search) {
      const s = `%${search}%`
      sql += ` AND (c.name ILIKE $${i} OR c.category ILIKE $${i+1} OR c.city ILIKE $${i+2} OR c.tags ILIKE $${i+3})`
      params.push(s, s, s, s); i += 4
    }
    if (type)   { sql += ` AND c.type=$${i}`;   params.push(type);   i++ }
    if (status) { sql += ` AND c.status=$${i}`; params.push(status); i++ }
    if (tag)    { sql += ` AND (',' || c.tags || ',') LIKE $${i}`; params.push(`%,${tag},%`); i++ }
    sql += ' GROUP BY c.id ORDER BY c.name ASC'
    res.json(await all(sql, params))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/tags', async (req, res) => {
  try {
    const rows = await all("SELECT tags FROM companies WHERE tags IS NOT NULL AND tags != ''")
    const tagSet = new Set()
    rows.forEach(r => r.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => tagSet.add(t)))
    res.json([...tagSet].sort())
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/companies/:id', async (req, res) => {
  try {
    const company = await one('SELECT * FROM companies WHERE id=$1', [req.params.id])
    if (!company) return res.status(404).json({ error: 'Not found' })
    const contacts = await all(
      'SELECT * FROM contacts WHERE company_id=$1 ORDER BY is_primary DESC, first_name ASC',
      [req.params.id]
    )
    res.json({ ...company, contacts })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/companies', async (req, res) => {
  try {
    const { name, type, website, phone, address, city, state, country, category, notes, status, tags } = req.body
    if (!name) return res.status(400).json({ error: 'Name required' })
    const r = await one(`
      INSERT INTO companies (name, type, website, phone, address, city, state, country, category, notes, status, tags)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id
    `, [name, type||'manufacturer', website||'', phone||'', address||'', city||'', state||'', country||'USA',
        category||'', notes||'', status||'prospect', tags||''])
    res.json({ id: r.id })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.put('/api/companies/:id', async (req, res) => {
  try {
    const {
      name, type, website, phone, address, city, state, country, category, notes, status, tags,
      pipeline_stage, opportunity_value, next_step, next_step_date,
    } = req.body
    await run(`
      UPDATE companies SET
        name=$1, type=$2, website=$3, phone=$4, address=$5, city=$6, state=$7, country=$8,
        category=$9, notes=$10, status=$11, tags=$12,
        pipeline_stage=$13, opportunity_value=$14, next_step=$15, next_step_date=$16,
        updated_at=NOW()
      WHERE id=$17
    `, [name, type, website||'', phone||'', address||'', city||'', state||'', country||'USA',
        category||'', notes||'', status, tags||'',
        pipeline_stage||'Prospect', opportunity_value||0, next_step||null, next_step_date||null,
        req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/companies/:id', async (req, res) => {
  try {
    const allowed = ['pipeline_stage','opportunity_value','next_step','next_step_date','last_activity_at','status','notes','tags']
    const sets = []
    const vals = []
    let i = 1
    for (const [k, v] of Object.entries(req.body)) {
      if (allowed.includes(k)) { sets.push(`${k}=$${i}`); vals.push(v); i++ }
    }
    if (!sets.length) return res.status(400).json({ error: 'No valid fields' })
    sets.push('updated_at=NOW()')
    vals.push(req.params.id)
    await run(`UPDATE companies SET ${sets.join(',')} WHERE id=$${i}`, vals)
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/companies/:id', async (req, res) => {
  try {
    await run('DELETE FROM companies WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── CONTACTS ────────────────────────────────────────────────────────────────

app.get('/api/contacts', async (req, res) => {
  try {
    const { search, company_id } = req.query
    let sql = `
      SELECT ct.*, co.name AS company_name, co.type AS company_type
      FROM contacts ct
      LEFT JOIN companies co ON ct.company_id = co.id
      WHERE 1=1
    `
    const params = []
    let i = 1
    if (search) {
      const s = `%${search}%`
      sql += ` AND (ct.first_name ILIKE $${i} OR ct.last_name ILIKE $${i+1} OR ct.email ILIKE $${i+2} OR co.name ILIKE $${i+3})`
      params.push(s, s, s, s); i += 4
    }
    if (company_id) { sql += ` AND ct.company_id=$${i}`; params.push(company_id); i++ }
    sql += ' ORDER BY co.name ASC, ct.first_name ASC'
    res.json(await all(sql, params))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/contacts/:id', async (req, res) => {
  try {
    const c = await one(`
      SELECT ct.*, co.name AS company_name
      FROM contacts ct
      LEFT JOIN companies co ON ct.company_id = co.id
      WHERE ct.id=$1
    `, [req.params.id])
    if (!c) return res.status(404).json({ error: 'Not found' })
    res.json(c)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/contacts', async (req, res) => {
  try {
    const { company_id, first_name, last_name, email, phone, title, linkedin, notes, is_primary } = req.body
    if (!first_name) return res.status(400).json({ error: 'First name required' })
    const r = await one(`
      INSERT INTO contacts (company_id, first_name, last_name, email, phone, title, linkedin, notes, is_primary)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
    `, [company_id||null, first_name, last_name||'', email||'', phone||'', title||'', linkedin||'', notes||'', is_primary?1:0])
    res.json({ id: r.id })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.put('/api/contacts/:id', async (req, res) => {
  try {
    const { company_id, first_name, last_name, email, phone, title, linkedin, notes, is_primary } = req.body
    await run(`
      UPDATE contacts SET
        company_id=$1, first_name=$2, last_name=$3, email=$4, phone=$5,
        title=$6, linkedin=$7, notes=$8, is_primary=$9, updated_at=NOW()
      WHERE id=$10
    `, [company_id||null, first_name, last_name||'', email||'', phone||'', title||'', linkedin||'', notes||'', is_primary?1:0, req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/contacts/:id', async (req, res) => {
  try {
    await run('DELETE FROM contacts WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── SEQUENCES ───────────────────────────────────────────────────────────────

app.get('/api/sequences', async (req, res) => {
  try {
    const seqs = await all('SELECT * FROM sequences ORDER BY name ASC')
    await Promise.all(seqs.map(async s => {
      s.steps = await all(
        'SELECT * FROM sequence_steps WHERE sequence_id=$1 ORDER BY step_number ASC',
        [s.id]
      )
      const { n } = await one(
        "SELECT COUNT(*)::int AS n FROM enrollments WHERE sequence_id=$1 AND status='active'",
        [s.id]
      )
      s.enrollment_count = n
    }))
    res.json(seqs)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/sequences/:id', async (req, res) => {
  try {
    const seq = await one('SELECT * FROM sequences WHERE id=$1', [req.params.id])
    if (!seq) return res.status(404).json({ error: 'Not found' })
    seq.steps = await all(
      'SELECT * FROM sequence_steps WHERE sequence_id=$1 ORDER BY step_number ASC',
      [seq.id]
    )
    res.json(seq)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/sequences', async (req, res) => {
  try {
    const { name, description, steps } = req.body
    if (!name) return res.status(400).json({ error: 'Name required' })
    const { id: seqId } = await one(
      'INSERT INTO sequences (name, description) VALUES ($1,$2) RETURNING id',
      [name, description||'']
    )
    if (steps && steps.length) {
      await Promise.all(steps.map((step, idx) =>
        run('INSERT INTO sequence_steps (sequence_id, step_number, delay_days, subject, body) VALUES ($1,$2,$3,$4,$5)',
          [seqId, idx+1, step.delay_days||0, step.subject||'', step.body||''])
      ))
    }
    res.json({ id: seqId })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.put('/api/sequences/:id', async (req, res) => {
  try {
    const { name, description, steps } = req.body
    await run('UPDATE sequences SET name=$1, description=$2 WHERE id=$3', [name, description||'', req.params.id])
    if (steps) {
      await run('DELETE FROM sequence_steps WHERE sequence_id=$1', [req.params.id])
      await Promise.all(steps.map((step, idx) =>
        run('INSERT INTO sequence_steps (sequence_id, step_number, delay_days, subject, body) VALUES ($1,$2,$3,$4,$5)',
          [req.params.id, idx+1, step.delay_days||0, step.subject||'', step.body||''])
      ))
    }
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/sequences/:id', async (req, res) => {
  try {
    await run('DELETE FROM sequences WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── ENROLLMENTS ─────────────────────────────────────────────────────────────

app.post('/api/enrollments', async (req, res) => {
  try {
    const { contact_ids, sequence_id } = req.body
    if (!contact_ids || !sequence_id) return res.status(400).json({ error: 'contact_ids and sequence_id required' })
    const ids = Array.isArray(contact_ids) ? contact_ids : [contact_ids]
    let enrolled = 0
    await Promise.all(ids.map(async cid => {
      const r = await run(`
        INSERT INTO enrollments (contact_id, sequence_id, current_step, status)
        VALUES ($1,$2,1,'active')
        ON CONFLICT (contact_id, sequence_id) DO NOTHING
      `, [cid, sequence_id])
      if (r.rowCount > 0) enrolled++
    }))
    res.json({ enrolled })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/enrollments/:id', async (req, res) => {
  try {
    await run("UPDATE enrollments SET status='stopped' WHERE id=$1", [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── OUTREACH QUEUE ───────────────────────────────────────────────────────────

async function getQueueItems() {
  const enrollments = await all(`
    SELECT e.*, s.name AS sequence_name,
      c.first_name, c.last_name, c.email, c.title, c.company_id,
      co.name AS company_name, co.type AS company_type, co.website
    FROM enrollments e
    JOIN sequences s ON e.sequence_id = s.id
    JOIN contacts c ON e.contact_id = c.id
    LEFT JOIN companies co ON c.company_id = co.id
    WHERE e.status = 'active'
  `)

  const queue = []
  await Promise.all(enrollments.map(async enr => {
    const step = await one(
      'SELECT * FROM sequence_steps WHERE sequence_id=$1 AND step_number=$2',
      [enr.sequence_id, enr.current_step]
    )
    if (!step) return

    let dueDate
    if (enr.current_step === 1) {
      const started = new Date(enr.started_at)
      dueDate = new Date(started.getTime() + step.delay_days * 86400000)
    } else {
      const lastActivity = await one(
        'SELECT sent_at FROM activities WHERE enrollment_id=$1 ORDER BY sent_at DESC LIMIT 1',
        [enr.id]
      )
      if (!lastActivity) return
      dueDate = new Date(new Date(lastActivity.sent_at).getTime() + step.delay_days * 86400000)
    }

    if (dueDate <= new Date()) {
      const { n: total_steps } = await one(
        'SELECT COUNT(*)::int AS n FROM sequence_steps WHERE sequence_id=$1',
        [enr.sequence_id]
      )
      queue.push({
        enrollment_id: enr.id,
        contact_id: enr.contact_id,
        sequence_id: enr.sequence_id,
        sequence_name: enr.sequence_name,
        current_step: enr.current_step,
        total_steps,
        first_name: enr.first_name,
        last_name: enr.last_name,
        email: enr.email,
        title: enr.title,
        company_name: enr.company_name,
        company_type: enr.company_type,
        website: enr.website,
        step_subject: step.subject,
        step_body: step.body,
        due_date: dueDate.toISOString(),
      })
    }
  }))

  return queue
}

app.get('/api/queue', async (req, res) => {
  try { res.json(await getQueueItems()) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/queue/send', async (req, res) => {
  try {
    const { enrollment_id, custom_subject, custom_body } = req.body

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

    const { resolvedSubject, resolvedBody } = await sendEmail({
      toEmail: enr.email,
      toName: [enr.first_name, enr.last_name].filter(Boolean).join(' '),
      subject: custom_subject || step.subject,
      body: custom_body || step.body,
      contact,
      company,
    })

    await run(
      "INSERT INTO activities (enrollment_id, contact_id, type, subject, body, status, sent_at) VALUES ($1,$2,'email',$3,$4,'sent',NOW())",
      [enrollment_id, enr.contact_id, resolvedSubject, resolvedBody]
    )
    if (enr.company_id) await run("UPDATE companies SET last_activity_at=NOW() WHERE id=$1", [enr.company_id])

    const { n: totalSteps } = await one(
      'SELECT COUNT(*)::int AS n FROM sequence_steps WHERE sequence_id=$1',
      [enr.sequence_id]
    )
    if (enr.current_step >= totalSteps) {
      await run("UPDATE enrollments SET status='completed', completed_at=NOW() WHERE id=$1", [enrollment_id])
    } else {
      await run("UPDATE enrollments SET current_step=current_step+1 WHERE id=$1", [enrollment_id])
    }

    res.json({ ok: true, subject: resolvedSubject })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/queue/send-all', async (req, res) => {
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

        const { resolvedSubject, resolvedBody } = await sendEmail({
          toEmail: enr.email,
          toName: [enr.first_name, enr.last_name].filter(Boolean).join(' '),
          subject: step.subject,
          body: step.body,
          contact,
          company,
        })

        await run(
          "INSERT INTO activities (enrollment_id, contact_id, type, subject, body, status, sent_at) VALUES ($1,$2,'email',$3,$4,'sent',NOW())",
          [item.enrollment_id, enr.contact_id, resolvedSubject, resolvedBody]
        )
        if (enr.company_id) await run("UPDATE companies SET last_activity_at=NOW() WHERE id=$1", [enr.company_id])

        const { n: totalSteps } = await one(
          'SELECT COUNT(*)::int AS n FROM sequence_steps WHERE sequence_id=$1',
          [enr.sequence_id]
        )
        if (enr.current_step >= totalSteps) {
          await run("UPDATE enrollments SET status='completed', completed_at=NOW() WHERE id=$1", [item.enrollment_id])
        } else {
          await run("UPDATE enrollments SET current_step=current_step+1 WHERE id=$1", [item.enrollment_id])
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

app.get('/api/queue/preview/:enrollment_id', async (req, res) => {
  try {
    const enr = await one(`
      SELECT e.*, c.first_name, c.last_name, c.email, c.title, c.company_id
      FROM enrollments e JOIN contacts c ON e.contact_id = c.id
      WHERE e.id=$1
    `, [req.params.enrollment_id])
    if (!enr) return res.status(404).json({ error: 'Not found' })

    const step = await one(
      'SELECT * FROM sequence_steps WHERE sequence_id=$1 AND step_number=$2',
      [enr.sequence_id, enr.current_step]
    )
    if (!step) return res.status(404).json({ error: 'Step not found' })

    const company = enr.company_id ? await one('SELECT * FROM companies WHERE id=$1', [enr.company_id]) : null
    const contact = { first_name: enr.first_name, last_name: enr.last_name, email: enr.email, title: enr.title }
    res.json({
      subject: interpolate(step.subject, contact, company),
      body:    interpolate(step.body,    contact, company),
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── PIPELINE ─────────────────────────────────────────────────────────────────

app.get('/api/pipeline', async (req, res) => {
  try {
    const contacts = await all(`
      SELECT
        ct.id, ct.first_name, ct.last_name, ct.email, ct.title, ct.is_primary,
        co.id AS company_id, co.name AS company_name, co.status AS company_status,
        e.id AS enrollment_id, e.current_step, e.status AS enrollment_status, e.started_at,
        s.id AS sequence_id, s.name AS sequence_name,
        (SELECT COUNT(*)::int FROM sequence_steps WHERE sequence_id = e.sequence_id) AS total_steps,
        (SELECT COUNT(*)::int FROM activities WHERE contact_id = ct.id AND type='email') AS emails_sent,
        (SELECT MAX(sent_at) FROM activities WHERE contact_id = ct.id) AS last_contact_at
      FROM contacts ct
      LEFT JOIN companies co ON ct.company_id = co.id
      LEFT JOIN enrollments e ON e.contact_id = ct.id
        AND e.id = (
          SELECT id FROM enrollments
          WHERE contact_id = ct.id
          ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END ASC, started_at DESC
          LIMIT 1
        )
      LEFT JOIN sequences s ON e.sequence_id = s.id
      ORDER BY co.name ASC, ct.first_name ASC
    `)
    res.json(contacts)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── ACTIVITIES ───────────────────────────────────────────────────────────────

app.get('/api/activities', async (req, res) => {
  try {
    const { contact_id, limit } = req.query
    let sql = `
      SELECT a.*, c.first_name, c.last_name, c.email,
             co.name AS company_name, co.id AS company_id,
             a.sent_at AS created_at
      FROM activities a
      LEFT JOIN contacts c ON a.contact_id = c.id
      LEFT JOIN companies co ON c.company_id = co.id
      WHERE 1=1
    `
    const params = []
    let i = 1
    if (contact_id) { sql += ` AND a.contact_id=$${i}`; params.push(contact_id); i++ }
    sql += ' ORDER BY a.sent_at DESC'
    if (limit) { sql += ` LIMIT $${i}`; params.push(parseInt(limit)); i++ }
    res.json(await all(sql, params))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/activities', async (req, res) => {
  try {
    const { contact_id, type, subject, body, status, notes } = req.body
    const r = await one(
      'INSERT INTO activities (contact_id, type, subject, body, status, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [contact_id, type||'note', subject||'', body||'', status||'sent', notes||'']
    )
    res.json({ id: r.id })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── SETTINGS ─────────────────────────────────────────────────────────────────

app.get('/api/settings', async (req, res) => {
  try {
    const rows = await all('SELECT key, value FROM settings')
    const s = {}
    rows.forEach(r => { s[r.key] = r.value })
    if (s.smtp_pass) s.smtp_pass = '••••••••'
    res.json(s)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/settings', async (req, res) => {
  try {
    const fields = ['smtp_host','smtp_port','smtp_user','smtp_from_name','smtp_secure']
    await Promise.all(
      fields
        .filter(k => req.body[k] !== undefined)
        .map(k => run(
          'INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
          [k, req.body[k]]
        ))
    )
    if (req.body.smtp_pass && !req.body.smtp_pass.startsWith('••')) {
      await run(
        'INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
        ['smtp_pass', req.body.smtp_pass]
      )
    }
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/settings/test-email', async (req, res) => {
  try {
    await testConnection()
    res.json({ ok: true, message: 'Connection successful!' })
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

// ─── CSV IMPORT ───────────────────────────────────────────────────────────────

app.post('/api/import/companies', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  try {
    const content = req.file.buffer.toString('utf8')
    const records = parse(content, { columns: true, skip_empty_lines: true, trim: true })
    let imported = 0
    for (const row of records) {
      const name = row.name || row.company || row.Company || row.Name
      if (!name) continue
      await run(`
        INSERT INTO companies (name, type, website, phone, city, state, category, notes, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [
        name,
        row.type  || row.Type     || 'manufacturer',
        row.website || row.Website || '',
        row.phone   || row.Phone   || '',
        row.city    || row.City    || '',
        row.state   || row.State   || '',
        row.category || row.Category || '',
        row.notes   || row.Notes   || '',
        row.status  || row.Status  || 'prospect',
      ])
      imported++
    }
    res.json({ imported })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/import/contacts', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  try {
    const content = req.file.buffer.toString('utf8')
    const records = parse(content, { columns: true, skip_empty_lines: true, trim: true })
    let imported = 0
    for (const row of records) {
      const first_name = row.first_name || row['First Name'] || row.firstname || row.name || row.Name
      if (!first_name) continue
      let company_id = null
      const companyName = row.company || row.Company || row.company_name
      if (companyName) {
        const co = await one('SELECT id FROM companies WHERE name ILIKE $1 LIMIT 1', [`%${companyName}%`])
        if (co) company_id = co.id
      }
      await run(`
        INSERT INTO contacts (company_id, first_name, last_name, email, phone, title, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [
        company_id,
        first_name,
        row.last_name || row['Last Name'] || row.lastname || '',
        row.email || row.Email || '',
        row.phone || row.Phone || '',
        row.title || row.Title || row.role || '',
        row.notes || row.Notes || '',
      ])
      imported++
    }
    res.json({ imported })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── NEWS FEED ────────────────────────────────────────────────────────────────

const https = require('https')
const http  = require('http')

function fetchURL(urlStr, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'))
    try {
      const u = new URL(urlStr)
      const mod = u.protocol === 'https:' ? https : http
      const req = mod.get({
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PhilLewisArtCRM/1.0)' },
        timeout: 8000,
      }, (res) => {
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
          const next = res.headers.location.startsWith('http')
            ? res.headers.location
            : u.origin + res.headers.location
          res.resume()
          return resolve(fetchURL(next, redirects + 1))
        }
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => resolve(data))
        res.on('error', reject)
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')) })
    } catch(e) { reject(e) }
  })
}

function parseRSS(xml) {
  const items = []
  const itemRx = /<item>([\s\S]*?)<\/item>/g
  let m
  while ((m = itemRx.exec(xml)) !== null) {
    const block = m[1]
    const get = tag => {
      const rx  = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i')
      const rx2 = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
      const f = block.match(rx) || block.match(rx2)
      return f ? f[1].replace(/<[^>]+>/g, '').trim() : ''
    }
    const title   = get('title')
    const linkM   = block.match(/<link\s*\/?>\s*([^\s<]+)/i) || block.match(/<link[^>]*>([^<]+)<\/link>/i)
    const link    = linkM ? linkM[1].trim() : ''
    const pubDate = get('pubDate')
    const source  = get('source')
    if (title && title.toLowerCase() !== 'title') {
      items.push({ title, link, source, pubDate, date: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString() })
    }
  }
  return items
}

let _newsCache = {}
const NEWS_TTL = 45 * 60 * 1000

async function fetchNewsFor(query) {
  const now = Date.now()
  if (_newsCache[query] && (now - _newsCache[query].ts) < NEWS_TTL) return _newsCache[query].items
  try {
    const xml = await fetchURL(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`)
    const items = parseRSS(xml)
    _newsCache[query] = { items, ts: now }
    return items
  } catch(e) { return [] }
}

app.get('/api/news', async (req, res) => {
  try {
    const company = req.query.company || null
    let results
    if (company) {
      results = await fetchNewsFor(`"${company}" art licensing OR collaboration OR artist`)
    } else {
      const queries = [
        'art licensing outdoor brands 2025',
        'artist collaboration skateboard surf snowboard apparel',
        'art licensing puzzle calendar greeting cards gift',
        'nature wildlife art brand collaboration limited edition',
        'outdoor lifestyle drinkware artist collaboration',
      ]
      const allItems = []
      await Promise.all(queries.map(async qry => {
        const items = await fetchNewsFor(qry)
        items.forEach(i => { i.query = qry; allItems.push(i) })
      }))
      const seen = new Set()
      results = allItems
        .filter(i => { if (seen.has(i.title)) return false; seen.add(i.title); return true })
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 40)
    }
    res.json(results)
  } catch(e) { res.status(500).json({ error: e.message }) }
})

// ─── CATCH ALL (SPA) ─────────────────────────────────────────────────────────

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// Export for Vercel serverless; listen locally when run directly
if (require.main === module) {
  app.listen(PORT, () => console.log(`\n  Phil Lewis Art CRM running at http://localhost:${PORT}\n`))
}

module.exports = app
