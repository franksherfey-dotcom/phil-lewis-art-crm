const express = require('express')
const { one, all } = require('../lib/helpers')
const router = express.Router()

router.get('/cron/process-queue', async (req, res) => {
  try {
    const isCron = req.headers['authorization'] === 'Bearer ' + (process.env.CRON_SECRET || '')
    const isDev = !process.env.VERCEL
    if (!isCron && !isDev) return res.status(401).json({ error: 'Unauthorized' })
    res.json({ ok: true, processed: 0 })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

router.get('/cron/weekly-digest', async (req, res) => {
  try {
    const isCron = req.headers['authorization'] === 'Bearer ' + (process.env.CRON_SECRET || '')
    const isDev = !process.env.VERCEL
    if (!isCron && !isDev) return res.status(401).json({ error: 'Unauthorized' })
    res.json({ ok: true, sent: 0 })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
