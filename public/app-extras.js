// ── INBOX MULTI-SELECT & BULK DELETE ──────────────────────────────────────

function updateInboxSelection() {
  const checks = document.querySelectorAll('.inbox-msg-check:checked');
  const bar = document.getElementById('inbox-bulk-bar');
  const countEl = document.getElementById('inbox-selected-count');
  const selectAll = document.getElementById('inbox-select-all');
  if (bar) bar.style.display = checks.length > 0 ? 'flex' : 'none';
  if (countEl) countEl.textContent = checks.length > 0 ? `${checks.length} selected` : '';
  const allChecks = document.querySelectorAll('.inbox-msg-check');
  if (selectAll) selectAll.checked = allChecks.length > 0 && checks.length === allChecks.length;
}

function toggleSelectAllInbox(el) {
  document.querySelectorAll('.inbox-msg-check').forEach(cb => { cb.checked = el.checked; });
  updateInboxSelection();
}

async function bulkDeleteInbox() {
  const checks = document.querySelectorAll('.inbox-msg-check:checked');
  const ids = Array.from(checks).map(cb => parseInt(cb.dataset.id));
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} message${ids.length !== 1 ? 's' : ''} from the CRM? (Won\u2019t delete from your email server.)`)) return;
  try {
    await apiFetch('/api/inbox/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
    toast(`Deleted ${ids.length} message${ids.length !== 1 ? 's' : ''}.`, 'success');
    closeInboxPane();
    loadInbox();
  } catch(e) { toast(e.message, 'error'); }
}

// ── LEAD HEAT MAP ─────────────────────────────────────────────────────────

async function loadLeadHeatmap() {
  const el = document.getElementById('lead-heatmap');
  if (!el) return;
  try {
    const leads = await apiFetch('/api/leads/heatmap');
    renderLeadHeatmap(leads);
  } catch(e) {
    el.innerHTML = `<div class="empty-state">Could not load heat map: ${esc(e.message)}</div>`;
  }
}

function scoreLeadTemperature(lead) {
  let score = 0;
  const reasons = [];
  const now = Date.now();

  // Reply sentiment — strongest signal
  if (lead.latest_sentiment === 'positive') { score += 40; reasons.push('positive reply'); }
  else if (lead.latest_sentiment === 'neutral') { score += 15; reasons.push('neutral reply'); }
  else if (lead.latest_sentiment === 'negative') { score -= 20; reasons.push('negative reply'); }

  // Got replies at all
  if (lead.reply_count > 0) { score += 20; reasons.push(`${lead.reply_count} repl${lead.reply_count > 1 ? 'ies' : 'y'}`); }

  // Pipeline stage advancement
  const stage = (lead.pipeline_stage || 'prospect').toLowerCase();
  if (stage === 'negotiation' || stage === 'closed-won') { score += 25; reasons.push(lead.pipeline_stage); }
  else if (stage === 'proposal') { score += 15; reasons.push('proposal stage'); }
  else if (stage === 'outreach') { score += 5; }

  // Opportunity value
  const opp = parseFloat(lead.opportunity_value) || 0;
  if (opp >= 10000) { score += 10; reasons.push(`$${opp.toLocaleString()} opp`); }
  else if (opp >= 5000) { score += 5; }

  // Active sequences = currently being worked
  if (lead.active_sequences > 0) { score += 5; reasons.push('active sequence'); }

  // Recency of last reply
  if (lead.last_reply_at) {
    const daysAgo = (now - new Date(lead.last_reply_at).getTime()) / 86400000;
    if (daysAgo <= 7) { score += 15; reasons.push('replied this week'); }
    else if (daysAgo <= 30) { score += 5; reasons.push('replied this month'); }
  }

  // Recency of any activity
  if (lead.last_activity_at) {
    const daysAgo = (now - new Date(lead.last_activity_at).getTime()) / 86400000;
    if (daysAgo > 60) { score -= 10; reasons.push('inactive 60+ days'); }
  } else if (lead.emails_sent === 0) {
    score -= 5; reasons.push('no outreach yet');
  }

  // Classify
  let temp, cls;
  if (score >= 35) { temp = 'Hot'; cls = 'hot'; }
  else if (score >= 10) { temp = 'Warm'; cls = 'warm'; }
  else { temp = 'Cold'; cls = 'cold'; }

  return { score, temp, cls, reasons };
}

// Phil's core categories — companies tagged with these are "aligned"
const ALIGNED_TAGS = ['outdoor','surf','skateboard','snowboard','fishing','camping','drinkware','footwear','apparel','hard-goods','puzzles','calendars','fabric','cards','lifestyle'];

function isAligned(lead) {
  if (!lead.tags) return false;
  const t = lead.tags.toLowerCase();
  return ALIGNED_TAGS.some(tag => t.includes(tag));
}

function renderLeadHeatmap(leads) {
  const el = document.getElementById('lead-heatmap');
  if (!el) return;

  // Separate sleepers first: aligned companies with zero outreach
  const sleepers = leads.filter(l => isAligned(l) && l.emails_sent === 0 && l.reply_count === 0);
  const sleeperIds = new Set(sleepers.map(l => l.id));

  // Score the rest
  const active = leads.filter(l => !sleeperIds.has(l.id));
  const scored = active.map(l => ({ ...l, ...scoreLeadTemperature(l) }))
    .sort((a, b) => b.score - a.score);

  const hot  = scored.filter(l => l.cls === 'hot');
  const warm = scored.filter(l => l.cls === 'warm');
  const cold = scored.filter(l => l.cls === 'cold');

  function renderSection(title, items, cls) {
    if (!items.length) return `<div class="heatmap-section heatmap-${cls}"><div class="heatmap-section-title">${title} <span class="heatmap-count">(0)</span></div><div class="heatmap-empty">No ${title.toLowerCase()} leads</div></div>`;
    return `
      <div class="heatmap-section heatmap-${cls}">
        <div class="heatmap-section-title">${title} <span class="heatmap-count">(${items.length})</span></div>
        <div class="heatmap-grid">
          ${items.map(l => `
            <div class="heatmap-card heatmap-card-${cls}" onclick="openCompanyDetail(${l.id})">
              <div class="heatmap-card-header">
                <span class="heatmap-dot heatmap-dot-${cls}"></span>
                <strong>${esc(l.name)}</strong>
              </div>
              <div class="heatmap-card-stage">${esc(l.pipeline_stage || 'Prospect')}${l.opportunity_value > 0 ? ` · $${parseFloat(l.opportunity_value).toLocaleString(undefined,{maximumFractionDigits:0})}` : ''}</div>
              <div class="heatmap-card-reasons">${l.reasons.join(' · ')}</div>
              <div class="heatmap-card-stats">
                <span title="Emails sent">${l.emails_sent} sent</span>
                <span title="Replies received">${l.reply_count} repl${l.reply_count !== 1 ? 'ies' : 'y'}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  function renderSleepers(items) {
    if (!items.length) return `<div class="heatmap-section heatmap-sleeper"><div class="heatmap-section-title">\uD83D\uDCA4 Sleepers <span class="heatmap-count">(0)</span></div><div class="heatmap-empty">No sleepers — every aligned company has been contacted</div></div>`;
    return `
      <div class="heatmap-section heatmap-sleeper">
        <div class="heatmap-section-title">\uD83D\uDCA4 Sleepers <span class="heatmap-count">(${items.length})</span></div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Aligned companies with zero outreach — potential untapped opportunities</div>
        <div class="heatmap-grid">
          ${items.map(l => {
            const tags = (l.tags || '').split(',').map(t => t.trim()).filter(Boolean);
            const matchedTags = tags.filter(t => ALIGNED_TAGS.includes(t.toLowerCase()));
            return `
            <div class="heatmap-card heatmap-card-sleeper" onclick="openCompanyDetail(${l.id})">
              <div class="heatmap-card-header">
                <span class="heatmap-dot heatmap-dot-sleeper"></span>
                <strong>${esc(l.name)}</strong>
              </div>
              <div class="heatmap-card-stage">${esc(l.pipeline_stage || 'Prospect')}${l.contact_count > 0 ? ` · ${l.contact_count} contact${l.contact_count !== 1 ? 's' : ''}` : ' · no contacts yet'}</div>
              <div class="heatmap-card-reasons">${matchedTags.join(' · ')}</div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  el.innerHTML = renderSection('\uD83D\uDD25 Hot', hot, 'hot')
    + renderSection('\uD83D\uDFE1 Warm', warm, 'warm')
    + renderSection('\uD83D\uDD35 Cold', cold, 'cold')
    + renderSleepers(sleepers);
}
