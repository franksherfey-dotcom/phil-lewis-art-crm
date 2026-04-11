// ── PHIL LEWIS ART — CATEGORY-TO-IMAGE MAPPING ───────────────────────────
// Maps company tags/categories to Phil's collaboration product images
const ART_IMAGE_MAP = {
  skateboard: {
    url: 'https://phillewisart.com/cdn/shop/articles/soulcraft-header2_600x.jpg?v=1630337503',
    alt: 'Phil Lewis Art × Soulcraft Boards',
    label: 'Board Art',
  },
  surf: {
    url: 'https://phillewisart.com/cdn/shop/articles/soulcraft-header2_600x.jpg?v=1630337503',
    alt: 'Phil Lewis Art × Soulcraft Wake Surf Boards',
    label: 'Board Art',
  },
  snowboard: {
    url: 'https://phillewisart.com/cdn/shop/articles/Final_3_wood_demo_8041b6df-1fe3-4780-98f7-802164043715_600x.jpg?v=1645204598',
    alt: 'Phil Lewis Art × Meier Skis',
    label: 'Board Art',
  },
  outdoor: {
    url: 'https://phillewisart.com/cdn/shop/articles/Final_3_wood_demo_8041b6df-1fe3-4780-98f7-802164043715_600x.jpg?v=1645204598',
    alt: 'Phil Lewis Art × Meier Skis',
    label: 'Outdoor Products',
  },
  drinkware: {
    url: 'https://phillewisart.com/cdn/shop/articles/epic-hero2_600x.jpg?v=1604016747',
    alt: 'Phil Lewis Art × Epic Water Filters',
    label: 'Drinkware',
  },
  puzzles: {
    url: 'https://phillewisart.com/cdn/shop/articles/Phil_Lewis_Product4423WEB_600x.jpg?v=1603909822',
    alt: 'Phil Lewis Art × Liberty Puzzles',
    label: 'Puzzles',
  },
  'hard-goods': {
    url: 'https://phillewisart.com/cdn/shop/articles/Phil_Lewis_Product5843WEB_fadcaa8c-3b21-462c-b8be-26b402bc6f94_600x.jpg?v=1747320948',
    alt: 'Phil Lewis Art × LogoJET UV Products',
    label: 'Hard Goods',
  },
  fabric: {
    url: 'https://phillewisart.com/cdn/shop/articles/Phil_Lewis_Product4973WEB_768653d3-f5fc-42a1-8a97-c2929961780a_600x.jpg?v=1603909864',
    alt: 'Phil Lewis Art × Third Eye Tapestries',
    label: 'Fabric & Tapestries',
  },
  apparel: {
    url: 'https://phillewisart.com/cdn/shop/articles/Phil_Lewis_Product4389WEB_600x.jpg?v=1603909818',
    alt: 'Phil Lewis Art × Grassroots California',
    label: 'Apparel & Accessories',
  },
  footwear: {
    url: 'https://phillewisart.com/cdn/shop/articles/Phil_Lewis_Product4389WEB_600x.jpg?v=1603909818',
    alt: 'Phil Lewis Art × Grassroots California',
    label: 'Footwear & Apparel',
  },
  camping: {
    url: 'https://phillewisart.com/cdn/shop/articles/epic-hero2_600x.jpg?v=1604016747',
    alt: 'Phil Lewis Art × Epic Water Filters',
    label: 'Camping & Outdoor Gear',
  },
  fishing: {
    url: 'https://phillewisart.com/cdn/shop/articles/epic-hero2_600x.jpg?v=1604016747',
    alt: 'Phil Lewis Art × Epic Water Filters',
    label: 'Fishing & Outdoor',
  },
  calendars: {
    url: 'https://phillewisart.com/cdn/shop/articles/Phil_Lewis_Product4423WEB_600x.jpg?v=1603909822',
    alt: 'Phil Lewis Art × Liberty Puzzles',
    label: 'Calendars & Print',
  },
  cards: {
    url: 'https://phillewisart.com/cdn/shop/articles/Phil_Lewis_Product4423WEB_600x.jpg?v=1603909822',
    alt: 'Phil Lewis Art × Liberty Puzzles',
    label: 'Cards & Stationery',
  },
  lifestyle: {
    url: 'https://phillewisart.com/cdn/shop/articles/Phil_Lewis_Product4973WEB_768653d3-f5fc-42a1-8a97-c2929961780a_600x.jpg?v=1603909864',
    alt: 'Phil Lewis Art × Third Eye Tapestries',
    label: 'Lifestyle Products',
  },
};

// Default fallback image (general Phil Lewis art)
const ART_IMAGE_DEFAULT = {
  url: 'https://phillewisart.com/cdn/shop/articles/Phil_Lewis_Product5843WEB_fadcaa8c-3b21-462c-b8be-26b402bc6f94_600x.jpg?v=1747320948',
  alt: 'Phil Lewis Art — Collaboration Products',
  label: 'Phil Lewis Art',
};

// Given a tags string (comma-separated), return the best matching art image
function getArtForTags(tagsStr) {
  if (!tagsStr) return ART_IMAGE_DEFAULT;
  const tags = tagsStr.toLowerCase().split(',').map(t => t.trim());
  for (const tag of tags) {
    if (ART_IMAGE_MAP[tag]) return ART_IMAGE_MAP[tag];
  }
  return ART_IMAGE_DEFAULT;
}

// Build the HTML block that gets embedded in emails
function buildArtImageHtml(artImg) {
  return `
<div style="margin:24px 0;text-align:center">
  <div style="margin-bottom:8px;font-size:13px;color:#666;font-style:italic">${esc(artImg.label)} — Recent Collaboration</div>
  <img src="${artImg.url}" alt="${esc(artImg.alt)}" style="max-width:100%;width:480px;border-radius:8px;border:1px solid #e0e0e0" />
  <div style="margin-top:8px;font-size:12px;color:#999">${esc(artImg.alt)}</div>
</div>`;
}

// Build the preview HTML for the sequence editor (shows art card inline)
function buildArtPreviewCard(artImg) {
  return `
<div class="art-preview-card">
  <div class="art-preview-label">${esc(artImg.label)} — Collaboration Preview</div>
  <img src="${artImg.url}" alt="${esc(artImg.alt)}" class="art-preview-img" />
  <div class="art-preview-caption">${esc(artImg.alt)}</div>
</div>`;
}

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
