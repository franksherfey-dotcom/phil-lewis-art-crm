const nodemailer = require('nodemailer')
const MailComposer = require('nodemailer/lib/mail-composer')
const { ImapFlow } = require('imapflow')
const { simpleParser } = require('mailparser')
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

// Build raw RFC 2822 message from mail options (needed for IMAP append)
function buildRawMessage(mailOptions) {
  return new Promise((resolve, reject) => {
    const mail = new MailComposer(mailOptions)
    mail.compile().build((err, message) => {
      if (err) reject(err)
      else resolve(message)
    })
  })
}

// Append a sent message to the IMAP Sent folder so it shows up in RoundCube
async function appendToSentFolder(settings, rawMessage) {
  if (!settings.imap_host || !settings.smtp_user || !settings.smtp_pass) return
  const client = new ImapFlow({
    host: settings.imap_host,
    port: parseInt(settings.imap_port) || 993,
    secure: settings.imap_secure !== 'false',
    auth: {
      user: settings.smtp_user,
      pass: settings.smtp_pass,
    },
    tls: { rejectUnauthorized: false },
    logger: false,
  })
  try {
    await client.connect()
    const folder = settings.imap_sent_folder || 'Sent'
    await client.append(folder, rawMessage, ['\\Seen'])
  } catch (e) {
    console.warn('IMAP append to Sent failed:', e.message)
  } finally {
    await client.logout().catch(() => {})
  }
}

async function sendEmail({ toEmail, toName, subject, body, isHtml, contact, company, inReplyTo, references }) {
  const settings = await getSettings()
  if (!settings.smtp_host || !settings.smtp_user) {
    throw new Error('SMTP not configured. Go to Settings to set up your email.')
  }
  const transport = createTransport(settings)

  const resolvedSubject = interpolate(subject, contact || {}, company || null)
  const resolvedBody = interpolate(body, contact || {}, company || null)

  const fromName = settings.smtp_from_name || 'Phil Lewis Art'
  const fromEmail = settings.smtp_user

  const mailOptions = {
    from: `"${fromName}" <${fromEmail}>`,
    to: toName ? `"${toName}" <${toEmail}>` : toEmail,
    replyTo: fromEmail,
    subject: resolvedSubject,
    // If body is already HTML (e.g. includes signature), use as-is; otherwise convert line breaks
    text: resolvedBody.replace(/<[^>]+>/g, ''),
    html: isHtml ? resolvedBody : resolvedBody.replace(/\n/g, '<br>'),
  }

  // Threading headers — keeps replies grouped in email clients and RoundCube
  if (inReplyTo) mailOptions.inReplyTo = inReplyTo
  if (references) mailOptions.references = references

  // Build raw message BEFORE sending — needed for IMAP append
  // (nodemailer dryRun doesn't expose raw message in v8+, MailComposer does)
  let rawMessage = null
  try {
    rawMessage = await buildRawMessage(mailOptions)
  } catch (e) {
    console.warn('Could not build raw message for IMAP append:', e.message)
  }

  // Send the email
  const info = await transport.sendMail(mailOptions)

  // Append to IMAP Sent folder so it appears in RoundCube
  if (rawMessage) {
    try {
      await appendToSentFolder(settings, rawMessage)
    } catch (e) {
      console.warn('Could not append to Sent folder:', e.message)
    }
  }

  return { resolvedSubject, resolvedBody }
}

// Maximum stored body length. Generous so full email threads fit, but capped to keep
// pathologically large messages (giant attachments serialized as text, etc.) from blowing
// up the activities table.
const MAX_BODY_LENGTH = 50000

// Sync received emails from IMAP inbox and match to CRM contacts.
//
// Uses mailparser (the standard sister library to nodemailer/imapflow) to handle:
//   - MIME multipart parsing (text/plain vs text/html parts)
//   - Content-Transfer-Encoding decoding (base64, quoted-printable, 7bit, 8bit)
//   - Charset conversion (UTF-8, ISO-8859-1, etc.)
//   - HTML-to-text fallback when no text/plain part exists
//
// Replaces the previous regex-based MIME extraction which had two bugs:
//   1. Did not decode base64-encoded bodies (stored raw base64 gibberish)
//   2. Hard-truncated bodies at 2000 chars (cut messages mid-sentence)
async function syncInbox(settings, knownEmails) {
  if (!settings.imap_host || !settings.smtp_user || !settings.smtp_pass) {
    throw new Error('IMAP not configured.')
  }
  const client = new ImapFlow({
    host: settings.imap_host,
    port: parseInt(settings.imap_port) || 993,
    secure: settings.imap_secure !== 'false',
    auth: {
      user: settings.smtp_user,
      pass: settings.smtp_pass,
    },
    tls: { rejectUnauthorized: false },
    logger: false,
  })

  const received = []
  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX')
    try {
      // Search last 60 days
      const since = new Date()
      since.setDate(since.getDate() - 60)
      const messages = await client.search({ since })

      for await (const msg of client.fetch(messages.length ? messages : '1:0', {
        envelope: true,
        source: true,
      })) {
        const fromAddr = msg.envelope?.from?.[0]?.address?.toLowerCase()
        if (!fromAddr) continue
        if (!knownEmails.has(fromAddr)) continue

        // Parse the raw RFC 2822 source with mailparser. This handles MIME parts,
        // base64/quoted-printable decoding, charset conversion, and HTML fallback.
        let parsed = null
        let bodyText = ''
        try {
          parsed = await simpleParser(msg.source)
          // Prefer plain text part. Fall back to HTML stripped of tags if no text part exists.
          bodyText = parsed.text || (parsed.html ? parsed.html.replace(/<[^>]+>/g, '') : '')
          bodyText = bodyText
            .replace(/\n{3,}/g, '\n\n')
            .trim()
          if (bodyText.length > MAX_BODY_LENGTH) {
            bodyText = bodyText.slice(0, MAX_BODY_LENGTH) + '\n\n[... message truncated]'
          }
        } catch (e) {
          console.warn('mailparser failed for inbound message; storing empty body:', e.message)
        }

        received.push({
          from_email: fromAddr,
          subject: parsed?.subject || msg.envelope?.subject || '(no subject)',
          body: bodyText,
          received_at: parsed?.date || msg.envelope?.date || new Date(),
        })
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }
  return received
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

module.exports = { sendEmail, syncInbox, testConnection, interpolate }
