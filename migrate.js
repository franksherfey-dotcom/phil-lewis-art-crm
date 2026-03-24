/**
 * One-time data migration: SQLite → Supabase PostgreSQL
 *
 * HOW TO RUN:
 *   1. Make sure your .env has DATABASE_URL set to your Supabase connection string
 *   2. Run the schema first in Supabase SQL Editor (supabase/schema.sql)
 *   3. Run: node migrate.js
 */

require('dotenv').config()
const Database = require('better-sqlite3')
const path = require('path')
const { Pool } = require('pg')

const sqlite = new Database(path.join(__dirname, 'data', 'crm.db'))
const pg = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

async function migrate() {
  console.log('Starting migration from SQLite → Supabase PostgreSQL...\n')

  // ── Companies ─────────────────────────────────────────────────────────────
  const companies = sqlite.prepare('SELECT * FROM companies').all()
  console.log(`Migrating ${companies.length} companies...`)
  for (const c of companies) {
    await pg.query(`
      INSERT INTO companies (
        id, name, type, website, phone, address, city, state, country,
        category, tags, notes, status,
        pipeline_stage, opportunity_value, next_step, next_step_date,
        last_activity_at, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,
        $10,$11,$12,$13,
        $14,$15,$16,$17,
        $18,$19,$20
      ) ON CONFLICT (id) DO NOTHING
    `, [
      c.id, c.name, c.type||'manufacturer', c.website||'', c.phone||'',
      c.address||'', c.city||'', c.state||'', c.country||'USA',
      c.category||'', c.tags||'', c.notes||'', c.status||'prospect',
      c.pipeline_stage||'Prospect', c.opportunity_value||0,
      c.next_step||null, c.next_step_date||null,
      c.last_activity_at||null,
      c.created_at ? new Date(c.created_at + 'Z') : new Date(),
      c.updated_at ? new Date(c.updated_at + 'Z') : new Date(),
    ])
  }
  // Reset sequence so future inserts don't conflict
  if (companies.length) {
    await pg.query(`SELECT setval('companies_id_seq', (SELECT MAX(id) FROM companies))`)
  }
  console.log(`  ✓ ${companies.length} companies`)

  // ── Contacts ──────────────────────────────────────────────────────────────
  const contacts = sqlite.prepare('SELECT * FROM contacts').all()
  console.log(`Migrating ${contacts.length} contacts...`)
  for (const c of contacts) {
    await pg.query(`
      INSERT INTO contacts (
        id, company_id, first_name, last_name, email, phone,
        title, linkedin, notes, is_primary, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO NOTHING
    `, [
      c.id, c.company_id||null, c.first_name, c.last_name||'',
      c.email||'', c.phone||'', c.title||'', c.linkedin||'',
      c.notes||'', c.is_primary||0,
      c.created_at ? new Date(c.created_at + 'Z') : new Date(),
      c.updated_at ? new Date(c.updated_at + 'Z') : new Date(),
    ])
  }
  if (contacts.length) {
    await pg.query(`SELECT setval('contacts_id_seq', (SELECT MAX(id) FROM contacts))`)
  }
  console.log(`  ✓ ${contacts.length} contacts`)

  // ── Sequences ─────────────────────────────────────────────────────────────
  const sequences = sqlite.prepare('SELECT * FROM sequences').all()
  console.log(`Migrating ${sequences.length} sequences...`)
  for (const s of sequences) {
    await pg.query(`
      INSERT INTO sequences (id, name, description, created_at)
      VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING
    `, [s.id, s.name, s.description||'',
        s.created_at ? new Date(s.created_at + 'Z') : new Date()])
  }
  if (sequences.length) {
    await pg.query(`SELECT setval('sequences_id_seq', (SELECT MAX(id) FROM sequences))`)
  }
  console.log(`  ✓ ${sequences.length} sequences`)

  // ── Sequence Steps ────────────────────────────────────────────────────────
  const steps = sqlite.prepare('SELECT * FROM sequence_steps').all()
  console.log(`Migrating ${steps.length} sequence steps...`)
  for (const s of steps) {
    await pg.query(`
      INSERT INTO sequence_steps (id, sequence_id, step_number, delay_days, subject, body, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING
    `, [s.id, s.sequence_id, s.step_number, s.delay_days||0,
        s.subject||'', s.body||'',
        s.created_at ? new Date(s.created_at + 'Z') : new Date()])
  }
  if (steps.length) {
    await pg.query(`SELECT setval('sequence_steps_id_seq', (SELECT MAX(id) FROM sequence_steps))`)
  }
  console.log(`  ✓ ${steps.length} sequence steps`)

  // ── Enrollments ───────────────────────────────────────────────────────────
  const enrollments = sqlite.prepare('SELECT * FROM enrollments').all()
  console.log(`Migrating ${enrollments.length} enrollments...`)
  for (const e of enrollments) {
    await pg.query(`
      INSERT INTO enrollments (id, contact_id, sequence_id, current_step, status, started_at, completed_at, paused_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING
    `, [
      e.id, e.contact_id, e.sequence_id, e.current_step||1, e.status||'active',
      e.started_at  ? new Date(e.started_at  + 'Z') : new Date(),
      e.completed_at ? new Date(e.completed_at + 'Z') : null,
      e.paused_at    ? new Date(e.paused_at    + 'Z') : null,
    ])
  }
  if (enrollments.length) {
    await pg.query(`SELECT setval('enrollments_id_seq', (SELECT MAX(id) FROM enrollments))`)
  }
  console.log(`  ✓ ${enrollments.length} enrollments`)

  // ── Activities ────────────────────────────────────────────────────────────
  const activities = sqlite.prepare('SELECT * FROM activities').all()
  console.log(`Migrating ${activities.length} activities...`)
  for (const a of activities) {
    await pg.query(`
      INSERT INTO activities (id, enrollment_id, contact_id, type, subject, body, status, notes, sent_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING
    `, [
      a.id, a.enrollment_id||null, a.contact_id||null,
      a.type||'email', a.subject||'', a.body||'', a.status||'sent', a.notes||'',
      a.sent_at ? new Date(a.sent_at + 'Z') : new Date(),
    ])
  }
  if (activities.length) {
    await pg.query(`SELECT setval('activities_id_seq', (SELECT MAX(id) FROM activities))`)
  }
  console.log(`  ✓ ${activities.length} activities`)

  // ── Settings ──────────────────────────────────────────────────────────────
  const settings = sqlite.prepare('SELECT * FROM settings').all()
  console.log(`Migrating ${settings.length} settings...`)
  for (const s of settings) {
    if (s.value) {
      await pg.query(
        'INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
        [s.key, s.value]
      )
    }
  }
  console.log(`  ✓ ${settings.length} settings`)

  console.log('\n✅ Migration complete!')
  await pg.end()
  sqlite.close()
}

migrate().catch(err => {
  console.error('Migration failed:', err.message)
  process.exit(1)
})
