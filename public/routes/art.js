const express = require('express')
const { one, all, run } = require('../lib/helpers')
const router = express.Router()

router.get('/', async (req, res) => {
  try {
    const rows = await all("SELECT * FROM art_images ORDER BY type DESC, title ASC")
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/', async (req, res) => {
  try {
    const { title, url, tags, category, notes, type } = req.body
    if (!title || !url) return res.status(400).json({ error: 'title and url required' })
    const r = await one(`
      INSERT INTO art_images (title, url, tags, category, notes, type)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
    `, [title, url, tags||'', category||'', notes||'', type||'art'])
    res.json({ id: r.id })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.put('/:id', async (req, res) => {
  try {
    const { title, url, tags, category, notes, priority } = req.body
    await run(`UPDATE art_images SET title=$1, url=$2, tags=$3, category=$4, notes=$5, priority=$6 WHERE id=$7`,
      [title, url, tags||'', category||'', notes||'', priority||0, req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/:id', async (req, res) => {
  try {
    await run('DELETE FROM art_images WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.get('/match', async (req, res) => {
  try {
    const { company_id } = req.query
    if (!company_id) return res.status(400).json({ error: 'company_id required' })
    const company = await one('SELECT * FROM companies WHERE id=$1', [company_id])
    if (!company) return res.status(404).json({ error: 'Company not found' })
    const artImages = await all("SELECT id, title, url FROM art_images WHERE type='art' LIMIT 20")
    res.json(artImages)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
