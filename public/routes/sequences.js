const express = require('express')
const pool = require('../lib/db')
const { one, all, run } = require('../lib/helpers')

const router = express.Router()

// FABRICS_SEQUENCE_SEED — used when seeding default sequences
const FABRICS_SEQUENCE_SEED = {
  name: 'Fabrics & Textiles',
  description: 'Outreach sequence for fabric manufacturers, textile companies, tapestry makers, blanket producers, and home textile brands interested in licensing Phil Lewis\'s art.',
  steps: [
    {
      step_number: 1,
      delay_days: 0,
      subject: 'Phil Lewis Art × {{company}} — Bold Art for Beautiful Textiles',
      body: `Hi {{first_name}},

I came across {{company}} and was really impressed by your textile work — the quality and attention to design stood out to me right away.

I'm reaching out on behalf of Phil Lewis, a Boulder-based artist known for his incredibly detailed, nature-inspired artwork. His bold color palettes and intricate patterns translate beautifully to fabric — whether it's woven tapestries, blankets, upholstery, or printed textiles.

Here's a sample of Phil's work that I think could be a fantastic fit for your products:

{{art_block}}

Phil's art has been licensed across dozens of product categories, and his designs are available in high-resolution formats ready for textile production — repeat patterns, all-over prints, or featured panel designs.

Would you be open to a quick conversation about what a licensing collaboration could look like? I'd love to share more.

Best,
Frank Sherfey
Phil Lewis Art — Licensing`
    },
    {
      step_number: 2,
      delay_days: 4,
      subject: 'Re: Phil Lewis Art × {{company}} — Bold Art for Beautiful Textiles',
      body: `Hi {{first_name}},

Just wanted to follow up on my note from earlier this week. I think there's a really natural fit between Phil Lewis's art and what {{company}} creates.

Phil's artwork features detailed natural landscapes, vibrant flora and fauna, and psychedelic color work that lends itself incredibly well to textile applications. His pieces have been printed on everything from apparel to home goods, and the level of detail holds up beautifully at large scale — perfect for throws, tapestries, and woven blankets.

If it helps, I'm happy to send over a curated portfolio with designs specifically suited for your product line. Just say the word.

Looking forward to connecting,
Frank`
    },
    {
      step_number: 3,
      delay_days: 5,
      subject: 'How Phil Lewis Art Works on Fabric — Quick Visual',
      body: `Hi {{first_name}},

I wanted to share a quick visual to help bring this to life. Here's one of Phil's pieces that I think would work especially well for {{company}}:

{{art_block}}

A few reasons Phil's art works so well on textiles:

• **Rich detail at any scale** — his intricate line work and layered compositions look stunning whether printed on a throw pillow or a full wall tapestry
• **Vibrant, saturated color** — his palette is bold and eye-catching, which translates to vivid fabric prints that pop on shelves
• **Nature-inspired themes** — mountains, forests, wildlife, and botanicals that resonate with outdoor and lifestyle audiences

We can provide production-ready files in whatever format your team needs — repeat tiles, engineered prints, or custom adaptations.

Would love to chat if this sparks any ideas for {{company}}.

Best,
Frank`
    },
    {
      step_number: 4,
      delay_days: 6,
      subject: 'Re: Phil Lewis Art × {{company}} — Bold Art for Beautiful Textiles',
      body: `Hi {{first_name}},

I know inboxes get busy, so I'll keep this one short.

Phil Lewis's art has been licensed by brands across outdoor, lifestyle, drinkware, board sports, and home goods — and we're actively expanding into textiles and fabric products. His work is a natural fit for companies like {{company}} that value bold, original design.

You can see some of Phil's collaborations here: https://phillewisart.com/blogs/collaborations

If the timing isn't right, no worries at all — but if you're exploring new art partnerships, I'd love to be on your radar.

Happy to send more info whenever it's useful.

Cheers,
Frank`
    },
    {
      step_number: 5,
      delay_days: 7,
      subject: 'One More Thought — Phil Lewis × {{company}}',
      body: `Hi {{first_name}},

One last thought before I let this rest — I wanted to share one more piece from Phil's collection that I think could really shine on fabric:

{{art_block}}

What makes licensing with Phil Lewis Art easy for textile producers:

• **Flexible licensing terms** — we work with everything from limited-edition capsules to ongoing collections
• **Production-ready art** — high-res files delivered in your preferred format, with support for colorway adjustments
• **Proven market appeal** — Phil's art resonates strongly with outdoor, nature, and lifestyle consumers, a natural crossover with premium home textiles

I'd love the chance to put together a quick proposal tailored to {{company}}'s product line. Even a 15-minute call could be a great starting point.

Either way, thanks for your time — and feel free to reach out anytime if something comes up down the road.

All the best,
Frank Sherfey
Phil Lewis Art — Licensing`
    }
  ]
}

async function seedFabricsSequenceIfMissing() {
  var existing = await one("SELECT id FROM sequences WHERE name='Fabrics & Textiles'")
  if (existing) return
  var { id: seqId } = await one(
    'INSERT INTO sequences (name, description) VALUES ($1,$2) RETURNING id',
    [FABRICS_SEQUENCE_SEED.name, FABRICS_SEQUENCE_SEED.description]
  )
  for (var s of FABRICS_SEQUENCE_SEED.steps) {
    await pool.query(
      'INSERT INTO sequence_steps (sequence_id, step_number, delay_days, subject, body) VALUES ($1,$2,$3,$4,$5)',
      [seqId, s.step_number, s.delay_days, s.subject, s.body]
    )
  }
}

// GET /api/sequences
router.get('/', async (req, res) => {
  try {
    await seedFabricsSequenceIfMissing()
    const seqs = await all('SELECT * FROM sequences ORDER BY name ASC')
    await Promise.all(seqs.map(async s => {
      s.steps = await all(
        'SELECT * FROM sequence_steps WHERE sequence_id=$1 ORDER BY step_number ASC',
        [s.id]
      )
      // Enrollment stats by status
      const stats = await all(
        "SELECT status, COUNT(*)::int AS n FROM enrollments WHERE sequence_id=$1 GROUP BY status",
        [s.id]
      )
      s.stats = { active: 0, replied: 0, completed: 0, stopped: 0, paused: 0, total: 0 }
      stats.forEach(r => { s.stats[r.status] = r.n; s.stats.total += r.n })
      s.enrollment_count = s.stats.active
    }))
    res.json(seqs)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// GET /api/sequences/:id
router.get('/:id', async (req, res) => {
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

// GET /api/sequences/:id/roster
router.get('/:id/roster', async (req, res) => {
  try {
    const seqId = req.params.id

    // Enrolled contacts with their status + reply info
    const enrolled = await all(`
      SELECT ct.id, ct.first_name, ct.last_name, ct.email, ct.title,
             co.name AS company_name, co.category AS company_category,
             co.id AS company_id,
             e.id AS enrollment_id, e.status AS enrollment_status,
             e.current_step, e.started_at, e.completed_at,
             (SELECT MAX(a.sent_at) FROM activities a
                WHERE a.contact_id = ct.id AND a.type = 'received_email') AS last_reply_at,
             (SELECT MAX(a.sent_at) FROM activities a
                WHERE a.contact_id = ct.id AND a.type = 'email') AS last_sent_at
      FROM enrollments e
      JOIN contacts ct ON ct.id = e.contact_id
      LEFT JOIN companies co ON co.id = ct.company_id
      WHERE e.sequence_id = $1
      ORDER BY CASE e.status WHEN 'replied' THEN 0 WHEN 'active' THEN 1 WHEN 'paused' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END,
               e.started_at DESC
    `, [seqId])

    // Suggested: contacts NOT in this sequence, have email, prioritise those not in any active sequence
    const suggestions = await all(`
      SELECT ct.id, ct.first_name, ct.last_name, ct.email, ct.title,
             co.name AS company_name, co.category AS company_category,
             (SELECT status FROM enrollments WHERE contact_id=ct.id ORDER BY
               CASE status WHEN 'active' THEN 0 ELSE 1 END LIMIT 1) AS other_enrollment_status
      FROM contacts ct
      LEFT JOIN companies co ON co.id = ct.company_id
      WHERE ct.email IS NOT NULL AND ct.email != ''
        AND NOT EXISTS (
          SELECT 1 FROM enrollments WHERE contact_id=ct.id AND sequence_id=$1
        )
      ORDER BY
        CASE WHEN NOT EXISTS (SELECT 1 FROM enrollments WHERE contact_id=ct.id AND status='active') THEN 0 ELSE 1 END,
        co.name ASC, ct.first_name ASC
      LIMIT 50
    `, [seqId])

    res.json({ enrolled, suggestions })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// POST /api/sequences
router.post('/', async (req, res) => {
  try {
    const { name, description, steps, auto_send } = req.body
    if (!name) return res.status(400).json({ error: 'Name required' })
    const { id: seqId } = await one(
      'INSERT INTO sequences (name, description, auto_send) VALUES ($1,$2,$3) RETURNING id',
      [name, description||'', auto_send === true]
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

// PATCH /api/sequences/:id/auto-send
router.patch('/:id/auto-send', async (req, res) => {
  try {
    const { auto_send } = req.body
    await run('UPDATE sequences SET auto_send=$1 WHERE id=$2', [auto_send === true, req.params.id])
    res.json({ ok: true, auto_send: auto_send === true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// PUT /api/sequences/:id
router.put('/:id', async (req, res) => {
  try {
    const { name, description, steps, auto_send } = req.body
    await run('UPDATE sequences SET name=$1, description=$2, auto_send=$3 WHERE id=$4', [name, description||'', auto_send === true, req.params.id])
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

// DELETE /api/sequences/:id
router.delete('/:id', async (req, res) => {
  try {
    await run('DELETE FROM sequences WHERE id=$1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
