const express = require('express')
const { one, all, run } = require('../lib/helpers')
const router = express.Router()

const REPLY_SEEDS = [
  { name: 'Interested', category: 'positive', subject: 'Great! Let me send you some samples', body: "Thanks for your interest! I'd love to send over some samples and discuss what this could look like for your brand." },
  { name: 'Not Now', category: 'neutral', subject: "Understood \u2014 let's touch base later", body: "No problem at all! I completely understand. Let me save your info and I'll circle back in a few months." },
]

router.get('/', async (req, res) => {
  try {
    var rows = await all('SELECT * FROM reply_templates ORDER BY sort_order, name ASC')
    if (!rows.length) {
      for (var template of REPLY_SEEDS) {
        await run('INSERT INTO reply_templates (name, category, subject, body) VALUES ($1,$2,$3,$4)',
          [template.name, template.category, template.subject, template.body])
      }
      rows = await all('SELECT * FROM reply_templates ORDER BY sort_order, name ASC')
    }
    res.json(rows)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.post('/', async (req, res) => {
  try {
    const { name, category, subject, body } = req.body
    if (!name) return res.status(400).json({ error: 'name required' })
    const r = await one('INSERT INTO reply_templates (name, category, subject, body) VALUES ($1,$2,$3,$4) RETURNING id',
      [name, category||'general', subject||'', body||''])
    res.json({ id: r.id })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.put('/:id', async (req, res) => {
  try {
    const { name, category, subject, body } = req.body
    await run('UPDATE reply_templates SET name=$1, category=$2, subject=$3, body=$4 WHERE id=$5',
      [name, category, subject, body, req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.delete('/:id', async (req, res) => {
  try {
    await run('DELETE FROM reply_templates WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
