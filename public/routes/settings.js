const express = require('express')
const { one, all, run } = require('../lib/helpers')
const { testConnection } = require('../emailer')

const router = express.Router()

// GET /api/settings
router.get('/', async (req, res) => {
  try {
    const rows = await all('SELECT key, value FROM settings')
    const settings = {}
    rows.forEach(r => { settings[r.key] = r.value })
    res.json(settings)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// POST /api/settings
router.post('/', async (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      await run(
        'INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2',
        [key, String(value)]
      )
    }
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// POST /api/settings/test-email
router.post('/test-email', async (req, res) => {
  try {
    const settings = {}
    const sRows = await all('SELECT key, value FROM settings')
    sRows.forEach(r => { settings[r.key] = r.value })

    if (!settings.smtp_host || !settings.smtp_user || !settings.smtp_pass) {
      return res.status(400).json({ error: 'SMTP settings not configured' })
    }

    const result = await testConnection({
      smtp_host: settings.smtp_host,
      smtp_port: settings.smtp_port || '587',
      smtp_user: settings.smtp_user,
      smtp_pass: settings.smtp_pass,
    })

    res.json(result)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
