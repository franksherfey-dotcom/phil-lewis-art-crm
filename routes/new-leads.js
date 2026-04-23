const express = require('express')
const { one, all, run } = require('../lib/helpers')

const router = express.Router()

// ── Sequence suggestion rules ──────────────────────────────────────────────
// Priority-ordered: first regex that matches a company's (tags + category)
// wins. Keep these simple; they're easy to tune and mirror the sequence
// names/descriptions already in the DB (seed: migrate.js).
const SUGGESTION_RULES = [
  { seq: 'Fabrics & Textiles',            re: /fabric|textile|tapestry|blanket/i },
  { seq: 'Board Sports Licensing',        re: /skate|surf|snowboard|snow|action\s*sport|boardsport|wake/i },
  { seq: 'Home Goods & Lifestyle Licensing', re: /drinkware|home\s*decor|stationery|calendar|\blifestyle\b(?!.*(skate|surf|snow))/i },
  { seq: 'Apparel & Accessories Licensing', re: /apparel|footwear|clothing|outerwear|headwear/i },
  // Fallback handled below
]

// Internal: given a sequence lookup (name -> row) and a company, pick a seq.
function suggestSequence(seqByName, company) {
  const hay = `${company.tags || ''} ${company.category || ''}`
  for (const rule of SUGGESTION_RULES) {
    if (rule.re.test(hay) && seqByName[rule.seq]) return seqByName[rule.seq]
  }
  return seqByName['Initial Licensing Outreach'] || null
}

// Internal: derive info@<domain> from a website URL.
function deriveInfoEmail(website) {
  if (!website) return null
  try {
    const host = new URL(website).hostname.replace(/^www\./, '')
    if (!host) return null
    return `info@${host}`
  } catch { return null }
}

// Internal: find-or-create a generic catch-all contact for a company.
// Returns { contact_id, created: boolean, email } or throws.
async function ensureGenericContact(company) {
  // Look for an existing contact with a generic-looking email.
  const existing = await one(`
    SELECT id, email FROM contacts
    WHERE company_id=$1
      AND email IS NOT NULL AND email <> ''
      AND (
        email ILIKE 'info@%' OR email ILIKE 'hello@%' OR
        email ILIKE 'contact@%' OR email ILIKE 'licensing@%' OR
        first_name ILIKE '%General%' OR last_name ILIKE '%General%'
      )
    ORDER BY is_primary DESC, id ASC
    LIMIT 1
  `, [company.id])
  if (existing) return { contact_id: existing.id, created: false, email: existing.email }

  const email = deriveInfoEmail(company.website)
  if (!email) {
    const err = new Error('no website domain to derive generic email')
    err.code = 'NO_DOMAIN'
    throw err
  }
  const inserted = await one(`
    INSERT INTO contacts (company_id, first_name, last_name, email, title, is_primary, notes)
    VALUES ($1, $2, 'General Contact', $3, 'General Inquiries', 0, $4)
    RETURNING id
  `, [company.id, company.name, email,
      'Generic catch-all auto-created by New Leads bulk-enroll.'])
  return { contact_id: inserted.id, created: true, email }
}

// GET /api/new-leads?hours=24
// Returns companies created within the last N hours (default 24), with their
// contacts and each contact's active enrollment (if any). Each company also
// includes a `suggested_sequence_id` / `suggested_sequence_name` derived from
// its tags + category — used by the New Leads UI for quick enroll actions.
router.get('/', async (req, res) => {
  try {
    const hours = Math.max(1, Math.min(168, parseInt(req.query.hours, 10) || 24))
    const companies = await all(`
      SELECT id, name, type, website, city, state, country, category, tags, notes,
             status, created_at, updated_at
      FROM companies
      WHERE created_at > NOW() - ($1 || ' hours')::interval
      ORDER BY created_at DESC
    `, [hours])

    if (!companies.length) return res.json({ hours, companies: [], sequences: [] })

    const ids = companies.map(c => c.id)
    const contacts = await all(`
      SELECT c.id, c.company_id, c.first_name, c.last_name, c.title, c.email,
             c.is_primary,
             e.id AS enrollment_id, e.status AS enrollment_status, e.current_step,
             e.sequence_id, s.name AS sequence_name
      FROM contacts c
      LEFT JOIN LATERAL (
        SELECT e2.id, e2.status, e2.current_step, e2.sequence_id
        FROM enrollments e2
        WHERE e2.contact_id = c.id
        ORDER BY CASE e2.status WHEN 'active' THEN 0 WHEN 'replied' THEN 1 ELSE 2 END,
                 e2.started_at DESC
        LIMIT 1
      ) e ON true
      LEFT JOIN sequences s ON e.sequence_id = s.id
      WHERE c.company_id = ANY($1)
      ORDER BY c.is_primary DESC, c.first_name ASC
    `, [ids])

    // Group contacts under their company
    const byCompany = {}
    contacts.forEach(ct => {
      if (!byCompany[ct.company_id]) byCompany[ct.company_id] = []
      byCompany[ct.company_id].push(ct)
    })

    // Fetch sequences once so we can attach suggestions AND expose them to the UI.
    const sequences = await all(`SELECT id, name, auto_send FROM sequences ORDER BY name ASC`)
    const seqByName = {}
    sequences.forEach(s => { seqByName[s.name] = s })

    const result = companies.map(c => {
      const suggested = suggestSequence(seqByName, c)
      const coContacts = byCompany[c.id] || []
      // A company is "enrollable" if any contact has an email OR we can derive info@<domain>.
      const hasEmailable = coContacts.some(ct => ct.email && ct.email.trim())
      const canGenerate = !!deriveInfoEmail(c.website)
      return {
        ...c,
        contacts: coContacts,
        suggested_sequence_id: suggested ? suggested.id : null,
        suggested_sequence_name: suggested ? suggested.name : null,
        suggested_sequence_auto_send: suggested ? !!suggested.auto_send : null,
        enrollable: hasEmailable || canGenerate,
      }
    })
    res.json({ hours, companies: result, sequences })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// POST /api/new-leads/bulk-enroll
// Body: { items: [{ company_id, sequence_id }] }
// For each item:
//   1. Find-or-create a generic catch-all contact for the company (info@<domain>).
//   2. Enroll that contact into the given sequence.
// Returns a per-item result array so the UI can show exactly what happened.
router.post('/bulk-enroll', async (req, res) => {
  try {
    const { items } = req.body || {}
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'items array required' })
    }

    const results = []
    for (const item of items) {
      const { company_id, sequence_id } = item || {}
      if (!company_id || !sequence_id) {
        results.push({ company_id, sequence_id, ok: false, error: 'company_id and sequence_id required' })
        continue
      }
      try {
        const company = await one('SELECT id, name, website FROM companies WHERE id=$1', [company_id])
        if (!company) {
          results.push({ company_id, sequence_id, ok: false, error: 'company not found' }); continue
        }
        const seq = await one('SELECT id FROM sequences WHERE id=$1', [sequence_id])
        if (!seq) {
          results.push({ company_id, sequence_id, ok: false, error: 'sequence not found' }); continue
        }

        let generic
        try {
          generic = await ensureGenericContact(company)
        } catch (e) {
          results.push({
            company_id, sequence_id, ok: false,
            error: e.code === 'NO_DOMAIN' ? 'no website domain to derive info@ email' : e.message
          })
          continue
        }

        // Enroll. Mirrors the idempotent logic in routes/enrollments.js so
        // re-running the endpoint is safe: reactivates stopped/completed rows.
        //
        // Race condition note: SELECT then INSERT has a TOCTOU window — two
        // concurrent bulk-enrolls on the same (contact_id, sequence_id) could
        // both see no existing row and both try to INSERT, tripping the unique
        // constraint. We catch that and fall back to an UPDATE, same pattern
        // used by routes/enrollments.js. This also covers any INSERT/UPDATE
        // that races with a delete (stale existing.id) by falling through to
        // a keyed UPDATE.
        let enrollmentAction = 'enrolled'
        try {
          const existing = await one(
            'SELECT id, status FROM enrollments WHERE contact_id=$1 AND sequence_id=$2',
            [generic.contact_id, sequence_id]
          )
          if (existing) {
            if (existing.status === 'active') {
              enrollmentAction = 'already_active'
            } else {
              await run(
                "UPDATE enrollments SET status='active', current_step=1, started_at=NOW(), completed_at=NULL WHERE id=$1",
                [existing.id]
              )
              enrollmentAction = 'reactivated'
            }
          } else {
            await run(
              "INSERT INTO enrollments (contact_id, sequence_id, current_step, status) VALUES ($1,$2,1,'active')",
              [generic.contact_id, sequence_id]
            )
          }
        } catch (e) {
          // Unique-constraint or exclusion-constraint violation (concurrent
          // insert won the race). Fall back to a keyed UPDATE — if it now
          // exists and is already active, the WHERE clause leaves it alone;
          // otherwise it's reactivated.
          try {
            await run(
              "UPDATE enrollments SET status='active', current_step=1, started_at=NOW(), completed_at=NULL WHERE contact_id=$1 AND sequence_id=$2 AND status != 'active'",
              [generic.contact_id, sequence_id]
            )
            enrollmentAction = 'reactivated'
          } catch (e2) {
            throw e // both paths failed — let the outer catch record the error
          }
        }

        results.push({
          company_id, sequence_id, ok: true,
          contact_id: generic.contact_id,
          contact_created: generic.created,
          contact_email: generic.email,
          enrollment: enrollmentAction,
        })
      } catch (err) {
        results.push({ company_id, sequence_id, ok: false, error: err.message })
      }
    }
    const enrolled = results.filter(r => r.ok && r.enrollment !== 'already_active').length
    const createdContacts = results.filter(r => r.ok && r.contact_created).length
    const failed = results.filter(r => !r.ok).length
    res.json({ enrolled, createdContacts, failed, results })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

module.exports = router
