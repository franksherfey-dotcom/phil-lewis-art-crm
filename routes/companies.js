const express = require('express')
const { one, all, run } = require('../lib/helpers')

const router = express.Router()

// GET /api/companies
router.get('/', async (req, res) => {
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
    if (type) {
      const types = type.split(',').filter(Boolean)
      if (types.length === 1) { sql += ` AND c.type=$${i}`; params.push(types[0]); i++ }
      else if (types.length > 1) { sql += ` AND c.type IN (${types.map((_,j) => `$${i+j}`).join(',')})`; types.forEach(t => params.push(t)); i += types.length }
    }
    if (status) {
      const statuses = status.split(',').filter(Boolean)
      if (statuses.length === 1) { sql += ` AND c.status=$${i}`; params.push(statuses[0]); i++ }
      else if (statuses.length > 1) { sql += ` AND c.status IN (${statuses.map((_,j) => `$${i+j}`).join(',')})`; statuses.forEach(s => params.push(s)); i += statuses.length }
    }
    if (tag) {
      const tags = tag.split(',').filter(Boolean)
      if (tags.length === 1) { sql += ` AND (',' || REPLACE(c.tags, ' ', '') || ',') ILIKE $${i}`; params.push(`%,${tags[0]},%`); i++ }
      else if (tags.length > 1) {
        sql += ` AND (${tags.map((_,j) => `(',' || REPLACE(c.tags, ' ', '') || ',') ILIKE $${i+j}`).join(' OR ')})`
        tags.forEach(t => params.push(`%,${t},%`)); i += tags.length
      }
    }
    sql += ' GROUP BY c.id ORDER BY c.name ASC'
    res.json(await all(sql, params))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// GET /api/tags
router.get('/tags', async (req, res) => {
  try {
    const rows = await all("SELECT tags FROM companies WHERE tags IS NOT NULL AND tags != ''")
    const tagSet = new Set()
    rows.forEach(r => r.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => tagSet.add(t)))
    res.json([...tagSet].sort())
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// GET /api/companies/:id
router.get('/:id', async (req, res) => {
  try {
    const company = await one('SELECT * FROM companies WHERE id=$1', [req.params.id])
    if (!company) return res.status(404).json({ error: 'Not found' })
    const contacts = await all(`
      SELECT c.*,
        e.id AS enrollment_id, e.status AS enrollment_status, e.current_step,
        s.name AS sequence_name,
        (SELECT COUNT(*)::int FROM sequence_steps WHERE sequence_id = e.sequence_id) AS sequence_total_steps
      FROM contacts c
      LEFT JOIN LATERAL (
        SELECT e2.id, e2.status, e2.current_step, e2.sequence_id
        FROM enrollments e2 WHERE e2.contact_id = c.id
        ORDER BY CASE e2.status WHEN 'active' THEN 0 WHEN 'replied' THEN 1 ELSE 2 END, e2.started_at DESC
        LIMIT 1
      ) e ON true
      LEFT JOIN sequences s ON e.sequence_id = s.id
      WHERE c.company_id = $1
      ORDER BY c.is_primary DESC, c.first_name ASC
    `, [req.params.id])
    res.json({ ...company, contacts })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// POST /api/companies
router.post('/', async (req, res) => {
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

// PUT /api/companies/:id
router.put('/:id', async (req, res) => {
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

// PATCH /api/companies/:id
router.patch('/:id', async (req, res) => {
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

// DELETE /api/companies/:id
router.delete('/:id', async (req, res) => {
  try {
    await run('DELETE FROM companies WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
