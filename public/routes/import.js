const express = require('express')
const { parse } = require('csv-parse/sync')
const { one, all, run } = require('../lib/helpers')
const router = express.Router()
const multer = require('multer')
const upload = multer({ storage: multer.memoryStorage() })

router.post('/quick', async (req, res) => {
  try {
    const { company_names } = req.body
    if (!company_names) return res.status(400).json({ error: 'company_names required' })
    const names = Array.isArray(company_names) ? company_names : company_names.split('\n').map(n => n.trim()).filter(Boolean)
    let created = 0
    for (const name of names) {
      if (name) {
        await run('INSERT INTO companies (name, type, status) VALUES ($1,$2,$3)',
          [name, 'manufacturer', 'prospect'])
        created++
      }
    }
    res.json({ created })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/companies', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' })
    const csv = req.file.buffer.toString()
    const records = parse(csv, { columns: true })
    let created = 0
    for (const rec of records) {
      const { name, type, website, phone, city, state, category, tags } = rec
      if (name) {
        await run('INSERT INTO companies (name, type, website, phone, city, state, category, tags, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [name, type||'manufacturer', website||'', phone||'', city||'', state||'', category||'', tags||'', 'prospect'])
        created++
      }
    }
    res.json({ created, total: records.length })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/contacts', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file required' })
    const csv = req.file.buffer.toString()
    const records = parse(csv, { columns: true })
    let created = 0
    for (const rec of records) {
      const { first_name, last_name, email, company_name, phone, title } = rec
      if (first_name && company_name) {
        const co = await one('SELECT id FROM companies WHERE name=$1', [company_name])
        if (co) {
          await run('INSERT INTO contacts (company_id, first_name, last_name, email, phone, title) VALUES ($1,$2,$3,$4,$5,$6)',
            [co.id, first_name, last_name||'', email||'', phone||'', title||''])
          created++
        }
      }
    }
    res.json({ created, total: records.length })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
