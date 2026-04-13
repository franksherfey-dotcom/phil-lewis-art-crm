// ── PHIL LEWIS ART CRM — News & Heatmap ──────────────────────────────────────────
// ── INDUSTRY NEWS ─────────────────────────────────────────────────────────
let _newsCache = null;         // raw items from API
var _newsTags  = [];           // active tag filters (multi-select)
let newsSearchTimeout;

async function loadNews(company, forceRefresh) {
  const el = document.getElementById('news-feed');
  if (!el) return;

  if (company) {
    // Company-specific search — bypass cache
    el.innerHTML = '<div class="empty-state">Searching…</div>';
    try {
      const items = await apiFetch(`/api/news?company=${encodeURIComponent(company)}`);
      _newsCache = items;
      renderNews(items);
    } catch(e) {
      el.innerHTML = `<div class="empty-state">Could not load news: ${esc(e.message)}</div>`;
    }
    return;
  }

  if (!_newsCache || forceRefresh) {
    el.innerHTML = '<div class="empty-state">Loading news…</div>';
    try {
      _newsCache = await apiFetch('/api/news');
    } catch(e) {
      el.innerHTML = `<div class="empty-state">Could not load news: ${esc(e.message)}</div>`;
      return;
    }
  }
  applyNewsFilters();
}

function setNewsTag(tag, btn) {
  if (!tag) {
    // "All" button — clear all selections
    _newsTags = [];
  } else {
    var idx = _newsTags.indexOf(tag);
    if (idx === -1) _newsTags.push(tag);
    else _newsTags.splice(idx, 1);
  }
  // Update chip active states
  document.querySelectorAll('.news-tag-chip').forEach(function(c) {
    var chipTag = c.getAttribute('data-tag');
    if (chipTag === '') {
      // "All" chip — active when nothing selected
      c.classList.toggle('news-tag-active', _newsTags.length === 0);
    } else {
      c.classList.toggle('news-tag-active', _newsTags.indexOf(chipTag) !== -1);
    }
  });
  applyNewsFilters();
}

function applyNewsFilters() {
  if (!_newsCache) return;
  var days     = parseInt(document.getElementById('news-date-filter')?.value || '0') || 0;
  var cutoff   = days ? Date.now() - days * 86400000 : 0;
  var company  = document.getElementById('news-company-search')?.value?.trim().toLowerCase() || '';

  var items = _newsCache.filter(function(item) {
    // Tag filter (multi-select OR)
    if (_newsTags.length && !_newsTags.some(function(t) { return (item.tags || []).includes(t); })) return false;
    // Date filter
    if (cutoff && new Date(item.date).getTime() < cutoff) return false;
    // Company text search
    if (company && !(item.title||'').toLowerCase().includes(company) &&
                   !(item.source||'').toLowerCase().includes(company)) return false;
    return true;
  });

  var infoEl = document.getElementById('news-results-info');
  if (infoEl) {
    var filters = [
      _newsTags.length ? _newsTags.map(function(t){ return '#'+t; }).join(', ') : '',
      days ? 'last ' + days + ' days' : '',
      company ? '"' + company + '"' : '',
    ].filter(Boolean).join(' · ');
    infoEl.textContent = filters
      ? items.length + ' article' + (items.length !== 1 ? 's' : '') + ' · ' + filters
      : items.length + ' articles';
  }

  renderNews(items);
  applyHeatmapFilter();
}

function renderNews(items) {
  const el = document.getElementById('news-feed');
  if (!el) return;
  if (!items || items.length === 0) {
    el.innerHTML = '<div class="empty-state">No articles match your filters. Try broadening your search.</div>';
    return;
  }
  el.innerHTML = `<div class="news-grid">${items.map(item => {
    const tags = (item.tags || []);
    const tagChips = tags.map(t =>
      `<span class="tag-chip ${tagClass(t)}">${esc(t)}</span>`
    ).join('');
    const dateStr = item.date ? new Date(item.date).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '';
    const mustRead = item.mustRead;
    return `
      <div class="news-card${mustRead ? ' news-card-must-read' : ''}">
        ${mustRead ? '<div class="news-must-read-badge">Must Read</div>' : ''}
        <div class="news-card-meta">
          <span class="news-source">${esc(item.source||'')}</span>
          <span class="news-date">${dateStr}</span>
        </div>
        <a class="news-title" href="${esc(item.link||'#')}" target="_blank" rel="noopener">${esc(item.title||'')}</a>
        ${tagChips ? `<div class="news-card-tags">${tagChips}</div>` : ''}
      </div>`;
  }).join('')}</div>`;
}

document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('news-company-search');
  if (inp) {
    inp.addEventListener('input', () => {
      clearTimeout(newsSearchTimeout);
      newsSearchTimeout = setTimeout(() => {
        const v = inp.value.trim();
        if (v.length > 2) {
          loadNews(v);
        } else if (v.length === 0) {
          loadNews(null);
        } else {
          applyNewsFilters();
        }
      }, 400);
    });
  }
});

