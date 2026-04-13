// ── PHIL LEWIS ART CRM — Pipeline ──────────────────────────────────────────
// ── PIPELINE ──────────────────────────────────────────────────────────────
function getPipelineStage(c) {
  if (c.enrollment_status === 'completed') return 'Sequence Complete';
  if (!c.emails_sent && !c.enrollment_id) return 'Not Contacted';
  if (!c.emails_sent && c.enrollment_id) return 'Enrolled — Pending';
  const n = c.emails_sent || 0;
  if (n === 1) return '1st Contact Sent';
  if (n === 2) return '2nd Contact Sent';
  if (n === 3) return '3rd Contact Sent';
  return `${n}th Contact Sent`;
}

const PIPELINE_STAGE_ORDER = [
  'Not Contacted', 'Enrolled — Pending',
  '1st Contact Sent', '2nd Contact Sent', '3rd Contact Sent',
  '4th Contact Sent', '5th Contact Sent', '6th Contact Sent',
  'Sequence Complete'
];

const PIPELINE_STAGE_CLASSES = {
  'Not Contacted': 'stage-none',
  'Enrolled — Pending': 'stage-pending',
  'Sequence Complete': 'stage-complete',
};

function isStuckContact(c) {
  if (c.enrollment_status !== 'active') return false;
  const now = Date.now();
  const cutoff = 14 * 24 * 60 * 60 * 1000; // 14 days in ms
  if (c.last_contact_at) {
    return (now - new Date(c.last_contact_at).getTime()) > cutoff;
  }
  if (c.started_at) {
    return (now - new Date(c.started_at).getTime()) > cutoff;
  }
  return false;
}

async function loadPipeline() {
  try {
    var contacts = await apiFetch('/api/pipeline');
    var el = document.getElementById('pipeline-content');

    if (!contacts.length) {
      el.innerHTML = '<div class="empty-state"><div style="font-size:32px;margin-bottom:8px">◉</div><p>No contacts yet. Add contacts and enroll them in sequences to track their pipeline progress.</p></div>';
      return;
    }

    // Bucket contacts into priority groups
    var replied = contacts.filter(function(c) { return c.enrollment_status === 'replied'; });
    var stuck = contacts.filter(function(c) { return isStuckContact(c); });
    var active = contacts.filter(function(c) { return c.enrollment_status === 'active' && !isStuckContact(c); });
    var completed = contacts.filter(function(c) { return c.enrollment_status === 'completed'; });
    var stopped = contacts.filter(function(c) { return c.enrollment_status === 'stopped'; });
    var notEnrolled = contacts.filter(function(c) { return !c.enrollment_status; });
    var needEmail = notEnrolled.filter(function(c) { return !c.email; });
    var haveEmail = notEnrolled.filter(function(c) { return !!c.email; });

    var html = '';

    // ── Summary stat cards ──
    html += '<div class="pipeline-summary" style="margin-bottom:20px">';
    html += pipelineStat(replied.length, 'Need Follow-Up', 'var(--success)', 'replied');
    html += pipelineStat(stuck.length, 'Stuck (2+ wks)', 'var(--danger)', 'stuck');
    html += pipelineStat(active.length, 'Active', 'var(--primary)', 'active');
    html += pipelineStat(completed.length, 'Completed', '#6b7280', 'completed');
    html += pipelineStat(haveEmail.length, 'Ready to Enroll', '#8b5cf6', 'ready');
    html += pipelineStat(needEmail.length, 'Need Email', '#9ca3af', 'needing');
    html += '</div>';

    // ── 1. REPLIED — Need Follow-Up (highest priority) ──
    if (replied.length) {
      html += pipelineSection('replied', '↩ Need Follow-Up', replied.length, 'stage-complete',
        'These prospects replied — follow up now!',
        replied.map(function(c) { return pipelineActionCard(c, 'replied'); }).join('')
      );
    }

    // ── 2. STUCK — Needs Attention ──
    if (stuck.length) {
      html += pipelineSection('stuck', '⚠ Stuck — No Contact in 2+ Weeks', stuck.length, 'stage-stuck',
        'These contacts are enrolled but haven\'t been reached recently.',
        stuck.map(function(c) { return pipelineActionCard(c, 'stuck'); }).join('')
      );
    }

    // ── 3. ACTIVE — In Sequences ──
    if (active.length) {
      // Sub-group by sequence name
      var seqGroups = {};
      active.forEach(function(c) {
        var key = c.sequence_name || 'Unknown Sequence';
        if (!seqGroups[key]) seqGroups[key] = [];
        seqGroups[key].push(c);
      });
      var seqHtml = '';
      Object.keys(seqGroups).sort().forEach(function(seqName) {
        var cts = seqGroups[seqName];
        seqHtml += '<div class="pipeline-seq-group">';
        seqHtml += '<div class="pipeline-seq-name">' + esc(seqName) + ' <span class="pipeline-seq-count">' + cts.length + '</span></div>';
        seqHtml += '<div class="pipeline-action-grid">';
        seqHtml += cts.map(function(c) { return pipelineActionCard(c, 'active'); }).join('');
        seqHtml += '</div></div>';
      });
      html += pipelineSection('active', 'In Sequences', active.length, 'stage-active', '', seqHtml);
    }

    // ── 4. COMPLETED ──
    if (completed.length) {
      html += pipelineCollapsible('completed', 'Completed Sequences', completed.length, 'stage-complete',
        completed.map(function(c) { return pipelineCompactRow(c); }).join('')
      );
    }

    // ── 5. READY TO ENROLL — have email but no sequence ──
    if (haveEmail.length) {
      html += pipelineSection('ready', 'Ready to Enroll', haveEmail.length, 'stage-ready',
        'These contacts have email addresses but aren\'t in a sequence yet.',
        '<div class="pipeline-action-grid">' + haveEmail.map(function(c) { return pipelineActionCard(c, 'ready'); }).join('') + '</div>'
      );
    }

    // ── 6. NEED EMAIL — collapsed by default ──
    if (needEmail.length) {
      html += pipelineCollapsible('needing', 'Need Email Address (' + needEmail.length + ')', needEmail.length, 'stage-none',
        needEmail.map(function(c) { return pipelineCompactRow(c); }).join('')
      );
    }

    el.innerHTML = html;
  } catch(e) { toast(e.message, 'error'); }
}

function pipelineStat(count, label, color, scrollTo) {
  return '<div class="pipeline-summary-card" style="border-color:' + color + ';cursor:pointer" onclick="scrollToPipelineSection(\'' + scrollTo + '\')">' +
    '<div class="pipeline-summary-count" style="color:' + color + '">' + count + '</div>' +
    '<div class="pipeline-summary-label">' + label + '</div>' +
  '</div>';
}

function scrollToPipelineSection(id) {
  var el = document.getElementById('pipeline-sec-' + id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function pipelineSection(id, title, count, cls, subtitle, content) {
  return '<div id="pipeline-sec-' + id + '" class="pipeline-priority-section" style="margin-bottom:24px">' +
    '<div class="pipeline-stage-header ' + cls + '" style="border-radius:8px 8px 0 0">' +
      '<span class="pipeline-stage-label">' + title + '</span>' +
      '<span class="pipeline-stage-count">' + count + ' contact' + (count !== 1 ? 's' : '') + '</span>' +
    '</div>' +
    (subtitle ? '<div style="padding:8px 16px;font-size:12px;color:var(--text-muted);background:var(--card-bg);border:1px solid var(--border);border-top:0">' + subtitle + '</div>' : '') +
    '<div style="background:var(--card-bg);border:1px solid var(--border);border-top:0;border-radius:0 0 8px 8px;padding:12px">' +
      content +
    '</div>' +
  '</div>';
}

function pipelineCollapsible(id, title, count, cls, content) {
  return '<div id="pipeline-sec-' + id + '" class="pipeline-priority-section" style="margin-bottom:24px">' +
    '<div class="pipeline-stage-header ' + cls + '" style="border-radius:8px;cursor:pointer" onclick="togglePipelineCollapse(\'' + id + '\')">' +
      '<span class="pipeline-stage-label">' + title + '</span>' +
      '<span class="pipeline-stage-count" style="display:flex;align-items:center;gap:6px">' +
        count + ' contact' + (count !== 1 ? 's' : '') +
        ' <span id="pipeline-chevron-' + id + '" style="font-size:10px;transition:transform .2s">▶</span>' +
      '</span>' +
    '</div>' +
    '<div id="pipeline-body-' + id + '" style="display:none;background:var(--card-bg);border:1px solid var(--border);border-top:0;border-radius:0 0 8px 8px;padding:12px;max-height:400px;overflow-y:auto">' +
      content +
    '</div>' +
  '</div>';
}

function togglePipelineCollapse(id) {
  var body = document.getElementById('pipeline-body-' + id);
  var chevron = document.getElementById('pipeline-chevron-' + id);
  if (!body) return;
  var showing = body.style.display !== 'none';
  body.style.display = showing ? 'none' : 'block';
  if (chevron) chevron.style.transform = showing ? '' : 'rotate(90deg)';
  // Fix border radius on header when expanded
  var header = body.previousElementSibling;
  if (header) header.style.borderRadius = showing ? '8px' : '8px 8px 0 0';
}

function pipelineActionCard(c, mode) {
  var stuck = isStuckContact(c);
  var borderColor = mode === 'replied' ? 'var(--success)' : mode === 'stuck' ? 'var(--danger)' : 'transparent';
  var stepInfo = '';
  if (c.enrollment_status === 'active' && c.current_step) {
    stepInfo = '<span class="pipe-card-step">Step ' + c.current_step + '/' + (c.total_steps || '?') + '</span>';
  }

  return '<div class="pipe-action-card" style="border-left:3px solid ' + borderColor + '">' +
    '<div class="pipe-card-top">' +
      '<div class="pipe-card-identity">' +
        (c.is_primary ? '<span class="primary-badge" title="Primary">★</span> ' : '') +
        '<a href="#" onclick="event.preventDefault();openContactDetail(' + c.id + ')" class="pipe-card-name">' + esc(c.first_name) + ' ' + esc(c.last_name || '') + '</a>' +
        (stuck ? ' <span class="pipe-stuck-badge">⚠ Stuck</span>' : '') +
      '</div>' +
      stepInfo +
    '</div>' +
    (c.title ? '<div class="pipe-card-title">' + esc(c.title) + '</div>' : '') +
    '<div class="pipe-card-company">' +
      (c.company_id ? '<a href="#" onclick="event.preventDefault();openCompanyDetail(' + c.company_id + ')">' + esc(c.company_name || '—') + '</a>' : '<span style="color:var(--text-muted)">—</span>') +
    '</div>' +
    '<div class="pipe-card-meta">' +
      (c.email ? '<span class="pipe-card-email">' + esc(c.email) + '</span>' : '<span style="color:var(--danger);font-size:11px">No email</span>') +
      (c.emails_sent ? '<span class="pipe-card-sent">' + c.emails_sent + ' sent</span>' : '') +
      (c.last_contact_at ? '<span class="pipe-card-date">' + fmtDate(c.last_contact_at) + '</span>' : '') +
    '</div>' +
    '<div class="pipe-card-actions">' +
      (mode === 'replied' ? '<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();openContactDetail(' + c.id + ')">Follow Up</button>' : '') +
      (mode === 'ready' ? '<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();openContactDetail(' + c.id + ')">Enroll</button>' : '') +
      (mode === 'stuck' ? '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();openContactDetail(' + c.id + ')">Review</button>' : '') +
      (mode === 'active' ? '<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openContactDetail(' + c.id + ')">View</button>' : '') +
    '</div>' +
  '</div>';
}

function pipelineCompactRow(c) {
  return '<div class="pipe-compact-row">' +
    '<div class="pipe-compact-identity">' +
      (c.is_primary ? '<span class="primary-badge" title="Primary">★</span> ' : '') +
      '<a href="#" onclick="event.preventDefault();openContactDetail(' + c.id + ')">' + esc(c.first_name) + ' ' + esc(c.last_name || '') + '</a>' +
    '</div>' +
    '<div class="pipe-compact-company">' +
      (c.company_id ? '<a href="#" onclick="event.preventDefault();openCompanyDetail(' + c.company_id + ')">' + esc(c.company_name || '—') + '</a>' : '—') +
    '</div>' +
    '<div class="pipe-compact-email">' +
      (c.email ? esc(c.email) : '<span style="color:var(--danger)">No email</span>') +
    '</div>' +
    '<div class="pipe-compact-action">' +
      '<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openContactDetail(' + c.id + ')">View</button>' +
    '</div>' +
  '</div>';
}

function stageSlug(stage) {
  return stage.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function scrollToStage(slug) {
  const el = document.getElementById('stage-' + slug);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

