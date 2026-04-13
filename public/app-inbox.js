// ── PHIL LEWIS ART CRM — Inbox & Settings ──────────────────────────────────────────
// ── INBOX ─────────────────────────────────────────────────────────────────
let _inboxTab = 'inbox';
let _inboxCache = [];

function switchInboxTab(tab) {
  _inboxTab = tab;
  document.querySelectorAll('.inbox-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.inbox-tab[data-tab="${tab}"]`).classList.add('active');
  const searchEl = document.getElementById('search-inbox');
  const placeholders = { inbox: 'Search inbox...', sent: 'Search sent...', not_in_sequence: 'Search contacts not in a sequence...' };
  searchEl.placeholder = placeholders[tab] || 'Search...';
  searchEl.value = '';
  loadInbox();
}

let _inboxDeduped = false;
async function loadInbox() {
  try {
    // One-time dedup on first inbox load per session
    if (!_inboxDeduped) {
      _inboxDeduped = true;
      apiFetch('/api/inbox/dedup', { method: 'POST' }).catch(() => {});
    }
    const search = document.getElementById('search-inbox')?.value || '';
    const el = document.getElementById('inbox-list');

    if (_inboxTab === 'not_in_sequence') {
      const params = search ? `?search=${encodeURIComponent(search)}&limit=200` : '?limit=200';
      const data = await apiFetch(`/api/inbox/not-in-sequence${params}`);
      const contacts = data.contacts || [];
      const inboxData = await apiFetch('/api/inbox?limit=0');
      updateBadge('badge-inbox', inboxData.unreadCount || 0);
      const countEl = document.getElementById('inbox-tab-count');
      if (countEl) countEl.textContent = inboxData.unreadCount > 0 ? inboxData.unreadCount : '';

      if (!contacts.length) {
        el.innerHTML = `<div class="empty-state">
          <div style="font-size:32px;margin-bottom:8px">&#128203;</div>
          <p>All contacts are currently enrolled in a sequence.</p>
        </div>`;
        return;
      }

      el.innerHTML = `<div class="inbox-messages">${contacts.map(c => {
        const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unknown';
        return `
          <div class="inbox-row" onclick="openContactDetail(${c.id})">
            <div class="inbox-row-left">
              <div class="inbox-sender">
                <a href="#" onclick="event.stopPropagation();openContactDetail(${c.id})" style="color:inherit;text-decoration:none"><strong>${esc(fullName)}</strong></a>
                ${c.company_name ? `<span class="inbox-company-pill">${esc(c.company_name)}</span>` : ''}
              </div>
              <div class="inbox-preview">${esc(c.email || '')}</div>
            </div>
            <div class="inbox-row-right">
              <div class="inbox-date">${c.last_activity_at ? fmtDate(c.last_activity_at) : 'No activity'}</div>
            </div>
          </div>`;
      }).join('')}</div>`;
      return;
    }

    // Inbox or Sent tab
    const params = new URLSearchParams({ tab: _inboxTab, limit: '200' });
    if (search) params.set('search', search);
    const data = await apiFetch(`/api/inbox?${params}`);
    _inboxCache = data.messages || [];
    updateBadge('badge-inbox', data.unreadCount || 0);
    const countEl = document.getElementById('inbox-tab-count');
    if (countEl) countEl.textContent = data.unreadCount > 0 ? data.unreadCount : '';

    if (!_inboxCache.length) {
      const emptyMsg = _inboxTab === 'sent'
        ? 'No sent messages yet.'
        : 'No replies yet. Sync your inbox to pull in responses from contacts.';
      el.innerHTML = `<div class="empty-state">
        <div style="font-size:32px;margin-bottom:8px">&#9993;</div>
        <p>${emptyMsg}</p>
        ${_inboxTab === 'inbox' ? '<button class="btn btn-primary" onclick="syncInboxFromInbox()" style="margin-top:12px">Sync Inbox Now</button>' : ''}
      </div>`;
      return;
    }

    el.innerHTML = `
      <div class="inbox-bulk-bar" id="inbox-bulk-bar" style="display:none">
        <label class="inbox-select-all"><input type="checkbox" id="inbox-select-all" onchange="toggleSelectAllInbox(this)"> Select all</label>
        <button class="btn btn-danger-outline btn-sm" onclick="bulkDeleteInbox()">&#128465; Delete selected</button>
        <span id="inbox-selected-count" class="inbox-selected-count"></span>
      </div>
      <div class="inbox-messages">${_inboxCache.map((m, i) => {
      const isRead = _inboxTab === 'sent' ? true : m.notes === 'read';
      const fullName = [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Unknown';
      const label = _inboxTab === 'sent' ? `To: ${fullName}` : fullName;
      const preview = cleanEmailBody(m.body || '').slice(0, 140);
      const sentimentDot = m.sentiment ? `<span class="sentiment-dot sentiment-${m.sentiment}" title="${m.sentiment}"></span>` : '';
      return `
        <div class="inbox-row ${isRead ? 'inbox-read' : 'inbox-unread'}" onclick="openInboxMessage(${i})">
          <div class="inbox-checkbox" onclick="event.stopPropagation()">
            <input type="checkbox" class="inbox-msg-check" data-index="${i}" data-id="${m.id}" onchange="updateInboxSelection()">
          </div>
          <div class="inbox-row-left">
            <div class="inbox-sender">
              ${sentimentDot}
              <a href="#" onclick="event.stopPropagation();openContactDetail(${m.contact_id})" style="color:inherit;text-decoration:none">${esc(label)}</a>
              ${m.company_name ? `<span class="inbox-company-pill">${esc(m.company_name)}</span>` : ''}
            </div>
            <div class="inbox-subject">${esc(m.subject || '(no subject)')}</div>
            <div class="inbox-preview">${esc(preview)}${preview.length >= 140 ? '...' : ''}</div>
          </div>
          <div class="inbox-row-right">
            <div class="inbox-date">${fmtDate(m.sent_at)}</div>
            <div class="inbox-row-actions" onclick="event.stopPropagation()">
              <div class="sentiment-btns sentiment-btns-sm">
                <button class="sentiment-btn sentiment-btn-positive ${m.sentiment==='positive'?'active':''}" title="Positive" onclick="setSentiment(${i},'positive')">&#9679;</button>
                <button class="sentiment-btn sentiment-btn-neutral ${m.sentiment==='neutral'?'active':''}" title="Neutral" onclick="setSentiment(${i},'neutral')">&#9679;</button>
                <button class="sentiment-btn sentiment-btn-negative ${m.sentiment==='negative'?'active':''}" title="Negative" onclick="setSentiment(${i},'negative')">&#9679;</button>
              </div>
              <button class="inbox-delete-btn" title="Delete" onclick="deleteInboxMessage(${i})">&#128465;</button>
            </div>
          </div>
        </div>`;
    }).join('')}</div>`;
  } catch(e) { toast(e.message, 'error'); }
}

async function openInboxMessage(index) {
  const m = _inboxCache[index];
  if (!m) return;

  // Mark as read if unread inbox message
  if (_inboxTab === 'inbox' && m.notes !== 'read') {
    try {
      await apiFetch(`/api/inbox/${m.id}/read`, { method: 'PATCH' });
      m.notes = 'read';
      const data = await apiFetch('/api/inbox?limit=0');
      updateBadge('badge-inbox', data.unreadCount || 0);
      const countEl = document.getElementById('inbox-tab-count');
      if (countEl) countEl.textContent = data.unreadCount > 0 ? data.unreadCount : '';
      // Update the row to show as read
      const rows = document.querySelectorAll('.inbox-row');
      if (rows[index]) { rows[index].classList.remove('inbox-unread'); rows[index].classList.add('inbox-read'); }
    } catch(e) {}
  }

  const fullName = [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Unknown';

  // Insert reading pane above the message list
  let pane = document.getElementById('inbox-reading-pane');
  if (!pane) {
    pane = document.createElement('div');
    pane.id = 'inbox-reading-pane';
    pane.className = 'inbox-reading-pane';
    const list = document.getElementById('inbox-list');
    list.parentNode.insertBefore(pane, list);
  }

  pane.innerHTML = `
    <div class="inbox-rp-header">
      <div>
        <div class="inbox-rp-subject">${esc(m.subject || '(no subject)')}</div>
        <div class="inbox-rp-meta">
          <span>${_inboxTab === 'sent' ? 'To:' : 'From:'} <a href="#" onclick="event.preventDefault();openContactDetail(${m.contact_id})">${esc(fullName)}</a></span>
          ${m.company_name ? `<span><a href="#" onclick="event.preventDefault();openCompanyDetail(${m.company_id})">${esc(m.company_name)}</a></span>` : ''}
          <span>${fmtDate(m.sent_at)}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="sentiment-btns" id="rp-sentiment-btns">
          <button class="sentiment-btn sentiment-btn-positive ${m.sentiment==='positive'?'active':''}" title="Positive" onclick="setSentiment(${index},'positive')">&#9679; Hot</button>
          <button class="sentiment-btn sentiment-btn-neutral ${m.sentiment==='neutral'?'active':''}" title="Neutral" onclick="setSentiment(${index},'neutral')">&#9679; Warm</button>
          <button class="sentiment-btn sentiment-btn-negative ${m.sentiment==='negative'?'active':''}" title="Negative" onclick="setSentiment(${index},'negative')">&#9679; Cold</button>
        </div>
        <button class="inbox-rp-close" onclick="closeInboxPane()">&#10005;</button>
      </div>
    </div>
    <div class="inbox-rp-body">${renderEmailBody(m.body)}</div>
    <div class="inbox-rp-actions">
      ${m.email ? `<button class="btn btn-primary" onclick="openReplyCompose(${index}, false)">&#9166; Reply</button>` : ''}
      ${m.email ? `<button class="btn btn-outline" onclick="openReplyCompose(${index}, true)">&#8627; Forward</button>` : ''}
      ${m.contact_id ? `<button class="btn btn-outline" onclick="openContactDetail(${m.contact_id})">View Contact</button>` : ''}
      ${m.company_id ? `<button class="btn btn-outline" onclick="openCompanyDetail(${m.company_id})">View Company</button>` : ''}
      <button class="btn btn-danger-outline" onclick="deleteInboxMessage(${index})">&#128465; Delete</button>
    </div>
    <div id="inbox-enrollment-badges"></div>
    <div id="inbox-compose-area" style="display:none"></div>
  `;
  pane.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Load active enrollments for this contact and show remove buttons
  if (m.contact_id) {
    try {
      var enrollments = await apiFetch('/api/contacts/' + m.contact_id + '/enrollments');
      var badgesEl = document.getElementById('inbox-enrollment-badges');
      if (badgesEl) badgesEl.innerHTML = renderEnrollmentBadges(enrollments, 'openInboxMessage(' + index + ')');
    } catch(e) {}
  }
}

// ── EMAIL SIGNATURE ───────────────────────────────────────────────────────
let _cachedSignature = null;

const DEFAULT_SIGNATURE = `<br><br>Best,<br>
<b>Frank Sherfey</b><br>
Licensing @ <a href="https://www.phillewisart.com" target="_blank">Phil Lewis Art</a><br>
(656) 296-7917<br>
<a href="https://www.phillewisart.com" target="_blank" style="display:inline-block;margin-top:6px">
  <img src="https://cdn.shopify.com/s/files/1/0579/0921/4404/files/Phil_Lewis_Art_Logo_Banner.png"
       onerror="this.style.display='none'"
       alt="Phil Lewis Art" style="height:40px;max-width:200px;object-fit:contain">
</a>`;

async function getSignature() {
  if (_cachedSignature !== null) return _cachedSignature;
  try {
    const s = await apiFetch('/api/settings');
    _cachedSignature = s.email_signature || DEFAULT_SIGNATURE;
  } catch(e) {
    _cachedSignature = DEFAULT_SIGNATURE;
  }
  return _cachedSignature;
}

function switchSigTab(tab, btn) {
  document.querySelectorAll('.sig-tab').forEach(t => t.classList.remove('sig-tab-active'));
  btn.classList.add('sig-tab-active');
  const editPane    = document.getElementById('sig-edit-pane');
  const previewPane = document.getElementById('sig-preview-pane');
  if (tab === 'edit') {
    editPane.style.display = ''; previewPane.style.display = 'none';
  } else {
    editPane.style.display = 'none'; previewPane.style.display = '';
    const raw = document.getElementById('sig-editor')?.value || '';
    const el  = document.getElementById('sig-preview-render');
    if (el) el.innerHTML = raw;
  }
}

async function saveDigestSettings() {
  var msg = document.getElementById('digest-msg');
  try {
    await apiFetch('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        digest_email: document.getElementById('setting-digest-email').value.trim(),
        phil_email: document.getElementById('setting-phil-email').value.trim() || 'phil@phillewisart.com',
      })
    });
    msg.textContent = 'Digest settings saved.';
    msg.className = 'settings-msg settings-msg-ok';
    toast('Digest settings saved', 'success');
  } catch(e) {
    msg.textContent = e.message;
    msg.className = 'settings-msg settings-msg-err';
  }
}

async function testDigest() {
  var msg = document.getElementById('digest-msg');
  msg.textContent = 'Sending test digest…';
  msg.className = 'settings-msg';
  try {
    var result = await apiFetch('/api/cron/weekly-digest');
    if (result.ok) {
      msg.textContent = 'Test digest sent to: ' + (Array.isArray(result.sent_to) ? result.sent_to.join(', ') : result.sent_to);
      msg.className = 'settings-msg settings-msg-ok';
      toast('Test digest sent!', 'success');
    } else {
      msg.textContent = result.error || 'Failed to send';
      msg.className = 'settings-msg settings-msg-err';
    }
  } catch(e) {
    msg.textContent = e.message;
    msg.className = 'settings-msg settings-msg-err';
  }
}

async function saveSignature() {
  const val = document.getElementById('sig-editor')?.value || '';
  const msgEl = document.getElementById('sig-msg');
  try {
    await apiFetch('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ email_signature: val }),
    });
    _cachedSignature = val;
    msgEl.textContent = 'Signature saved.';
    msgEl.className = 'settings-msg success';
    setTimeout(() => { msgEl.textContent = ''; }, 3000);
  } catch(e) {
    msgEl.textContent = e.message;
    msgEl.className = 'settings-msg error';
  }
}

function resetDefaultSignature() {
  const el = document.getElementById('sig-editor');
  if (el) el.value = DEFAULT_SIGNATURE;
}

var _icSelectedArt = null; // selected art for inbox compose

async function openReplyCompose(index, isForward) {
  const m = _inboxCache[index];
  if (!m) return;
  const area = document.getElementById('inbox-compose-area');
  if (!area) return;

  _icSelectedArt = null;

  const sig = await getSignature();
  const reSubject = isForward
    ? `Fwd: ${m.subject || ''}`
    : (m.subject && !/^re:/i.test(m.subject) ? `Re: ${m.subject}` : (m.subject || ''));
  const toEmail  = isForward ? '' : (m.email || '');
  const toName   = isForward ? '' : ([m.first_name, m.last_name].filter(Boolean).join(' ') || '');
  const fullName = [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email || '';
  const quoteDate = m.sent_at ? new Date(m.sent_at).toLocaleString() : '';
  const quotedBody = `\n\n\n---\nOn ${quoteDate}, ${esc(fullName)} wrote:\n${(m.body || '').split('\n').map(l => '> ' + l).join('\n')}`;
  // Strip HTML tags for the textarea preview (signature is injected as HTML at send time)
  const sigPlain = sig.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const bodyWithSig = `\n\n${sigPlain}${quotedBody}`;

  // Get company tags for auto-matching art suggestion
  var companyTags = '';
  if (m.company_id) {
    try {
      var co = await apiFetch('/api/companies/' + m.company_id);
      companyTags = co.tags || '';
    } catch(e) {}
  }

  area.style.display = 'block';
  area.innerHTML = `
    <div class="inbox-compose-box">
      <div class="inbox-compose-row">
        <label class="inbox-compose-label">To</label>
        <input id="ic-to" class="inbox-compose-input" type="email" value="${esc(toEmail)}" placeholder="recipient@example.com" ${!isForward ? 'readonly' : ''}>
      </div>
      <div class="inbox-compose-row">
        <label class="inbox-compose-label">Subject</label>
        <input id="ic-subject" class="inbox-compose-input" type="text" value="${esc(reSubject)}">
      </div>
      <div class="inbox-compose-row">
        <label class="inbox-compose-label">Message</label>
        <div class="textarea-toolbar">
          <button type="button" class="btn btn-ghost btn-sm" onclick="insertLink('ic-body')" title="Insert hyperlink">🔗 Link</button>
        </div>
        <textarea id="ic-body" class="inbox-compose-textarea" rows="10">${esc(bodyWithSig)}</textarea>
      </div>
      <div id="ic-art-preview"></div>
      <div id="ic-art-picker"></div>
      <div class="inbox-sig-note">\u2709 Your email signature will be appended automatically</div>
      <div class="inbox-compose-actions">
        <button class="btn btn-primary" onclick="sendInboxReply(${index}, ${isForward})">Send</button>
        <button class="btn btn-outline" onclick="openIcArtPicker('${esc(companyTags)}')">Add Art</button>
        <button class="btn btn-outline" onclick="closeReplyCompose()">Cancel</button>
        <span id="ic-status" style="margin-left:12px;font-size:13px;color:#666"></span>
      </div>
    </div>`;

  // Place cursor at very top (before signature/quote)
  const ta = document.getElementById('ic-body');
  if (ta) { ta.focus(); ta.setSelectionRange(0, 0); ta.scrollTop = 0; }
}

function openIcArtPicker(companyTags) {
  var pickerEl = document.getElementById('ic-art-picker');
  if (!pickerEl) return;

  var cache = (typeof _artCache !== 'undefined' && _artCache.length) ? _artCache : [];
  if (!cache.length) { toast('Art gallery not loaded yet', 'error'); return; }

  // Score by tag overlap for sorting
  var prospectTags = (companyTags || '').toLowerCase().split(',').map(function(t) { return t.trim(); }).filter(Boolean);
  var scored = cache.map(function(art) {
    var artTags = (art.tags || '').toLowerCase().split(',').map(function(t) { return t.trim(); });
    var overlap = prospectTags.filter(function(t) { return artTags.indexOf(t) !== -1; }).length;
    return { art: art, score: overlap * 10 + (art.priority || 0) };
  }).sort(function(a, b) { return b.score - a.score; });

  var html = '<div class="qr-art-picker-wrap">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
      '<span style="font-size:12px;font-weight:600">Choose Art to Embed</span>' +
      '<button class="btn btn-ghost btn-sm" onclick="document.getElementById(\'ic-art-picker\').innerHTML=\'\'" style="font-size:11px">Close</button>' +
    '</div>';

  if (prospectTags.length) {
    html += '<div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">Sorted by match to prospect tags: ' + prospectTags.join(', ') + '</div>';
  }

  html += '<div class="qr-art-picker-grid">';
  scored.forEach(function(item) {
    var a = item.art;
    var matchBadge = item.score > 0 ? '<div style="font-size:9px;color:var(--success);font-weight:600">' + Math.floor(item.score / 10) + ' tag match' + (Math.floor(item.score / 10) !== 1 ? 'es' : '') + '</div>' : '';
    html += '<div class="qr-art-picker-item" onclick="selectIcArt(' + a.id + ')">' +
      '<img src="' + esc(a.url) + '" alt="' + esc(a.title) + '" onerror="_onImgErr(this)" />' +
      '<div class="qr-art-picker-label">' + esc(a.title) + '</div>' +
      matchBadge +
    '</div>';
  });
  html += '</div></div>';

  pickerEl.innerHTML = html;
}

function selectIcArt(artId) {
  var cache = (typeof _artCache !== 'undefined') ? _artCache : [];
  var art = cache.find(function(a) { return a.id === artId; });
  if (!art) return;
  _icSelectedArt = _artToImage(art);
  document.getElementById('ic-art-picker').innerHTML = '';
  renderIcArtPreview();
}

function removeIcArt() {
  _icSelectedArt = null;
  renderIcArtPreview();
}

function renderIcArtPreview() {
  var el = document.getElementById('ic-art-preview');
  if (!el) return;
  if (!_icSelectedArt || !_icSelectedArt.url) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML =
    '<div style="border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--bg);margin-bottom:12px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
        '<span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted)">Art \u2014 will be embedded in email</span>' +
        '<div style="display:flex;gap:6px">' +
          '<button class="btn btn-outline btn-sm" onclick="openIcArtPicker(\'\')" style="font-size:11px">Change</button>' +
          '<button class="btn btn-ghost btn-sm" onclick="removeIcArt()" style="font-size:11px;color:var(--text-muted)">Remove</button>' +
        '</div>' +
      '</div>' +
      '<div style="text-align:center">' +
        '<img src="' + esc(_icSelectedArt.url) + '" alt="' + esc(_icSelectedArt.alt) + '" style="max-width:100%;width:400px;border-radius:6px" />' +
        '<div style="font-size:12px;color:var(--text-muted);margin-top:6px">' + esc(_icSelectedArt.alt) + '</div>' +
      '</div>' +
    '</div>';
}

function closeReplyCompose() {
  const area = document.getElementById('inbox-compose-area');
  if (area) { area.style.display = 'none'; area.innerHTML = ''; }
}

async function sendInboxReply(index, isForward) {
  const m = _inboxCache[index];
  if (!m) return;
  const toEmail  = document.getElementById('ic-to')?.value?.trim();
  const subject  = document.getElementById('ic-subject')?.value?.trim();
  const body     = document.getElementById('ic-body')?.value?.trim();
  const statusEl = document.getElementById('ic-status');

  if (!toEmail || !subject || !body) {
    toast('To, Subject, and Message are all required.', 'error'); return;
  }

  // Build HTML body: user text + art (if selected) + HTML signature
  const sig = await getSignature();
  var artBlock = '';
  if (_icSelectedArt && _icSelectedArt.url) {
    artBlock = '<div style="margin:24px 0;text-align:center">' +
      '<div style="margin-bottom:8px;font-size:13px;color:#666;font-style:italic">' + esc(_icSelectedArt.label || '') + ' \u2014 Recent Collaboration</div>' +
      '<img src="' + _icSelectedArt.url + '" alt="' + esc(_icSelectedArt.alt) + '" style="max-width:100%;width:480px;border-radius:8px;border:1px solid #e0e0e0" />' +
      '<div style="margin-top:8px;font-size:12px;color:#999">' + esc(_icSelectedArt.alt) + '</div>' +
      '<div style="margin-top:4px"><a href="https://phillewisart.com/blogs/collaborations" style="font-size:12px;color:#4f46e5;text-decoration:none">View more collaborations \u2192</a></div>' +
    '</div>';
  }
  const bodyHtml = body.replace(/\n/g, '<br>') + artBlock + '<br><br>' + sig;

  const btn = document.querySelector('#inbox-compose-area .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  if (statusEl) statusEl.textContent = '';

  try {
    await apiFetch('/api/inbox/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toEmail,
        toName: isForward ? '' : ([m.first_name, m.last_name].filter(Boolean).join(' ') || ''),
        subject,
        body: bodyHtml,
        isHtml: true,
        contactId:  m.contact_id  || null,
        companyId:  m.company_id  || null,
        inReplyTo:  isForward ? null : (m.message_id || null),
        references: isForward ? null : (m.message_id || null),
      }),
    });
    toast(isForward ? 'Forwarded successfully.' : 'Reply sent!', 'success');
    closeReplyCompose();
    // Refresh the sent tab count badge
    loadInbox();
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
    if (statusEl) statusEl.textContent = '✗ ' + e.message;
    toast('Send failed: ' + e.message, 'error');
  }
}

function closeInboxPane() {
  const pane = document.getElementById('inbox-reading-pane');
  if (pane) pane.remove();
}

async function setSentiment(index, sentiment) {
  const m = _inboxCache[index];
  if (!m) return;
  // Toggle off if already set to same value
  const newVal = m.sentiment === sentiment ? null : sentiment;
  try {
    await apiFetch(`/api/inbox/${m.id}/sentiment`, {
      method: 'PATCH',
      body: JSON.stringify({ sentiment: newVal }),
    });
    m.sentiment = newVal;
    loadInbox(); // refresh list to show updated dots
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteInboxMessage(index) {
  const m = _inboxCache[index];
  if (!m) return;
  if (!confirm('Delete this message from the CRM? (This won\u2019t delete it from your email server.)')) return;
  try {
    await apiFetch(`/api/inbox/${m.id}`, { method: 'DELETE' });
    toast('Message deleted.', 'success');
    closeInboxPane();
    loadInbox();
  } catch(e) { toast(e.message, 'error'); }
}

// updateInboxSelection, toggleSelectAllInbox, bulkDeleteInbox
// → defined in app-extras.js (authoritative version)

async function syncInboxFromInbox() {
  toast('Syncing inbox...');
  try {
    const r = await apiFetch('/api/inbox/sync', { method: 'POST' });
    // Auto-dedup after sync to clean up any existing duplicates
    const dedup = await apiFetch('/api/inbox/dedup', { method: 'POST' });
    const parts = [`${r.imported} new repl${r.imported !== 1 ? 'ies' : 'y'}`];
    if (r.autoStopped > 0) parts.push(`${r.autoStopped} sequence${r.autoStopped !== 1 ? 's' : ''} stopped`);
    if (r.opportunitiesCreated > 0) parts.push(`${r.opportunitiesCreated} new opportunit${r.opportunitiesCreated !== 1 ? 'ies' : 'y'} created`);
    if (dedup.removed > 0) parts.push(`${dedup.removed} duplicate${dedup.removed !== 1 ? 's' : ''} cleaned`);
    toast(`Inbox synced: ${parts.join(', ')}`, 'success');
    closeInboxPane();
    loadInbox();
  } catch(e) { toast(`Sync failed: ${e.message}`, 'error'); }
}

// ── SETTINGS ──────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const s = await apiFetch('/api/settings');
    const form = document.getElementById('settings-form');
    form.querySelector('[name="smtp_from_name"]').value = s.smtp_from_name||'';
    form.querySelector('[name="smtp_user"]').value = s.smtp_user||'';
    form.querySelector('[name="smtp_host"]').value = s.smtp_host||'';
    form.querySelector('[name="smtp_port"]').value = s.smtp_port||'587';
    form.querySelector('[name="smtp_pass"]').value = s.smtp_pass||'';
    form.querySelector('[name="smtp_secure"]').value = s.smtp_secure||'false';
    // IMAP
    const imap = document.getElementById('imap-form');
    if (imap) {
      imap.querySelector('[name="imap_host"]').value = s.imap_host||'';
      imap.querySelector('[name="imap_port"]').value = s.imap_port||'993';
      imap.querySelector('[name="imap_secure"]').value = s.imap_secure||'true';
      imap.querySelector('[name="imap_sent_folder"]').value = s.imap_sent_folder||'Sent';
    }
    // Signature
    const sigEl = document.getElementById('sig-editor');
    if (sigEl) {
      sigEl.value = s.email_signature || DEFAULT_SIGNATURE;
      _cachedSignature = sigEl.value;
    }
    // Digest settings
    var digestEl = document.getElementById('setting-digest-email');
    if (digestEl) digestEl.value = s.digest_email || '';
    var philEl = document.getElementById('setting-phil-email');
    if (philEl) philEl.value = s.phil_email || 'phil@phillewisart.com';
  } catch(e) { toast(e.message, 'error'); }
}

async function saveImapSettings(e) {
  e.preventDefault();
  const form = document.getElementById('imap-form');
  const msg = document.getElementById('imap-msg');
  const body = {
    imap_host: form.querySelector('[name="imap_host"]').value,
    imap_port: form.querySelector('[name="imap_port"]').value,
    imap_secure: form.querySelector('[name="imap_secure"]').value,
    imap_sent_folder: form.querySelector('[name="imap_sent_folder"]').value,
  };
  try {
    await apiFetch('/api/settings', { method: 'POST', body: JSON.stringify(body) });
    msg.textContent = 'IMAP settings saved.';
    msg.className = 'settings-msg success';
    msg.style.display = 'block';
    toast('IMAP settings saved', 'success');
  } catch(err) {
    msg.textContent = err.message;
    msg.className = 'settings-msg error';
    msg.style.display = 'block';
  }
}

async function syncInbox() {
  const msg = document.getElementById('imap-msg');
  msg.textContent = 'Syncing inbox…';
  msg.className = 'settings-msg';
  msg.style.display = 'block';
  try {
    const r = await apiFetch('/api/inbox/sync', { method: 'POST' });
    const autoStoppedMsg = r.autoStopped > 0 ? ` ${r.autoStopped} sequence${r.autoStopped!==1?'s':''} auto-stopped.` : '';
    msg.textContent = `Sync complete — ${r.found} email${r.found!==1?'s':''} scanned, ${r.imported} new repl${r.imported!==1?'ies':'y'} imported.${autoStoppedMsg}`;
    msg.className = 'settings-msg success';
    toast(`Inbox synced: ${r.imported} new replies${r.autoStopped > 0 ? `, ${r.autoStopped} sequence${r.autoStopped!==1?'s':''} stopped` : ''}`, 'success');
  } catch(err) {
    msg.textContent = `Sync failed: ${err.message}`;
    msg.className = 'settings-msg error';
  }
}

async function saveSettings(e) {
  e.preventDefault();
  const form = e.target;
  const body = {
    smtp_from_name: form.querySelector('[name="smtp_from_name"]').value,
    smtp_user: form.querySelector('[name="smtp_user"]').value,
    smtp_host: form.querySelector('[name="smtp_host"]').value,
    smtp_port: form.querySelector('[name="smtp_port"]').value,
    smtp_pass: form.querySelector('[name="smtp_pass"]').value,
    smtp_secure: form.querySelector('[name="smtp_secure"]').value,
  };
  const msg = document.getElementById('settings-msg');
  try {
    await apiFetch('/api/settings', { method: 'POST', body: JSON.stringify(body) });
    msg.textContent = 'Settings saved.';
    msg.className = 'settings-msg success';
    toast('Settings saved', 'success');
  } catch(err) {
    msg.textContent = err.message;
    msg.className = 'settings-msg error';
  }
}

async function testEmail() {
  const msg = document.getElementById('settings-msg');
  msg.textContent = 'Testing connection...';
  msg.className = 'settings-msg';
  msg.style.display = 'block';
  try {
    // Save first
    const form = document.getElementById('settings-form');
    const body = {
      smtp_from_name: form.querySelector('[name="smtp_from_name"]').value,
      smtp_user: form.querySelector('[name="smtp_user"]').value,
      smtp_host: form.querySelector('[name="smtp_host"]').value,
      smtp_port: form.querySelector('[name="smtp_port"]').value,
      smtp_pass: form.querySelector('[name="smtp_pass"]').value,
      smtp_secure: form.querySelector('[name="smtp_secure"]').value,
    };
    await apiFetch('/api/settings', { method: 'POST', body: JSON.stringify(body) });
    const r = await apiFetch('/api/settings/test-email', { method: 'POST' });
    msg.textContent = 'Connection successful! Your email is ready to use.';
    msg.className = 'settings-msg success';
  } catch(err) {
    msg.textContent = `Connection failed: ${err.message}`;
    msg.className = 'settings-msg error';
  }

// ── SETTINGS ──────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const s = await apiFetch('/api/settings');
    const form = document.getElementById('settings-form');
    form.querySelector('[name="smtp_from_name"]').value = s.smtp_from_name||'';
    form.querySelector('[name="smtp_user"]').value = s.smtp_user||'';
    form.querySelector('[name="smtp_host"]').value = s.smtp_host||'';
    form.querySelector('[name="smtp_port"]').value = s.smtp_port||'587';
    form.querySelector('[name="smtp_pass"]').value = s.smtp_pass||'';
    form.querySelector('[name="smtp_secure"]').value = s.smtp_secure||'false';
    // IMAP
    const imap = document.getElementById('imap-form');
    if (imap) {
      imap.querySelector('[name="imap_host"]').value = s.imap_host||'';
      imap.querySelector('[name="imap_port"]').value = s.imap_port||'993';
      imap.querySelector('[name="imap_secure"]').value = s.imap_secure||'true';
      imap.querySelector('[name="imap_sent_folder"]').value = s.imap_sent_folder||'Sent';
    }
    // Signature
    const sigEl = document.getElementById('sig-editor');
    if (sigEl) {
      sigEl.value = s.email_signature || DEFAULT_SIGNATURE;
      _cachedSignature = sigEl.value;
    }
    // Digest settings
    var digestEl = document.getElementById('setting-digest-email');
    if (digestEl) digestEl.value = s.digest_email || '';
    var philEl = document.getElementById('setting-phil-email');
    if (philEl) philEl.value = s.phil_email || 'phil@phillewisart.com';
  } catch(e) { toast(e.message, 'error'); }
}

async function saveImapSettings(e) {
  e.preventDefault();
  const form = document.getElementById('imap-form');
  const msg = document.getElementById('imap-msg');
  const body = {
    imap_host: form.querySelector('[name="imap_host"]').value,
    imap_port: form.querySelector('[name="imap_port"]').value,
    imap_secure: form.querySelector('[name="imap_secure"]').value,
    imap_sent_folder: form.querySelector('[name="imap_sent_folder"]').value,
  };
  try {
    await apiFetch('/api/settings', { method: 'POST', body: JSON.stringify(body) });
    msg.textContent = 'IMAP settings saved.';
    msg.className = 'settings-msg success';
    msg.style.display = 'block';
    toast('IMAP settings saved', 'success');
  } catch(err) {
    msg.textContent = err.message;
    msg.className = 'settings-msg error';
    msg.style.display = 'block';
  }
}

async function syncInbox() {
  const msg = document.getElementById('imap-msg');
  msg.textContent = 'Syncing inbox…';
  msg.className = 'settings-msg';
  msg.style.display = 'block';
  try {
    const r = await apiFetch('/api/inbox/sync', { method: 'POST' });
    const autoStoppedMsg = r.autoStopped > 0 ? ` ${r.autoStopped} sequence${r.autoStopped!==1?'s':''} auto-stopped.` : '';
    msg.textContent = `Sync complete — ${r.found} email${r.found!==1?'s':''} scanned, ${r.imported} new repl${r.imported!==1?'ies':'y'} imported.${autoStoppedMsg}`;
    msg.className = 'settings-msg success';
    toast(`Inbox synced: ${r.imported} new replies${r.autoStopped > 0 ? `, ${r.autoStopped} sequence${r.autoStopped!==1?'s':''} stopped` : ''}`, 'success');
  } catch(err) {
    msg.textContent = `Sync failed: ${err.message}`;
    msg.className = 'settings-msg error';
  }
}

async function saveSettings(e) {
  e.preventDefault();
  const form = e.target;
  const body = {
    smtp_from_name: form.querySelector('[name="smtp_from_name"]').value,
    smtp_user: form.querySelector('[name="smtp_user"]').value,
    smtp_host: form.querySelector('[name="smtp_host"]').value,
    smtp_port: form.querySelector('[name="smtp_port"]').value,
    smtp_pass: form.querySelector('[name="smtp_pass"]').value,
    smtp_secure: form.querySelector('[name="smtp_secure"]').value,
  };
  const msg = document.getElementById('settings-msg');
  try {
    await apiFetch('/api/settings', { method: 'POST', body: JSON.stringify(body) });
    msg.textContent = 'Settings saved.';
    msg.className = 'settings-msg success';
    toast('Settings saved', 'success');
  } catch(err) {
    msg.textContent = err.message;
    msg.className = 'settings-msg error';
  }
}

async function testEmail() {
  const msg = document.getElementById('settings-msg');
  msg.textContent = 'Testing connection...';
  msg.className = 'settings-msg';
  msg.style.display = 'block';
  try {
    // Save first
    const form = document.getElementById('settings-form');
    const body = {
      smtp_from_name: form.querySelector('[name="smtp_from_name"]').value,
      smtp_user: form.querySelector('[name="smtp_user"]').value,
      smtp_host: form.querySelector('[name="smtp_host"]').value,
      smtp_port: form.querySelector('[name="smtp_port"]').value,
      smtp_pass: form.querySelector('[name="smtp_pass"]').value,
      smtp_secure: form.querySelector('[name="smtp_secure"]').value,
    };
    await apiFetch('/api/settings', { method: 'POST', body: JSON.stringify(body) });
    const r = await apiFetch('/api/settings/test-email', { method: 'POST' });
    msg.textContent = 'Connection successful! Your email is ready to use.';
    msg.className = 'settings-msg success';
  } catch(err) {
    msg.textContent = `Connection failed: ${err.message}`;
    msg.className = 'settings-msg error';
  }
}

// ── CSV IMPORT ────────────────────────────────────────────────────────────
let importType = '';
function openQuickImport() {
  document.getElementById('quick-import-url').value = '';
  document.getElementById('quick-import-result').style.display = 'none';
  document.getElementById('quick-import-btn').disabled = false;
  document.getElementById('quick-import-btn').textContent = '⚡ Import';
  openModal('modal-quick-import');
  setTimeout(function() { document.getElementById('quick-import-url').focus(); }, 100);
}

async function submitQuickImport() {
  var url = document.getElementById('quick-import-url').value.trim();
  if (!url) { toast('Paste a URL first', 'error'); return; }
  var btn = document.getElementById('quick-import-btn');
  var resultEl = document.getElementById('quick-import-result');
  btn.disabled = true;
  btn.textContent = 'Importing…';
  resultEl.style.display = 'none';

  try {
    var data = await apiFetch('/api/import/quick', {
      method: 'POST',
      body: JSON.stringify({ url: url })
    });

    if (data.existing) {
      resultEl.style.display = 'block';
      resultEl.innerHTML = '<div style="padding:12px;background:#fef3c7;border-radius:8px;font-size:13px">' +
        '<strong>Already exists:</strong> ' + esc(data.company.name) +
        ' <button class="btn btn-ghost btn-sm" onclick="closeModal(\'modal-quick-import\');openCompanyDetail(' + data.company.id + ')">View →</button></div>';
      btn.disabled = false;
      btn.textContent = '⚡ Import';
      return;
    }

    resultEl.style.display = 'block';
    resultEl.innerHTML = '<div style="padding:12px;background:#dcfce7;border-radius:8px;font-size:13px">' +
      '<strong>Created:</strong> ' + esc(data.company.name) +
      (data.scraped.description ? '<br><span style="color:var(--text-muted)">' + esc(data.scraped.description.slice(0, 150)) + '</span>' : '') +
      ' <button class="btn btn-primary btn-sm" style="margin-left:8px" onclick="closeModal(\'modal-quick-import\');openCompanyDetail(' + data.company.id + ')">Open & Edit →</button></div>';
    toast('Prospect added: ' + data.company.name, 'success');
    loadCompanies();
    btn.textContent = '✓ Done';
  } catch(e) {
    toast(e.message, 'error');
    btn.disabled = false;
    btn.textContent = '⚡ Import';
  }
}

function openImportModal(type) {
  importType = type;
  document.getElementById('import-modal-title').textContent = type === 'companies' ? 'Import Companies CSV' : 'Import Contacts CSV';
  document.getElementById('import-file').value = '';
  document.getElementById('import-msg').className = 'settings-msg';
  document.getElementById('import-msg').textContent = '';
  const helpEl = document.getElementById('import-format-help');
  if (type === 'companies') {
    helpEl.innerHTML = `<div class="import-format-help">
      <strong>Expected columns (first row = headers):</strong><br>
      <code>name</code>, <code>type</code> (manufacturer/retailer/publisher/agent), <code>website</code>, <code>phone</code>, <code>city</code>, <code>state</code>, <code>category</code>, <code>notes</code>, <code>status</code><br><br>
      Only <code>name</code> is required. All other columns are optional.
    </div>`;
  } else {
    helpEl.innerHTML = `<div class="import-format-help">
      <strong>Expected columns:</strong><br>
      <code>first_name</code>, <code>last_name</code>, <code>email</code>, <code>phone</code>, <code>title</code>, <code>company</code> (matches existing company name), <code>notes</code><br><br>
      Only <code>first_name</code> is required.
    </div>`;
  }
  openModal('modal-import');
}

async function submitImport() {
  const file = document.getElementById('import-file').files[0];
  const msg = document.getElementById('import-msg');
  if (!file) { msg.textContent = 'Please select a file.'; msg.className = 'settings-msg error'; return; }
  const formData = new FormData();
  formData.append('file', file);
  msg.textContent = 'Importing...';
  msg.className = 'settings-msg';
  msg.style.display = 'block';
  try {
    const res = await fetch(`/api/import/${importType}`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed');
    msg.textContent = `Successfully imported ${data.imported} record${data.imported!==1?'s':''}.`;
    msg.className = 'settings-msg success';
    if (importType === 'companies') loadCompanies();
    else loadContacts();
  } catch(e) {
    msg.textContent = e.message;
    msg.className = 'settings-msg error';
  }
}


}
