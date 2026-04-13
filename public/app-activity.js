// ── PHIL LEWIS ART CRM — Activity ──────────────────────────────────────────
// ── ACTIVITY ──────────────────────────────────────────────────────────────
var _activityCache = [];
var _activityFilter = ''; // '', 'sent-week', 'replies-week', 'companies-week', 'sent-month', 'replies-month'

function filterActivity(filter) {
  if (_activityFilter === filter) { _activityFilter = ''; } // toggle off
  else { _activityFilter = filter; }
  renderActivityTimeline();
  // Update stat card active states
  document.querySelectorAll('.activity-stat-card').forEach(function(card) {
    card.classList.toggle('activity-stat-active', card.getAttribute('data-filter') === _activityFilter);
  });
  // Show/hide filter indicator
  var indicator = document.getElementById('activity-filter-indicator');
  if (indicator) {
    if (_activityFilter) {
      var labels = {
        'needs-reply': 'Needs Your Reply',
        'sent-week': 'Sent This Week', 'replies-week': 'Replies This Week',
        'companies-week': 'Companies Reached This Week',
        'sent-month': 'Sent (30 Days)', 'replies-month': 'Replies (30 Days)'
      };
      indicator.innerHTML = '<span>Showing: <strong>' + (labels[_activityFilter] || _activityFilter) + '</strong></span>' +
        '<button class="btn btn-ghost btn-sm" onclick="filterActivity(\'\');loadActivity()" style="color:var(--text-muted)">✕ Clear filter</button>';
      indicator.style.display = 'flex';
    } else {
      indicator.style.display = 'none';
    }
  }
}

function getFilteredActivities() {
  var activities = _activityCache;
  if (!_activityFilter) return activities;
  var now = new Date();
  var weekAgo = new Date(now - 7 * 86400000);
  var monthAgo = new Date(now - 30 * 86400000);
  if (_activityFilter === 'sent-week') return activities.filter(function(a) { return a.type === 'email' && new Date(a.sent_at) >= weekAgo; });
  if (_activityFilter === 'replies-week') return activities.filter(function(a) { return a.type === 'received_email' && new Date(a.sent_at) >= weekAgo; });
  if (_activityFilter === 'companies-week') {
    var weekItems = activities.filter(function(a) { return new Date(a.sent_at) >= weekAgo; });
    var seenCo = {};
    return weekItems.filter(function(a) { if (!a.company_name || seenCo[a.company_name]) return false; seenCo[a.company_name] = true; return true; });
  }
  if (_activityFilter === 'sent-month') return activities.filter(function(a) { return a.type === 'email' && new Date(a.sent_at) >= monthAgo; });
  if (_activityFilter === 'replies-month') return activities.filter(function(a) { return a.type === 'received_email' && new Date(a.sent_at) >= monthAgo; });
  return activities;
}

async function loadActivity() {
  try {
    var activities = await apiFetch('/api/activities?limit=300');
    _activityCache = activities;

    if (!activities.length) {
      document.getElementById('activity-stats').innerHTML = '';
      document.getElementById('activity-timeline').innerHTML = '<div class="empty-state">No activity yet.</div>';
      return;
    }

    // Index for lookups
    activities.forEach(function(a, idx) { a._idx = idx; });

    // ── Compute stats ──
    var now = new Date();
    var weekAgo = new Date(now - 7 * 86400000);
    var monthAgo = new Date(now - 30 * 86400000);

    var thisWeek = activities.filter(function(a) { return new Date(a.sent_at) >= weekAgo; });
    var thisMonth = activities.filter(function(a) { return new Date(a.sent_at) >= monthAgo; });

    var sentWeek = thisWeek.filter(function(a) { return a.type === 'email'; }).length;
    var repliesWeek = thisWeek.filter(function(a) { return a.type === 'received_email'; }).length;
    var sentMonth = thisMonth.filter(function(a) { return a.type === 'email'; }).length;
    var repliesMonth = thisMonth.filter(function(a) { return a.type === 'received_email'; }).length;
    var uniqueCompaniesWeek = new Set(thisWeek.map(function(a) { return a.company_name; }).filter(Boolean)).size;
    var responseRate = sentMonth > 0 ? Math.round((repliesMonth / sentMonth) * 100) : 0;

    // Find replies awaiting your response — inbound with no subsequent outbound to same contact
    var needsReply = [];
    var contactLastSent = {};
    var contactLastReceived = {};
    activities.forEach(function(a) {
      if (a.type === 'email' && a.contact_id) {
        if (!contactLastSent[a.contact_id] || new Date(a.sent_at) > new Date(contactLastSent[a.contact_id].sent_at)) {
          contactLastSent[a.contact_id] = a;
        }
      }
      if (a.type === 'received_email' && a.contact_id) {
        if (!contactLastReceived[a.contact_id] || new Date(a.sent_at) > new Date(contactLastReceived[a.contact_id].sent_at)) {
          contactLastReceived[a.contact_id] = a;
        }
      }
    });
    Object.keys(contactLastReceived).forEach(function(cid) {
      var lastIn = contactLastReceived[cid];
      var lastOut = contactLastSent[cid];
      if (!lastOut || new Date(lastIn.sent_at) > new Date(lastOut.sent_at)) {
        needsReply.push(lastIn);
      }
    });
    needsReply.sort(function(a, b) { return new Date(b.sent_at) - new Date(a.sent_at); });

    function statCard(value, label, filter, cls) {
      var active = _activityFilter === filter;
      return '<div class="activity-stat-card' + (cls ? ' ' + cls : '') + (active ? ' activity-stat-active' : '') + '"' +
        ' data-filter="' + filter + '"' +
        (filter ? ' onclick="filterActivity(\'' + filter + '\')" style="cursor:pointer"' : '') + '>' +
        '<div class="activity-stat-num">' + value + '</div>' +
        '<div class="activity-stat-label">' + label + '</div>' +
      '</div>';
    }
    var statsHtml = statCard(needsReply.length, 'Needs Reply', 'needs-reply', needsReply.length > 0 ? 'activity-stat-urgent' : '') +
      statCard(sentWeek, 'Sent This Week', 'sent-week', '') +
      statCard(repliesWeek, 'Replies This Week', 'replies-week', 'activity-stat-reply') +
      statCard(uniqueCompaniesWeek, 'Companies Reached', 'companies-week', '') +
      statCard(responseRate + '%', '30-Day Response Rate', '', '') +
      statCard(sentMonth, 'Sent (30 Days)', 'sent-month', '') +
      statCard(repliesMonth, 'Replies (30 Days)', 'replies-month', 'activity-stat-reply');
    document.getElementById('activity-stats').innerHTML = statsHtml;

    // Store needs-reply for filter
    _needsReplyCache = needsReply;

    renderActivityTimeline();
  } catch(e) { toast(e.message, 'error'); }
}

var _needsReplyCache = [];

function renderActivityTimeline() {
  var activities = getFilteredActivities();
  var timelineEl = document.getElementById('activity-timeline');

  // ── NEEDS REPLY section (always show when unfiltered, or when filtered to needs-reply) ──
  var showNeedsReply = (!_activityFilter || _activityFilter === 'needs-reply') && _needsReplyCache.length > 0;
  var html = '';

  if (showNeedsReply) {
    html += '<div class="al-section al-needs-reply">';
    html += '<div class="al-section-header"><h3>Needs Your Reply</h3><span class="al-section-count">' + _needsReplyCache.length + '</span></div>';
    html += '<div class="al-needs-reply-grid">';
    _needsReplyCache.forEach(function(a) {
      var daysAgo = Math.floor((Date.now() - new Date(a.sent_at).getTime()) / 86400000);
      var urgencyCls = daysAgo >= 3 ? 'al-urgent' : daysAgo >= 1 ? 'al-warning' : '';
      var timeLabel = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : daysAgo + 'd ago';
      html += '<div class="al-reply-card ' + urgencyCls + '">' +
        '<div class="al-reply-card-header">' +
          '<div class="al-reply-card-who">' +
            '<strong>' + esc((a.first_name || '') + ' ' + (a.last_name || '')) + '</strong>' +
            (a.company_name ? '<span class="al-reply-card-co" onclick="event.stopPropagation();openCompanyDetail(' + a.company_id + ')">' + esc(a.company_name) + '</span>' : '') +
          '</div>' +
          '<span class="al-reply-card-time">' + timeLabel + '</span>' +
        '</div>' +
        '<div class="al-reply-card-subject">' + esc(a.subject || '(no subject)') + '</div>' +
        (a.body ? '<div class="al-reply-card-snippet">' + esc((a.body || '').substring(0, 120)) + '</div>' : '') +
        '<div class="al-reply-card-actions">' +
          '<button class="btn btn-primary btn-sm" onclick="openContactDetail(' + a.contact_id + ')">Reply</button>' +
          '<button class="btn btn-outline btn-sm" onclick="openActivityDetail(' + a._idx + ')">View Full</button>' +
          (a.enrollment_id ? '<button class="btn btn-ghost btn-sm" onclick="stopEnrollment(' + a.enrollment_id + ',{onDone:function(){loadActivity()}})" style="color:var(--text-muted)">Stop Sequence</button>' : '') +
        '</div>' +
      '</div>';
    });
    html += '</div></div>';
  }

  // If filtered to needs-reply only, stop here
  if (_activityFilter === 'needs-reply') {
    timelineEl.innerHTML = html || '<div class="empty-state">No replies awaiting your response.</div>';
    return;
  }

  if (!activities.length) {
    timelineEl.innerHTML = html + '<div class="empty-state">No activity matches this filter.</div>';
    return;
  }

  // ── COMPANY-GROUPED TIMELINE ──
  // Group all activities by company, then show chronological within each
  var companyMap = {};
  var companyOrder = [];
  activities.forEach(function(a) {
    var coKey = a.company_name || '(unknown)';
    if (!companyMap[coKey]) {
      companyMap[coKey] = { name: coKey, id: a.company_id, items: [], sent: 0, received: 0, latestDate: a.sent_at };
      companyOrder.push(coKey);
    }
    companyMap[coKey].items.push(a);
    if (a.type === 'email') companyMap[coKey].sent++;
    if (a.type === 'received_email') companyMap[coKey].received++;
    if (new Date(a.sent_at) > new Date(companyMap[coKey].latestDate)) companyMap[coKey].latestDate = a.sent_at;
  });

  // Sort companies: those with replies first, then by most recent activity
  companyOrder.sort(function(a, b) {
    var ca = companyMap[a], cb = companyMap[b];
    // Replies bubble up
    if (ca.received > 0 && cb.received === 0) return -1;
    if (cb.received > 0 && ca.received === 0) return 1;
    return new Date(cb.latestDate) - new Date(ca.latestDate);
  });

  html += '<div class="al-section">';
  html += '<div class="al-section-header"><h3>Activity by Company</h3></div>';

  companyOrder.forEach(function(coKey) {
    var co = companyMap[coKey];
    var hasReplies = co.received > 0;

    html += '<div class="al-company-group' + (hasReplies ? ' al-company-has-replies' : '') + '">';
    html += '<div class="al-company-header" onclick="this.parentElement.classList.toggle(\'al-collapsed\')">';
    html += '<div class="al-company-name">' +
      (co.id ? '<a href="#" onclick="event.preventDefault();event.stopPropagation();openCompanyDetail(' + co.id + ')">' + esc(co.name) + '</a>' : esc(co.name)) +
      '</div>';
    html += '<div class="al-company-badges">';
    if (co.sent > 0) html += '<span class="al-badge al-badge-sent">' + co.sent + ' sent</span>';
    if (co.received > 0) html += '<span class="al-badge al-badge-reply">' + co.received + ' repl' + (co.received !== 1 ? 'ies' : 'y') + '</span>';
    html += '</div>';
    html += '<span class="al-company-chevron">▾</span>';
    html += '</div>';

    html += '<div class="al-company-body">';

    // Show activities grouped by contact within the company
    var contactMap = {};
    var contactOrder = [];
    co.items.forEach(function(a) {
      var ctKey = a.contact_id || 'unknown';
      if (!contactMap[ctKey]) {
        contactMap[ctKey] = { id: a.contact_id, name: (a.first_name || '') + ' ' + (a.last_name || ''), email: a.email, title: a.title, items: [] };
        contactOrder.push(ctKey);
      }
      contactMap[ctKey].items.push(a);
    });

    contactOrder.forEach(function(ctKey) {
      var ct = contactMap[ctKey];
      var ctReplies = ct.items.filter(function(a) { return a.type === 'received_email'; });
      var ctSent = ct.items.filter(function(a) { return a.type === 'email'; });

      html += '<div class="al-contact-row">';
      html += '<div class="al-contact-info">';
      html += '<div class="al-contact-name">' +
        (ct.id ? '<a href="#" onclick="event.preventDefault();openContactDetail(' + ct.id + ')">' + esc(ct.name.trim() || 'Unknown') + '</a>' : esc(ct.name.trim() || 'Unknown')) +
        (ct.title ? '<span class="al-contact-title">' + esc(ct.title) + '</span>' : '') +
        '</div>';

      // Show sequence context if any
      var seqItem = ct.items.find(function(a) { return a.sequence_name; });
      if (seqItem) {
        var stepLabel = seqItem.current_step ? 'Step ' + seqItem.current_step + (seqItem.sequence_total_steps ? '/' + seqItem.sequence_total_steps : '') : '';
        var seqStatus = seqItem.enrollment_status || '';
        html += '<div class="al-seq-context">' +
          '<span class="al-seq-name">' + esc(seqItem.sequence_name) + '</span>' +
          (stepLabel ? '<span class="al-seq-step">' + stepLabel + '</span>' : '') +
          (seqStatus ? '<span class="al-seq-status al-seq-' + seqStatus + '">' + seqStatus + '</span>' : '') +
          '</div>';
      }
      html += '</div>';

      // Activity items for this contact — compact rows
      html += '<div class="al-contact-activities">';
      ct.items.forEach(function(a) {
        var isReply = a.type === 'received_email';
        var icon = isReply ? '←' : '→';
        var iconCls = isReply ? 'al-icon-reply' : 'al-icon-sent';
        html += '<div class="al-activity-row' + (isReply ? ' al-activity-reply' : '') + '">' +
          '<span class="al-activity-icon ' + iconCls + '">' + icon + '</span>' +
          '<span class="al-activity-subject">' + esc(a.subject || '(no subject)') + '</span>' +
          '<span class="al-activity-date">' + fmtDate(a.sent_at) + '</span>' +
          '<span class="al-activity-actions">' +
            (isReply ? '<button class="btn btn-primary btn-xs" onclick="openContactDetail(' + a.contact_id + ')">Reply</button>' : '') +
            '<button class="btn btn-ghost btn-xs" onclick="openActivityDetail(' + a._idx + ')">View</button>' +
          '</span>' +
        '</div>';
      });
      html += '</div>';

      // Quick action row for this contact
      html += '<div class="al-contact-actions">';
      if (ctReplies.length > 0 && ct.id) {
        html += '<button class="btn btn-primary btn-sm" onclick="openContactDetail(' + ct.id + ')">Reply</button>';
      }
      if (ct.id) {
        html += '<button class="btn btn-outline btn-sm" onclick="openContactDetail(' + ct.id + ')">View Contact</button>';
      }
      if (ct.email && co.id) {
        html += '<button class="btn btn-outline btn-sm" onclick="openPortfolioComposer(' + (co.id || 'null') + ',\'' + esc(ct.email) + '\',\'' + esc((ct.name || '').split(' ')[0]) + '\')">📨 Portfolio</button>';
      }
      html += '</div>';

      html += '</div>';
    });

    html += '</div></div>';
  });

  html += '</div>';
  timelineEl.innerHTML = html;
}

function toggleActivityDay(header) {
  var body = header.nextElementSibling;
  var chevron = header.querySelector('.activity-day-chevron');
  if (!body) return;
  var isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : '';
  if (chevron) chevron.textContent = isOpen ? '▸' : '▾';
}

function openActivityDetail(index) {
  const a = _activityCache[index];
  if (!a) return;

  const fullName = [a.first_name, a.last_name].filter(Boolean).join(' ') || '—';
  document.getElementById('actd-title').textContent = a.subject || 'Activity Detail';

  // Contact card
  document.getElementById('actd-contact-card').innerHTML = `
    <div class="actd-contact-name">${esc(fullName)}</div>
    ${a.title       ? `<div class="actd-contact-meta">${esc(a.title)}</div>` : ''}
    ${a.company_name? `<div class="actd-contact-meta actd-company">${esc(a.company_name)}</div>` : ''}
    ${a.email       ? `<div class="actd-contact-meta"><a href="mailto:${esc(a.email)}" class="email-link">${esc(a.email)}</a></div>` : ''}
    <div class="actd-contact-meta text-muted">${fmtDate(a.sent_at)}</div>
  `;

  // Sequence progress
  const seqEl = document.getElementById('actd-seq-row');
  if (a.sequence_name) {
    const step = a.current_step || 1;
    const total = a.sequence_total_steps || '?';
    const pct = total !== '?' ? Math.round((step / total) * 100) : 0;
    const statusColor = a.enrollment_status === 'active' ? 'var(--primary)'
      : a.enrollment_status === 'completed' ? 'var(--success)'
      : a.enrollment_status === 'replied'   ? 'var(--accent)'
      : 'var(--text-muted)';
    seqEl.innerHTML = `
      <div class="actd-seq-label">Sequence</div>
      <div class="actd-seq-name">${esc(a.sequence_name)}</div>
      <div class="actd-seq-progress-row">
        <div class="actd-seq-step-badge" style="color:${statusColor};border-color:${statusColor}">
          Step ${step} of ${total}
        </div>
        <div class="actd-seq-bar-wrap">
          <div class="actd-seq-bar-fill" style="width:${pct}%;background:${statusColor}"></div>
        </div>
        <span class="actd-seq-status" style="color:${statusColor}">${esc(a.enrollment_status || '')}</span>
      </div>
    `;
    seqEl.style.display = 'block';
  } else {
    seqEl.style.display = 'none';
  }

  // Message body
  document.getElementById('actd-body').textContent = a.body || '(no message body recorded)';

  document.getElementById('modal-activity-detail').classList.remove('hidden');
}

