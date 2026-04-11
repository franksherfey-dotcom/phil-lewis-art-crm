// ── DYNAMIC ART MATCHING ─────────────────────────────────────────────────
// Art images are pulled from the gallery database (_artCache).
// getArtForTags() scores each gallery entry by tag overlap with the
// prospect's company tags, so the best match is always automatic.

function _artToImage(art) {
  const label = (GALLERY_DISPLAY_NAMES && GALLERY_DISPLAY_NAMES[art.category])
    || art.category || art.title;
  return { url: art.url, alt: 'Phil Lewis Art × ' + art.title, label };
}

// Given a tags string (comma-separated), return the best matching art image
function getArtForTags(tagsStr) {
  const cache = (typeof _artCache !== 'undefined' && _artCache && _artCache.length) ? _artCache : [];
  if (!cache.length) {
    // Gallery not loaded yet — return a safe fallback
    return { url: '', alt: 'Phil Lewis Art', label: 'Phil Lewis Art' };
  }
  if (!tagsStr) return _artToImage(cache[0]);

  const prospectTags = tagsStr.toLowerCase().split(',').map(t => t.trim());
  let bestMatch = null;
  let bestScore = 0;

  for (const art of cache) {
    const artTags = (art.tags || '').toLowerCase().split(',').map(t => t.trim());
    const score = prospectTags.filter(t => artTags.includes(t)).length;
    if (score > bestScore) {
      bestScore = score;
      bestMatch = art;
    }
  }

  return _artToImage(bestMatch || cache[0]);
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

// ── QUICK REPLY ─────────────────────────────────────────────────────────

var _replyTemplates = [];
var _qrActivityId = null;
var _qrContactTags = '';
var _qrContext = {};

async function openQuickReply(activityId) {
  _qrActivityId = activityId;
  try {
    // Load templates if not cached
    if (!_replyTemplates.length) {
      _replyTemplates = await apiFetch('/api/reply-templates');
    }

    // Load the activity + contact info
    const activities = await apiFetch(`/api/activities?contact_id=&limit=200`);
    const activity = activities.find(a => a.id == activityId);
    if (!activity) { toast('Activity not found', 'error'); return; }

    // Get company tags for art matching
    if (activity.company_id) {
      try {
        const co = await apiFetch(`/api/companies/${activity.company_id}`);
        _qrContactTags = co.tags || '';
      } catch(e) { _qrContactTags = ''; }
    }

    _qrContext = {
      first_name: activity.first_name || '',
      last_name: activity.last_name || '',
      company: activity.company_name || '',
      original_subject: (activity.subject || '').replace(/^(Re: )+/i, ''),
      contact_email: activity.email || '',
    };

    // Set header
    document.getElementById('qr-header').textContent = `Reply to ${_qrContext.first_name} at ${_qrContext.company}`;

    // Context line
    document.getElementById('qr-context').innerHTML = `
      <strong>To:</strong> ${esc(_qrContext.contact_email)} &nbsp;·&nbsp;
      <strong>Thread:</strong> ${esc(_qrContext.original_subject)}
    `;

    // Template chips
    const chipsEl = document.getElementById('qr-template-chips');
    chipsEl.innerHTML = _replyTemplates.map(t => `
      <button class="btn btn-outline btn-sm" onclick="applyReplyTemplate(${t.id})" style="font-size:12px">${esc(t.name)}</button>
    `).join('');

    // Default subject
    document.getElementById('qr-subject').value = `Re: ${_qrContext.original_subject}`;
    document.getElementById('qr-body').value = '';

    // Show art preview
    renderQuickReplyArt();

    openModal('modal-quick-reply');
  } catch(e) { toast(e.message, 'error'); }
}

function applyReplyTemplate(templateId) {
  const t = _replyTemplates.find(r => r.id == templateId);
  if (!t) return;

  // Fill placeholders
  let body = t.body
    .replace(/\{\{first_name\}\}/g, _qrContext.first_name)
    .replace(/\{\{last_name\}\}/g, _qrContext.last_name)
    .replace(/\{\{company\}\}/g, _qrContext.company)
    .replace(/\{\{original_subject\}\}/g, _qrContext.original_subject);

  // Replace art block placeholder with a text marker (actual art is shown in preview)
  body = body.replace(/\{\{art_block\}\}/g, '[Art image will be embedded below]');

  let subject = (t.subject || 'Re: {{original_subject}}')
    .replace(/\{\{original_subject\}\}/g, _qrContext.original_subject);

  document.getElementById('qr-subject').value = subject;
  document.getElementById('qr-body').value = body;

  // Highlight the selected chip
  document.querySelectorAll('#qr-template-chips .btn').forEach(b => {
    b.classList.remove('btn-primary');
    b.classList.add('btn-outline');
  });
  event.target.classList.remove('btn-outline');
  event.target.classList.add('btn-primary');
}

function renderQuickReplyArt() {
  const el = document.getElementById('qr-art-preview');
  if (!el) return;
  const artImg = getArtForTags(_qrContactTags);
  if (artImg && artImg.url) {
    el.innerHTML = `
      <div style="border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--bg)">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:var(--text-muted);margin-bottom:8px">Art Preview — matched to prospect tags</div>
        <div style="text-align:center">
          <img src="${esc(artImg.url)}" alt="${esc(artImg.alt)}" style="max-width:100%;width:400px;border-radius:6px" />
          <div style="font-size:12px;color:var(--text-muted);margin-top:6px">${esc(artImg.alt)}</div>
        </div>
      </div>`;
  } else {
    el.innerHTML = '';
  }
}

async function sendQuickReply() {
  const subject = document.getElementById('qr-subject').value.trim();
  let body = document.getElementById('qr-body').value.trim();
  if (!body) { toast('Write a message first', 'error'); return; }

  // Replace the art placeholder with actual HTML for the email
  const artImg = getArtForTags(_qrContactTags);
  if (artImg && artImg.url) {
    const artHtml = `<div style="margin:24px 0;text-align:center"><div style="margin-bottom:8px;font-size:13px;color:#666;font-style:italic">${esc(artImg.label)} — Recent Collaboration</div><img src="${artImg.url}" alt="${esc(artImg.alt)}" style="max-width:100%;width:480px;border-radius:8px;border:1px solid #e0e0e0" /><div style="margin-top:8px;font-size:12px;color:#999">${esc(artImg.alt)}</div></div>`;
    body = body.replace('[Art image will be embedded below]', artHtml);
  }

  const btn = document.getElementById('qr-send-btn');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    await apiFetch('/api/quick-reply', {
      method: 'POST',
      body: JSON.stringify({ activity_id: _qrActivityId, subject, body }),
    });
    toast('Reply sent!', 'success');
    closeModal('modal-quick-reply');
    // Refresh dashboard
    if (typeof loadDashboard === 'function') loadDashboard();
  } catch(e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send Reply';
  }
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

var _heatmapCache = null;

// Map consolidated chip tags to the granular company tags they cover
var TAG_GROUP_MAP = {
  'board-sports': ['skateboard','snowboard','surf','ski'],
  'outdoor':      ['outdoor','fishing','camping'],
  'stationery':   ['calendars','cards'],
};

async function loadLeadHeatmap() {
  const el = document.getElementById('lead-heatmap');
  if (!el) return;
  try {
    _heatmapCache = await apiFetch('/api/leads/heatmap');
    applyHeatmapFilter();
  } catch(e) {
    el.innerHTML = `<div class="empty-state">Could not load heat map: ${esc(e.message)}</div>`;
  }
}

function applyHeatmapFilter() {
  if (!_heatmapCache) return;
  var leads = _heatmapCache;
  var company = document.getElementById('news-company-search')?.value?.trim().toLowerCase() || '';
  if (typeof _newsTags !== 'undefined' && _newsTags.length) {
    var allMatchTags = [];
    _newsTags.forEach(function(nt) {
      var mapped = TAG_GROUP_MAP[nt] || [nt];
      mapped.forEach(function(t) { if (allMatchTags.indexOf(t) === -1) allMatchTags.push(t); });
    });
    leads = leads.filter(function(l) {
      var tags = (l.tags || '').toLowerCase().split(',').map(function(t) { return t.trim(); });
      return allMatchTags.some(function(mt) { return tags.indexOf(mt) !== -1; });
    });
  }
  if (company) {
    leads = leads.filter(l => (l.name || '').toLowerCase().includes(company));
  }
  renderLeadHeatmap(leads);
}

function scoreLeadTemperature(lead) {
  var score = 0;
  var factors = []; // { label, points, detail }
  var now = Date.now();

  // Reply sentiment — strongest signal
  if (lead.latest_sentiment === 'positive') {
    score += 40; factors.push({ label: 'Sentiment', points: '+40', detail: 'Positive reply received', cls: 'up' });
  } else if (lead.latest_sentiment === 'neutral') {
    score += 15; factors.push({ label: 'Sentiment', points: '+15', detail: 'Neutral reply received', cls: 'up' });
  } else if (lead.latest_sentiment === 'negative') {
    score -= 20; factors.push({ label: 'Sentiment', points: '-20', detail: 'Negative reply received', cls: 'down' });
  }

  // Got replies at all
  if (lead.reply_count > 0) {
    score += 20; factors.push({ label: 'Replies', points: '+20', detail: lead.reply_count + ' repl' + (lead.reply_count > 1 ? 'ies' : 'y') + ' received', cls: 'up' });
  }

  // Pipeline stage advancement
  var stage = (lead.pipeline_stage || 'prospect').toLowerCase();
  if (stage === 'negotiation' || stage === 'closed-won') {
    score += 25; factors.push({ label: 'Pipeline', points: '+25', detail: 'Stage: ' + (lead.pipeline_stage || 'Prospect'), cls: 'up' });
  } else if (stage === 'proposal') {
    score += 15; factors.push({ label: 'Pipeline', points: '+15', detail: 'Stage: Proposal', cls: 'up' });
  } else if (stage === 'interested') {
    score += 10; factors.push({ label: 'Pipeline', points: '+10', detail: 'Stage: Interested', cls: 'up' });
  } else if (stage === 'outreach') {
    score += 5; factors.push({ label: 'Pipeline', points: '+5', detail: 'Stage: Outreach', cls: 'neutral' });
  }

  // Opportunity value
  var opp = parseFloat(lead.opportunity_value) || 0;
  if (opp >= 10000) {
    score += 10; factors.push({ label: 'Opp Value', points: '+10', detail: '$' + opp.toLocaleString() + ' opportunity', cls: 'up' });
  } else if (opp >= 5000) {
    score += 5; factors.push({ label: 'Opp Value', points: '+5', detail: '$' + opp.toLocaleString() + ' opportunity', cls: 'up' });
  }

  // Active sequences
  if (lead.active_sequences > 0) {
    score += 5; factors.push({ label: 'Sequence', points: '+5', detail: 'Active outreach sequence running', cls: 'neutral' });
  }

  // Recency of last reply
  if (lead.last_reply_at) {
    var replyDays = Math.floor((now - new Date(lead.last_reply_at).getTime()) / 86400000);
    if (replyDays <= 7) {
      score += 15; factors.push({ label: 'Reply Recency', points: '+15', detail: 'Replied ' + (replyDays === 0 ? 'today' : replyDays + 'd ago'), cls: 'up' });
    } else if (replyDays <= 30) {
      score += 5; factors.push({ label: 'Reply Recency', points: '+5', detail: 'Replied ' + replyDays + 'd ago', cls: 'neutral' });
    } else {
      factors.push({ label: 'Reply Recency', points: '0', detail: 'Last reply ' + replyDays + 'd ago', cls: 'neutral' });
    }
  }

  // Recency of any activity
  if (lead.last_activity_at) {
    var actDays = Math.floor((now - new Date(lead.last_activity_at).getTime()) / 86400000);
    if (actDays > 60) {
      score -= 10; factors.push({ label: 'Activity', points: '-10', detail: 'No activity in ' + actDays + ' days', cls: 'down' });
    }
  } else if (lead.emails_sent === 0) {
    score -= 5; factors.push({ label: 'Activity', points: '-5', detail: 'No outreach sent yet', cls: 'down' });
  }

  // Emails sent with no reply
  if (lead.emails_sent > 0 && lead.reply_count === 0) {
    factors.push({ label: 'Engagement', points: '0', detail: lead.emails_sent + ' sent, no reply yet', cls: 'neutral' });
  }

  // Classify
  var temp, cls;
  if (score >= 35) { temp = 'Hot'; cls = 'hot'; }
  else if (score >= 10) { temp = 'Warm'; cls = 'warm'; }
  else { temp = 'Cold'; cls = 'cold'; }

  // Legacy reasons array for compatibility
  var reasons = factors.map(function(f) { return f.detail; });

  return { score: score, temp: temp, cls: cls, reasons: reasons, factors: factors };
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
    if (!items.length) return '<div class="heatmap-section heatmap-' + cls + '"><div class="heatmap-section-title">' + title + ' <span class="heatmap-count">(0)</span></div><div class="heatmap-empty">No ' + title.replace(/[^\w\s]/g,'').trim().toLowerCase() + ' leads</div></div>';
    return '<div class="heatmap-section heatmap-' + cls + '">' +
      '<div class="heatmap-section-title">' + title + ' <span class="heatmap-count">(' + items.length + ')</span></div>' +
      '<div class="heatmap-grid">' +
        items.map(function(l) {
          var factorsHtml = (l.factors || []).map(function(f) {
            return '<div class="score-factor score-factor-' + f.cls + '">' +
              '<span class="score-factor-pts">' + f.points + '</span>' +
              '<span class="score-factor-detail">' + esc(f.detail) + '</span>' +
            '</div>';
          }).join('');
          return '<div class="heatmap-card heatmap-card-' + cls + '" onclick="openCompanyDetail(' + l.id + ')">' +
            '<div class="heatmap-card-header">' +
              '<span class="heatmap-dot heatmap-dot-' + cls + '"></span>' +
              '<strong>' + esc(l.name) + '</strong>' +
              '<span class="heatmap-score">Score: ' + l.score + '</span>' +
            '</div>' +
            '<div class="heatmap-card-stage">' + esc(l.pipeline_stage || 'Prospect') + (l.opportunity_value > 0 ? ' · $' + parseFloat(l.opportunity_value).toLocaleString(undefined,{maximumFractionDigits:0}) : '') + '</div>' +
            '<div class="score-breakdown">' + factorsHtml + '</div>' +
            '<div class="heatmap-card-stats">' +
              '<span title="Emails sent">' + l.emails_sent + ' sent</span>' +
              '<span title="Replies received">' + l.reply_count + ' repl' + (l.reply_count !== 1 ? 'ies' : 'y') + '</span>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';
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

// ── ART GALLERY ──────────────────────────────────────────────────────────
var _artCache = [];
let _galleryFilter = '';

// Pre-load art cache at startup so getArtForTags works from any page
(async function() {
  try { _artCache = await apiFetch('/api/art'); } catch(e) {}
})();

async function loadArtGallery() {
  try {
    _artCache = await apiFetch('/api/art');
    renderGalleryFilters();
    renderArtGallery();
  } catch(e) {
    const el = document.getElementById('gallery-grid');
    if (el) el.innerHTML = `<div class="empty-state">Could not load gallery: ${esc(e.message)}</div>`;
  }
}

var GALLERY_DISPLAY_NAMES = {
  'Wildlife':     'Wildlife',
  'Nature':       'Nature & Landscapes',
  'Psychedelic':  'Psychedelic & Mandala',
  'Fantasy':      'Fantasy & Mythical',
  'Whimsical':    'Whimsical',
  'boards':       'Board Sports',
  'hard-goods':   'Hard Goods',
  'home-decor':   'Home Decor',
  'collectibles': 'Collectibles',
  'apparel':      'Apparel',
  'print':        'Print & Stationery',
  'drinkware':    'Drinkware',
  'kids-games':   'Kids & Games',
  'accessories':  'Accessories',
  'barware':      'Barware',
  'tech':         'Tech',
  'engraving':    'Custom Engraving',
  'disc-sports':  'Disc Sports',
  'stickers':     'Stickers',
  'pets':         'Pets',
};

function renderGalleryFilters() {
  const el = document.getElementById('gallery-filter-chips');
  if (!el) return;
  const cats = [...new Set(_artCache.map(a => a.category).filter(Boolean))];

  el.innerHTML = `
    <span class="tag-filter-chip ${_galleryFilter===''?'active':''}" onclick="filterGallery('')">All (${_artCache.length})</span>
    ${cats.map(c => {
      const count = _artCache.filter(a => a.category === c).length;
      const label = GALLERY_DISPLAY_NAMES[c] || c.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      return `<span class="tag-filter-chip ${_galleryFilter===c?'active':''}" onclick="filterGallery('${esc(c)}')">${esc(label)} (${count})</span>`;
    }).join('')}
  `;
}

function filterGallery(val) {
  _galleryFilter = _galleryFilter === val ? '' : val;
  renderGalleryFilters();
  renderArtGallery();
}

function renderArtGallery() {
  const el = document.getElementById('gallery-grid');
  if (!el) return;
  let items = _artCache;
  if (_galleryFilter) {
    items = items.filter(a => a.category === _galleryFilter || (a.tags||'').includes(_galleryFilter));
  }
  if (!items.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div style="font-size:32px;margin-bottom:8px">🎨</div><p>No art images yet. Click "+ Add Art" to get started.</p></div>`;
    return;
  }
  el.innerHTML = items.map(a => `
    <div class="gallery-card">
      <div class="gallery-card-img-wrap">
        <img src="${esc(a.url)}" alt="${esc(a.title)}" class="gallery-card-img" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 200 150%22><rect fill=%22%23f0f0f0%22 width=%22200%22 height=%22150%22/><text x=%2250%25%22 y=%2250%25%22 fill=%22%23999%22 text-anchor=%22middle%22 dy=%22.3em%22>Image Error</text></svg>'">
      </div>
      <div class="gallery-card-body">
        <div class="gallery-card-title">${esc(a.title)}</div>
        ${a.tags ? `<div class="gallery-card-tags">${a.tags.split(',').map(t => `<span class="tag-chip tag-default">${esc(t.trim())}</span>`).join('')}</div>` : ''}
        ${a.category ? `<div class="gallery-card-cat">${esc(a.category)}</div>` : ''}
        <div class="gallery-card-actions">
          <button class="btn btn-ghost btn-sm" onclick="openArtModal(${a.id})">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteArtImage(${a.id})">Delete</button>
        </div>
      </div>
    </div>
  `).join('');
}

function openArtModal(id = null) {
  const form = document.getElementById('art-form');
  form.reset();
  form.querySelector('[name="art_id"]').value = '';
  document.getElementById('art-form-preview').style.display = 'none';
  document.getElementById('art-modal-title').textContent = id ? 'Edit Art Image' : 'Add Art Image';

  if (id) {
    const art = _artCache.find(a => a.id === id);
    if (art) {
      form.querySelector('[name="art_id"]').value = art.id;
      form.querySelector('[name="art_title"]').value = art.title;
      form.querySelector('[name="art_url"]').value = art.url;
      form.querySelector('[name="art_tags"]').value = art.tags || '';
      form.querySelector('[name="art_category"]').value = art.category || '';
      form.querySelector('[name="art_notes"]').value = art.notes || '';
      // is_default no longer used — art matching is dynamic by tags
      updateArtPreview(art.url);
    }
  }
  openModal('modal-art');
}

function updateArtPreview(url) {
  const wrap = document.getElementById('art-form-preview');
  const img = document.getElementById('art-form-preview-img');
  if (url && url.startsWith('http')) {
    img.src = url;
    wrap.style.display = 'block';
  } else {
    wrap.style.display = 'none';
  }
}

async function saveArtImage(e) {
  e.preventDefault();
  const form = e.target;
  const id = form.querySelector('[name="art_id"]').value;
  const data = {
    title: form.querySelector('[name="art_title"]').value,
    url: form.querySelector('[name="art_url"]').value,
    tags: form.querySelector('[name="art_tags"]').value,
    category: form.querySelector('[name="art_category"]').value,
    notes: form.querySelector('[name="art_notes"]').value,
    is_default: false,
  };
  try {
    if (id) {
      await apiFetch(`/api/art/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      toast('Art image updated', 'success');
    } else {
      await apiFetch('/api/art', { method: 'POST', body: JSON.stringify(data) });
      toast('Art image added', 'success');
    }
    closeModal('modal-art');
    loadArtGallery();
  } catch(err) { toast(err.message, 'error'); }
}

async function deleteArtImage(id) {
  if (!confirm('Delete this art image? It will no longer be available for outreach emails.')) return;
  try {
    await apiFetch(`/api/art/${id}`, { method: 'DELETE' });
    toast('Art image deleted', 'success');
    loadArtGallery();
  } catch(e) { toast(e.message, 'error'); }
}

// ── ART PICKER (for sequence editor steps) ──────────────────────────────
let _artPickerStepNum = null;
let _stepArtOverrides = {}; // stepNum -> artId or null

function openArtPicker(stepNum) {
  _artPickerStepNum = stepNum;
  const content = document.getElementById('art-picker-content');
  content.innerHTML = '<div style="padding:20px;color:var(--text-muted)">Loading art…</div>';
  openModal('modal-art-picker');

  // Get sequence description tags for auto-match highlighting
  const descField = document.querySelector('#sequence-form [name="description"]');
  const desc = descField ? descField.value : '';
  const tagMatch = desc.match(/tags?:\s*([^\n]+)/i);
  const seqTags = (tagMatch ? tagMatch[1] : desc).toLowerCase();

  apiFetch('/api/art').then(arts => {
    if (!arts.length) {
      content.innerHTML = '<div class="empty-state" style="grid-column:1/-1">No art images. Go to Art Gallery to add some.</div>';
      return;
    }
    content.innerHTML = arts.map(a => {
      const artTags = (a.tags||'').toLowerCase().split(',').map(t=>t.trim());
      const isMatch = artTags.some(t => t && seqTags.includes(t));
      return `
        <div class="gallery-card gallery-picker-card ${isMatch ? 'gallery-card-matched' : ''}" onclick="selectArtForStep(${a.id}, '${esc(a.url)}', '${esc(a.title)}')">
          <div class="gallery-card-img-wrap">
            <img src="${esc(a.url)}" alt="${esc(a.title)}" class="gallery-card-img">
            ${isMatch ? '<div class="gallery-match-badge">Tag Match</div>' : ''}
          </div>
          <div class="gallery-card-body">
            <div class="gallery-card-title">${esc(a.title)}</div>
            ${a.tags ? `<div class="gallery-card-tags">${a.tags.split(',').map(t=>`<span class="tag-chip tag-default">${esc(t.trim())}</span>`).join('')}</div>` : ''}
          </div>
        </div>`;
    }).join('');
  }).catch(err => {
    content.innerHTML = `<div style="padding:20px;color:red">${esc(err.message)}</div>`;
  });
}

function selectArtForStep(artId, url, title) {
  _stepArtOverrides[_artPickerStepNum] = { id: artId, url, title };
  updateStepArtPreview(_artPickerStepNum);
  closeModal('modal-art-picker');
  toast(`Art set: ${title}`, 'success');
}

function clearStepArt() {
  _stepArtOverrides[_artPickerStepNum] = null; // explicit "no art"
  updateStepArtPreview(_artPickerStepNum);
  closeModal('modal-art-picker');
  toast('Art removed from this step', '');
}

function updateStepArtPreview(stepNum) {
  const previewEl = document.getElementById(`step-art-preview-${stepNum}`);
  if (!previewEl) return;
  const override = _stepArtOverrides[stepNum];
  if (override === null) {
    // Explicitly no art
    previewEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:8px">No art for this step <button class="btn btn-ghost btn-sm" onclick="openArtPicker(' + stepNum + ')">Change</button></div>';
  } else if (override) {
    previewEl.innerHTML = `
      <div class="step-art-selected">
        <img src="${esc(override.url)}" class="step-art-thumb" />
        <span>${esc(override.title)}</span>
        <button class="btn btn-ghost btn-sm" onclick="openArtPicker(${stepNum})">Change</button>
      </div>`;
  } else {
    // Auto-assigned — show placeholder
    previewEl.innerHTML = `
      <div style="font-size:12px;color:var(--text-muted);padding:8px">
        Auto-matched by tags <button class="btn btn-ghost btn-sm" onclick="openArtPicker(${stepNum})">Override</button>
      </div>`;
  }
}
