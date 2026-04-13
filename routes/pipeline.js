const express = require('express')
const { one, all } = require('../lib/helpers')

const router = express.Router()

// GET /api/pipeline
router.get('/pipeline', async (req, res) => {
  try {
    const pipeline = await all(`
      SELECT
        pipeline_stage,
        COUNT(*)::int AS count,
        ROUND(AVG(COALESCE(opportunity_value,0))::numeric,0)::int AS avg_value,
        SUM(COALESCE(opportunity_value,0))::int AS total_value
      FROM companies
      WHERE status IN ('active','prospect','interested')
      GROUP BY pipeline_stage
      ORDER BY CASE pipeline_stage
        WHEN 'Prospect' THEN 1
        WHEN 'Interested' THEN 2
        WHEN 'Negotiating' THEN 3
        WHEN 'Won' THEN 4
        WHEN 'Lost' THEN 5
        ELSE 6
      END
    `)
    res.json(pipeline)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// GET /api/pipeline/stuck-count
router.get('/pipeline/stuck-count', async (req, res) => {
  try {
    const stuck = await one(`
      SELECT COUNT(*)::int AS n FROM companies
      WHERE last_activity_at < NOW() - INTERVAL '21 days'
        AND status IN ('active','prospect','interested')
    `)
    res.json({ stuck: stuck.n })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// GET /api/leads/heatmap
router.get('/leads/heatmap', async (req, res) => {
  try {
    const heatmap = await all(`
      SELECT
        c.type,
        c.pipeline_stage,
        COUNT(*)::int AS count,
        ROUND(AVG(COALESCE(opportunity_value,0))::numeric,0)::int AS avg_value
      FROM companies c
      WHERE c.status IN ('active','prospect','interested')
      GROUP BY c.type, c.pipeline_stage
      ORDER BY c.type, c.pipeline_stage
    `)
    res.json(heatmap)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
