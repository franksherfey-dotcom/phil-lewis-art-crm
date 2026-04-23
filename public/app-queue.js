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

    // Prune any selections that no longer exist in the queue (e.g. after sends/removals)
    const validIds = new Set(queue.map(q => q.enrollment_id));
    _queueSelected.forEach(id => { if (!validIds.has(id)) _queueSelected.delete(id); });

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
      const groupIds = g.items.map(it => it.enrollment_id);
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
            const isSel = _queueSelected.has(item.enrollment_id);
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
  if (checked) _queueSelected.add(enrollmentId);
  else _queueSelected.delete(enrollmentId);
  loadQueue();
}

function toggleQueueGroupSelect(seqId, checked) {
  var items = _queueCache.filter(function(q) { return q.sequence_id === seqId; });
  items.forEach(function(it) {
    if (checked) _queueSelected.add(it.enrollment_id);
    else _queueSelected.delete(it.enrollment_id);
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
    _queueSelected.delete(enrollmentId);
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
      '<div class="modal-content" style="max-width:520px">' +
        '<div class="modal-header">' +
          '<h2>Switch Sequence</h2>' +
          '<button class="modal-close" onclick="closeModal(\'modal-switch-sequence\')">✕</button>' +
        '</div>' +
        '<div id="switch-sequence-body" style="padding:16px"></div>' +
      '</div>';
    document.body.appendChild(overlay);
  }
  var body = document.getElementById('switch-sequence-body');
  body.innerHTML = '<div style="padding:8px">Loading sequences…</div>';
  openModal('modal-switch-sequence');
  try {
    var seqs = await apiFetch('/api/sequences');
    body.innerHTML =
      '<p style="margin:0 0 12px;font-size:13px;color:var(--text-muted)">Move this contact to a different sequence. Their current enrollment will be stopped and they\'ll start at Step 1 of the new sequence.</p>' +
      seqs.map(function(s) {
        var isCurrent = s.id === currentSeqId;
        return '<button class="btn ' + (isCurrent ? 'btn-outline' : 'btn-primary') + ' btn-sm" ' +
          (isCurrent ? 'disabled' : '') +
          ' style="display:block;width:100%;text-align:left;margin-bottom:6px;padding:10px 12px" ' +
          'onclick="doSwitchSequence(' + enrollmentId + ',' + contactId + ',' + s.id + ',\'' + esc(s.name).replace(/'/g, "\\'") + '\')">' +
          '<strong>' + esc(s.name) + '</strong>' +
          (isCurrent ? ' <span style="color:var(--text-muted);font-size:11px">(current)</span>' : '') +
          (s.description ? '<div style="font-size:12px;color:var(--text-muted);margin-top:2px;white-space:normal">' + esc(s.description) + '</div>' : '') +
        '</button>';
      }).join('');
  } catch(e) { body.innerHTML = '<div style="color:var(--danger,#c33)">Failed to load sequences: ' + esc(e.message) + '</div>'; }
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
      '<div class="modal-content" style="max-width:860px">' +
        '<div class="modal-header">' +
          '<h2>New Leads</h2>' +
          '<button class="modal-close" onclick="closeModal(\'modal-new-leads\')">✕</button>' +
        '</div>' +
        '<div style="padding:12px 20px;border-bottom:1px solid var(--border,#e4e6ea);display:flex;gap:8px;align-items:center">' +
          '<span style="font-size:13px;color:var(--text-muted)">Show leads from the last:</span>' +
          '<button class="btn btn-ghost btn-sm" onclick="openNewLeadsModal(24)">24h</button>' +
          '<button class="btn btn-ghost btn-sm" onclick="openNewLeadsModal(72)">3 days</button>' +
          '<button class="btn btn-ghost btn-sm" onclick="openNewLeadsModal(168)">7 days</button>' +
        '</div>' +
        '<div id="new-leads-body" style="padding:16px;max-height:70vh;overflow:auto"></div>' +
      '</div>';
    document.body.appendChild(overlay);
  }
  var body = document.getElementById('new-leads-body');
  body.innerHTML = '<div style="padding:16px;color:var(--text-muted)">Loading…</div>';
  openModal('modal-new-leads');
  try {
    var data = await apiFetch('/api/new-leads?hours=' + hours);
    var cos = data.companies || [];
    if (!cos.length) {
      body.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted)"><div style="font-size:32px">🌱</div><strong>No new leads in the last ' + hours + ' hours.</strong><div style="margin-top:6px;font-size:12px">The daily prospect finder runs weekday mornings around 9 AM.</div></div>';
      return;
    }

    // Summary bar — breakdown by assigned sequence
    var seqCounts = {};
    cos.forEach(function(c) {
      (c.contacts || []).forEach(function(ct) {
        var key = ct.sequence_name || '— not enrolled —';
        seqCounts[key] = (seqCounts[key] || 0) + 1;
      });
    });
    var summary = '<div style="margin-bottom:14px;padding:10px 12px;background:var(--bg-alt,#f6f7f9);border-radius:8px;font-size:13px">' +
      '<strong>' + cos.length + ' new compan' + (cos.length !== 1 ? 'ies' : 'y') + '</strong> &middot; ' +
      Object.entries(seqCounts).map(function(kv) { return esc(kv[0]) + ': ' + kv[1]; }).join(' &middot; ') +
      '</div>';

    var html = summary + cos.map(function(c) {
      var added = new Date(c.created_at);
      var addedLabel = added.toLocaleString([], { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
      var tagHtml = (c.tags || '').split(',').map(function(t) { return t.trim(); }).filter(Boolean)
        .map(function(t) { return '<span style="display:inline-block;padding:1px 7px;margin:0 3px 2px 0;background:#eef;border-radius:10px;font-size:11px">' + esc(t) + '</span>'; }).join('');
      var contactsHtml = (c.contacts || []).map(function(ct) {
        var name = [ct.first_name, ct.last_name].filter(Boolean).join(' ');
        var enrollBadge = ct.sequence_name
          ? '<span style="padding:2px 8px;background:#e8f3ff;color:#0550ae;border-radius:4px;font-size:11px">→ ' + esc(ct.sequence_name) + '</span>'
          : (ct.email ? '<span style="padding:2px 8px;background:#fff3cd;color:#664d03;border-radius:4px;font-size:11px">not enrolled</span>' : '<span style="padding:2px 8px;background:#f0f0f0;color:#666;border-radius:4px;font-size:11px">no email</span>');
        var actions = ct.enrollment_id
          ? '<button class="btn btn-ghost btn-xs" onclick="openSwitchSequenceModal(' + ct.enrollment_id + ',' + ct.id + ',' + (ct.sequence_id || 'null') + ')">Switch</button> ' +
            '<button class="btn btn-ghost btn-xs" onclick="removeFromQueue(' + ct.enrollment_id + ')" title="Remove from sequence" style="color:var(--text-muted)">✕</button>'
          : '';
        return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-top:1px dashed #eee">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:13px"><strong>' + esc(name || '—') + '</strong>' + (ct.is_primary ? ' <span style="font-size:10px;color:var(--text-muted)">(primary)</span>' : '') + (ct.title ? ' <span style="color:var(--text-muted)">· ' + esc(ct.title) + '</span>' : '') + '</div>' +
            (ct.email ? '<div style="font-size:11px;color:var(--text-muted)">' + esc(ct.email) + '</div>' : '') +
          '</div>' +
          '<div>' + enrollBadge + '</div>' +
          '<div>' + actions + '</div>' +
        '</div>';
      }).join('');

      return '<div style="margin-bottom:14px;padding:12px 14px;border:1px solid var(--border,#e4e6ea);border-radius:8px">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">' +
          '<div>' +
            '<strong style="font-size:15px;cursor:pointer" onclick="closeModal(\'modal-new-leads\');openCompanyDetail(' + c.id + ')">' + esc(c.name) + '</strong>' +
            (c.city ? ' <span style="color:var(--text-muted);font-size:12px">· ' + esc(c.city) + (c.state ? ', ' + esc(c.state) : '') + '</span>' : '') +
          '</div>' +
          '<span style="font-size:11px;color:var(--text-muted)">added ' + addedLabel + '</span>' +
        '</div>' +
        (tagHtml ? '<div style="margin:4px 0 6px">' + tagHtml + '</div>' : '') +
        (c.notes ? '<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;font-style:italic">' + esc(c.notes) + '</div>' : '') +
        (contactsHtml || '<div style="font-size:12px;color:var(--text-muted);padding:6px 0">No contacts attached.</div>') +
      '</div>';
    }).join('');

    body.innerHTML = html;
  } catch(e) { body.innerHTML = '<div style="color:var(--danger,#c33);padding:16px">Failed to load: ' + esc(e.message) + '</div>'; }
}
