// ── PHIL LEWIS ART CRM — Reports ──────────────────────────────────────────
// ── REPORTS ───────────────────────────────────────────────────────────────
async function loadReports() {
  var el = document.getElementById('reports-content');
  if (!el) return;
  el.innerHTML = '<div class="empty-state">Loading…</div>';

  try {
    var results = await Promise.all([
      apiFetch('/api/dashboard'),
      apiFetch('/api/pipeline'),
      apiFetch('/api/activities?limit=300'),
      apiFetch('/api/companies'),
      apiFetch('/api/sequences'),
    ]);
    var stats = results[0], pipeline = results[1], activity = results[2], companies = results[3], sequences = results[4];
    var now = Date.now();
    var today = new Date().toISOString().slice(0,10);

    // ── Deal Aging Buckets ──
    function ageDays(c) {
      var d = c.created_at || c.updated_at;
      return d ? Math.floor((now - new Date(d).getTime()) / 86400000) : 999;
    }
    var allCompanies = companies || [];
    var newDeals = allCompanies.filter(function(c) { return ageDays(c) <= 30; });
    var midDeals = allCompanies.filter(function(c) { var d = ageDays(c); return d > 30 && d <= 60; });
    var oldDeals = allCompanies.filter(function(c) { var d = ageDays(c); return d > 60 && d <= 90; });
    var ancientDeals = allCompanies.filter(function(c) { return ageDays(c) > 90; });

    // ── Attention Needed: unreplied replies, overdue next steps, stalled ──
    // Contacts who replied but we haven't followed up
    var replies = (activity || []).filter(function(a) { return a.type === 'received_email'; });
    var repliedCompanyIds = new Set();
    replies.forEach(function(a) { if (a.company_id) repliedCompanyIds.add(a.company_id); });

    // Sent after reply?
    var sentAfterReply = new Set();
    replies.forEach(function(r) {
      var laterSent = (activity || []).find(function(a) {
        return a.type === 'email' && a.contact_id === r.contact_id && new Date(a.sent_at) > new Date(r.sent_at);
      });
      if (laterSent) sentAfterReply.add(r.contact_id);
    });
    var unrepliedContacts = replies.filter(function(r) { return !sentAfterReply.has(r.contact_id); });
    // Deduplicate by contact_id (keep most recent)
    var seenContacts = {};
    unrepliedContacts = unrepliedContacts.filter(function(r) {
      if (seenContacts[r.contact_id]) return false;
      seenContacts[r.contact_id] = true;
      return true;
    });

    // Overdue next steps
    var overdueSteps = allCompanies.filter(function(c) {
      return c.next_step && c.next_step_date && c.next_step_date < today;
    });

    // Upcoming next steps (due within 7 days)
    var weekFromNow = new Date(now + 7 * 86400000).toISOString().slice(0,10);
    var upcomingSteps = allCompanies.filter(function(c) {
      return c.next_step && c.next_step_date && c.next_step_date >= today && c.next_step_date <= weekFromNow;
    });

    // ── Weekly Activity ──
    var weekMap = {};
    (activity || []).forEach(function(a) {
      var d = new Date(a.created_at || a.sent_at);
      if (isNaN(d)) return;
      var monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay()+6)%7));
      var key = monday.toISOString().slice(0,10);
      if (!weekMap[key]) weekMap[key] = { sent:0, received:0, companies:new Set() };
      if (a.type === 'received_email') weekMap[key].received++;
      else weekMap[key].sent++;
      if (a.company_id) weekMap[key].companies.add(a.company_id);
    });
    var weeks = Object.entries(weekMap).sort(function(a,b) { return b[0].localeCompare(a[0]); }).slice(0,6);

    // ── Total opp value ──
    var totalOpp = allCompanies.reduce(function(s,c) { return s + (parseFloat(c.opportunity_value)||0); }, 0);
    var totalReplies = replies.length;
    var totalSent = (activity || []).filter(function(a) { return a.type === 'email'; }).length;
    var responseRate = totalSent > 0 ? Math.round((totalReplies / totalSent) * 100) : 0;

    var html = '';

    // ── KPI Row ──
    html += '<div class="report-kpi-row">';
    html += reportKPI(allCompanies.length, 'Total Prospects', '', "showPage('companies')");
    html += reportKPI(totalSent, 'Emails Sent', '', "showPage('activity');setTimeout(function(){filterActivity('sent-month')},100)");
    html += reportKPI(totalReplies, 'Replies', 'highlight', "showPage('activity');setTimeout(function(){filterActivity('replies-month')},100)");
    html += reportKPI(responseRate + '%', 'Response Rate', responseRate > 5 ? 'highlight' : '');
    html += reportKPI('$' + totalOpp.toLocaleString(undefined,{maximumFractionDigits:0}), 'Pipeline Value', totalOpp > 0 ? 'highlight' : '', "showPage('pipeline')");
    html += reportKPI(unrepliedContacts.length, 'Need Your Reply', unrepliedContacts.length > 0 ? 'warn' : '', "document.getElementById('report-attention-section').scrollIntoView({behavior:'smooth'})");
    html += '</div>';

    // ── NEEDS ATTENTION (top priority) ──
    if (unrepliedContacts.length > 0 || overdueSteps.length > 0) {
      html += '<div id="report-attention-section" class="report-card report-card-wide report-card-attention">';
      html += '<div class="report-card-title" style="color:var(--danger)">⚡ Needs Your Attention</div>';

      if (unrepliedContacts.length > 0) {
        html += '<div class="report-subsection"><div class="report-subsection-title">Prospects replied — you haven\'t responded (' + unrepliedContacts.length + ')</div>';
        html += '<div class="report-attention-grid">';
        unrepliedContacts.slice(0, 10).forEach(function(r) {
          html += '<div class="report-attention-card" style="cursor:pointer" onclick="openContactDetail(' + r.contact_id + ')">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
              '<div>' +
                '<div class="report-attn-name">' + esc(r.first_name || '') + ' ' + esc(r.last_name || '') + '</div>' +
                '<div class="report-attn-company">' + esc(r.company_name || '—') + '</div>' +
              '</div>' +
              '<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();openContactDetail(' + r.contact_id + ')" style="white-space:nowrap">Reply Now</button>' +
            '</div>' +
            '<div class="report-attn-subject">"' + esc((r.subject || '').slice(0, 50)) + '"</div>' +
            '<div class="report-attn-date">' + fmtDate(r.sent_at) + '</div>' +
          '</div>';
        });
        html += '</div></div>';
      }

      if (overdueSteps.length > 0) {
        html += '<div class="report-subsection"><div class="report-subsection-title">Overdue next steps (' + overdueSteps.length + ')</div>';
        overdueSteps.forEach(function(c) {
          html += '<div class="report-overdue-row" style="cursor:pointer" onclick="openCompanyDetail(' + c.id + ')">' +
            '<strong style="min-width:120px">' + esc(c.name) + '</strong>' +
            '<span class="report-overdue-step">' + esc(c.next_step) + '</span>' +
            '<span style="color:var(--danger);font-size:12px;font-weight:600">Due ' + fmtDate(c.next_step_date) + '</span>' +
            '<div style="display:flex;gap:4px;margin-left:auto;flex-shrink:0">' +
              '<button class="btn btn-primary btn-sm" onclick="event.stopPropagation();openCompanyDetail(' + c.id + ')" style="white-space:nowrap">Take Action</button>' +
              '<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();snoozeNextStep(' + c.id + ',7)" title="Snooze 7 days" style="white-space:nowrap">Snooze</button>' +
              '<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();markNextStepDone(' + c.id + ')" title="Mark as done" style="white-space:nowrap">✓ Done</button>' +
            '</div>' +
          '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
    }

    // ── DEAL AGING BUCKETS ──
    html += '<div class="report-card report-card-wide">';
    html += '<div class="report-card-title">Deal Aging</div>';
    html += '<div class="deal-aging-grid">';
    html += dealAgingBucket('New (0–30 days)', newDeals, 'var(--success)');
    html += dealAgingBucket('Warming (31–60 days)', midDeals, 'var(--primary)');
    html += dealAgingBucket('Aging (61–90 days)', oldDeals, '#f59e0b');
    html += dealAgingBucket('Stale (90+ days)', ancientDeals, 'var(--danger)');
    html += '</div></div>';

    // ── WEEKLY OUTREACH CHART ──
    html += '<div class="report-grid">';
    html += '<div class="report-card">';
    html += '<div class="report-card-title">Weekly Outreach</div>';
    if (weeks.length) {
      var maxWeekVal = Math.max.apply(null, weeks.map(function(w) { return Math.max(w[1].sent, w[1].received); })) || 1;
      html += '<div class="report-bar-chart">';
      weeks.slice().reverse().forEach(function(w) {
        var sentH = Math.max(2, Math.round((w[1].sent / maxWeekVal) * 90));
        var recvH = Math.max(2, Math.round((w[1].received / maxWeekVal) * 90));
        var weekLabel = w[0].slice(5); // MM-DD
        html += '<div class="report-bar-group">' +
          '<div class="report-bar-bars">' +
            '<div class="report-bar" data-val="' + w[1].sent + ' sent" style="height:' + sentH + 'px;background:var(--primary)"></div>' +
            '<div class="report-bar" data-val="' + w[1].received + ' replies" style="height:' + recvH + 'px;background:var(--success)"></div>' +
          '</div>' +
          '<div class="report-bar-label">' + weekLabel + '</div>' +
        '</div>';
      });
      html += '</div>';
      html += '<div class="report-chart-legend">' +
        '<span><span class="report-legend-dot" style="background:var(--primary)"></span>Sent</span>' +
        '<span><span class="report-legend-dot" style="background:var(--success)"></span>Replies</span>' +
      '</div>';
      // Keep table too but compact
      html += '<table class="report-table" style="margin-top:12px"><thead><tr><th>Week</th><th>Sent</th><th>Replies</th><th>Companies</th></tr></thead><tbody>';
      weeks.forEach(function(w) {
        html += '<tr><td>' + w[0] + '</td><td><strong>' + w[1].sent + '</strong></td><td style="color:var(--success);font-weight:600">' + w[1].received + '</td><td>' + w[1].companies.size + '</td></tr>';
      });
      html += '</tbody></table>';
    } else {
      html += '<div style="color:var(--text-muted);padding:12px 0;font-size:13px">No activity yet</div>';
    }
    html += '</div>';

    // ── UPCOMING NEXT STEPS ──
    html += '<div class="report-card">';
    html += '<div class="report-card-title">Coming Up This Week</div>';
    if (upcomingSteps.length) {
      upcomingSteps.forEach(function(c) {
        html += '<div class="report-upcoming-row">' +
          '<a href="#" onclick="event.preventDefault();openCompanyDetail(' + c.id + ')">' + esc(c.name) + '</a>' +
          '<span class="report-upcoming-step">' + esc(c.next_step) + '</span>' +
          '<span style="font-size:11px;color:var(--text-muted)">' + fmtDate(c.next_step_date) + '</span>' +
        '</div>';
      });
    } else {
      html += '<div style="color:var(--text-muted);padding:12px 0;font-size:13px">No upcoming tasks this week.</div>';
    }
    html += '</div></div>';

    // ── SEQUENCE PERFORMANCE ──
    if (sequences && sequences.length) {
      html += '<div class="report-card report-card-wide">';
      html += '<div class="report-card-title">Sequence Performance</div>';
      html += '<div class="seq-stats-grid">';
      sequences.forEach(function(seq) {
        var st = seq.stats || { active:0, replied:0, completed:0, stopped:0, total:0 };
        var replyRate = st.total > 0 ? Math.round(((st.replied) / st.total) * 100) : 0;
        var completionRate = st.total > 0 ? Math.round(((st.completed + st.replied) / st.total) * 100) : 0;
        var stalled = st.stopped || 0;

        html += '<div class="seq-stat-card">';
        html += '<div class="seq-stat-name">' + esc(seq.name) + '</div>';

        // Mini funnel bar
        if (st.total > 0) {
          var segments = [
            { label: 'Replied', count: st.replied, color: 'var(--success)' },
            { label: 'Active', count: st.active, color: 'var(--primary)' },
            { label: 'Completed', count: st.completed, color: '#6b7280' },
            { label: 'Stopped', count: stalled, color: 'var(--danger)' }
          ];
          html += '<div class="seq-stat-bar-bg" style="height:10px;display:flex;overflow:hidden;border-radius:5px">';
          segments.forEach(function(seg) {
            if (seg.count > 0) {
              var pct = Math.round((seg.count / st.total) * 100);
              html += '<div style="width:' + pct + '%;background:' + seg.color + ';height:100%" title="' + seg.label + ': ' + seg.count + '"></div>';
            }
          });
          html += '</div>';
        }

        html += '<div class="seq-stat-row"><span>Total enrolled</span><strong>' + st.total + '</strong></div>';
        html += '<div class="seq-stat-row"><span>Active</span><strong>' + st.active + '</strong></div>';
        html += '<div class="seq-stat-row"><span>Replied</span><strong style="color:var(--success)">' + st.replied + '</strong></div>';
        html += '<div class="seq-stat-row"><span>Reply rate</span><strong style="color:' + (replyRate > 5 ? 'var(--success)' : 'var(--text)') + '">' + replyRate + '%</strong></div>';
        html += '<div class="seq-stat-row"><span>Completion rate</span><strong>' + completionRate + '%</strong></div>';
        if (stalled > 0) {
          html += '<div class="seq-stat-row"><span style="color:var(--danger)">Stopped/Stalled</span><strong style="color:var(--danger)">' + stalled + '</strong></div>';
        }

        // Steps info
        html += '<div style="margin-top:6px;font-size:11px;color:var(--text-muted)">' + (seq.steps ? seq.steps.length : 0) + ' steps in sequence</div>';
        html += '</div>';
      });
      html += '</div></div>';
    }

    // ── PIPELINE FUNNEL CHART ──
    var pipeActive = pipeline ? pipeline.filter(function(c) { return c.enrollment_status === 'active'; }).length : 0;
    var pipeReplied = pipeline ? pipeline.filter(function(c) { return c.enrollment_status === 'replied'; }).length : 0;
    var pipeCompleted = pipeline ? pipeline.filter(function(c) { return c.enrollment_status === 'completed'; }).length : 0;
    var pipeNotEnrolled = pipeline ? pipeline.filter(function(c) { return !c.enrollment_status; }).length : 0;
    var pipeTotal = pipeline ? pipeline.length : 0;

    if (pipeTotal > 0) {
      html += '<div class="report-card report-card-wide">';
      html += '<div class="report-card-title">Pipeline Funnel</div>';
      var funnelStages = [
        { label: 'Not Enrolled', count: pipeNotEnrolled, color: '#9ca3af' },
        { label: 'Active', count: pipeActive, color: 'var(--primary)' },
        { label: 'Replied', count: pipeReplied, color: 'var(--success)' },
        { label: 'Completed', count: pipeCompleted, color: '#6b7280' }
      ];
      var maxFunnel = Math.max.apply(null, funnelStages.map(function(s) { return s.count; })) || 1;
      html += '<div class="report-bar-chart" style="height:80px">';
      funnelStages.forEach(function(s) {
        var h = Math.max(2, Math.round((s.count / maxFunnel) * 70));
        html += '<div class="report-bar-group">' +
          '<div class="report-bar-bars">' +
            '<div class="report-bar" data-val="' + s.count + '" style="height:' + h + 'px;background:' + s.color + ';width:32px"></div>' +
          '</div>' +
          '<div class="report-bar-label">' + s.label + '</div>' +
        '</div>';
      });
      html += '</div></div>';
    }

    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="empty-state">Error loading reports: ' + esc(e.message) + '</div>'; }
}

function reportKPI(value, label, cls, onclick) {
  var clickAttr = onclick ? ' onclick="' + onclick + '" style="cursor:pointer" title="Click to drill down"' : '';
  return '<div class="report-kpi ' + cls + '"' + clickAttr + '><div class="report-kpi-value">' + value + '</div><div class="report-kpi-label">' + label + '</div></div>';
}

function dealAgingBucket(title, deals, color) {
  var topDeals = deals.sort(function(a,b) { return (parseFloat(b.opportunity_value)||0) - (parseFloat(a.opportunity_value)||0); }).slice(0, 5);
  var totalOpp = deals.reduce(function(s,c) { return s + (parseFloat(c.opportunity_value)||0); }, 0);

  var html = '<div class="deal-aging-bucket" style="border-top:3px solid ' + color + '">';
  html += '<div class="deal-aging-header">';
  html += '<div class="deal-aging-count" style="color:' + color + '">' + deals.length + '</div>';
  html += '<div class="deal-aging-title">' + title + '</div>';
  if (totalOpp > 0) html += '<div class="deal-aging-opp">$' + totalOpp.toLocaleString(undefined,{maximumFractionDigits:0}) + '</div>';
  html += '</div>';

  if (topDeals.length) {
    topDeals.forEach(function(c) {
      html += '<div class="deal-aging-row">' +
        '<a href="#" onclick="event.preventDefault();openCompanyDetail(' + c.id + ')">' + esc(c.name) + '</a>' +
        (c.status ? '<span class="status-pill status-' + (c.status||'').replace(/\s/g,'-').toLowerCase() + '">' + esc(c.status) + '</span>' : '') +
      '</div>';
    });
    if (deals.length > 5) html += '<div class="deal-aging-more">+' + (deals.length - 5) + ' more</div>';
  } else {
    html += '<div style="font-size:12px;color:var(--text-muted);padding:8px 0">None</div>';
  }
  html += '</div>';
  return html;
}

