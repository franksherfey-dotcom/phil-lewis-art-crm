const nodemailer = require('nodemailer')
const pool = require('./lib/db')

async function getSettings() {
  const { rows } = await pool.query('SELECT key, value FROM settings')
  const s = {}
  rows.forEach(r => { s[r.key] = r.value })
  return s
}

function createTransport(settings) {
  return nodemailer.createTransport({
    host: settings.smtp_host,
    port: parseInt(settings.smtp_port) || 587,
    secure: settings.smtp_secure === 'true',
    auth: {
      user: settings.smtp_user,
      pass: settings.smtp_pass,
    },
    tls: { rejectUnauthorized: false },
  })
}

// Replace template tokens: {{first_name}}, {{last_name}}, {{company}}, {{title}}, {{website}}, {{city}}
function interpolate(template, contact, company) {
  return template
    .replace(/\{\{first_name\}\}/gi, contact.first_name || '')
    .replace(/\{\{last_name\}\}/gi, contact.last_name || '')
    .replace(/\{\{full_name\}\}/gi, [contact.first_name, contact.last_name].filter(Boolean).join(' '))
    .replace(/\{\{company\}\}/gi, company ? company.name : '')
    .replace(/\{\{title\}\}/gi, contact.title || '')
    .replace(/\{\{website\}\}/gi, company ? (company.website || '') : '')
    .replace(/\{\{city\}\}/gi, company ? (company.city || '') : '')
}

async function sendEmail({ toEmail, toName, subject, body, contact, company }) {
  const settings = await getSettings()
  if (!settings.smtp_host || !settings.smtp_user) {
    throw new Error('SMTP not configured. Go to Settings to set up your email.')
  }
  const transport = createTransport(settings)

  const resolvedSubject = interpolate(subject, contact || {}, company || null)
  const resolvedBody = interpolate(body, contact || {}, company || null)

  const fromName = settings.smtp_from_name || 'Phil Lewis Art'
  const fromEmail = settings.smtp_user

  await transport.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: toName ? `"${toName}" <${toEmail}>` : toEmail,
    replyTo: fromEmail,
    subject: resolvedSubject,
    text: resolvedBody,
    html: resolvedBody.replace(/\n/g, '<br>'),
  })

  return { resolvedSubject, resolvedBody }
}

async function testConnection() {
  const settings = await getSettings()
  if (!settings.smtp_host || !settings.smtp_user) {
    throw new Error('SMTP not configured.')
  }
  const transport = createTransport(settings)
  await transport.verify()
  return true
}

module.exports = { sendEmail, testConnection, interpolate }
