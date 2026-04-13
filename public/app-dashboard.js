// ── PHIL LEWIS ART CRM — Dashboard ──────────────────────────────────────────

// ── DASHBOARD ─────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    var [d, stuckData, inboxData, priorities, weekly] = await Promise.all([
      apiFetch('/api/dashboard'),
      apiFetch('/api/pipeline/stuck-count').catch(function() { return { count: 0 }; }),
      apiFetch('/api/inbox?limit=0').catch(function() { return { unreadCount: 0 }; }),
      apiFetch('/api/dashboard/priorities').catch(function() { return { unreplied:[], firstTouches:[], manualFollowUps:[], goingCold:[], overdue:[], autoSendPending:0, recentAutoSent:[] }; }),
      apiFetch('/api/dashboard/weekly-summary').catch(function() { return { emailsSent:0, repliesReceived:0, replyRate:0, newCompanies:0, completedSequences:0, repliedSequences:0, positiveReplies:[] }; }),
    ]);
    updateBadge('badge-inbox', inboxData.unreadCount || 0);
    updateBadge('badge-queue', d.queueCount);
    var stuckCount = stuckData.count || 0;
    var p = priorities;
    var replies = (d.recentActivity || []).sort(function(a, b) { return new Date(b.sent_at) - new Date(a.sent_at); });

    // ── TILE 1: REPLIES ─────────────────────────────────────────────────
    var replyCount = replies.length;
    var unreadCount = replies.filter(function(r) { return !r.notes || r.notes !== 'read'; }).length;
    var replyBadgeClass = unreadCount > 0 ? 'dt-badge dt-badge-urgent' : 'dt-badge';
    var replyItems = replies.slice(0, 3).map(function(a) {
      var isNew = !a.notes || a.notes !== 'read';
      var rawSnippet = cleanReplyBody(a.body || '');
      var snippet = rawSnippet.length > 80 ? rawSnippet.substring(0, 80) + '…' : rawSnippet;
      var sentimentLabels = { positive: '✓', neutral: '⏳', negative: '✗' };
      var sentimentHtml = a.sentiment ? '<span class="dt-sentiment dt-sentiment-' + a.sentiment + '">' + sentimentLabels[a.sentiment] + '</span>' : '';
      return '<div class="dt-preview-item' + (isNew ? ' dt-preview-unread' : '') + '" onclick="openContactDetail(' + a.contact_id + ')">' +
        '<div class="dt-preview-row">' +
          '<span class="dt-preview-name">' + sentimentHtml + esc(a.first_name) + ' ' + esc(a.last_name || '') + '</span>' +
          '<span class="dt-preview-co">' + esc(a.company_name || '') + '</span>' +
          '<span class="dt-preview-date">' + fmtDate(a.sent_at) + '</span>' +
        '</div>' +
        (snippet ? '<div class="dt-preview-snippet">"' + esc(snippet) + '"</div>' : '') +
      '</div>';
    }).join('');

    // ── TILE 2: QUEUE / OUTREACH ────────────────────────────────────────
    var firstTouchCount = p.firstTouches.length;
    var followUpCount = p.manualFollowUps.length;
    var autoCount = p.autoSendPending;
    var queueTotal = d.queueCount;
    var queueItems = p.firstTouches.slice(0, 2).map(function(q) {
      return '<div class="dt-preview-item" onclick="showPage(\'queue\')">' +
        '<div class="dt-preview-row">' +
          '<span class="dt-preview-name">✋ ' + esc(q.first_name) + ' ' + esc(q.last_name || '') + '</span>' +
          '<span class="dt-preview-co">' + esc(q.company_name || '') + '</span>' +
        '</div>' +
        '<div class="dt-preview-snippet">Step 1 — "' + esc((q.step_subject || '').slice(0, 50)) + '"</div>' +
      '</div>';
    }).join('');
    if (followUpCount > 0) {
      queueItems += '<div class="dt-preview-item" onclick="showPage(\'queue\')">' +
        '<div class="dt-preview-row"><span class="dt-preview-name">📧 ' + followUpCount + ' manual follow-up' + (followUpCount !== 1 ? 's' : '') + ' ready</span></div></div>';
    }
    if (autoCount > 0) {
      queueItems += '<div class="dt-preview-item" onclick="showPage(\'queue\')">' +
        '<div class="dt-preview-row"><span class="dt-preview-name">⚡ ' + autoCount + ' queued for auto-send</span></div></div>';
    }

    // ── TILE 3: PIPELINE HEALTH ─────────────────────────────────────────
    var pipelineAlerts = p.overdue.length + p.goingCold.length + stuckCount;
    var pipelineBadgeClass = pipelineAlerts > 0 ? 'dt-badge dt-badge-warn' : 'dt-badge dt-badge-ok';
    var pipelineItems = '';
    if (p.overdue.length > 0) {
      pipelineItems += p.overdue.slice(0, 2).map(function(o) {
        return '<div class="dt-preview-item" onclick="openCompanyDetail(' + o.id + ')">' +
          '<div class="dt-preview-row">' +
            '<span class="dt-preview-name">⏰ ' + esc(o.name) + '</span>' +
            '<span class="dt-preview-date">due ' + fmtDate(o.next_step_date) + '</span>' +
          '</div>' +
          '<div class="dt-preview-snippet">' + esc(o.next_step || '') + '</div>' +
        '</div>';
      }).join('');
    }
    if (p.goingCold.length > 0) {
      pipelineItems += p.goingCold.slice(0, 2).map(function(c) {
        var daysAgo = Math.round((Date.now() - new Date(c.last_activity_at).getTime()) / 86400000);
        return '<div class="dt-preview-item" onclick="openCompanyDetail(' + c.id + ')">' +
          '<div class="dt-preview-row">' +
            '<span class="dt-preview-name">🧊 ' + esc(c.name) + '</span>' +
            '<span class="dt-preview-date">' + daysAgo + 'd silent</span>' +
          '</div>' +
        '</div>';
      }).join('');
    }
    if (stuckCount > 0 && p.overdue.length === 0 && p.goingCold.length === 0) {
      pipelineItems += '<div class="dt-preview-item" onclick="showPage(\'pipeline\')">' +
        '<div class="dt-preview-row"><span class="dt-preview-name" style="color:var(--danger)">' + stuckCount + ' stuck contact' + (stuckCount !== 1 ? 's' : '') + ' — no activity in 2+ weeks</span></div></div>';
    }
    if (!pipelineItems) {
      pipelineItems = '<div class="dt-preview-empty">All clear — no overdue or cold contacts</div>';
    }

    // ── RENDER TILES ────────────────────────────────────────────────────
    var tilesEl = document.getElementById('dash-tiles');
    tilesEl.innerHTML =
      '<div class="dt-grid">' +
        // Replies tile
        '<div class="dt-tile dt-tile-replies" onclick="showPage(\'inbox\')">' +
          '<div class="dt-tile-header">' +
            '<div class="dt-tile-icon">💬</div>' +
            '<div class="dt-tile-title">Replies</div>' +
            '<div class="' + replyBadgeClass + '">' + unreadCount + ' unread</div>' +
          '</div>' +
          (replyItems || '<div class="dt-preview-empty">No replies yet</div>') +
          (replyCount > 3 ? '<div class="dt-tile-more">View all ' + replyCount + ' →</div>' : '') +
        '</div>' +
        // Queue tile
        '<div class="dt-tile dt-tile-queue" onclick="showPage(\'queue\')">' +
          '<div class="dt-tile-header">' +
            '<div class="dt-tile-icon">📤</div>' +
            '<div class="dt-tile-title">Outreach Queue</div>' +
            '<div class="dt-badge">' + queueTotal + ' ready</div>' +
          '</div>' +
          (queueItems || '<div class="dt-preview-empty">Queue is clear — all caught up</div>') +
          (firstTouchCount > 2 ? '<div class="dt-tile-more">View all ' + queueTotal + ' →</div>' : '') +
        '</div>' +
        // Pipeline tile
        '<div class="dt-tile dt-tile-pipeline" onclick="showPage(\'pipeline\')">' +
          '<div class="dt-tile-header">' +
            '<div class="dt-tile-icon">🔬</div>' +
            '<div class="dt-tile-title">Pipeline Health</div>' +
            '<div class="' + pipelineBadgeClass + '">' + (pipelineAlerts > 0 ? pipelineAlerts + ' alert' + (pipelineAlerts !== 1 ? 's' : '') : 'Healthy') + '</div>' +
          '</div>' +
          pipelineItems +
          (p.overdue.length + p.goingCold.length > 4 ? '<div class="dt-tile-more">View pipeline →</div>' : '') +
        '</div>' +
      '</div>';

    // ── MINI STATS STRIP ────────────────────────────────────────────────
    var miniEl = document.getElementById('dash-mini-stats');
    miniEl.innerHTML =
      '<div class="dm-strip">' +
        '<div class="dm-stat" onclick="showPage(\'prospects\')"><span class="dm-val">' + d.totalCompanies + '</span> <span class="dm-label">Companies</span></div>' +
        '<div class="dm-stat" onclick="showPage(\'pipeline\')"><span class="dm-val">' + d.totalContacts + '</span> <span class="dm-label">Contacts</span></div>' +
        '<div class="dm-stat" onclick="showPage(\'sequences\')"><span class="dm-val">' + d.activeEnrollments + '</span> <span class="dm-label">Active Sequences</span></div>' +
        '<div class="dm-stat" onclick="showPage(\'activity\')"><span class="dm-val">' + d.emailsSent + '</span> <span class="dm-label">Total Sent</span></div>' +
        '<div class="dm-sep"></div>' +
        '<div class="dm-stat"><span class="dm-val">' + weekly.emailsSent + '</span> <span class="dm-label">Sent This Week</span></div>' +
        '<div class="dm-stat" onclick="showPage(\'inbox\')"><span class="dm-val" style="color:var(--success,#22c55e)">' + weekly.repliesReceived + '</span> <span class="dm-label">Replies This Week</span></div>' +
        '<div class="dm-stat"><span class="dm-val">' + weekly.replyRate + '%</span> <span class="dm-label">Reply Rate</span></div>' +
      '</div>';

  } catch(e) { toast(e.message, 'error'); }
}

async function loadPriorities() {
  var panel = document.getElementById('priorities-panel');
  if (!panel) return;
  try {
    var p = await apiFetch('/api/dashboard/priorities');
    var hasAnything = p.unreplied.length || p.firstTouches.length || p.manualFollowUps.length || p.goingCold.length || p.overdue.length;
    if (!hasAnything && !p.autoSendPending && !p.recentAutoSent.length) {
      panel.innerHTML = '<div class="pri-panel"><div class="pri-header">✨ Today\'s Priorities</div><div class="pri-empty">All clear! No urgent items today.</div></div>';
      return;
    }

    var html = '<div class="pri-panel"><div class="pri-header">📋 Today\'s Priorities</div>';

    // Unreplied replies — highest priority
    if (p.unreplied.length) {
      html += '<div class="pri-section pri-urgent">';
      html += '<div class="pri-section-title pri-title-link" onclick="showPage(\'inbox\')">💬 Reply to These (' + p.unreplied.length + ') →</div>';
      html += p.unreplied.map(function(r) {
        var sentimentLabels = { positive: '✓ Interested', neutral: '⏳ Maybe Later', negative: '✗ Not Interested' };
        var sentiment = r.sentiment ? ' <span class="pri-sentiment pri-sentiment-' + r.sentiment + '">' + (sentimentLabels[r.sentiment] || r.sentiment) + '</span>' : '';
        return '<div class="pri-item pri-item-clickable" onclick="openContactDetail(' + r.contact_id + ')">' +
          '<div class="pri-item-name">' + esc(r.first_name) + ' ' + esc(r.last_name || '') + sentiment + '</div>' +
          '<div class="pri-item-sub">' + esc(r.company_name || '') + ' · ' + fmtDate(r.sent_at) + '</div>' +
        '</div>';
      }).join('');
      html += '</div>';
    }

    // First-touch emails (step 1) — need manual review
    if (p.firstTouches.length) {
      html += '<div class="pri-section">';
      html += '<div class="pri-section-title pri-title-link" onclick="showPage(\'queue\')">✋ First Touches to Review (' + p.firstTouches.length + ') →</div>';
      html += p.firstTouches.slice(0, 8).map(function(q) {
        return '<div class="pri-item pri-item-clickable" onclick="showPage(\'queue\')">' +
          '<div class="pri-item-name">' + esc(q.first_name) + ' ' + esc(q.last_name || '') + '</div>' +
          '<div class="pri-item-sub">' + esc(q.company_name || '') + ' · "' + esc((q.step_subject || '').slice(0, 50)) + '"</div>' +
        '</div>';
      }).join('');
      if (p.firstTouches.length > 8) html += '<div class="pri-more" onclick="showPage(\'queue\')">+ ' + (p.firstTouches.length - 8) + ' more in queue →</div>';
      html += '</div>';
    }

    // Manual follow-ups (non-auto-send sequences, step 2+)
    if (p.manualFollowUps.length) {
      html += '<div class="pri-section">';
      html += '<div class="pri-section-title pri-title-link" onclick="showPage(\'queue\')">📧 Follow-Ups to Send (' + p.manualFollowUps.length + ') →</div>';
      html += p.manualFollowUps.slice(0, 5).map(function(q) {
        return '<div class="pri-item pri-item-clickable" onclick="showPage(\'queue\')">' +
          '<div class="pri-item-name">' + esc(q.first_name) + ' ' + esc(q.last_name || '') + ' — Step ' + q.current_step + '</div>' +
          '<div class="pri-item-sub">' + esc(q.company_name || '') + '</div>' +
        '</div>';
      }).join('');
      if (p.manualFollowUps.length > 5) html += '<div class="pri-more" onclick="showPage(\'queue\')">+ ' + (p.manualFollowUps.length - 5) + ' more in queue →</div>';
      html += '</div>';
    }

    // Auto-send summary
    if (p.autoSendPending > 0 || p.recentAutoSent.length > 0) {
      html += '<div class="pri-section pri-auto">';
      html += '<div class="pri-section-title pri-title-link" onclick="showPage(\'queue\')">⚡ Auto-Send Activity →</div>';
      if (p.autoSendPending > 0) html += '<div class="pri-item pri-item-clickable" onclick="showPage(\'queue\')"><div class="pri-item-sub">' + p.autoSendPending + ' follow-up' + (p.autoSendPending !== 1 ? 's' : '') + ' queued for auto-send →</div></div>';
      if (p.recentAutoSent.length > 0) {
        html += '<div class="pri-item pri-item-clickable" onclick="showPage(\'activity\')"><div class="pri-item-sub">' + p.recentAutoSent.length + ' email' + (p.recentAutoSent.length !== 1 ? 's' : '') + ' auto-sent in the last 24h →</div></div>';
        p.recentAutoSent.slice(0, 3).forEach(function(a) {
          html += '<div class="pri-item" style="padding-left:12px"><div class="pri-item-sub">→ ' + esc(a.first_name) + ' ' + esc(a.last_name || '') + ' · ' + esc(a.company_name || '') + '</div></div>';
        });
        if (p.recentAutoSent.length > 3) html += '<div class="pri-more" onclick="showPage(\'activity\')">+ ' + (p.recentAutoSent.length - 3) + ' more →</div>';
      }
      html += '</div>';
    }

    // Overdue next-steps
    if (p.overdue.length) {
      html += '<div class="pri-section pri-warn">';
      html += '<div class="pri-section-title pri-title-link" onclick="showPage(\'pipeline\')">⏰ Overdue Actions (' + p.overdue.length + ') →</div>';
      html += p.overdue.map(function(o) {
        return '<div class="pri-item pri-item-clickable" onclick="openCompanyDetail(' + o.id + ')">' +
          '<div class="pri-item-name">' + esc(o.name) + '</div>' +
          '<div class="pri-item-sub">' + esc(o.next_step || '') + ' · due ' + fmtDate(o.next_step_date) + '</div>' +
        '</div>';
      }).join('');
      html += '</div>';
    }

    // Going cold
    if (p.goingCold.length) {
      html += '<div class="pri-section">';
      html += '<div class="pri-section-title pri-title-link" onclick="showPage(\'prospects\')">🧊 Going Cold (' + p.goingCold.length + ') →</div>';
      html += p.goingCold.slice(0, 5).map(function(c) {
        var daysAgo = Math.round((Date.now() - new Date(c.last_activity_at).getTime()) / 86400000);
        return '<div class="pri-item pri-item-clickable" onclick="openCompanyDetail(' + c.id + ')">' +
          '<div class="pri-item-name">' + esc(c.name) + '</div>' +
          '<div class="pri-item-sub">Last activity ' + daysAgo + ' days ago' + (c.active_enrollments > 0 ? ' · ' + c.active_enrollments + ' active enrollment' + (c.active_enrollments !== 1 ? 's' : '') : '') + '</div>' +
        '</div>';
      }).join('');
      html += '</div>';
    }

    html += '</div>';
    panel.innerHTML = html;
  } catch(e) {
    panel.innerHTML = '';
    console.error('Priorities load error:', e);
  }
}

async function loadWeeklySummary() {
  var panel = document.getElementById('weekly-summary-panel');
  if (!panel) return;
  try {
    var w = await apiFetch('/api/dashboard/weekly-summary');
    var html = '<div class="ws-panel">';
    html += '<div class="ws-header">📊 Last 7 Days</div>';
    html += '<div class="ws-grid">';
    html += '<div class="ws-stat ws-stat-link" onclick="showPage(\'activity\')"><div class="ws-stat-val">' + w.emailsSent + '</div><div class="ws-stat-label">Sent</div></div>';
    html += '<div class="ws-stat ws-stat-link" onclick="showPage(\'inbox\')"><div class="ws-stat-val" style="color:var(--success,#22c55e)">' + w.repliesReceived + '</div><div class="ws-stat-label">Replies</div></div>';
    html += '<div class="ws-stat ws-stat-link" onclick="showPage(\'sequences\')"><div class="ws-stat-val">' + w.replyRate + '%</div><div class="ws-stat-label">Reply Rate</div></div>';
    html += '<div class="ws-stat ws-stat-link" onclick="showPage(\'prospects\')"><div class="ws-stat-val">' + w.newCompanies + '</div><div class="ws-stat-label">New Prospects</div></div>';
    html += '<div class="ws-stat ws-stat-link" onclick="showPage(\'sequences\')"><div class="ws-stat-val">' + w.completedSequences + '</div><div class="ws-stat-label">Sequences Done</div></div>';
    html += '<div class="ws-stat ws-stat-link" onclick="showPage(\'inbox\')"><div class="ws-stat-val" style="color:var(--success,#22c55e)">' + w.repliedSequences + '</div><div class="ws-stat-label">Got Replies</div></div>';
    html += '</div>';

    if (w.positiveReplies && w.positiveReplies.length > 0) {
      html += '<div class="ws-positive">';
      html += '<div class="ws-positive-title">Interested Replies</div>';
      w.positiveReplies.forEach(function(r) {
        html += '<div class="ws-positive-item' + (r.company_id ? ' pri-item-clickable' : '') + '"' +
          (r.company_id ? ' onclick="openCompanyDetail(' + r.company_id + ')"' : '') + '>' +
          esc(r.first_name || '') + ' ' + esc(r.last_name || '') +
          (r.company_name ? ' <span style="color:var(--text-muted)">(' + esc(r.company_name) + ')</span>' : '') +
          '</div>';
      });
      html += '</div>';
    }

    html += '</div>';
    panel.innerHTML = html;
  } catch(e) {
    panel.innerHTML = '';
    console.error('Weekly summary error:', e);
  }
}

/* ── Prospect Reply action handlers ── */
function toggleActivityMenu(btn) {
  var menu = btn.nextElementSibling;
  // Close any other open menus first
  document.querySelectorAll('.activity-menu.open').forEach(function(m) {
    if (m !== menu) m.classList.remove('open');
  });
  menu.classList.toggle('open');
}

// Close menus when clicking outside (activity menus + ms-dropdown menus)
document.addEventListener('click', function() {
  document.querySelectorAll('.activity-menu.open, .ms-dropdown-menu.open').forEach(function(m) { m.classList.remove('open'); });
});

async function archiveReply(activityId) {
  try {
    await fetch('/api/activities/' + activityId + '/archive', { method: 'PATCH' });
    toast('Reply archived');
    loadDashboard();
  } catch(e) { toast(e.message, 'error'); }
}

async function toggleReadReply(activityId) {
  try {
    var res = await fetch('/api/activities/' + activityId + '/toggle-read', { method: 'PATCH' });
    var data = await res.json();
    toast(data.notes === 'read' ? 'Marked as read' : 'Marked as unread');
    loadDashboard();
  } catch(e) { toast(e.message, 'error'); }
}

async function removeFromSequence(enrollmentId, activityId) {
  if (!confirm('Remove this contact from their active sequence?')) return;
  try {
    await fetch('/api/enrollments/' + enrollmentId, { method: 'DELETE' });
    toast('Removed from sequence');
    loadDashboard();
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteReply(activityId) {
  if (!confirm('Permanently delete this reply? This cannot be undone.')) return;
  try {
    await fetch('/api/activities/' + activityId, { method: 'DELETE' });
    toast('Reply deleted');
    loadDashboard();
  } catch(e) { toast(e.message, 'error'); }
}

function updateBadge(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = count > 0 ? count : '';
  el.style.display = count > 0 ? '' : 'none';
}

// ── CONTACT DETAIL MODAL ──────────────────────────────────────────────────
async function openContactDetail(contactId) {
  try {
    const [contact, activities, enrollments] = await Promise.all([
      apiFetch(`/api/contacts/${contactId}`),
      apiFetch(`/api/activities?contact_id=${contactId}`),
      apiFetch(`/api/contacts/${contactId}/enrollments`),
    ]);

    // Fetch company detail for context
    let company = null;
    if (contact.company_id) {
      try { company = await apiFetch(`/api/companies/${contact.company_id}`); } catch(e) {}
    }

    const replies = activities.filter(a => a.type === 'received_email');
    const sent = activities.filter(a => a.type === 'email');
    const latestReply = replies[0]; // already sorted newest-first

    // Find the latest inbound activity ID for Quick Reply
    const latestInboundId = latestReply ? latestReply.id : null;

    document.getElementById('contact-detail-title').textContent =
      `${contact.first_name} ${contact.last_name || ''}`.trim();

    // ── Build the redesigned modal content ──
    let html = '';

    // Top bar: name, title, company, email — compact row
    html += `<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:4px">`;
    if (contact.title) html += `<span style="font-size:13px;color:var(--text-muted)">${esc(contact.title)}</span>`;
    if (contact.company_name) {
      html += `<span style="font-size:13px">at <strong>${contact.company_id
        ? `<a href="#" onclick="event.preventDefault();closeModal('modal-contact-detail');openCompanyDetail(${contact.company_id})">${esc(contact.company_name)}</a>`
        : esc(contact.company_name)}</strong></span>`;
    }
    if (contact.email) html += `<span style="font-size:12px;color:var(--text-muted)">· <a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a></span>`;
    html += `</div>`;

    // Company intel bar (if we have company data)
    if (company) {
      const chips = [];
      if (company.pipeline_stage) chips.push(`<span class="cd-chip cd-chip-stage">${esc(company.pipeline_stage)}</span>`);
      if (company.opportunity_value && parseFloat(company.opportunity_value) > 0) chips.push(`<span class="cd-chip cd-chip-opp">$${parseFloat(company.opportunity_value).toLocaleString(undefined,{maximumFractionDigits:0})}</span>`);
      if (company.tags) company.tags.split(',').forEach(t => { if(t.trim()) chips.push(`<span class="cd-chip">${esc(t.trim())}</span>`); });
      if (company.status) chips.push(`<span class="cd-chip">${esc(company.status)}</span>`);
      html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${chips.join('')}</div>`;
      if (company.notes) {
        html += `<div style="font-size:12px;color:var(--text-muted);background:var(--bg);border-radius:6px;padding:10px;margin-bottom:14px;line-height:1.5">${esc(company.notes)}</div>`;
      }
    }

    // Latest reply — the main event
    if (latestReply && latestReply.body) {
      html += `<div style="margin-bottom:14px">`;
      html += `<div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Their Latest Reply · ${fmtDate(latestReply.sent_at)}</div>`;
      html += `<div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:6px;padding:12px 14px;font-size:13px;line-height:1.6;max-height:200px;overflow-y:auto;white-space:pre-wrap">${esc(latestReply.body)}</div>`;
      html += `</div>`;
    }

    // Action buttons row
    html += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">`;
    if (latestInboundId) {
      html += `<button class="btn btn-primary" onclick="closeModal('modal-contact-detail');openQuickReply(${latestInboundId})">Reply to ${esc(contact.first_name)}</button>`;
    }
    if (contact.email) {
      html += `<button class="btn btn-outline" onclick="closeModal('modal-contact-detail');openPortfolioComposer(${contact.company_id || 'null'}, '${esc(contact.email)}', '${esc(contact.first_name)}')">📨 Send Portfolio</button>`;
    }
    html += `</div>`;

    // Enrollment history — all sequences (active, replied, completed, stopped)
    html += renderEnrollmentHistory(enrollments, contactId);

    // Thread history — compact, expandable
    html += `<div style="margin-bottom:6px;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">Thread History (${activities.length})</div>`;
    html += `<div style="border:1px solid var(--border);border-radius:6px;overflow:hidden;max-height:220px;overflow-y:auto">`;
    activities.forEach(a => {
      const isReply = a.type === 'received_email';
      const icon = isReply ? '←' : '→';
      const iconColor = isReply ? 'var(--accent)' : 'var(--primary)';
      const label = isReply ? 'Received' : 'Sent';
      html += `<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);font-size:12px" class="cd-thread-row" onclick="this.querySelector('.cd-body')?.classList.toggle('hidden')">`;
      html += `<span style="color:${iconColor};font-weight:700;flex-shrink:0" title="${label}">${icon}</span>`;
      html += `<div style="flex:1;min-width:0">`;
      html += `<div style="display:flex;justify-content:space-between;gap:8px"><span style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.subject||'(no subject)')}</span><span style="color:var(--text-muted);white-space:nowrap;flex-shrink:0">${fmtDate(a.sent_at)}</span></div>`;
      if (a.body) {
        const preview = a.body.replace(/\n/g,' ').substring(0, 100);
        html += `<div class="cd-body hidden" style="margin-top:4px;color:var(--text-muted);white-space:pre-wrap;line-height:1.5;max-height:150px;overflow-y:auto;cursor:text" onclick="event.stopPropagation()">${esc(a.body)}</div>`;
        html += `<div style="color:var(--text-muted);margin-top:2px;font-size:11px;cursor:pointer">${esc(preview)}…</div>`;
      }
      html += `</div></div>`;
    });
    html += `</div>`;

    // Footer actions
    html += `<div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">`;
    if (contact.company_id) {
      html += `<a href="#" class="btn btn-outline btn-sm" onclick="event.preventDefault();closeModal('modal-contact-detail');openCompanyDetail(${contact.company_id})">Company Detail</a>`;
      html += `<a href="#" class="btn btn-outline btn-sm" onclick="event.preventDefault();closeModal('modal-contact-detail');showPage('pipeline')">Pipeline</a>`;
    }
    html += `</div>`;

    document.getElementById('contact-detail-body').innerHTML = html;
    openModal('modal-contact-detail');
  } catch(e) { toast(e.message, 'error'); }
}
