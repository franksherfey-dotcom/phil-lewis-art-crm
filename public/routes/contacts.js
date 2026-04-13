const express = require('express')
const { one, all, run } = require('../lib/helpers')

const router = express.Router()

// GET /api/contacts
router.get('/', async (req, res) => {
  try {
    const { search, company_id, category, tag, not_in_sequence, has_email, missing_email } = req.query
    let sql = `
      SELECT ct.*,
             co.name AS company_name, co.type AS company_type,
             co.category AS company_category, co.tags AS company_tags,
             e.status AS enrollment_status, s.name AS sequence_name, e.id AS enrollment_id
      FROM contacts ct
      LEFT JOIN companies co ON ct.company_id = co.id
      LEFT JOIN LATERAL (
        SELECT id, sequence_id, status FROM enrollments
        WHERE contact_id = ct.id
        ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'replied' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END
        LIMIT 1
      ) e ON true
      LEFT JOIN sequences s ON s.id = e.sequence_id
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
    if (category) {
      const cats = category.split(',').filter(Boolean)
      if (cats.length === 1) { sql += ` AND co.category ILIKE $${i}`; params.push(cats[0]); i++ }
      else if (cats.length > 1) { sql += ` AND co.category ILIKE ANY(ARRAY[${cats.map((_,j)=>`$${i+j}`).join(',')}])`; cats.forEach(c => params.push(c)); i += cats.length }
    }
    if (tag) {
      const tags = tag.split(',').filter(Boolean)
      if (tags.length === 1) { sql += ` AND (',' || co.tags || ',') ILIKE $${i}`; params.push(`%,${tags[0]},%`); i++ }
      else if (tags.length > 1) {
        sql += ` AND (${tags.map((_,j) => `(',' || co.tags || ',') ILIKE $${i+j}`).join(' OR ')})`
        tags.forEach(t => params.push(`%,${t},%`)); i += tags.length
      }
    }
    if (not_in_sequence === 'true') {
      sql += ` AND NOT EXISTS (SELECT 1 FROM enrollments WHERE contact_id=ct.id AND status='active')`
    }
    if (has_email === 'true') {
      sql += ` AND ct.email IS NOT NULL AND ct.email != ''`
    }
    if (missing_email === 'true') {
      sql += ` AND (ct.email IS NULL OR ct.email = '')`
    }
    sql += ' ORDER BY co.name ASC, ct.first_name ASC'
    res.json(await all(sql, params))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// GET /api/contacts/categories
router.get('/categories', async (req, res) => {
  try {
    const rows = await all(`SELECT DISTINCT category FROM companies WHERE category IS NOT NULL AND category != '' ORDER BY category ASC`)
    res.json(rows.map(r => r.category))
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// GET /api/contacts/:id
router.get('/:id', async (req, res) => {
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

// POST /api/contacts
router.post('/', async (req, res) => {
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

// PUT /api/contacts/:id
router.put('/:id', async (req, res) => {
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

// DELETE /api/contacts/:id
router.delete('/:id', async (req, res) => {
  try {
    await run('DELETE FROM contacts WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
