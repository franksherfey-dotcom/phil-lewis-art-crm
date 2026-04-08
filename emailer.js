const nodemailer = require('nodemailer')
const MailComposer = require('nodemailer/lib/mail-composer')
const { ImapFlow } = require('imapflow')
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

async function sendEmail({ toEmail, toName, subject, body, contact, company, inReplyTo, references }) {
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
    text: resolvedBody,
    html: resolvedBody.replace(/\n/g, '<br>'),
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

// Sync received emails from IMAP inbox and match to CRM contacts
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
        bodyStructure: true,
        source: true,
      })) {
        const fromAddr = msg.envelope?.from?.[0]?.address?.toLowerCase()
        if (!fromAddr) continue
        if (!knownEmails.has(fromAddr)) continue
        // Extract plain text body — strip MIME boundaries and headers
        let bodyText = ''
        try {
          const src = msg.source.toString('utf8')
          // Try to extract the text/plain MIME part first
          const plainMatch = src.match(/Content-Type:\s*text\/plain[^\r\n]*\r?\n(?:Content-Transfer-Encoding:[^\r\n]*\r?\n)?(?:[^\r\n]*\r?\n)*?\r?\n([\s\S]*?)(?:\r?\n--|\s*$)/)
          if (plainMatch) {
            bodyText = plainMatch[1]
          } else {
            // Fallback: grab text after main headers
            const split = src.split(/\r?\n\r?\n/)
            bodyText = split.slice(1).join('\n\n')
          }
          // Clean up: strip HTML tags, MIME boundaries, content headers, and quoted-printable artifacts
          bodyText = bodyText
            .replace(/<[^>]+>/g, '')
            .replace(/^--.*$/gm, '')
            .replace(/^Content-(?:Type|Transfer-Encoding|Disposition):[^\r\n]*/gm, '')
            .replace(/=\r?\n/g, '')       // quoted-printable soft line breaks
            .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
            .replace(/\n{3,}/g, '\n\n')
            .trim()
            .slice(0, 2000)
        } catch {}
        received.push({
          from_email: fromAddr,
          subject: msg.envelope?.subject || '(no subject)',
          body: bodyText,
          received_at: msg.envelope?.date || new Date(),
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
