// ── PHIL LEWIS ART CRM — Queue ──────────────────────────────────────────
// ── QUEUE ─────────────────────────────────────────────────────────────────
let _queueCache = [];

let _queueExpanded = {}; // seqId -> bool (default open)
let _queueSelected = new Set(); // enrollment_id set for bulk actions

async function loadQueue() {
  try {
    const queue = await apiFetch('/api/queue');
    _queueCache = queue;
    updateBadge('badge-queue', queue.length);

    // Prune any selections that no longer exist in the queue (e.g. after sends/removals).
    // IDs are coerced to strings: the API returns strings while onclick handlers inline
    // bare numbers, so mixing types in the Set silently breaks lookups.
    const validIds = new Set(queue.map(q => String(q.enrollment_id)));
    _queueSelected.forEach(id => { if (!validIds.has(String(id))) _queueSelected.delete(id); });

    const btn = document.getElementById('send-all-btn');
    const infoEl = document.getElementById('queue-info');
    const listEl = document.getElementById('queue-list');

    if (!queue.length) {
      if (btn) btn.disabled = true;
      infoEl.textContent = '';
      listEl.innerHTML = `
        <div class="queue-empty">
          <div class="empty-icon">✓</div>
          <strong>Queue is clear!</strong>
          <p style="margin-top:6px">All caught up. Enroll more contacts in sequences to see items here.</p>
        </div>
      `;
      renderQueueBulkBar();
      return;
    }

    if (btn) btn.disabled = false;
    infoEl.textContent = `${queue.length} email${queue.length!==1?'s':''} ready to send across ${countCampaigns(queue)} campaign${countCampaigns(queue)!==1?'s':''}`;

    // Group by sequence
    const groups = {};
    queue.forEach((item, i) => {
      const key = item.sequence_id;
      if (!groups[key]) groups[key] = { name: item.sequence_name, id: key, items: [] };
      groups[key].items.push({ ...item, _index: i });
    });

    // Default: all expanded
    Object.keys(groups).forEach(k => {
      if (_queueExpanded[k] === undefined) _queueExpanded[k] = true;
    });

    // Fetch sequences to check auto_send status
    var seqsForAuto = {};
    try {
      var seqList = await apiFetch('/api/sequences');
      seqList.forEach(function(s) { seqsForAuto[s.id] = s; });
    } catch(e) { /* ignore — non-critical */ }

    listEl.innerHTML = Object.values(groups).map(g => {
      const isOpen = _queueExpanded[g.id];
      const isAutoSend = seqsForAuto[g.id] && seqsForAuto[g.id].auto_send;
      const stepCounts = {};
      g.items.forEach(item => {
        const k = `Step ${item.current_step}`;
        stepCounts[k] = (stepCounts[k] || 0) + 1;
      });
      const stepSummary = Object.entries(stepCounts).map(([k,v]) => `${k}: ${v}`).join(' · ');

      // Master checkbox state for the group
      const groupIds = g.items.map(it => String(it.enrollment_id));
      const selectedInGroup = groupIds.filter(id => _queueSelected.has(id)).length;
      const allChecked = selectedInGroup === groupIds.length && groupIds.length > 0;
      const someChecked = selectedInGroup > 0 && !allChecked;
      const masterChk = `<input type="checkbox" class="queue-group-check" ${allChecked ? 'checked' : ''} ${someChecked ? 'data-indeterminate="1"' : ''} onclick="event.stopPropagation();toggleQueueGroupSelect(${g.id}, this.checked)" title="Select all in this sequence" style="margin-right:6px">`;

      return `
        <div class="queue-group">
          <div class="queue-group-header" onclick="toggleQueueGroup(${g.id})">
            <div class="queue-group-left">
              ${masterChk}
              <span class="queue-group-arrow">${isOpen ? '▾' : '▸'}</span>
              <span class="queue-group-name">${esc(g.name)}</span>
              ${isAutoSend ? '<span class="seq-auto-badge seq-auto-on" style="font-size:11px">⚡ Auto</span>' : ''}
              <span class="queue-group-count">${g.items.length} recipient${g.items.length!==1?'s':''}</span>
              <span class="queue-group-steps">${stepSummary}</span>
            </div>
            <div class="queue-group-actions" onclick="event.stopPropagation()">
              <button class="btn btn-outline btn-sm" onclick="openEnrollModalForSeq(${g.id})">+ Add Contacts</button>
              <button class="btn btn-ghost btn-sm" onclick="openSequenceModal(${g.id})">Edit Sequence</button>
            </div>
          </div>
          ${isOpen ? `<div class="queue-group-body">${g.items.map(item => {
            const isSel = _queueSelected.has(String(item.enrollment_id));
            return `
            <div class="queue-item queue-item-clickable${isSel ? ' queue-item-selected' : ''}" onclick="openQueueDetail(${item._index})">
              <div class="queue-item-check" onclick="event.stopPropagation()">
                <input type="checkbox" ${isSel ? 'checked' : ''} onclick="event.stopPropagation();toggleQueueSelect(${item.enrollment_id}, this.checked)" title="Select">
              </div>
              <div class="queue-item-info">
                <div class="queue-contact">${esc(item.first_name)} ${esc(item.last_name||'')}</div>
                <div class="queue-company">${esc(item.company_name||'No company')} ${item.company_type ? `· ${typeName(item.company_type)}` : ''}</div>
                ${item.email ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(item.email)}</div>` : ''}
                <span class="queue-step-badge">Step ${item.current_step} of ${item.total_steps}</span>
                ${(isAutoSend && item.current_step > 1) ? '<span class="queue-auto-hint">⚡ will auto-send</span>' : (item.current_step === 1 ? '<span class="queue-manual-hint">✋ manual review</span>' : '')}
                <div class="queue-subject">"${esc(item.step_subject)}"</div>
              </div>
              <div class="queue-actions" onclick="event.stopPropagation()">
                <button class="btn btn-ghost btn-sm" onclick="previewEmail(${item.enrollment_id})">Preview</button>
                <button class="btn btn-primary btn-sm" onclick="sendOne(${item.enrollment_id})">Send</button>
                <button class="btn btn-ghost btn-sm" onclick="openSwitchSequenceModal(${item.enrollment_id}, ${item.contact_id}, ${item.sequence_id})" title="Switch to a different sequence">Switch</button>
                <button class="btn btn-ghost btn-sm" style="color:var(--text-muted);padding:0 8px" onclick="removeFromQueue(${item.enrollment_id})" title="Remove from sequence">✕</button>
              </div>
            </div>`;
          }).join('')}</div>` : ''}
        </div>`;
    }).join('');

    // Paint indeterminate state on master checkboxes (can't set via attribute)
    listEl.querySelectorAll('.queue-group-check[data-indeterminate="1"]').forEach(el => { el.indeterminate = true; });

    renderQueueBulkBar();
  } catch(e) { toast(e.message, 'error'); }
}

// ── BULK SELECT / REMOVE ─────────────────────────────────────────────────

function renderQueueBulkBar() {
  var bar = document.getElementById('queue-bulk-bar');
  if (!bar) {
    // Inject the bar above the queue list on first use
    var anchor = document.getElementById('queue-list');
    if (!anchor) return;
    bar = document.createElement('div');
    bar.id = 'queue-bulk-bar';
    bar.className = 'queue-bulk-bar hidden';
    bar.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;margin-bottom:10px;background:var(--bg-alt,#f6f7f9);border:1px solid var(--border,#e4e6ea);border-radius:8px;font-size:14px';
    bar.innerHTML =
      '<strong id="queue-bulk-count">0 selected</strong>' +
      '<button class="btn btn-danger btn-sm" onclick="bulkRemoveFromQueue()">Remove from sequence</button>' +
      '<button class="btn btn-ghost btn-sm" onclick="clearQueueSelection()">Clear selection</button>';
    anchor.parentNode.insertBefore(bar, anchor);
  }
  var n = _queueSelected.size;
  if (n === 0) {
    bar.classList.add('hidden');
    bar.style.display = 'none';
  } else {
    bar.classList.remove('hidden');
    bar.style.display = 'flex';
    var countEl = document.getElementById('queue-bulk-count');
    if (countEl) countEl.textContent = n + ' selected';
  }
}

function toggleQueueSelect(enrollmentId, checked) {
  var id = String(enrollmentId);
  if (checked) _queueSelected.add(id);
  else _queueSelected.delete(id);
  loadQueue();
}

function toggleQueueGroupSelect(seqId, checked) {
  // Compare as strings: _queueCache items come from the API with string IDs,
  // but seqId arrives as a number (inlined bare into the onclick attribute).
  var key = String(seqId);
  var items = _queueCache.filter(function(q) { return String(q.sequence_id) === key; });
  items.forEach(function(it) {
    var id = String(it.enrollment_id);
    if (checked) _queueSelected.add(id);
    else _queueSelected.delete(id);
  });
  loadQueue();
}

function clearQueueSelection() {
  _queueSelected.clear();
  loadQueue();
}

async function removeFromQueue(enrollmentId) {
  if (!confirm('Remove this contact from the sequence? They will stop receiving scheduled emails.')) return;
  try {
    await apiFetch('/api/enrollments/' + enrollmentId, { method: 'DELETE' });
    _queueSelected.delete(String(enrollmentId));
    toast('Removed from sequence', 'success');
    loadQueue();
    updateDashboardBadge();
  } catch(e) { toast(e.message, 'error'); }
}

async function bulkRemoveFromQueue() {
  var ids = Array.from(_queueSelected);
  if (!ids.length) return;
  if (!confirm('Remove ' + ids.length + ' contact' + (ids.length !== 1 ? 's' : '') + ' from their sequences? They will stop receiving scheduled emails.')) return;
  var ok = 0, fail = 0;
  // Small concurrency: fire in batches of 6
  var batchSize = 6;
  for (var i = 0; i < ids.length; i += batchSize) {
    var batch = ids.slice(i, i + batchSize);
    var results = await Promise.all(batch.map(function(id) {
      return apiFetch('/api/enrollments/' + id, { method: 'DELETE' })
        .then(function() { return true; })
        .catch(function() { return false; });
    }));
    results.forEach(function(r) { if (r) ok++; else fail++; });
  }
  _queueSelected.clear();
  toast('Removed ' + ok + ' from sequence' + (fail ? ' · ' + fail + ' failed' : ''), fail ? '' : 'success');
  loadQueue();
  updateDashboardBadge();
}

// ── SWITCH SEQUENCE ──────────────────────────────────────────────────────

async function openSwitchSequenceModal(enrollmentId, contactId, currentSeqId) {
  var overlay = document.getElementById('modal-switch-sequence');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modal-switch-sequence';
    overlay.className = 'modal-overlay hidden';
    overlay.innerHTML =
      '<div class="modal">' +
        '<div class="modal-header">' +
          '<h2>Switch Sequence</h2>' +
          '<button class="modal-close" onclick="closeModal(\'modal-switch-sequence\')">\u2715</button>' +
        '</div>' +
        '<div id="switch-sequence-body"></div>' +
      '</div>';
    document.body.appendChild(overlay);
  }
  var body = document.getElementById('switch-sequence-body');
  body.innerHTML = '<div style="padding:12px 0;color:var(--text-muted);font-size:13px">Loading sequences\u2026</div>';
  openModal('modal-switch-sequence');
  try {
    var seqs = await apiFetch('/api/sequences');
    body.innerHTML =
      '<p style="margin:0 0 14px;font-size:13px;color:var(--text-muted);line-height:1.45">Move this contact to a different sequence. Their current enrollment will be stopped and they\'ll start at Step 1 of the new sequence.</p>' +
      seqs.map(function(s) {
        var isCurrent = s.id === currentSeqId;
        var safeName = esc(s.name).replace(/'/g, "\\'");
        return '<button ' + (isCurrent ? 'disabled' : '') +
          ' style="display:block;width:100%;text-align:left;margin-bottom:8px;padding:12px 14px;border-radius:var(--radius);cursor:' + (isCurrent ? 'default' : 'pointer') + ';' +
            'background:' + (isCurrent ? 'var(--bg)' : 'var(--surface)') + ';' +
            'border:1.5px solid ' + (isCurrent ? 'var(--border)' : 'var(--primary)') + ';' +
            'color:' + (isCurrent ? 'var(--text-muted)' : 'var(--primary)') + ';' +
            'font-family:inherit" ' +
          (isCurrent ? '' : 'onmouseover="this.style.background=\'var(--primary-pale)\'" onmouseout="this.style.background=\'var(--surface)\'" ') +
          (isCurrent ? '' : 'onclick="doSwitchSequence(' + enrollmentId + ',' + contactId + ',' + s.id + ',\'' + safeName + '\')"') + '>' +
          '<div style="font-weight:700;font-size:14px">' + esc(s.name) +
            (isCurrent ? ' <span style="font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-left:6px">current</span>' : '') +
          '</div>' +
          (s.description ? '<div style="font-size:12px;color:var(--text-muted);margin-top:4px;line-height:1.4;font-weight:400">' + esc(s.description) + '</div>' : '') +
        '</button>';
      }).join('');
  } catch(e) { body.innerHTML = '<div style="padding:16px;color:var(--danger);background:var(--danger-pale);border-radius:var(--radius)">Failed to load sequences: ' + esc(e.message) + '</div>'; }
}

async function doSwitchSequence(oldEnrollmentId, contactId, newSeqId, newSeqName) {
  if (!confirm('Move this contact to "' + newSeqName + '"? They will start at Step 1 of that sequence.')) return;
  try {
    // Create new enrollment first (upserts active, resets to step 1)
    await apiFetch('/api/enrollments', {
      method: 'POST',
      body: JSON.stringify({ contact_ids: [contactId], sequence_id: newSeqId })
    });
    // Then stop the old enrollment (only if different from the new one)
    await apiFetch('/api/enrollments/' + oldEnrollmentId, { method: 'DELETE' });
    toast('Switched to ' + newSeqName, 'success');
    closeModal('modal-switch-sequence');
    loadQueue();
    updateDashboardBadge();
  } catch(e) { toast(e.message, 'error'); }
}

function countCampaigns(queue) {
  return new Set(queue.map(q => q.sequence_id)).size;
}

function toggleQueueGroup(seqId) {
  _queueExpanded[seqId] = !_queueExpanded[seqId];
  loadQueue();
}

async function openQueueDetail(index) {
  const item = _queueCache[index];
  if (!item) return;

  // Reset art override for this queue item
  _queueArtOverride = null;

  // Fetch the interpolated preview and art gallery in parallel
  let preview = { subject: item.step_subject, body: item.step_body || '' };
  try {
    const [prev, arts] = await Promise.all([
      apiFetch(`/api/queue/preview/${item.enrollment_id}`),
      fetchArtImages()
    ]);
    preview = prev;
    // Pre-select the auto-matched art so the user sees what will be sent
    if (preview.company_tags) {
      const matched = getArtForTags(preview.company_tags);
      if (matched) _queueArtOverride = matched;
    }
  } catch(e) {}

  const fullName = [item.first_name, item.last_name].filter(Boolean).join(' ') || 'Unknown';

  // Determine if this step gets art (odd steps + closing step)
  const isArtStep = (item.current_step % 2 === 1) || (item.current_step >= item.total_steps);

  // Build art picker section for art steps
  let artSection = '';
  if (isArtStep) {
    const artLabel = _queueArtOverride && _queueArtOverride !== 'none'
      ? `<img src="${esc(_queueArtOverride.url)}" alt="${esc(_queueArtOverride.title)}" style="width:80px;height:80px;object-fit:cover;border-radius:6px"/> <span style="font-size:12px">${esc(_queueArtOverride.title)}</span>`
      : '<span style="color:var(--text-muted)">Auto-selected based on company tags</span>';
    artSection = `
    <div class="queue-detail-field">
      <label class="queue-detail-label">Art Image</label>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div id="queue-art-preview" style="display:flex;align-items:center;gap:8px">${artLabel}</div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-outline btn-sm" onclick="openQueueArtPicker(${item.enrollment_id})">Change Art</button>
          <button class="btn btn-outline btn-sm" onclick="_queueArtOverride='none';updateQueueArtPreview()">No Art</button>
        </div>
      </div>
    </div>`;
  }

  document.getElementById('queue-detail-title').textContent = `Email to ${fullName}`;
  document.getElementById('queue-detail-content').innerHTML = `
    <!-- CRM Context -->
    <div class="queue-detail-crm">
      <div class="queue-detail-contact-card">
        <div class="queue-detail-name">${esc(fullName)}</div>
        ${item.title ? `<div class="queue-detail-role">${esc(item.title)}</div>` : ''}
        ${item.email ? `<div class="queue-detail-email">${esc(item.email)}</div>` : ''}
      </div>
      <div class="queue-detail-links">
        ${item.contact_id ? `<button class="btn btn-outline btn-sm" onclick="closeModal('modal-queue-detail');openContactDetail(${item.contact_id})">View Contact</button>` : ''}
        ${item.company_id ? `<button class="btn btn-outline btn-sm" onclick="closeModal('modal-queue-detail');openCompanyDetail(${item.company_id})">View Company</button>` : ''}
      </div>
    </div>

    ${item.company_name ? `
    <div class="queue-detail-company-bar">
      <span class="queue-detail-co-name">${esc(item.company_name)}</span>
      ${item.company_type ? `<span class="queue-detail-co-type">${typeName(item.company_type)}</span>` : ''}
      ${item.website ? `<a href="${esc(item.website)}" target="_blank" class="queue-detail-co-link">${esc(item.website)}</a>` : ''}
    </div>` : ''}

    <div class="queue-detail-seq-info">
      <span class="queue-seq-name">${esc(item.sequence_name)}</span>
      <span class="queue-step-badge">Step ${item.current_step} of ${item.total_steps}</span>
    </div>

    <!-- Editable Subject -->
    <div class="queue-detail-field">
      <label class="queue-detail-label">Subject</label>
      <input type="text" id="queue-edit-subject" class="queue-detail-input" value="${esc(preview.subject)}">
    </div>

    <!-- Editable Body -->
    <div class="queue-detail-field">
      <label class="queue-detail-label">Message Body</label>
      <div class="textarea-toolbar">
        <button type="button" class="btn btn-ghost btn-sm" onclick="insertLink('queue-edit-body')" title="Insert hyperlink">🔗 Link</button>
      </div>
      <textarea id="queue-edit-body" class="queue-detail-textarea" rows="12">${esc(preview.body)}</textarea>
    </div>

    ${artSection}

    <div class="queue-detail-actions">
      <button class="btn btn-primary" onclick="sendFromQueueDetail(${item.enrollment_id})">Send Email</button>
      <button class="btn btn-outline" onclick="previewFromQueueDetail(${item.enrollment_id})">Preview</button>
      <button class="btn btn-danger" onclick="removeFromQueue(${item.enrollment_id});closeModal('modal-queue-detail')">Remove from Sequence</button>
      <button class="btn btn-outline" onclick="closeModal('modal-queue-detail')">Cancel</button>
    </div>
  `;
  openModal('modal-queue-detail');
}

async function sendFromQueueDetail(enrollmentId) {
  const subject = document.getElementById('queue-edit-subject').value;
  const body = document.getElementById('queue-edit-body').value;
  // Build payload with optional art override
  const payload = { enrollment_id: enrollmentId, custom_subject: subject, custom_body: body };
  if (_queueArtOverride === 'none') {
    payload.custom_art_id = 'none';
  } else if (_queueArtOverride && _queueArtOverride.id) {
    payload.custom_art_id = _queueArtOverride.id;
  }
  try {
    const r = await apiFetch('/api/queue/send', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    toast(`Sent: "${r.subject}"`, 'success');
    closeModal('modal-queue-detail');
    loadQueue();
    updateDashboardBadge();
  } catch(e) { toast(e.message, 'error'); }
}

async function previewFromQueueDetail(enrollmentId) {
  const subject = document.getElementById('queue-edit-subject').value;
  const body = document.getElementById('queue-edit-body').value;
  try {
    const preview = await apiFetch(`/api/queue/preview/${enrollmentId}`);
    let bodyHtml = renderEmailBody(body || preview.body);
    // Show art based on user's selection (or auto-match if no override)
    if (_queueArtOverride === 'none') {
      // User chose no art — skip
    } else if (_queueArtOverride && _queueArtOverride.url) {
      bodyHtml += buildArtPreviewCard(_queueArtOverride);
    } else if (preview.company_tags) {
      await fetchArtImages();
      const artImg = getArtForTags(preview.company_tags);
      if (artImg) bodyHtml += buildArtPreviewCard(artImg);
    }
    document.getElementById('preview-content').innerHTML = `
      <div class="preview-subject">Subject: ${esc(subject || preview.subject)}</div>
      <div class="preview-body">${bodyHtml}</div>
    `;
    currentEnrollmentIdForPreview = enrollmentId;
    document.getElementById('preview-send-btn').onclick = () => {
      closeModal('modal-preview');
      sendFromQueueDetail(enrollmentId);
    };
    openModal('modal-preview');
  } catch(e) { toast(e.message, 'error'); }
}

async function previewEmail(enrollmentId) {
  try {
    const preview = await apiFetch(`/api/queue/preview/${enrollmentId}`);
    let bodyHtml = renderEmailBody(preview.body);
    // Show art preview based on company tags
    if (preview.company_tags) {
      await fetchArtImages();
      const artImg = getArtForTags(preview.company_tags);
      if (artImg) bodyHtml += buildArtPreviewCard(artImg);
    }
    document.getElementById('preview-content').innerHTML = `
      <div class="preview-subject">Subject: ${esc(preview.subject)}</div>
      <div class="preview-body">${bodyHtml}</div>
    `;
    currentEnrollmentIdForPreview = enrollmentId;
    document.getElementById('preview-send-btn').onclick = () => {
      closeModal('modal-preview');
      sendOne(enrollmentId);
    };
    openModal('modal-preview');
  } catch(e) { toast(e.message, 'error'); }
}

async function sendOne(enrollmentId) {
  try {
    const r = await apiFetch('/api/queue/send', { method: 'POST', body: JSON.stringify({ enrollment_id: enrollmentId }) });
    toast(`Sent: "${r.subject}"`, 'success');
    loadQueue();
    updateDashboardBadge();
  } catch(e) { toast(e.message, 'error'); }
}

async function sendAll() {
  const queue = await apiFetch('/api/queue');
  if (!queue.length) { toast('Queue is empty', ''); return; }
  if (!confirm(`Send ${queue.length} email${queue.length!==1?'s':''} now?`)) return;
  const btn = document.getElementById('send-all-btn');
  btn.textContent = 'Sending...';
  btn.disabled = true;
  try {
    const r = await apiFetch('/api/queue/send-all', { method: 'POST' });
    toast(`Sent ${r.sent} email${r.sent!==1?'s':''}${r.failed ? ` · ${r.failed} failed` : ''}`, r.failed ? '' : 'success');
    loadQueue();
  } catch(e) { toast(e.message, 'error'); }
  btn.textContent = 'Send All';
  btn.disabled = false;
}

async function updateDashboardBadge() {
  const queue = await apiFetch('/api/queue');
  updateBadge('badge-queue', queue.length);
}

// ── NEW LEADS ────────────────────────────────────────────────────────────

async function refreshNewLeadsBadge() {
  try {
    const data = await apiFetch('/api/new-leads?hours=24');
    const n = (data.companies || []).length;
    var badge = document.getElementById('badge-new-leads');
    if (badge) {
      badge.textContent = n > 0 ? n : '';
      badge.style.display = n > 0 ? '' : 'none';
    }
  } catch(e) { /* silent — non-critical */ }
}

async function openNewLeadsModal(hoursArg) {
  var hours = hoursArg || 24;
  var overlay = document.getElementById('modal-new-leads');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modal-new-leads';
    overlay.className = 'modal-overlay hidden';
    overlay.innerHTML =
      '<div class="modal modal-wide">' +
        '<div class="modal-header">' +
          '<h2>New Leads</h2>' +
          '<button class="modal-close" onclick="closeModal(\'modal-new-leads\')">\u2715</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center;margin-bottom:16px">' +
          '<span style="font-size:12px;color:var(--text-muted);font-weight:600">Show leads from the last:</span>' +
          '<button class="btn btn-ghost btn-sm" onclick="openNewLeadsModal(24)">24h</button>' +
          '<button class="btn btn-ghost btn-sm" onclick="openNewLeadsModal(72)">3 days</button>' +
          '<button class="btn btn-ghost btn-sm" onclick="openNewLeadsModal(168)">7 days</button>' +
        '</div>' +
        '<div id="new-leads-body"></div>' +
      '</div>';
    document.body.appendChild(overlay);
  }
  var body = document.getElementById('new-leads-body');
  body.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px">Loading\u2026</div>';
  openModal('modal-new-leads');
  try {
    var data = await apiFetch('/api/new-leads?hours=' + hours);
    var cos = data.companies || [];
    if (!cos.length) {
      body.innerHTML =
        '<div style="padding:40px 20px;text-align:center;color:var(--text-muted)">' +
          '<div style="font-size:36px;margin-bottom:8px">\ud83c\udf31</div>' +
          '<div style="font-size:15px;font-weight:700;color:var(--text)">No new leads in the last ' + hours + ' hours</div>' +
          '<div style="margin-top:6px;font-size:12px">The daily prospect finder runs weekday mornings around 9 AM.</div>' +
        '</div>';
      return;
    }
    var seqCounts = {};
    cos.forEach(function(c) {
      (c.contacts || []).forEach(function(ct) {
        var key = ct.sequence_name || '\u2014 not enrolled';
        seqCounts[key] = (seqCounts[key] || 0) + 1;
      });
    });
    var summaryBits = Object.entries(seqCounts).map(function(kv) {
      return '<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--primary)"><strong>' + kv[1] + '</strong> ' + esc(kv[0]) + '</span>';
    }).join('<span style="color:var(--border)">\u2502</span>');
    var summary =
      '<div style="margin-bottom:16px;padding:12px 16px;background:var(--primary-pale);border-radius:var(--radius);display:flex;gap:12px;flex-wrap:wrap;align-items:center">' +
        '<strong style="color:var(--primary);font-size:13px">' + cos.length + ' new compan' + (cos.length !== 1 ? 'ies' : 'y') + '</strong>' +
        '<span style="color:var(--border)">\u2502</span>' +
        summaryBits +
      '</div>';
    var html = summary + cos.map(function(c) {
      var added = new Date(c.created_at);
      var addedLabel = added.toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
      var tagHtml = (c.tags || '').split(',').map(function(t) { return t.trim(); }).filter(Boolean)
        .map(function(t) { return '<span class="tag-chip" style="color:var(--text-muted);border-color:var(--border);background:var(--bg)">' + esc(t) + '</span>'; }).join(' ');
      var contactsHtml = (c.contacts || []).map(function(ct, i) {
        var name = [ct.first_name, ct.last_name].filter(Boolean).join(' ');
        var enrollBadge = ct.sequence_name
          ? '<span class="badge" style="background:var(--primary-pale);color:var(--primary)">\u2192 ' + esc(ct.sequence_name) + '</span>'
          : (ct.email
              ? '<span class="badge" style="background:var(--warn-pale);color:var(--warn)">not enrolled</span>'
              : '<span class="badge">no email</span>');
        var actions = ct.enrollment_id
          ? '<button class="btn btn-ghost btn-sm" onclick="openSwitchSequenceModal(' + ct.enrollment_id + ',' + ct.id + ',' + (ct.sequence_id || 'null') + ')">Switch</button>' +
            '<button class="btn btn-ghost btn-sm" onclick="removeFromQueue(' + ct.enrollment_id + ')" title="Remove from sequence" style="padding:5px 8px;margin-left:4px">\u2715</button>'
          : '';
        var borderStyle = i === 0 ? '' : 'border-top:1px solid var(--border);';
        return '<div style="' + borderStyle + 'display:flex;align-items:center;gap:12px;padding:10px 0">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:13px;font-weight:600">' + esc(name || '\u2014') +
              (ct.is_primary ? ' <span style="font-size:10px;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:0.05em">primary</span>' : '') +
              (ct.title ? ' <span style="font-weight:400;color:var(--text-muted)">\u00b7 ' + esc(ct.title) + '</span>' : '') +
            '</div>' +
            (ct.email ? '<div style="font-size:12px;color:var(--text-muted);margin-top:2px">' + esc(ct.email) + '</div>' : '') +
          '</div>' +
          '<div>' + enrollBadge + '</div>' +
          (actions ? '<div style="display:flex;gap:4px">' + actions + '</div>' : '') +
        '</div>';
      }).join('');
      return '<div class="card" style="margin-bottom:12px;padding:14px 16px">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:6px">' +
          '<div style="min-width:0">' +
            '<a href="#" style="font-size:15px;font-weight:700;color:var(--primary);text-decoration:none" onclick="event.preventDefault();closeModal(\'modal-new-leads\');openCompanyDetail(' + c.id + ')">' + esc(c.name) + '</a>' +
            (c.city ? ' <span style="color:var(--text-muted);font-size:12px;font-weight:400">\u00b7 ' + esc(c.city) + (c.state ? ', ' + esc(c.state) : '') + '</span>' : '') +
          '</div>' +
          '<span style="font-size:11px;color:var(--text-muted);white-space:nowrap">added ' + addedLabel + '</span>' +
        '</div>' +
        (tagHtml ? '<div style="margin:6px 0 8px;display:flex;flex-wrap:wrap;gap:4px">' + tagHtml + '</div>' : '') +
        (c.notes ? '<div style="font-size:12px;color:var(--text-muted);margin:6px 0 8px;font-style:italic;line-height:1.4">' + esc(c.notes) + '</div>' : '') +
        (contactsHtml ? '<div style="margin-top:8px;border-top:1px solid var(--border);padding-top:4px">' + contactsHtml + '</div>' : '<div style="font-size:12px;color:var(--text-muted);padding:8px 0 0">No contacts attached.</div>') +
      '</div>';
    }).join('');
    body.innerHTML = html;
  } catch(e) { body.innerHTML = '<div style="padding:16px;color:var(--danger);background:var(--danger-pale);border-radius:var(--radius)">Failed to load: ' + esc(e.message) + '</div>'; }
}
