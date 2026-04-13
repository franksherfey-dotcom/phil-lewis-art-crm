const pool = require('./db')

// ── QUERY HELPERS ────────────────────────────────────────────────────────────
const run  = (sql, p = []) => pool.query(sql, p)
const one  = async (sql, p = []) => (await pool.query(sql, p)).rows[0]
const all  = async (sql, p = []) => (await pool.query(sql, p)).rows

// ── PHIL LEWIS ART IMAGE MAP (for embedding in outreach emails) ─────────
// Now uses database art_images table instead of hardcoded map
async function getArtForCompany(company) {
  const fallback = { url: 'https://phillewisart.com/cdn/shop/articles/Phil_Lewis_Product5843WEB_fadcaa8c-3b21-462c-b8be-26b402bc6f94_600x.jpg?v=1747320948', alt: 'Phil Lewis Art — Collaboration Products' }
  try {
    if (company && company.tags) {
      const companyTags = company.tags.toLowerCase().split(',').map(t => t.trim())
      const artRows = await all('SELECT * FROM art_images ORDER BY id')
      // Score each art image by tag overlap, weighted by priority
      let bestMatch = null, bestScore = -1
      for (const a of artRows) {
        if (!a.tags) continue
        const artTags = a.tags.toLowerCase().split(',').map(t => t.trim())
        const overlap = companyTags.filter(t => artTags.includes(t)).length
        if (overlap > 0) {
          const score = overlap * 10 + (a.priority || 0)
          if (score > bestScore) { bestScore = score; bestMatch = a }
        }
      }
      if (bestMatch) return { url: bestMatch.url, alt: 'Phil Lewis Art × ' + bestMatch.title }
      // Fall back to default image
      const defaultImg = artRows.find(a => a.is_default)
      if (defaultImg) return { url: defaultImg.url, alt: 'Phil Lewis Art × ' + defaultImg.title }
    }
    return fallback
  } catch { return fallback }
}

function buildArtEmailBlock(artImg) {
  return `
<div style="margin:24px 0;text-align:center;padding:16px;background:#fafafa;border-radius:8px">
  <div style="margin-bottom:8px;font-size:13px;color:#666;font-style:italic">Recent Collaboration</div>
  <img src="${artImg.url}" alt="${artImg.alt}" style="max-width:100%;width:480px;border-radius:8px;border:1px solid #e0e0e0" />
  <div style="margin-top:8px;font-size:12px;color:#999">${artImg.alt}</div>
  <div style="margin-top:4px"><a href="https://phillewisart.com/blogs/collaborations" style="font-size:12px;color:#4f46e5;text-decoration:none">View more collaborations →</a></div>
</div>`
}

// ── AUTO-SET NEXT STEP (enrollment logic) ────────────────────────────────────
async function autoSetNextStep(companyId, type, detail) {
  try {
    const now = new Date().toISOString().split('T')[0]  // YYYY-MM-DD
    const nextDays = type === 'cold_outreach' ? 7 : type === 'reply_received' ? 3 : 14
    const nextDate = new Date(Date.now() + nextDays * 24*60*60*1000).toISOString().split('T')[0]
    const step = type === 'cold_outreach' ? 'Follow-up on cold outreach' : type === 'reply_received' ? 'Reply received — schedule call' : type === 'call_scheduled' ? 'After call follow-up' : detail || 'Next step'
    await run(
      `UPDATE companies SET next_step=$1, next_step_date=$2, last_activity_at=NOW(), updated_at=NOW()
       WHERE id=$3`,
      [step, nextDate, companyId]
    )
  } catch (e) { console.error('autoSetNextStep error:', e.message) }
}

// ── GET QUEUE ITEMS ────────────────────────────────────────────────────────────
// Single query — avoids N+1 pattern that caused Vercel timeouts
async function getQueueItems() {
  const rows = await all(`
    SELECT
      e.id AS enrollment_id, e.contact_id, e.sequence_id, e.current_step, e.started_at,
      s.name AS sequence_name, s.auto_send,
      ss.subject AS step_subject, ss.body AS step_body, ss.delay_days,
      (SELECT COUNT(*)::int FROM sequence_steps WHERE sequence_id = e.sequence_id) AS total_steps,
      c.first_name, c.last_name, c.email, c.title, c.company_id,
      co.name AS company_name, co.type AS company_type, co.website,
      (SELECT MAX(sent_at) FROM activities WHERE enrollment_id = e.id) AS last_activity_at
    FROM enrollments e
    JOIN sequences s ON e.sequence_id = s.id
    JOIN sequence_steps ss ON ss.sequence_id = e.sequence_id AND ss.step_number = e.current_step
    JOIN contacts c ON e.contact_id = c.id
    LEFT JOIN companies co ON c.company_id = co.id
    WHERE e.status = 'active'
  `)

  const now = new Date()
  const queue = []
  for (const row of rows) {
    let dueDate
    if (row.current_step === 1) {
      dueDate = new Date(new Date(row.started_at).getTime() + row.delay_days * 86400000)
    } else {
      if (!row.last_activity_at) continue
      dueDate = new Date(new Date(row.last_activity_at).getTime() + row.delay_days * 86400000)
    }
    if (dueDate <= now) {
      queue.push({
        enrollment_id: row.enrollment_id,
        contact_id: row.contact_id,
        sequence_id: row.sequence_id,
        sequence_name: row.sequence_name,
        auto_send: row.auto_send,
        current_step: row.current_step,
        total_steps: row.total_steps,
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
        title: row.title,
        company_id: row.company_id,
        company_name: row.company_name,
        company_type: row.company_type,
        website: row.website,
        step_subject: row.step_subject,
        step_body: row.step_body,
        due_date: dueDate.toISOString(),
      })
    }
  }
  return queue
}

module.exports = {
  run, one, all,
  getArtForCompany, buildArtEmailBlock, autoSetNextStep, getQueueItems
}
