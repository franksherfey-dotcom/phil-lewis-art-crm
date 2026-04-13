// ── PHIL LEWIS ART CRM — Sequences ──────────────────────────────────────────
// ── SEQUENCES ─────────────────────────────────────────────────────────────
async function loadSequences() {
  try {
    const seqs = await apiFetch('/api/sequences');
    const el = document.getElementById('sequences-list');
    if (!seqs.length) {
      el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div style="font-size:32px;margin-bottom:8px">◈</div><p>No sequences yet. Create one to start automating your outreach.</p></div>`;
      return;
    }
    el.innerHTML = seqs.map(function(s) {
      var st = s.stats || { active:0, replied:0, completed:0, stopped:0, total:0 };
      var replyRate = st.total > 0 ? Math.round((st.replied / st.total) * 100) : 0;
      var completionRate = st.total > 0 ? Math.round(((st.completed + st.replied) / st.total) * 100) : 0;

      // Mini stats bar segments
      var barHtml = '';
      if (st.total > 0) {
        var segs = [
          { n: st.replied, color: 'var(--success)', label: 'Replied' },
          { n: st.active, color: 'var(--primary)', label: 'Active' },
          { n: st.completed, color: '#6b7280', label: 'Completed' },
          { n: st.stopped || 0, color: 'var(--danger)', label: 'Stopped' }
        ];
        barHtml = '<div style="display:flex;height:6px;border-radius:3px;overflow:hidden;background:var(--border-light,#eef0f3);margin:8px 0">';
        segs.forEach(function(seg) {
          if (seg.n > 0) {
            var pct = Math.round((seg.n / st.total) * 100);
            barHtml += '<div style="width:' + pct + '%;background:' + seg.color + '" title="' + seg.label + ': ' + seg.n + '"></div>';
          }
        });
        barHtml += '</div>';
      }

      function statChip(count, label, color, seqId, seqName, statusFilter) {
        if (count === 0) return '';
        return '<span class="seq-stat-chip" style="cursor:pointer" onclick="event.stopPropagation();openSequenceRoster(' + seqId + ',' + JSON.stringify(esc(seqName)) + ',\'' + statusFilter + '\')">' +
          '<strong style="color:' + color + '">' + count + '</strong> ' + label + '</span>';
      }

      var statsLine = st.total > 0
        ? '<div style="display:flex;gap:12px;font-size:12px;color:var(--text-muted);margin-top:4px;flex-wrap:wrap">' +
            statChip(st.total, 'enrolled', 'var(--text)', s.id, s.name, '') +
            statChip(st.active, 'active', 'var(--primary)', s.id, s.name, 'active') +
            statChip(st.replied, 'replied', 'var(--success)', s.id, s.name, 'replied') +
            '<span>Reply rate: <strong style="color:' + (replyRate > 5 ? 'var(--success)' : 'var(--text)') + '">' + replyRate + '%</strong></span>' +
            (st.stopped > 0 ? statChip(st.stopped, 'stopped', 'var(--danger)', s.id, s.name, 'stopped') : '') +
          '</div>'
        : '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">No enrollments yet</div>';

      var autoLabel = s.auto_send
        ? '<span class="seq-auto-badge seq-auto-on" title="Steps 2+ send automatically on schedule">⚡ Auto-Send ON</span>'
        : '<span class="seq-auto-badge seq-auto-off" title="All steps require manual send">Manual</span>';

      return '<div class="seq-card">' +
        '<div class="seq-card-header">' +
          '<div class="seq-name">' + esc(s.name) + ' ' + autoLabel + '</div>' +
          '<div style="display:flex;gap:6px;align-items:center">' +
            '<label class="auto-send-toggle" title="Auto-send steps 2+ on schedule" onclick="event.stopPropagation()">' +
              '<input type="checkbox" ' + (s.auto_send ? 'checked' : '') + ' onchange="toggleAutoSend(' + s.id + ', this.checked)">' +
              '<span class="auto-send-slider"></span>' +
            '</label>' +
            '<button class="btn btn-ghost btn-sm" onclick="openSequenceModal(' + s.id + ')">Edit</button>' +
            '<button class="btn btn-danger btn-sm" onclick="deleteSequence(' + s.id + ')">Delete</button>' +
          '</div>' +
        '</div>' +
        (s.description ? '<div class="seq-desc">' + esc(s.description) + '</div>' : '') +
        barHtml + statsLine +
        '<div class="seq-steps-preview">' +
          s.steps.map(function(step) {
            return '<div class="seq-step-row">' +
              '<div class="seq-step-num">' + step.step_number + '</div>' +
              '<div class="seq-step-info">' + esc(step.subject) + '</div>' +
              '<div class="seq-step-delay">' + (step.step_number===1 ? 'Day 0 (immediate)' : '+' + step.delay_days + ' day' + (step.delay_days!==1?'s':'')) + '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<div class="seq-footer">' +
          '<button class="enrolled-count enrolled-count-btn" onclick="openSequenceRoster(' + s.id + ', ' + JSON.stringify(esc(s.name)) + ')">' + s.enrollment_count + ' contact' + (s.enrollment_count!==1?'s':'') + ' enrolled</button>' +
          '<button class="btn btn-primary btn-sm" onclick="openEnrollModalForSeq(' + s.id + ')">Enroll Contacts</button>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch(e) { toast(e.message, 'error'); }
}

// ── Sequence Roster Panel ─────────────────────────────────────────────────────
async function openSequenceRoster(seqId, seqName, filterStatus) {
  const existing = document.getElementById('seq-roster-panel');
  if (existing) existing.remove();

  var activeFilter = filterStatus || '';

  const panel = document.createElement('div');
  panel.id = 'seq-roster-panel';
  panel.className = 'seq-roster-panel';
  panel.innerHTML = '<div class="seq-roster-loading">Loading roster…</div>';
  const seqList = document.getElementById('sequences-list');
  seqList.parentNode.insertBefore(panel, seqList.nextSibling);
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const { enrolled, suggestions } = await apiFetch('/api/sequences/' + seqId + '/roster');

    // Compute stats
    var rosterActive = enrolled.filter(function(c) { return c.enrollment_status === 'active'; }).length;
    var rosterReplied = enrolled.filter(function(c) { return c.enrollment_status === 'replied'; }).length;
    var rosterCompleted = enrolled.filter(function(c) { return c.enrollment_status === 'completed'; }).length;
    var rosterStopped = enrolled.filter(function(c) { return c.enrollment_status === 'stopped' || c.enrollment_status === 'paused'; }).length;
    var rosterReplyRate = enrolled.length > 0 ? Math.round((rosterReplied / enrolled.length) * 100) : 0;

    // Filter chips
    function rosterChip(label, count, status, color) {
      var isActive = activeFilter === status;
      return '<span class="roster-filter-chip' + (isActive ? ' roster-filter-active' : '') + '"' +
        ' style="cursor:pointer;border-color:' + (isActive ? color : 'var(--border)') + '"' +
        ' onclick="openSequenceRoster(' + seqId + ',' + JSON.stringify(esc(seqName)) + ',\'' + (isActive ? '' : status) + '\')">' +
        '<strong style="color:' + color + '">' + count + '</strong> ' + label + '</span>';
    }

    var filterHtml = '<div class="roster-filter-bar">' +
      rosterChip('All', enrolled.length, '', 'var(--text)') +
      rosterChip('Active', rosterActive, 'active', 'var(--primary)') +
      rosterChip('Replied', rosterReplied, 'replied', 'var(--success)') +
      rosterChip('Completed', rosterCompleted, 'completed', '#6b7280') +
      (rosterStopped > 0 ? rosterChip('Stopped', rosterStopped, 'stopped', 'var(--danger)') : '') +
      '<span style="margin-left:auto;font-size:12px;color:var(--text-muted)">Reply rate: <strong style="color:' + (rosterReplyRate > 5 ? 'var(--success)' : 'var(--text)') + '">' + rosterReplyRate + '%</strong></span>' +
    '</div>';

    // Filter enrolled list
    var filteredEnrolled = enrolled;
    if (activeFilter) {
      if (activeFilter === 'stopped') {
        filteredEnrolled = enrolled.filter(function(c) { return c.enrollment_status === 'stopped' || c.enrollment_status === 'paused'; });
      } else {
        filteredEnrolled = enrolled.filter(function(c) { return c.enrollment_status === activeFilter; });
      }
    }

    // Build enrolled rows — with action buttons and reply status
    var enrolledRowsHtml = '';
    if (filteredEnrolled.length) {
      filteredEnrolled.forEach(function(c) {
        var statusBadge =
          c.enrollment_status === 'active'    ? '<span class="seq-badge seq-active">● Active</span>' :
          c.enrollment_status === 'replied'   ? '<span class="seq-badge seq-replied">✓ Replied</span>' :
          c.enrollment_status === 'completed' ? '<span class="seq-badge seq-completed">✓ Done</span>' :
          c.enrollment_status === 'paused'    ? '<span class="seq-badge seq-completed">⏸ Paused</span>' :
                                                '<span class="seq-badge seq-completed">Stopped</span>';

        // Reply status: did they reply? Did Frank respond back?
        var replyInfo = '';
        if (c.enrollment_status === 'replied' && c.last_reply_at) {
          var youReplied = c.last_sent_at && new Date(c.last_sent_at) > new Date(c.last_reply_at);
          if (youReplied) {
            replyInfo = '<div style="font-size:11px;color:var(--success);margin-top:2px">✓ You responded ' + fmtDate(c.last_sent_at) + '</div>';
          } else {
            replyInfo = '<div style="font-size:11px;color:var(--danger);font-weight:600;margin-top:2px">⚠ Awaiting your reply (replied ' + fmtDate(c.last_reply_at) + ')</div>';
          }
        }

        // Action buttons based on status
        var actions = '';
        if (c.enrollment_status === 'replied') {
          var youReplied2 = c.last_sent_at && new Date(c.last_sent_at) > new Date(c.last_reply_at);
          if (!youReplied2) {
            actions = '<button class="btn btn-primary btn-sm" onclick="openContactDetail(' + c.id + ')">Reply Now</button>';
          } else {
            actions = '<button class="btn btn-outline btn-sm" onclick="openContactDetail(' + c.id + ')">View</button>';
          }
        } else if (c.enrollment_status === 'active') {
          actions = '<button class="btn btn-outline btn-sm" onclick="openContactDetail(' + c.id + ')">View</button>';
        } else {
          actions = '<button class="btn btn-ghost btn-sm" onclick="openContactDetail(' + c.id + ')">View</button>';
        }
        actions += ' <button class="btn btn-ghost btn-sm" style="color:var(--text-muted)" onclick="unenrollFromRoster(' + c.enrollment_id + ',' + seqId + ',\'' + esc(seqName) + '\')">Remove</button>';

        enrolledRowsHtml += '<tr' + (c.enrollment_status === 'replied' && !(c.last_sent_at && new Date(c.last_sent_at) > new Date(c.last_reply_at)) ? ' style="background:var(--success-pale,#f0fdf4)"' : '') + '>' +
          '<td><a href="#" onclick="event.preventDefault();openContactDetail(' + c.id + ')" style="font-weight:600;color:var(--text);text-decoration:none">' + esc(c.first_name) + ' ' + esc(c.last_name||'') + '</a>' + replyInfo + '</td>' +
          '<td>' + esc(c.title||'—') + '</td>' +
          '<td>' + (c.company_name ? '<a href="#" onclick="event.preventDefault();openCompanyDetail(' + (c.company_id||0) + ')" style="color:var(--text);text-decoration:none">' + esc(c.company_name) + '</a>' : '—') + '</td>' +
          '<td>' + esc(c.email||'—') + '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td style="white-space:nowrap">' + actions + '</td>' +
        '</tr>';
      });
    } else {
      enrolledRowsHtml = '<tr><td colspan="6" class="empty-state" style="padding:16px">No contacts match this filter.</td></tr>';
    }

    var suggestRows = suggestions.length
      ? suggestions.map(function(c) {
          return '<tr>' +
            '<td><strong>' + esc(c.first_name) + ' ' + esc(c.last_name||'') + '</strong></td>' +
            '<td>' + esc(c.title||'—') + '</td>' +
            '<td>' + (c.company_name ? esc(c.company_name) : '—') + '</td>' +
            '<td>' + esc(c.email||'—') + '</td>' +
            '<td>' + (c.other_enrollment_status === 'active'
              ? '<span class="seq-badge seq-completed" title="In another sequence">In sequence</span>'
              : '<span style="color:var(--success,#16a34a);font-size:12px;font-weight:600">● Available</span>') + '</td>' +
            '<td><button class="btn btn-primary btn-sm" onclick="enrollFromRoster(' + c.id + ',' + seqId + ',\'' + esc(seqName) + '\')">Add</button></td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="6" class="empty-state" style="padding:16px">All contacts with emails are already enrolled.</td></tr>';

    var filterLabel = activeFilter ? ' — ' + activeFilter.charAt(0).toUpperCase() + activeFilter.slice(1) : '';
    panel.innerHTML =
      '<div class="seq-roster-header">' +
        '<div>' +
          '<div class="seq-roster-title">' + esc(seqName) + ' — Roster' + filterLabel + '</div>' +
          '<div class="seq-roster-sub">' + enrolled.length + ' enrolled · ' + suggestions.filter(function(s) { return s.other_enrollment_status !== 'active'; }).length + ' available to add</div>' +
        '</div>' +
        '<button class="inbox-rp-close" onclick="document.getElementById(\'seq-roster-panel\').remove()">✕</button>' +
      '</div>' +
      filterHtml +
      '<div class="seq-roster-section-title">' + (activeFilter ? activeFilter.charAt(0).toUpperCase() + activeFilter.slice(1) + ' (' + filteredEnrolled.length + ')' : 'Currently Enrolled (' + enrolled.length + ')') + '</div>' +
      '<div class="table-scroll-wrapper" style="margin-bottom:24px">' +
        '<table class="data-table">' +
          '<thead><tr><th>Name</th><th>Title</th><th>Company</th><th>Email</th><th>Status</th><th></th></tr></thead>' +
          '<tbody>' + enrolledRowsHtml + '</tbody>' +
        '</table>' +
      '</div>' +
      (activeFilter ? '' :
        '<div class="seq-roster-section-title">Suggested Contacts to Add (' + suggestions.length + ')</div>' +
        '<div class="seq-roster-hint">● Available = not in any active sequence. Sorted by availability first.</div>' +
        '<div class="table-scroll-wrapper">' +
          '<table class="data-table">' +
            '<thead><tr><th>Name</th><th>Title</th><th>Company</th><th>Email</th><th>Status</th><th></th></tr></thead>' +
            '<tbody>' + suggestRows + '</tbody>' +
          '</table>' +
        '</div>'
      );
  } catch(e) {
    panel.innerHTML = '<div style="padding:20px;color:red">Failed to load roster: ' + esc(e.message) + '</div>';
  }
}

async function enrollFromRoster(contactId, seqId, seqName) {
  try {
    const r = await apiFetch('/api/enrollments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_ids: [contactId], sequence_id: seqId }),
    });
    toast(`Added to "${seqName}"`, 'success');
    openSequenceRoster(seqId, seqName);
    loadSequences();
  } catch(e) { toast('Failed: ' + e.message, 'error'); }
}

async function unenrollFromRoster(enrollmentId, seqId, seqName) {
  try {
    await apiFetch(`/api/enrollments/${enrollmentId}`, { method: 'DELETE' });
    toast('Contact removed from sequence.', 'success');
    openSequenceRoster(seqId, seqName);
    loadSequences();
  } catch(e) { toast('Failed: ' + e.message, 'error'); }
}

let stepCount = 0;
function openSequenceModal(id = null) {
  const form = document.getElementById('sequence-form');
  form.reset();
  form.querySelector('[name="id"]').value = '';
  stepCount = 0;
  document.getElementById('steps-container').innerHTML = '';
  document.getElementById('sequence-modal-title').textContent = id ? 'Edit Sequence' : 'New Sequence';
  // Ensure auto_send checkbox exists in the form
  if (!form.querySelector('[name="auto_send"]')) {
    var asDiv = document.createElement('div');
    asDiv.className = 'form-group auto-send-form-row';
    asDiv.innerHTML = '<label class="auto-send-form-label"><input type="checkbox" name="auto_send"> <span>⚡ Auto-Send Steps 2+</span></label>' +
      '<div class="auto-send-hint">When enabled, follow-up emails (steps 2, 3, …) send automatically on schedule. Step 1 always stays manual for personalisation.</div>';
    var stepsContainer = document.getElementById('steps-container');
    stepsContainer.parentNode.insertBefore(asDiv, stepsContainer);
  }
  form.querySelector('[name="auto_send"]').checked = false;

  if (id) {
    apiFetch(`/api/sequences/${id}`).then(s => {
      form.querySelector('[name="id"]').value = s.id;
      form.querySelector('[name="name"]').value = s.name;
      form.querySelector('[name="description"]').value = s.description||'';
      form.querySelector('[name="auto_send"]').checked = !!s.auto_send;
      s.steps.forEach(st => addStep(st));
    });
  } else {
    addStep(); // start with one blank step
  }
  openModal('modal-sequence');
}

function addStep(data = null) {
  stepCount++;
  const n = stepCount;
  const container = document.getElementById('steps-container');
  const div = document.createElement('div');
  div.className = 'step-block';
  div.id = `step-block-${n}`;
  div.innerHTML = `
    <div class="step-block-header">
      <div class="step-block-title">Step ${n}</div>
      <button type="button" class="btn btn-danger btn-sm" onclick="removeStep(${n})">Remove</button>
    </div>
    <div class="step-delay-row">
      <label>Send after</label>
      <input type="number" name="step_delay_${n}" value="${data ? data.delay_days : (n===1?0:7)}" min="0">
      <label>day(s) ${n===1?'(0 = send immediately when enrolled)':''}</label>
    </div>
    <div class="step-subject form-group">
      <label>Subject Line</label>
      <input type="text" name="step_subject_${n}" value="${data ? esc(data.subject) : ''}" placeholder="e.g. Art Licensing Inquiry — {{company}}" required>
    </div>
    <div class="step-body form-group">
      <div class="step-body-tabs">
        <button type="button" class="step-tab step-tab-active" onclick="switchStepTab(${n}, 'edit', this)">Edit</button>
        <button type="button" class="step-tab" onclick="switchStepTab(${n}, 'preview', this)">Preview</button>
      </div>
      <div class="textarea-toolbar">
        <button type="button" class="btn btn-ghost btn-sm" onclick="insertLink('step-body-textarea-${n}')" title="Insert hyperlink">🔗 Link</button>
      </div>
      <textarea id="step-body-textarea-${n}" name="step_body_${n}" rows="10" placeholder="Hi {{first_name}},&#10;&#10;I'm Frank Sherfey, licensing representative for Phil Lewis..." required>${data ? esc(data.body) : ''}</textarea>
      <div id="step-body-preview-${n}" class="step-body-preview" style="display:none"></div>
    </div>
    <div class="step-art-row" id="step-art-row-${n}">
      <div class="step-art-label">
        🎨 Art Image
        <button type="button" class="btn btn-ghost btn-sm" onclick="openArtPicker(${n})">Choose Art</button>
      </div>
      <div id="step-art-preview-${n}" class="step-art-preview"></div>
    </div>
  `;
  container.appendChild(div);
  // Show initial art status
  if (typeof updateStepArtPreview === 'function') updateStepArtPreview(n);
  // Update art indicators on all steps (recalculate which is "closing")
  updateArtStepIndicators();
}

function updateArtStepIndicators() {
  const blocks = document.querySelectorAll('.step-block');
  blocks.forEach((block, i) => {
    const stepNum = parseInt(block.id.replace('step-block-',''));
    const row = document.getElementById(`step-art-row-${stepNum}`);
    if (!row) return;
    const realIdx = i + 1;
    const isLast = i === blocks.length - 1;
    const willGetArt = (realIdx % 2 === 1) || isLast;
    const label = row.querySelector('.step-art-label');
    if (label && !_stepArtOverrides[stepNum]) {
      const hint = willGetArt ? ' <span style="font-size:11px;color:var(--text-muted)">(auto-included)</span>' : ' <span style="font-size:11px;color:var(--text-muted)">(no art — even step)</span>';
      label.innerHTML = `🎨 Art Image${hint} <button type="button" class="btn btn-ghost btn-sm" onclick="openArtPicker(${stepNum})">Choose Art</button>`;
    }
  });
}

// ── ART PICKER FUNCTIONS ──────────────────────────────────────────────────

async function fetchArtImages() {
  if (_artCache) return _artCache;
  try {
    _artCache = await apiFetch('/api/art');
    return _artCache;
  } catch(e) { toast('Could not load art gallery: ' + e.message, 'error'); return []; }
}

function getArtForTags(tagsStr) {
  if (!_artCache || !_artCache.length) return null;
  const tags = (tagsStr || '').toLowerCase().split(',').map(t => t.trim()).filter(Boolean);
  for (const tag of tags) {
    const match = _artCache.find(a => a.tags && a.tags.toLowerCase().split(',').some(at => at.trim() === tag));
    if (match) return match;
  }
  const def = _artCache.find(a => a.is_default);
  return def || _artCache[0] || null;
}

function buildArtPreviewCard(artImg) {
  if (!artImg) return '';
  const imgSrc = artImg.url || '';
  const title = artImg.title || artImg.alt || 'Phil Lewis Art';
  return `
<div style="margin:24px 0;text-align:center;padding:16px;background:#fafafa;border-radius:8px">
  <div style="margin-bottom:8px;font-size:13px;color:#666;font-style:italic">Here's a look at Phil's work:</div>
  <img src="${esc(imgSrc)}" alt="${esc(title)}" style="max-width:100%;width:480px;border-radius:8px;border:1px solid #e0e0e0" />
  <div style="margin-top:8px;font-size:12px;color:#999">${esc(title)}</div>
</div>`;
}

async function openArtPicker(stepNum) {
  const arts = await fetchArtImages();
  const content = document.getElementById('art-picker-content');
  if (!content) return;
  content.innerHTML = arts.map(a => `
    <div class="art-picker-item" onclick="selectStepArt(${stepNum}, ${a.id})" style="cursor:pointer;text-align:center;padding:8px;border:2px solid transparent;border-radius:8px">
      <img src="${esc(a.url)}" alt="${esc(a.title)}" style="width:120px;height:120px;object-fit:cover;border-radius:6px" onerror="this.parentElement.innerHTML='<div style=\\'width:120px;height:120px;background:#eee;display:flex;align-items:center;justify-content:center;border-radius:6px;font-size:11px;color:#999\\'>No Preview</div><div style=\\'font-size:11px;margin-top:4px\\'>${esc(a.title)}</div>'"/>
      <div style="font-size:11px;margin-top:4px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.title)}</div>
    </div>
  `).join('');
  const noArtBtn = document.querySelector('#modal-art-picker .btn-danger');
  if (noArtBtn) noArtBtn.onclick = () => clearStepArt(stepNum);
  openModal('modal-art-picker');
}

function selectStepArt(stepNum, artId) {
  const art = _artCache ? _artCache.find(a => a.id === artId) : null;
  if (art) _stepArtOverrides[stepNum] = art;
  closeModal('modal-art-picker');
  updateStepArtPreview(stepNum);
  updateArtStepIndicators();
}

function clearStepArt(stepNum) {
  _stepArtOverrides[stepNum] = null;
  closeModal('modal-art-picker');
  updateStepArtPreview(stepNum);
  updateArtStepIndicators();
}

function updateStepArtPreview(n) {
  const el = document.getElementById(`step-art-preview-${n}`);
  if (!el) return;
  const override = _stepArtOverrides[n];
  if (override === null) {
    el.innerHTML = '<span style="color:var(--text-muted);font-size:12px">No art (manually removed)</span>';
  } else if (override) {
    el.innerHTML = `<img src="${esc(override.url)}" alt="${esc(override.title)}" style="width:80px;height:80px;object-fit:cover;border-radius:6px"/> <span style="font-size:12px">${esc(override.title)}</span>`;
  } else {
    el.innerHTML = '<span style="color:var(--text-muted);font-size:12px">Auto (based on company tags)</span>';
  }
}

// ── QUEUE DETAIL ART PICKER ──────────────────────────────────────────────

async function openQueueArtPicker(enrollmentId) {
  const arts = await fetchArtImages();
  const content = document.getElementById('art-picker-content');
  if (!content) return;
  const currentId = _queueArtOverride && _queueArtOverride !== 'none' ? _queueArtOverride.id : null;
  content.innerHTML = arts.map(a => `
    <div class="art-picker-item" onclick="selectQueueArt(${a.id})" style="cursor:pointer;text-align:center;padding:8px;border:2px solid ${a.id === currentId ? 'var(--primary)' : 'transparent'};border-radius:8px">
      <img src="${esc(a.url)}" alt="${esc(a.title)}" style="width:120px;height:120px;object-fit:cover;border-radius:6px" onerror="this.style.display='none';this.insertAdjacentHTML('afterend','<div style=\\'width:120px;height:120px;background:#eee;display:flex;align-items:center;justify-content:center;border-radius:6px;font-size:11px;color:#999\\'>No Preview</div>')"/>
      <div style="font-size:11px;margin-top:4px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.title)}${a.tags ? ' <span style="font-size:10px;color:#999">(' + esc(a.tags.split(",")[0]) + ')</span>' : ''}</div>
    </div>
  `).join('');
  const noArtBtn = document.querySelector('#modal-art-picker .btn-danger');
  if (noArtBtn) noArtBtn.onclick = () => { _queueArtOverride = 'none'; closeModal('modal-art-picker'); updateQueueArtPreview(); };
  openModal('modal-art-picker');
}

function selectQueueArt(artId) {
  const art = _artCache ? _artCache.find(a => a.id === artId) : null;
  if (art) _queueArtOverride = art;
  closeModal('modal-art-picker');
  updateQueueArtPreview();
}

function updateQueueArtPreview() {
  const el = document.getElementById('queue-art-preview');
  if (!el) return;
  if (_queueArtOverride === 'none') {
    el.innerHTML = '<span style="color:var(--text-muted)">No art will be included</span>';
  } else if (_queueArtOverride) {
    el.innerHTML = `<img src="${esc(_queueArtOverride.url)}" alt="${esc(_queueArtOverride.title)}" style="width:80px;height:80px;object-fit:cover;border-radius:6px"/> <span style="font-size:12px">${esc(_queueArtOverride.title)}</span>`;
  } else {
    el.innerHTML = '<span style="color:var(--text-muted)">Auto-selected based on company tags</span>';
  }
}

function removeStep(n) {
  const el = document.getElementById(`step-block-${n}`);
  if (el) el.remove();
}

async function switchStepTab(n, tab, btn) {
  const textarea = document.getElementById(`step-body-textarea-${n}`);
  const preview  = document.getElementById(`step-body-preview-${n}`);
  const tabs     = btn.closest('.step-body-tabs').querySelectorAll('.step-tab');
  tabs.forEach(t => t.classList.remove('step-tab-active'));
  btn.classList.add('step-tab-active');
  if (tab === 'preview') {
    let html = renderEmailBody(textarea.value, true);
    const block = btn.closest('.step-block');
    const stepNum = block ? parseInt(block.id.replace('step-block-','')) : n;
    const allBlocks = document.querySelectorAll('.step-block');
    const isFirstStep = block === allBlocks[0];
    // Check for art override first, then auto-match
    if (_stepArtOverrides[stepNum] === null) {
      // Explicitly no art
    } else if (_stepArtOverrides[stepNum]) {
      html += buildArtPreviewCard(_stepArtOverrides[stepNum]);
    } else if (isFirstStep) {
      await fetchArtImages();
      const descField = document.querySelector('#sequence-form [name="description"]');
      const desc = descField ? descField.value : '';
      const tagMatch = desc.match(/tags?:\s*([^\n]+)/i);
      const tagsStr = tagMatch ? tagMatch[1] : desc;
      const artImg = getArtForTags(tagsStr);
      if (artImg) html += buildArtPreviewCard(artImg);
    }
    preview.innerHTML = html;
    textarea.style.display = 'none';
    preview.style.display  = 'block';
  } else {
    textarea.style.display = 'block';
    preview.style.display  = 'none';
  }
}

async function saveSequence(e) {
  e.preventDefault();
  const form = e.target;
  const id = form.querySelector('[name="id"]').value;
  const name = form.querySelector('[name="name"]').value;
  const description = form.querySelector('[name="description"]').value;
  const auto_send = form.querySelector('[name="auto_send"]') ? form.querySelector('[name="auto_send"]').checked : false;

  // Collect steps from DOM
  const steps = [];
  document.querySelectorAll('.step-block').forEach((block, i) => {
    const n = block.id.replace('step-block-','');
    const delay = parseInt(form.querySelector(`[name="step_delay_${n}"]`)?.value) || 0;
    const subject = form.querySelector(`[name="step_subject_${n}"]`)?.value || '';
    const body = form.querySelector(`[name="step_body_${n}"]`)?.value || '';
    if (subject || body) steps.push({ step_number: i+1, delay_days: delay, subject, body });
  });

  if (!steps.length) { toast('Add at least one email step', 'error'); return; }

  try {
    if (id) {
      await apiFetch(`/api/sequences/${id}`, { method: 'PUT', body: JSON.stringify({ name, description, steps, auto_send }) });
      toast('Sequence updated');
    } else {
      await apiFetch('/api/sequences', { method: 'POST', body: JSON.stringify({ name, description, steps, auto_send }) });
      toast('Sequence created', 'success');
    }
    closeModal('modal-sequence');
    loadSequences();
  } catch(err) { toast(err.message, 'error'); }
}

async function toggleAutoSend(seqId, enabled) {
  try {
    await apiFetch('/api/sequences/' + seqId + '/auto-send', {
      method: 'PATCH',
      body: JSON.stringify({ auto_send: enabled })
    });
    toast(enabled ? 'Auto-send enabled — steps 2+ will send automatically' : 'Auto-send disabled — all steps manual', enabled ? 'success' : 'info');
    loadSequences();
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteSequence(id) {
  if (!confirm('Delete this sequence? This will also stop all active enrollments.')) return;
  try {
    await apiFetch(`/api/sequences/${id}`, { method: 'DELETE' });
    toast('Sequence deleted');
    loadSequences();
  } catch(e) { toast(e.message, 'error'); }
}

// ── ENROLL ────────────────────────────────────────────────────────────────

// Inline dropdown on the company detail modal
async function toggleEnrollDropdown(companyId, btnEl) {
  const existing = document.getElementById('enroll-inline-dropdown');
  if (existing) { existing.remove(); return; }

  btnEl.disabled = true;
  const origText = btnEl.textContent;
  btnEl.textContent = 'Loading…';

  try {
    const sequences = await apiFetch('/api/sequences');
    btnEl.textContent = origText;
    btnEl.disabled = false;

    if (!sequences.length) { toast('Create a sequence first', 'error'); return; }

    const dd = document.createElement('div');
    dd.id = 'enroll-inline-dropdown';
    dd.className = 'enroll-inline-dropdown';
    dd.innerHTML = sequences.map(s => `
      <button class="enroll-dropdown-item" onclick="quickEnrollCompany(${companyId}, ${s.id}, '${esc(s.name)}')">
        <span class="enroll-dropdown-name">${esc(s.name)}</span>
        ${s.description ? `<span class="enroll-dropdown-desc">${esc(s.description)}</span>` : ''}
      </button>
    `).join('');

    btnEl.parentNode.appendChild(dd);

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function closeDD(e) {
        if (!dd.contains(e.target) && e.target !== btnEl) {
          dd.remove();
          document.removeEventListener('click', closeDD);
        }
      });
    }, 0);

  } catch(e) {
    btnEl.textContent = origText;
    btnEl.disabled = false;
    toast(e.message, 'error');
  }
}

async function quickEnrollCompany(companyId, sequenceId, sequenceName) {
  const dd = document.getElementById('enroll-inline-dropdown');
  if (dd) dd.remove();
  try {
    const contacts = await apiFetch(`/api/contacts?company_id=${companyId}`);
    const eligible = contacts.filter(c => c.email).map(c => c.id);
    if (!eligible.length) { toast('No contacts with email addresses', 'error'); return; }
    const r = await apiFetch('/api/enrollments', { method: 'POST', body: JSON.stringify({ contact_ids: eligible, sequence_id: sequenceId }) });
    toast(`${r.enrolled} contact${r.enrolled !== 1 ? 's' : ''} enrolled in "${sequenceName}"`, 'success');
    loadQueue();
    updateBadge('badge-queue', null);
    loadDashboard();
  } catch(e) { toast(e.message, 'error'); }
}

let enrollTargetCompanyId = null;
let enrollTargetSequenceId = null;

async function openEnrollModal(companyId = null) {
  enrollTargetCompanyId = companyId;
  enrollTargetSequenceId = null;
  await _prepareEnrollModal(companyId, null);
}

async function openEnrollModalForSeq(sequenceId) {
  enrollTargetCompanyId = null;
  enrollTargetSequenceId = sequenceId;
  await _prepareEnrollModal(null, sequenceId);
}

var _allEnrollContacts = []; // full list for search
var _enrollChecked = new Set(); // track checked IDs across filter changes

async function _prepareEnrollModal(companyId, sequenceId) {
  try {
    // Always load all contacts so search works across companies
    const [sequences, allContacts, companyContacts] = await Promise.all([
      apiFetch('/api/sequences'),
      apiFetch('/api/contacts'),
      companyId ? apiFetch('/api/contacts?company_id=' + companyId) : Promise.resolve([]),
    ]);

    if (!sequences.length) {
      toast('Create a sequence first', 'error');
      return;
    }

    const seqSel = document.getElementById('enroll-sequence-select');
    seqSel.innerHTML = sequences.map(s => `<option value="${s.id}" ${s.id == sequenceId ? 'selected' : ''} data-desc="${esc(s.description||'')}">${esc(s.name)}</option>`).join('');

    // Show campaign description on change
    const descEl = document.getElementById('enroll-campaign-desc');
    const updateDesc = () => {
      const opt = seqSel.options[seqSel.selectedIndex];
      if (descEl) descEl.textContent = opt ? opt.dataset.desc : '';
    };
    seqSel.onchange = updateDesc;
    updateDesc();

    _allEnrollContacts = allContacts;
    // Pre-check company contacts that have email
    _enrollChecked = new Set();
    if (companyId && companyContacts.length) {
      companyContacts.forEach(function(c) { if (c.email) _enrollChecked.add(c.id); });
    }

    // Clear search and render
    var searchEl = document.getElementById('enroll-search');
    if (searchEl) searchEl.value = '';

    // Show company contacts first, or all if no company
    var initialList = companyId ? companyContacts : allContacts;
    currentEnrollContacts = initialList;
    renderEnrollContacts(initialList);
    openModal('modal-enroll');
  } catch(e) { toast(e.message, 'error'); }
}

function renderEnrollContacts(contacts) {
  var listEl = document.getElementById('enroll-contacts-list');
  if (!contacts.length) {
    listEl.innerHTML = '<div class="empty-state" style="padding:16px">No contacts match your search.</div>';
    return;
  }
  listEl.innerHTML = contacts.map(function(c) {
    var isChecked = _enrollChecked.has(c.id);
    return '<div class="enroll-contact-row">' +
      '<input type="checkbox" id="enroll-c-' + c.id + '" value="' + c.id + '"' +
        (isChecked ? ' checked' : '') +
        (!c.email ? ' disabled' : '') +
        ' onchange="toggleEnrollCheck(' + c.id + ',this.checked)">' +
      '<label for="enroll-c-' + c.id + '">' +
        '<div class="enroll-contact-name">' + esc(c.first_name) + ' ' + esc(c.last_name || '') +
          (c.company_name ? ' \u2014 ' + esc(c.company_name) : '') + '</div>' +
        '<div class="enroll-contact-email">' + (c.email ? esc(c.email) : '\u26A0 No email address') +
          (c.company_tags ? ' <span class="enroll-tags">' + c.company_tags.split(',').map(function(t) { return esc(t.trim()); }).join(', ') + '</span>' : '') +
        '</div>' +
      '</label>' +
    '</div>';
  }).join('');
}

function toggleEnrollCheck(contactId, checked) {
  if (checked) _enrollChecked.add(contactId);
  else _enrollChecked.delete(contactId);
}

function filterEnrollContacts() {
  var query = (document.getElementById('enroll-search').value || '').toLowerCase().trim();
  if (!query) {
    // Show company contacts if we opened from company, else all
    renderEnrollContacts(currentEnrollContacts.length ? currentEnrollContacts : _allEnrollContacts);
    return;
  }
  var filtered = _allEnrollContacts.filter(function(c) {
    var searchable = ((c.first_name || '') + ' ' + (c.last_name || '') + ' ' + (c.company_name || '') + ' ' + (c.email || '') + ' ' + (c.company_tags || '') + ' ' + (c.company_category || '')).toLowerCase();
    return searchable.indexOf(query) !== -1;
  });
  renderEnrollContacts(filtered);
}

async function confirmEnroll() {
  const seqId = document.getElementById('enroll-sequence-select').value;
  // Merge any currently visible checkboxes into the tracked set
  document.querySelectorAll('#enroll-contacts-list input[type=checkbox]').forEach(function(el) {
    if (el.checked) _enrollChecked.add(parseInt(el.value));
    else _enrollChecked.delete(parseInt(el.value));
  });
  var checked = Array.from(_enrollChecked);
  if (!checked.length) { toast('Select at least one contact', 'error'); return; }

  // Filter out contacts without email — they can't receive sequence emails
  var withEmail = checked.filter(function(cid) {
    var c = _allEnrollContacts.find(function(ct) { return ct.id === cid; });
    return c && c.email;
  });
  var skipped = checked.length - withEmail.length;
  if (skipped > 0) {
    toast(skipped + ' contact' + (skipped !== 1 ? 's' : '') + ' skipped — no email address', 'error');
  }
  if (!withEmail.length) { toast('None of the selected contacts have email addresses', 'error'); return; }

  try {
    const r = await apiFetch('/api/enrollments', { method: 'POST', body: JSON.stringify({ contact_ids: withEmail, sequence_id: seqId }) });
    toast(`${r.enrolled} contact${r.enrolled!==1?'s':''} enrolled` + (skipped > 0 ? ` (${skipped} skipped — no email)` : ''), 'success');
    closeModal('modal-enroll');
    closeModal('modal-company-detail');
    loadQueue();
    updateBadge('badge-queue', null); // will refresh
    loadDashboard();
  } catch(e) { toast(e.message, 'error'); }
}

