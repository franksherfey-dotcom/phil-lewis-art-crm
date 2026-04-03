// ── STATE ──────────────────────────────────────────────────────────────────
const API = '';

// ── MOBILE SIDEBAR ──────────────────────────────────────────────────────────
(function initMobileSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebar-overlay');
  const hamburger = document.getElementById('hamburger');
  if (!sidebar || !overlay || !hamburger) return;

  function openSidebar()  { sidebar.classList.add('open'); overlay.classList.add('open'); }
  function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('open'); }

  hamburger.addEventListener('click', openSidebar);
  overlay.addEventListener('click', closeSidebar);

  // Close sidebar when a nav item is tapped on mobile
  sidebar.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => { if (window.innerWidth <= 768) closeSidebar(); });
  });
})();
let currentEnrollContacts = [];
let currentEnrollmentIdForPreview = null;
let allCompanies = [];
let activeTagFilter = '';
let allTags = [];
let currentDetailCompanyId = null; // tracks which company detail is open when adding/editing contacts

// ── TAG HELPERS ────────────────────────────────────────────────────────────
const PRESET_TAGS = [
  'apparel','hard-goods','outdoor','skateboard','snowboard','surf',
  'fishing','camping','drinkware','footwear','puzzles','calendars',
  'fabric','cards','lifestyle'
];

function tagClass(tag) {
  const slug = tag.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
  return PRESET_TAGS.includes(slug) ? `tag-${slug}` : 'tag-default';
}

function renderTagChips(tagsStr) {
  if (!tagsStr) return '';
  return tagsStr.split(',').map(t => t.trim()).filter(Boolean)
    .map(t => `<span class="tag-chip ${tagClass(t)}">${esc(t)}</span>`).join('');
}

async function loadAllTags() {
  allTags = await apiFetch('/api/tags');
  // Populate filter dropdown
  const sel = document.getElementById('filter-tag');
  if (!sel) return;
  sel.innerHTML = `<option value="">All Tags</option>` +
    allTags.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  // Render clickable chips below filters
  renderTagFilterChips();
}

function renderTagFilterChips() {
  const el = document.getElementById('tag-filter-chips');
  if (!el || !allTags.length) return;
  el.innerHTML = allTags.map(t => `
    <span class="tag-filter-chip ${activeTagFilter===t?'active':''}" onclick="setTagFilter('${esc(t)}')">${esc(t)}</span>
  `).join('');
}

function setTagFilter(tag) {
  activeTagFilter = activeTagFilter === tag ? '' : tag;
  const sel = document.getElementById('filter-tag');
  if (sel) sel.value = activeTagFilter;
  renderTagFilterChips();
  loadCompanies();
}

// ── NAVIGATION ────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => showPage(item.dataset.page));
});

function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const el = document.getElementById(`page-${page}`);
  if (el) el.classList.add('active');
  const nav = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (nav) nav.classList.add('active');

  if (page === 'dashboard') loadDashboard();
  if (page === 'prospects') { loadAllTags(); loadCompanies(); }
  if (page === 'contacts') loadContacts();
  if (page === 'pipeline') loadPipeline();
  if (page === 'sequences') loadSequences();
  if (page === 'queue') loadQueue();
  if (page === 'inbox') loadInbox();
  if (page === 'activity') loadActivity();
  if (page === 'settings') loadSettings();
  if (page === 'reports') loadReports();
  if (page === 'news') loadNews();
}

// ── API HELPERS ────────────────────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
  const res = await fetch(API + url, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ── TOAST ──────────────────────────────────────────────────────────────────
let toastTimeout;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { el.className = 'toast hidden'; }, 3500);
}

// ── MODAL ──────────────────────────────────────────────────────────────────
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function openModal(id) {
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  document.body.appendChild(el); // ensure this modal is on top of any other open modal
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });
});

// ── DASHBOARD ─────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const [d, stuckData, inboxData] = await Promise.all([
      apiFetch('/api/dashboard'),
      apiFetch('/api/pipeline/stuck-count').catch(() => ({ count: 0 })),
      apiFetch('/api/inbox?limit=0').catch(() => ({ unreadCount: 0 })),
    ]);
    updateBadge('badge-inbox', inboxData.unreadCount || 0);
    const stuckCount = stuckData.count || 0;
    const stuckClass = stuckCount > 0 ? 'stat-card stat-stuck stat-clickable' : 'stat-card stat-clickable';
    document.getElementById('stats-grid').innerHTML = `
      <div class="stat-card stat-clickable" onclick="showPage('prospects')" title="View all companies">
        <div class="stat-label">Companies</div>
        <div class="stat-value">${d.totalCompanies}</div>
        <div class="stat-sub">in your prospect list</div>
        <div class="stat-link-hint">View prospects →</div>
      </div>
      <div class="stat-card stat-clickable" onclick="showPage('pipeline')" title="View contact pipeline">
        <div class="stat-label">Contacts</div>
        <div class="stat-value">${d.totalContacts}</div>
        <div class="stat-sub">across all companies</div>
        <div class="stat-link-hint">View pipeline →</div>
      </div>
      <div class="stat-card highlight stat-clickable" onclick="showPage('sequences')" title="View email sequences">
        <div class="stat-label">Active Sequences</div>
        <div class="stat-value">${d.activeEnrollments}</div>
        <div class="stat-sub">contacts enrolled</div>
        <div class="stat-link-hint">View sequences →</div>
      </div>
      <div class="stat-card stat-clickable" onclick="showPage('activity')" title="View activity log">
        <div class="stat-label">Emails Sent</div>
        <div class="stat-value">${d.emailsSent}</div>
        <div class="stat-sub">total outreach</div>
        <div class="stat-link-hint">View activity →</div>
      </div>
      <div class="stat-card queue stat-clickable" onclick="showPage('queue')" title="View outreach queue">
        <div class="stat-label">Queue Today</div>
        <div class="stat-value">${d.queueCount}</div>
        <div class="stat-sub">ready to send</div>
        <div class="stat-link-hint">View queue →</div>
      </div>
      <div class="${stuckClass}" onclick="showPage('pipeline')" title="View stuck contacts in pipeline" style="${stuckCount > 0 ? 'border-color:var(--danger);' : ''}">
        <div class="stat-label" style="${stuckCount > 0 ? 'color:var(--danger);' : ''}">Stuck</div>
        <div class="stat-value" style="${stuckCount > 0 ? 'color:var(--danger);' : ''}">${stuckCount}</div>
        <div class="stat-sub">${stuckCount > 0 ? 'no contact in 2+ weeks' : 'no stuck contacts'}</div>
        <div class="stat-link-hint">View pipeline →</div>
      </div>
    `;
    updateBadge('badge-queue', d.queueCount);

    const actEl = document.getElementById('recent-activity');
    if (!d.recentActivity.length) {
      actEl.innerHTML = `<div class="empty-state">No activity yet. Add prospects and enroll them in a sequence to get started.</div>`;
      return;
    }
    actEl.innerHTML = `<div class="activity-list">${d.recentActivity.map(a => `
      <div class="activity-row">
        <div class="activity-name">
          ${a.contact_id
            ? `<a href="#" class="contact-name-link" onclick="event.preventDefault();openContactDetail(${a.contact_id})">${esc(a.first_name)} ${esc(a.last_name||'')}</a>`
            : `${esc(a.first_name)} ${esc(a.last_name||'')}`
          }
        </div>
        <div class="activity-co">${esc(a.company_name||'—')}</div>
        <div class="activity-subj">${esc(a.subject||'—')}</div>
        <div class="activity-date">${fmtDate(a.sent_at)}</div>
      </div>
    `).join('')}</div>`;
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
    const [contact, activities] = await Promise.all([
      apiFetch(`/api/contacts/${contactId}`),
      apiFetch(`/api/activities?contact_id=${contactId}`),
    ]);

    // Fetch enrollment info from pipeline
    let enrollmentInfo = null;
    try {
      const pipeline = await apiFetch('/api/pipeline');
      enrollmentInfo = pipeline.find(p => p.id === contactId) || null;
    } catch(e) { /* ignore */ }

    const statusLabel = enrollmentInfo
      ? (enrollmentInfo.enrollment_status || 'not enrolled')
      : 'not enrolled';
    const statusColor = {
      active: 'var(--primary)',
      completed: 'var(--success)',
      replied: 'var(--success)',
      stopped: 'var(--text-muted)',
    }[statusLabel] || 'var(--text-muted)';

    const activityRows = activities.length
      ? activities.map(a => `
        <tr>
          <td style="color:var(--text-muted);white-space:nowrap">${fmtDate(a.sent_at)}</td>
          <td>
            <span class="status-pill" style="background:var(--primary-pale);color:var(--primary);font-size:10px">
              ${esc(a.type === 'received_email' ? 'reply received' : a.type)}
            </span>
          </td>
          <td style="font-size:12px">${esc(a.subject||'—')}</td>
        </tr>
      `).join('')
      : `<tr><td colspan="3" style="color:var(--text-muted);text-align:center;padding:12px">No activity recorded yet.</td></tr>`;

    document.getElementById('contact-detail-title').textContent =
      `${contact.first_name} ${contact.last_name || ''}`.trim();

    document.getElementById('contact-detail-body').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div>
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Name</div>
          <div style="font-size:14px;font-weight:600">${esc(contact.first_name)} ${esc(contact.last_name||'')}</div>
        </div>
        ${contact.title ? `
        <div>
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Title</div>
          <div style="font-size:13px">${esc(contact.title)}</div>
        </div>` : ''}
        ${contact.company_name ? `
        <div>
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Company</div>
          <div style="font-size:13px">
            ${contact.company_id
              ? `<a href="#" onclick="event.preventDefault();closeModal('modal-contact-detail');openCompanyDetail(${contact.company_id})">${esc(contact.company_name)}</a>`
              : esc(contact.company_name)
            }
          </div>
        </div>` : ''}
        ${contact.email ? `
        <div>
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Email</div>
          <div style="font-size:13px"><a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a></div>
        </div>` : ''}
        <div>
          <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">Sequence Status</div>
          <div style="font-size:13px">
            <span style="color:${statusColor};font-weight:600;text-transform:capitalize">${esc(statusLabel)}</span>
            ${enrollmentInfo && enrollmentInfo.sequence_name ? ` — <span style="font-size:12px;color:var(--text-muted)">${esc(enrollmentInfo.sequence_name)}</span>` : ''}
            ${enrollmentInfo && enrollmentInfo.enrollment_status === 'active' && enrollmentInfo.total_steps
              ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">Step ${enrollmentInfo.current_step} of ${enrollmentInfo.total_steps}</div>`
              : ''}
          </div>
        </div>
      </div>

      <div style="margin-bottom:6px;font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">
        Communications (${activities.length})
      </div>
      <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden">
        <table class="data-table" style="margin:0;font-size:12px">
          <thead>
            <tr>
              <th style="width:110px">Date</th>
              <th style="width:110px">Type</th>
              <th>Subject</th>
            </tr>
          </thead>
          <tbody>${activityRows}</tbody>
        </table>
      </div>

      <div style="margin-top:14px;text-align:right">
        ${contact.company_id
          ? `<a href="#" class="btn btn-outline btn-sm" onclick="event.preventDefault();closeModal('modal-contact-detail');showPage('pipeline')">View in Pipeline →</a>`
          : ''}
      </div>
    `;

    openModal('modal-contact-detail');
  } catch(e) { toast(e.message, 'error'); }
}

// ── COMPANIES ─────────────────────────────────────────────────────────────
async function loadCompanies() {
  const search = document.getElementById('search-companies')?.value || '';
  const type = document.getElementById('filter-type')?.value || '';
  const status = document.getElementById('filter-status')?.value || '';
  const tag = document.getElementById('filter-tag')?.value || activeTagFilter || '';
  let url = '/api/companies?';
  if (search) url += `search=${encodeURIComponent(search)}&`;
  if (type) url += `type=${encodeURIComponent(type)}&`;
  if (status) url += `status=${encodeURIComponent(status)}&`;
  if (tag) url += `tag=${encodeURIComponent(tag)}&`;
  try {
    const companies = await apiFetch(url);
    allCompanies = companies;
    updateBadge('badge-prospects', companies.length);
    const el = document.getElementById('companies-list');
    if (!companies.length) {
      el.innerHTML = `<div class="empty-state"><div style="font-size:32px;margin-bottom:8px">◎</div><p>No companies match your filters.</p></div>`;
      return;
    }
    el.innerHTML = companies.map(c => `
      <div class="company-card" onclick="openCompanyDetail(${c.id})">
        <div class="company-card-header">
          <div class="company-name">${esc(c.name)}</div>
          <span class="type-badge type-${c.type}">${typeName(c.type)}</span>
        </div>
        ${c.tags ? `<div class="company-tags">${renderTagChips(c.tags)}</div>` : ''}
        <div class="company-meta">
          ${c.city ? `<span>📍 ${esc(c.city)}${c.state ? ', '+esc(c.state) : ''}</span>` : ''}
          ${c.category ? `<span>${esc(c.category)}</span>` : ''}
        </div>
        <div class="company-footer">
          <span class="status-pill status-${c.status.replace(/\s/g,'-')}">${esc(c.status)}</span>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="contact-count">${c.contact_count} contact${c.contact_count!==1?'s':''}</span>
            <div class="card-actions" onclick="event.stopPropagation()">
              <button class="btn btn-outline btn-sm campaign-btn" onclick="openEnrollModal(${c.id})" title="Add contacts to a campaign">＋ Campaign</button>
              <button class="btn btn-ghost btn-sm" onclick="openCompanyModal(${c.id})">Edit</button>
              <button class="btn btn-danger btn-sm" onclick="deleteCompany(${c.id})">Delete</button>
            </div>
          </div>
        </div>
      </div>
    `).join('');
  } catch(e) { toast(e.message, 'error'); }
}

async function openCompanyDetail(id) {
  try {
    currentDetailCompanyId = id;
    const c = await apiFetch(`/api/companies/${id}`);
    document.getElementById('company-detail-name').textContent = c.name;
    const PIPELINE_STAGES = ['Prospect','Contacted','Interested','Proposal Sent','Negotiating','Closed Won','Closed Lost'];
    document.getElementById('company-detail-content').innerHTML = `
      <div class="detail-section">
        <div class="detail-meta-grid">
          <div class="detail-meta-item"><label>Type</label><p>${typeName(c.type)}</p></div>
          <div class="detail-meta-item"><label>Status</label><p><span class="status-pill status-${c.status.replace(/\s/g,'-')}">${esc(c.status)}</span></p></div>
          ${c.website ? `<div class="detail-meta-item"><label>Website</label><p><a href="${esc(c.website.startsWith('http')?c.website:'https://'+c.website)}" target="_blank">${esc(c.website)}</a></p></div>` : ''}
          ${c.phone ? `<div class="detail-meta-item"><label>Phone</label><p>${esc(c.phone)}</p></div>` : ''}
          ${c.city ? `<div class="detail-meta-item"><label>Location</label><p>${esc(c.city)}${c.state?', '+esc(c.state):''}</p></div>` : ''}
          ${c.category ? `<div class="detail-meta-item"><label>Category</label><p>${esc(c.category)}</p></div>` : ''}
          ${c.tags ? `<div class="detail-meta-item" style="grid-column:1/-1"><label>Tags</label><p>${renderTagChips(c.tags)}</p></div>` : ''}
        </div>
        ${c.notes ? `<div style="margin-top:12px;font-size:13px;color:var(--text-muted);line-height:1.5">${esc(c.notes)}</div>` : ''}
      </div>

      <!-- Pipeline Fields -->
      <div class="detail-section detail-pipeline-section">
        <div class="detail-section-header"><h3>Deal Info</h3></div>
        <div class="pipeline-fields-grid">
          <div class="pipeline-field">
            <label>Pipeline Stage</label>
            <select id="pf-stage" onchange="savePipelineField(${c.id},'pipeline_stage',this.value)">
              ${PIPELINE_STAGES.map(s=>`<option value="${s}"${(c.pipeline_stage||'Prospect')===s?' selected':''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="pipeline-field">
            <label>Opp Value ($)</label>
            <input type="number" id="pf-opp" value="${c.opportunity_value||''}" placeholder="0" min="0"
              onblur="savePipelineField(${c.id},'opportunity_value',this.value)">
          </div>
          <div class="pipeline-field" style="grid-column:1/-1">
            <label>Next Step</label>
            <input type="text" id="pf-next" value="${esc(c.next_step||'')}" placeholder="e.g. Follow up with art director…"
              onblur="savePipelineField(${c.id},'next_step',this.value)">
          </div>
          <div class="pipeline-field">
            <label>Due Date</label>
            <input type="date" id="pf-date" value="${c.next_step_date||''}"
              onchange="savePipelineField(${c.id},'next_step_date',this.value)">
          </div>
        </div>
      </div>
      <div class="detail-section">
        <div class="detail-section-header">
          <h3>Contacts <span class="contact-count-badge">${c.contacts.length}</span></h3>
          <button class="btn btn-primary btn-sm" onclick="openContactModalFromDetail(null, ${c.id})">+ Add Contact</button>
        </div>
        ${c.contacts.length ? `
          <div class="contact-rows">
            ${c.contacts.map(ct => `
              <div class="contact-detail-row">
                <div class="contact-detail-main">
                  <div class="contact-detail-name">
                    ${ct.is_primary ? '<span class="primary-badge">★ Primary</span>' : ''}
                    <strong>${esc(ct.first_name)} ${esc(ct.last_name||'')}</strong>
                    ${ct.title ? `<span class="contact-detail-title">${esc(ct.title)}</span>` : ''}
                  </div>
                  <div class="contact-detail-links">
                    ${ct.email ? `<a href="mailto:${esc(ct.email)}" class="contact-link email-link">✉ ${esc(ct.email)}</a>` : ''}
                    ${ct.phone ? `<span class="contact-link phone-link">✆ ${esc(ct.phone)}</span>` : ''}
                    ${ct.linkedin ? `<a href="${esc(ct.linkedin.startsWith('http')?ct.linkedin:'https://'+ct.linkedin)}" target="_blank" class="contact-link linkedin-link">in LinkedIn</a>` : ''}
                  </div>
                  ${ct.notes ? `<div class="contact-detail-notes">${esc(ct.notes)}</div>` : ''}
                </div>
                <div class="contact-detail-actions">
                  <button class="btn btn-ghost btn-sm" onclick="openContactModalFromDetail(${ct.id}, ${c.id})">Edit</button>
                  <button class="btn btn-danger btn-sm" onclick="deleteContactFromDetail(${ct.id}, ${c.id})">Delete</button>
                </div>
              </div>
            `).join('')}
          </div>
          <div class="enroll-btn-row" style="margin-top:14px;position:relative">
            <button class="btn btn-outline btn-sm" onclick="toggleEnrollDropdown(${c.id}, this)">＋ Add to Campaign ▾</button>
          </div>
        ` : `
          <div class="empty-state" style="padding:24px;text-align:center">
            <div style="font-size:28px;margin-bottom:8px">◉</div>
            <p style="margin-bottom:12px">No contacts yet. Add the key person to reach out to.</p>
          </div>
        `}
      </div>
    `;
    openModal('modal-company-detail');
  } catch(e) { toast(e.message, 'error'); }
}

async function savePipelineField(companyId, field, value) {
  try {
    await apiFetch(`/api/companies/${companyId}`, { method:'PATCH', body: JSON.stringify({ [field]: value }) });
    toast('Saved');
  } catch(e) { toast(e.message, 'error'); }
}

function openContactModalFromDetail(contactId, companyId) {
  currentDetailCompanyId = companyId;
  openContactModal(contactId, companyId);
}

async function deleteContactFromDetail(contactId, companyId) {
  if (!confirm('Delete this contact?')) return;
  try {
    await apiFetch(`/api/contacts/${contactId}`, { method: 'DELETE' });
    toast('Contact deleted');
    openCompanyDetail(companyId);
  } catch(e) { toast(e.message, 'error'); }
}

function buildTagPicker(selectedTags = []) {
  const picker = document.getElementById('tag-picker');
  if (!picker) return;
  const selected = new Set(selectedTags.map(t => t.trim().toLowerCase()).filter(Boolean));
  const renderPicker = () => {
    picker.innerHTML = PRESET_TAGS.map(t => `
      <span class="tag-picker-chip ${selected.has(t)?'selected':''}" onclick="toggleTag('${t}')">${t}</span>
    `).join('');
    document.querySelector('[name="tags"]').value = [...selected].join(',');
  };
  window.toggleTag = (t) => {
    if (selected.has(t)) selected.delete(t); else selected.add(t);
    renderPicker();
  };
  renderPicker();
}

function openCompanyModal(id = null) {
  const form = document.getElementById('company-form');
  form.reset();
  form.querySelector('[name="id"]').value = '';
  document.getElementById('company-modal-title').textContent = id ? 'Edit Company' : 'Add Company';
  buildTagPicker([]);
  if (id) {
    apiFetch(`/api/companies/${id}`).then(c => {
      form.querySelector('[name="id"]').value = c.id;
      form.querySelector('[name="name"]').value = c.name;
      form.querySelector('[name="type"]').value = c.type;
      form.querySelector('[name="website"]').value = c.website||'';
      form.querySelector('[name="phone"]').value = c.phone||'';
      form.querySelector('[name="category"]').value = c.category||'';
      form.querySelector('[name="status"]').value = c.status;
      form.querySelector('[name="city"]').value = c.city||'';
      form.querySelector('[name="state"]').value = c.state||'';
      form.querySelector('[name="notes"]').value = c.notes||'';
      buildTagPicker((c.tags||'').split(','));
    });
  }
  openModal('modal-company');
}

async function saveCompany(e) {
  e.preventDefault();
  const form = e.target;
  const id = form.querySelector('[name="id"]').value;
  const body = {
    name: form.querySelector('[name="name"]').value,
    type: form.querySelector('[name="type"]').value,
    website: form.querySelector('[name="website"]').value,
    phone: form.querySelector('[name="phone"]').value,
    category: form.querySelector('[name="category"]').value,
    status: form.querySelector('[name="status"]').value,
    city: form.querySelector('[name="city"]').value,
    state: form.querySelector('[name="state"]').value,
    notes: form.querySelector('[name="notes"]').value,
    tags: form.querySelector('[name="tags"]').value,
  };
  try {
    if (id) {
      await apiFetch(`/api/companies/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      toast('Company updated');
    } else {
      await apiFetch('/api/companies', { method: 'POST', body: JSON.stringify(body) });
      toast('Company added', 'success');
    }
    closeModal('modal-company');
    loadCompanies();
    loadAllTags();
  } catch(err) { toast(err.message, 'error'); }
}

async function deleteCompany(id) {
  if (!confirm('Delete this company and all its contacts? This cannot be undone.')) return;
  try {
    await apiFetch(`/api/companies/${id}`, { method: 'DELETE' });
    toast('Company deleted');
    loadCompanies();
  } catch(e) { toast(e.message, 'error'); }
}

// ── CONTACTS ──────────────────────────────────────────────────────────────
async function loadContacts() {
  const search = document.getElementById('search-contacts')?.value || '';
  let url = '/api/contacts?';
  if (search) url += `search=${encodeURIComponent(search)}&`;
  try {
    const contacts = await apiFetch(url);
    const tbody = document.getElementById('contacts-tbody');
    if (!contacts.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No contacts yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = contacts.map(c => `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:6px">
            ${c.is_primary ? '<span class="primary-badge" title="Primary contact">★</span>' : ''}
            <strong>${esc(c.first_name)} ${esc(c.last_name||'')}</strong>
          </div>
        </td>
        <td>${esc(c.title||'—')}</td>
        <td>${c.company_name ? `<a href="#" onclick="event.preventDefault();openCompanyDetail(${c.company_id||0})">${esc(c.company_name)}</a>` : '—'}</td>
        <td>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '—'}</td>
        <td>${esc(c.phone||'—')}</td>
        <td>${c.linkedin ? `<a href="${esc(c.linkedin.startsWith('http')?c.linkedin:'https://'+c.linkedin)}" target="_blank" class="linkedin-table-link">View</a>` : '—'}</td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" onclick="openContactModal(${c.id})">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteContact(${c.id})">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch(e) { toast(e.message, 'error'); }
}

async function openContactModal(id = null, companyId = null) {
  const form = document.getElementById('contact-form');
  form.reset();
  form.querySelector('[name="id"]').value = '';
  document.getElementById('contact-modal-title').textContent = id ? 'Edit Contact' : 'Add Contact';

  // Populate company dropdown
  const companies = allCompanies.length ? allCompanies : await apiFetch('/api/companies');
  if (!allCompanies.length) allCompanies = companies;
  const sel = document.getElementById('contact-company-select');
  sel.innerHTML = `<option value="">— None —</option>` +
    companies.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  if (companyId) sel.value = companyId;

  if (id) {
    const c = await apiFetch(`/api/contacts/${id}`);
    form.querySelector('[name="id"]').value = c.id;
    form.querySelector('[name="first_name"]').value = c.first_name;
    form.querySelector('[name="last_name"]').value = c.last_name||'';
    form.querySelector('[name="email"]').value = c.email||'';
    form.querySelector('[name="phone"]').value = c.phone||'';
    form.querySelector('[name="title"]').value = c.title||'';
    form.querySelector('[name="linkedin"]').value = c.linkedin||'';
    form.querySelector('[name="notes"]').value = c.notes||'';
    form.querySelector('[name="is_primary"]').checked = !!c.is_primary;
    sel.value = c.company_id || '';
  }
  openModal('modal-contact');
}

async function saveContact(e) {
  e.preventDefault();
  const form = e.target;
  const id = form.querySelector('[name="id"]').value;
  const sel = document.getElementById('contact-company-select');
  const body = {
    company_id: sel.value || null,
    first_name: form.querySelector('[name="first_name"]').value,
    last_name: form.querySelector('[name="last_name"]').value,
    email: form.querySelector('[name="email"]').value,
    phone: form.querySelector('[name="phone"]').value,
    title: form.querySelector('[name="title"]').value,
    linkedin: form.querySelector('[name="linkedin"]').value,
    notes: form.querySelector('[name="notes"]').value,
    is_primary: form.querySelector('[name="is_primary"]').checked,
  };
  try {
    if (id) {
      await apiFetch(`/api/contacts/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      toast('Contact updated');
    } else {
      await apiFetch('/api/contacts', { method: 'POST', body: JSON.stringify(body) });
      toast('Contact added', 'success');
    }
    closeModal('modal-contact');
    const detailId = currentDetailCompanyId;
    currentDetailCompanyId = null;
    if (detailId) {
      openCompanyDetail(detailId); // refresh the company detail view
    } else {
      loadContacts();
      loadCompanies();
    }
  } catch(err) { toast(err.message, 'error'); }
}

async function deleteContact(id) {
  if (!confirm('Delete this contact?')) return;
  try {
    await apiFetch(`/api/contacts/${id}`, { method: 'DELETE' });
    toast('Contact deleted');
    loadContacts();
  } catch(e) { toast(e.message, 'error'); }
}

// ── SEQUENCES ─────────────────────────────────────────────────────────────
async function loadSequences() {
  try {
    const seqs = await apiFetch('/api/sequences');
    const el = document.getElementById('sequences-list');
    if (!seqs.length) {
      el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div style="font-size:32px;margin-bottom:8px">◈</div><p>No sequences yet. Create one to start automating your outreach.</p></div>`;
      return;
    }
    el.innerHTML = seqs.map(s => `
      <div class="seq-card">
        <div class="seq-card-header">
          <div class="seq-name">${esc(s.name)}</div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" onclick="openSequenceModal(${s.id})">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteSequence(${s.id})">Delete</button>
          </div>
        </div>
        ${s.description ? `<div class="seq-desc">${esc(s.description)}</div>` : ''}
        <div class="seq-steps-preview">
          ${s.steps.map(st => `
            <div class="seq-step-row">
              <div class="seq-step-num">${st.step_number}</div>
              <div class="seq-step-info">${esc(st.subject)}</div>
              <div class="seq-step-delay">${st.step_number===1 ? 'Day 0 (immediate)' : `+${st.delay_days} day${st.delay_days!==1?'s':''}`}</div>
            </div>
          `).join('')}
        </div>
        <div class="seq-footer">
          <span class="enrolled-count">${s.enrollment_count} contact${s.enrollment_count!==1?'s':''} enrolled</span>
          <button class="btn btn-primary btn-sm" onclick="openEnrollModalForSeq(${s.id})">Enroll Contacts</button>
        </div>
      </div>
    `).join('');
  } catch(e) { toast(e.message, 'error'); }
}

let stepCount = 0;
function openSequenceModal(id = null) {
  const form = document.getElementById('sequence-form');
  form.reset();
  form.querySelector('[name="id"]').value = '';
  stepCount = 0;
  document.getElementById('steps-container').innerHTML = '';
  document.getElementById('sequence-modal-title').textContent = id ? 'Edit Sequence' : 'New Sequence';
  if (id) {
    apiFetch(`/api/sequences/${id}`).then(s => {
      form.querySelector('[name="id"]').value = s.id;
      form.querySelector('[name="name"]').value = s.name;
      form.querySelector('[name="description"]').value = s.description||'';
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
      <label>Email Body</label>
      <textarea name="step_body_${n}" rows="6" placeholder="Hi {{first_name}},\n\nI'm Frank Sherfey, licensing representative for Phil Lewis..." required>${data ? esc(data.body) : ''}</textarea>
    </div>
  `;
  container.appendChild(div);
}

function removeStep(n) {
  const el = document.getElementById(`step-block-${n}`);
  if (el) el.remove();
}

async function saveSequence(e) {
  e.preventDefault();
  const form = e.target;
  const id = form.querySelector('[name="id"]').value;
  const name = form.querySelector('[name="name"]').value;
  const description = form.querySelector('[name="description"]').value;

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
      await apiFetch(`/api/sequences/${id}`, { method: 'PUT', body: JSON.stringify({ name, description, steps }) });
      toast('Sequence updated');
    } else {
      await apiFetch('/api/sequences', { method: 'POST', body: JSON.stringify({ name, description, steps }) });
      toast('Sequence created', 'success');
    }
    closeModal('modal-sequence');
    loadSequences();
  } catch(err) { toast(err.message, 'error'); }
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

async function _prepareEnrollModal(companyId, sequenceId) {
  try {
    const [sequences, contacts] = await Promise.all([
      apiFetch('/api/sequences'),
      apiFetch(`/api/contacts${companyId ? `?company_id=${companyId}` : ''}`),
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

    currentEnrollContacts = contacts;
    const listEl = document.getElementById('enroll-contacts-list');
    if (!contacts.length) {
      listEl.innerHTML = `<div class="empty-state" style="padding:16px">No contacts found${companyId ? ' for this company' : ''}.</div>`;
    } else {
      listEl.innerHTML = contacts.map(c => `
        <div class="enroll-contact-row">
          <input type="checkbox" id="enroll-c-${c.id}" value="${c.id}" ${c.email ? 'checked' : 'disabled'}>
          <label for="enroll-c-${c.id}">
            <div class="enroll-contact-name">${esc(c.first_name)} ${esc(c.last_name||'')}${c.company_name ? ` — ${esc(c.company_name)}` : ''}</div>
            <div class="enroll-contact-email">${c.email ? esc(c.email) : '⚠ No email address'}</div>
          </label>
        </div>
      `).join('');
    }
    openModal('modal-enroll');
  } catch(e) { toast(e.message, 'error'); }
}

async function confirmEnroll() {
  const seqId = document.getElementById('enroll-sequence-select').value;
  const checked = [...document.querySelectorAll('#enroll-contacts-list input[type=checkbox]:checked')].map(el => parseInt(el.value));
  if (!checked.length) { toast('Select at least one contact', 'error'); return; }
  try {
    const r = await apiFetch('/api/enrollments', { method: 'POST', body: JSON.stringify({ contact_ids: checked, sequence_id: seqId }) });
    toast(`${r.enrolled} contact${r.enrolled!==1?'s':''} enrolled`, 'success');
    closeModal('modal-enroll');
    closeModal('modal-company-detail');
    loadQueue();
    updateBadge('badge-queue', null); // will refresh
    loadDashboard();
  } catch(e) { toast(e.message, 'error'); }
}

// ── QUEUE ─────────────────────────────────────────────────────────────────
let _queueCache = [];

async function loadQueue() {
  try {
    const queue = await apiFetch('/api/queue');
    _queueCache = queue;
    updateBadge('badge-queue', queue.length);
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
      return;
    }

    if (btn) btn.disabled = false;
    infoEl.textContent = `${queue.length} email${queue.length!==1?'s':''} ready to send`;
    listEl.innerHTML = `<div class="queue-list">${queue.map((item, i) => `
      <div class="queue-item queue-item-clickable" onclick="openQueueDetail(${i})">
        <div class="queue-item-info">
          <div class="queue-contact">${esc(item.first_name)} ${esc(item.last_name||'')}</div>
          <div class="queue-company">${esc(item.company_name||'No company')} ${item.company_type ? `· ${typeName(item.company_type)}` : ''}</div>
          ${item.email ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(item.email)}</div>` : ''}
          <div class="queue-seq">${esc(item.sequence_name)}</div>
          <span class="queue-step-badge">Step ${item.current_step} of ${item.total_steps}</span>
          <div class="queue-subject">"${esc(item.step_subject)}"</div>
        </div>
        <div class="queue-actions" onclick="event.stopPropagation()">
          <button class="btn btn-ghost btn-sm" onclick="previewEmail(${item.enrollment_id})">Preview</button>
          <button class="btn btn-primary btn-sm" onclick="sendOne(${item.enrollment_id})">Send</button>
        </div>
      </div>
    `).join('')}</div>`;
  } catch(e) { toast(e.message, 'error'); }
}

async function openQueueDetail(index) {
  const item = _queueCache[index];
  if (!item) return;

  // Fetch the interpolated preview
  let preview = { subject: item.step_subject, body: item.step_body || '' };
  try {
    preview = await apiFetch(`/api/queue/preview/${item.enrollment_id}`);
  } catch(e) {}

  const fullName = [item.first_name, item.last_name].filter(Boolean).join(' ') || 'Unknown';

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
      <textarea id="queue-edit-body" class="queue-detail-textarea" rows="12">${esc(preview.body)}</textarea>
    </div>

    <div class="queue-detail-actions">
      <button class="btn btn-primary" onclick="sendFromQueueDetail(${item.enrollment_id})">Send Email</button>
      <button class="btn btn-outline" onclick="closeModal('modal-queue-detail')">Cancel</button>
    </div>
  `;
  openModal('modal-queue-detail');
}

async function sendFromQueueDetail(enrollmentId) {
  const subject = document.getElementById('queue-edit-subject').value;
  const body = document.getElementById('queue-edit-body').value;
  try {
    const r = await apiFetch('/api/queue/send', {
      method: 'POST',
      body: JSON.stringify({ enrollment_id: enrollmentId, custom_subject: subject, custom_body: body }),
    });
    toast(`Sent: "${r.subject}"`, 'success');
    closeModal('modal-queue-detail');
    loadQueue();
    updateDashboardBadge();
  } catch(e) { toast(e.message, 'error'); }
}

async function previewEmail(enrollmentId) {
  try {
    const preview = await apiFetch(`/api/queue/preview/${enrollmentId}`);
    document.getElementById('preview-content').innerHTML = `
      <div class="preview-subject">Subject: ${esc(preview.subject)}</div>
      <div class="preview-body">${esc(preview.body)}</div>
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

// ── ACTIVITY ──────────────────────────────────────────────────────────────
let _activityCache = [];

async function loadActivity() {
  try {
    const activities = await apiFetch('/api/activities?limit=100');
    _activityCache = activities;
    const tbody = document.getElementById('activity-tbody');
    if (!activities.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No activity yet.</td></tr>`;
      return;
    }
    tbody.innerHTML = activities.map((a, i) => `
      <tr class="activ-row" onclick="openActivityDetail(${i})" title="Click to view full message">
        <td class="text-muted" style="white-space:nowrap">${fmtDate(a.sent_at)}</td>
        <td>
          <span class="contact-name-link">${esc(a.first_name||'')} ${esc(a.last_name||'')}</span>
          ${a.title ? `<div style="font-size:11px;color:var(--text-muted)">${esc(a.title)}</div>` : ''}
        </td>
        <td>${esc(a.company_name||'—')}</td>
        <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.subject||'—')}</td>
        <td><span class="status-pill" style="background:var(--primary-pale);color:var(--primary)">${esc(a.type)}</span></td>
      </tr>
    `).join('');
  } catch(e) { toast(e.message, 'error'); }
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

// ── INBOX ─────────────────────────────────────────────────────────────────
let _inboxTab = 'inbox';
let _inboxCache = [];

function switchInboxTab(tab) {
  _inboxTab = tab;
  document.querySelectorAll('.inbox-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.inbox-tab[data-tab="${tab}"]`).classList.add('active');
  const searchEl = document.getElementById('search-inbox');
  const placeholders = { inbox: 'Search inbox...', sent: 'Search sent...', not_in_sequence: 'Search contacts not in a sequence...' };
  searchEl.placeholder = placeholders[tab] || 'Search...';
  searchEl.value = '';
  loadInbox();
}

async function loadInbox() {
  try {
    const search = document.getElementById('search-inbox')?.value || '';
    const el = document.getElementById('inbox-list');

    if (_inboxTab === 'not_in_sequence') {
      const params = search ? `?search=${encodeURIComponent(search)}&limit=200` : '?limit=200';
      const data = await apiFetch(`/api/inbox/not-in-sequence${params}`);
      const contacts = data.contacts || [];
      const inboxData = await apiFetch('/api/inbox?limit=0');
      updateBadge('badge-inbox', inboxData.unreadCount || 0);
      const countEl = document.getElementById('inbox-tab-count');
      if (countEl) countEl.textContent = inboxData.unreadCount > 0 ? inboxData.unreadCount : '';

      if (!contacts.length) {
        el.innerHTML = `<div class="empty-state">
          <div style="font-size:32px;margin-bottom:8px">&#128203;</div>
          <p>All contacts are currently enrolled in a sequence.</p>
        </div>`;
        return;
      }

      el.innerHTML = `<div class="inbox-messages">${contacts.map(c => {
        const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unknown';
        return `
          <div class="inbox-row" onclick="openContactDetail(${c.id})">
            <div class="inbox-row-left">
              <div class="inbox-sender">
                <a href="#" onclick="event.stopPropagation();openContactDetail(${c.id})" style="color:inherit;text-decoration:none"><strong>${esc(fullName)}</strong></a>
                ${c.company_name ? `<span class="inbox-company-pill">${esc(c.company_name)}</span>` : ''}
              </div>
              <div class="inbox-preview">${esc(c.email || '')}</div>
            </div>
            <div class="inbox-row-right">
              <div class="inbox-date">${c.last_activity_at ? fmtDate(c.last_activity_at) : 'No activity'}</div>
            </div>
          </div>`;
      }).join('')}</div>`;
      return;
    }

    // Inbox or Sent tab
    const params = new URLSearchParams({ tab: _inboxTab, limit: '200' });
    if (search) params.set('search', search);
    const data = await apiFetch(`/api/inbox?${params}`);
    _inboxCache = data.messages || [];
    updateBadge('badge-inbox', data.unreadCount || 0);
    const countEl = document.getElementById('inbox-tab-count');
    if (countEl) countEl.textContent = data.unreadCount > 0 ? data.unreadCount : '';

    if (!_inboxCache.length) {
      const emptyMsg = _inboxTab === 'sent'
        ? 'No sent messages yet.'
        : 'No replies yet. Sync your inbox to pull in responses from contacts.';
      el.innerHTML = `<div class="empty-state">
        <div style="font-size:32px;margin-bottom:8px">&#9993;</div>
        <p>${emptyMsg}</p>
        ${_inboxTab === 'inbox' ? '<button class="btn btn-primary" onclick="syncInboxFromInbox()" style="margin-top:12px">Sync Inbox Now</button>' : ''}
      </div>`;
      return;
    }

    el.innerHTML = `<div class="inbox-messages">${_inboxCache.map((m, i) => {
      const isRead = _inboxTab === 'sent' ? true : m.notes === 'read';
      const fullName = [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Unknown';
      const label = _inboxTab === 'sent' ? `To: ${fullName}` : fullName;
      const preview = cleanEmailBody(m.body || '').slice(0, 140);
      return `
        <div class="inbox-row ${isRead ? 'inbox-read' : 'inbox-unread'}" onclick="openInboxMessage(${i})">
          <div class="inbox-row-left">
            <div class="inbox-sender">
              <a href="#" onclick="event.stopPropagation();openContactDetail(${m.contact_id})" style="color:inherit;text-decoration:none">${esc(label)}</a>
              ${m.company_name ? `<span class="inbox-company-pill">${esc(m.company_name)}</span>` : ''}
            </div>
            <div class="inbox-subject">${esc(m.subject || '(no subject)')}</div>
            <div class="inbox-preview">${esc(preview)}${preview.length >= 140 ? '...' : ''}</div>
          </div>
          <div class="inbox-row-right">
            <div class="inbox-date">${fmtDate(m.sent_at)}</div>
          </div>
        </div>`;
    }).join('')}</div>`;
  } catch(e) { toast(e.message, 'error'); }
}

async function openInboxMessage(index) {
  const m = _inboxCache[index];
  if (!m) return;

  // Mark as read if unread inbox message
  if (_inboxTab === 'inbox' && m.notes !== 'read') {
    try {
      await apiFetch(`/api/inbox/${m.id}/read`, { method: 'PATCH' });
      m.notes = 'read';
      const data = await apiFetch('/api/inbox?limit=0');
      updateBadge('badge-inbox', data.unreadCount || 0);
      const countEl = document.getElementById('inbox-tab-count');
      if (countEl) countEl.textContent = data.unreadCount > 0 ? data.unreadCount : '';
      // Update the row to show as read
      const rows = document.querySelectorAll('.inbox-row');
      if (rows[index]) { rows[index].classList.remove('inbox-unread'); rows[index].classList.add('inbox-read'); }
    } catch(e) {}
  }

  const fullName = [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Unknown';

  // Insert reading pane above the message list
  let pane = document.getElementById('inbox-reading-pane');
  if (!pane) {
    pane = document.createElement('div');
    pane.id = 'inbox-reading-pane';
    pane.className = 'inbox-reading-pane';
    const list = document.getElementById('inbox-list');
    list.parentNode.insertBefore(pane, list);
  }

  pane.innerHTML = `
    <div class="inbox-rp-header">
      <div>
        <div class="inbox-rp-subject">${esc(m.subject || '(no subject)')}</div>
        <div class="inbox-rp-meta">
          <span>${_inboxTab === 'sent' ? 'To:' : 'From:'} <a href="#" onclick="event.preventDefault();openContactDetail(${m.contact_id})">${esc(fullName)}</a></span>
          ${m.company_name ? `<span><a href="#" onclick="event.preventDefault();openCompanyDetail(${m.company_id})">${esc(m.company_name)}</a></span>` : ''}
          <span>${fmtDate(m.sent_at)}</span>
        </div>
      </div>
      <button class="inbox-rp-close" onclick="closeInboxPane()">&#10005;</button>
    </div>
    <div class="inbox-rp-body">${esc(cleanEmailBody(m.body) || '(no message body)')}</div>
    <div class="inbox-rp-actions">
      ${m.email ? `<a href="mailto:${esc(m.email)}?subject=Re: ${encodeURIComponent(m.subject || '')}" class="btn btn-primary">Reply via Email</a>` : ''}
      ${m.contact_id ? `<button class="btn btn-outline" onclick="openContactDetail(${m.contact_id})">View Contact</button>` : ''}
      ${m.company_id ? `<button class="btn btn-outline" onclick="openCompanyDetail(${m.company_id})">View Company</button>` : ''}
    </div>
  `;
  pane.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeInboxPane() {
  const pane = document.getElementById('inbox-reading-pane');
  if (pane) pane.remove();
}

async function syncInboxFromInbox() {
  toast('Syncing inbox...');
  try {
    const r = await apiFetch('/api/inbox/sync', { method: 'POST' });
    const parts = [`${r.imported} new repl${r.imported !== 1 ? 'ies' : 'y'}`];
    if (r.autoStopped > 0) parts.push(`${r.autoStopped} sequence${r.autoStopped !== 1 ? 's' : ''} stopped`);
    if (r.opportunitiesCreated > 0) parts.push(`${r.opportunitiesCreated} new opportunit${r.opportunitiesCreated !== 1 ? 'ies' : 'y'} created`);
    toast(`Inbox synced: ${parts.join(', ')}`, 'success');
    closeInboxPane();
    loadInbox();
  } catch(e) { toast(`Sync failed: ${e.message}`, 'error'); }
}

// ── SETTINGS ──────────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const s = await apiFetch('/api/settings');
    const form = document.getElementById('settings-form');
    form.querySelector('[name="smtp_from_name"]').value = s.smtp_from_name||'';
    form.querySelector('[name="smtp_user"]').value = s.smtp_user||'';
    form.querySelector('[name="smtp_host"]').value = s.smtp_host||'';
    form.querySelector('[name="smtp_port"]').value = s.smtp_port||'587';
    form.querySelector('[name="smtp_pass"]').value = s.smtp_pass||'';
    form.querySelector('[name="smtp_secure"]').value = s.smtp_secure||'false';
    // IMAP
    const imap = document.getElementById('imap-form');
    if (imap) {
      imap.querySelector('[name="imap_host"]').value = s.imap_host||'';
      imap.querySelector('[name="imap_port"]').value = s.imap_port||'993';
      imap.querySelector('[name="imap_secure"]').value = s.imap_secure||'true';
      imap.querySelector('[name="imap_sent_folder"]').value = s.imap_sent_folder||'Sent';
    }
  } catch(e) { toast(e.message, 'error'); }
}

async function saveImapSettings(e) {
  e.preventDefault();
  const form = document.getElementById('imap-form');
  const msg = document.getElementById('imap-msg');
  const body = {
    imap_host: form.querySelector('[name="imap_host"]').value,
    imap_port: form.querySelector('[name="imap_port"]').value,
    imap_secure: form.querySelector('[name="imap_secure"]').value,
    imap_sent_folder: form.querySelector('[name="imap_sent_folder"]').value,
  };
  try {
    await apiFetch('/api/settings', { method: 'POST', body: JSON.stringify(body) });
    msg.textContent = 'IMAP settings saved.';
    msg.className = 'settings-msg success';
    msg.style.display = 'block';
    toast('IMAP settings saved', 'success');
  } catch(err) {
    msg.textContent = err.message;
    msg.className = 'settings-msg error';
    msg.style.display = 'block';
  }
}

async function syncInbox() {
  const msg = document.getElementById('imap-msg');
  msg.textContent = 'Syncing inbox…';
  msg.className = 'settings-msg';
  msg.style.display = 'block';
  try {
    const r = await apiFetch('/api/inbox/sync', { method: 'POST' });
    const autoStoppedMsg = r.autoStopped > 0 ? ` ${r.autoStopped} sequence${r.autoStopped!==1?'s':''} auto-stopped.` : '';
    msg.textContent = `Sync complete — ${r.found} email${r.found!==1?'s':''} scanned, ${r.imported} new repl${r.imported!==1?'ies':'y'} imported.${autoStoppedMsg}`;
    msg.className = 'settings-msg success';
    toast(`Inbox synced: ${r.imported} new replies${r.autoStopped > 0 ? `, ${r.autoStopped} sequence${r.autoStopped!==1?'s':''} stopped` : ''}`, 'success');
  } catch(err) {
    msg.textContent = `Sync failed: ${err.message}`;
    msg.className = 'settings-msg error';
  }
}

async function saveSettings(e) {
  e.preventDefault();
  const form = e.target;
  const body = {
    smtp_from_name: form.querySelector('[name="smtp_from_name"]').value,
    smtp_user: form.querySelector('[name="smtp_user"]').value,
    smtp_host: form.querySelector('[name="smtp_host"]').value,
    smtp_port: form.querySelector('[name="smtp_port"]').value,
    smtp_pass: form.querySelector('[name="smtp_pass"]').value,
    smtp_secure: form.querySelector('[name="smtp_secure"]').value,
  };
  const msg = document.getElementById('settings-msg');
  try {
    await apiFetch('/api/settings', { method: 'POST', body: JSON.stringify(body) });
    msg.textContent = 'Settings saved.';
    msg.className = 'settings-msg success';
    toast('Settings saved', 'success');
  } catch(err) {
    msg.textContent = err.message;
    msg.className = 'settings-msg error';
  }
}

async function testEmail() {
  const msg = document.getElementById('settings-msg');
  msg.textContent = 'Testing connection...';
  msg.className = 'settings-msg';
  msg.style.display = 'block';
  try {
    // Save first
    const form = document.getElementById('settings-form');
    const body = {
      smtp_from_name: form.querySelector('[name="smtp_from_name"]').value,
      smtp_user: form.querySelector('[name="smtp_user"]').value,
      smtp_host: form.querySelector('[name="smtp_host"]').value,
      smtp_port: form.querySelector('[name="smtp_port"]').value,
      smtp_pass: form.querySelector('[name="smtp_pass"]').value,
      smtp_secure: form.querySelector('[name="smtp_secure"]').value,
    };
    await apiFetch('/api/settings', { method: 'POST', body: JSON.stringify(body) });
    const r = await apiFetch('/api/settings/test-email', { method: 'POST' });
    msg.textContent = 'Connection successful! Your email is ready to use.';
    msg.className = 'settings-msg success';
  } catch(err) {
    msg.textContent = `Connection failed: ${err.message}`;
    msg.className = 'settings-msg error';
  }
}

// ── CSV IMPORT ────────────────────────────────────────────────────────────
let importType = '';
function openImportModal(type) {
  importType = type;
  document.getElementById('import-modal-title').textContent = type === 'companies' ? 'Import Companies CSV' : 'Import Contacts CSV';
  document.getElementById('import-file').value = '';
  document.getElementById('import-msg').className = 'settings-msg';
  document.getElementById('import-msg').textContent = '';
  const helpEl = document.getElementById('import-format-help');
  if (type === 'companies') {
    helpEl.innerHTML = `<div class="import-format-help">
      <strong>Expected columns (first row = headers):</strong><br>
      <code>name</code>, <code>type</code> (manufacturer/retailer/publisher/agent), <code>website</code>, <code>phone</code>, <code>city</code>, <code>state</code>, <code>category</code>, <code>notes</code>, <code>status</code><br><br>
      Only <code>name</code> is required. All other columns are optional.
    </div>`;
  } else {
    helpEl.innerHTML = `<div class="import-format-help">
      <strong>Expected columns:</strong><br>
      <code>first_name</code>, <code>last_name</code>, <code>email</code>, <code>phone</code>, <code>title</code>, <code>company</code> (matches existing company name), <code>notes</code><br><br>
      Only <code>first_name</code> is required.
    </div>`;
  }
  openModal('modal-import');
}

async function submitImport() {
  const file = document.getElementById('import-file').files[0];
  const msg = document.getElementById('import-msg');
  if (!file) { msg.textContent = 'Please select a file.'; msg.className = 'settings-msg error'; return; }
  const formData = new FormData();
  formData.append('file', file);
  msg.textContent = 'Importing...';
  msg.className = 'settings-msg';
  msg.style.display = 'block';
  try {
    const res = await fetch(`/api/import/${importType}`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed');
    msg.textContent = `Successfully imported ${data.imported} record${data.imported!==1?'s':''}.`;
    msg.className = 'settings-msg success';
    if (importType === 'companies') loadCompanies();
    else loadContacts();
  } catch(e) {
    msg.textContent = e.message;
    msg.className = 'settings-msg error';
  }
}

// ── HELPERS ────────────────────────────────────────────────────────────────
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function cleanEmailBody(text) {
  if (!text) return '';
  return text
    .replace(/^--[-_a-zA-Z0-9.]+$/gm, '')
    .replace(/^Content-(?:Type|Transfer-Encoding|Disposition):[^\r\n]*/gmi, '')
    .replace(/charset="[^"]*"/gi, '')
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function fmtDate(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function typeName(type) {
  const map = { manufacturer: 'Manufacturer', retailer: 'Retailer', publisher: 'Publisher', agent: 'Agent/Rep', other: 'Other' };
  return map[type] || type;
}

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
    const contacts = await apiFetch('/api/pipeline');
    const el = document.getElementById('pipeline-content');

    if (!contacts.length) {
      el.innerHTML = '<div class="empty-state"><div style="font-size:32px;margin-bottom:8px">◉</div><p>No contacts yet. Add contacts and enroll them in sequences to track their pipeline progress.</p></div>';
      return;
    }

    // Count summary stats
    const totalActive = contacts.filter(c => c.enrollment_status === 'active').length;
    const totalReplied = contacts.filter(c => c.enrollment_status === 'replied').length;
    const totalCompleted = contacts.filter(c => c.enrollment_status === 'completed').length;
    const stuckContacts = contacts.filter(c => isStuckContact(c));
    const stuckCount = stuckContacts.length;

    // Group by sequence_name, then by current_step
    // Contacts without enrollment go into a special group
    const seqMap = {};
    contacts.forEach(c => {
      const seqName = c.sequence_name || '__none__';
      if (!seqMap[seqName]) seqMap[seqName] = {};
      const step = c.enrollment_status === 'active' ? (c.current_step || 0)
                 : c.enrollment_status === 'completed' ? '__completed__'
                 : c.enrollment_status === 'replied' ? '__replied__'
                 : c.enrollment_status === 'stopped' ? '__stopped__'
                 : '__none__';
      if (!seqMap[seqName][step]) seqMap[seqName][step] = [];
      seqMap[seqName][step].push(c);
    });

    // Sort sequence names: put __none__ last
    const seqNames = Object.keys(seqMap).sort((a, b) => {
      if (a === '__none__') return 1;
      if (b === '__none__') return -1;
      return a.localeCompare(b);
    });

    let html = '';

    // Summary stats bar
    html += `
      <div class="pipeline-summary" style="margin-bottom:16px">
        <div class="pipeline-summary-card stage-active">
          <div class="pipeline-summary-count">${totalActive}</div>
          <div class="pipeline-summary-label">Active</div>
        </div>
        <div class="pipeline-summary-card stage-complete">
          <div class="pipeline-summary-count">${totalReplied}</div>
          <div class="pipeline-summary-label">Replied</div>
        </div>
        <div class="pipeline-summary-card stage-complete">
          <div class="pipeline-summary-count">${totalCompleted}</div>
          <div class="pipeline-summary-label">Completed</div>
        </div>
        ${stuckCount > 0 ? `
        <div class="pipeline-summary-card" style="border-color:var(--danger);cursor:default">
          <div class="pipeline-summary-count" style="color:var(--danger)">${stuckCount}</div>
          <div class="pipeline-summary-label" style="color:var(--danger)">Stuck</div>
        </div>` : ''}
      </div>
    `;

    // Stuck alert banner
    if (stuckCount > 0) {
      html += `
        <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:8px;padding:10px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px;font-size:13px;color:#856404">
          <span style="font-size:16px">⚠</span>
          <strong>${stuckCount} contact${stuckCount !== 1 ? 's' : ''} haven't been contacted in 2+ weeks.</strong>
          <span style="color:#6c757d;font-size:12px">Scroll down to see contacts with a red ⚠ Stuck badge.</span>
        </div>
      `;
    }

    // Build sequence sections
    for (const seqName of seqNames) {
      const stepMap = seqMap[seqName];
      const displaySeqName = seqName === '__none__' ? 'No Sequence' : seqName;

      // Get all steps, sorted numerically, with special statuses last
      const stepKeys = Object.keys(stepMap).sort((a, b) => {
        const specialOrder = { '__completed__': 900, '__replied__': 901, '__stopped__': 902, '__none__': 999 };
        const aVal = specialOrder[a] !== undefined ? specialOrder[a] : parseInt(a);
        const bVal = specialOrder[b] !== undefined ? specialOrder[b] : parseInt(b);
        return aVal - bVal;
      });

      html += `<div class="pipeline-stage-section" style="margin-bottom:24px">`;

      for (const stepKey of stepKeys) {
        const stepContacts = stepMap[stepKey];
        let stepLabel;
        let headerClass = 'stage-active';

        if (stepKey === '__completed__') {
          stepLabel = 'Completed';
          headerClass = 'stage-complete';
        } else if (stepKey === '__replied__') {
          stepLabel = 'Replied';
          headerClass = 'stage-complete';
        } else if (stepKey === '__stopped__') {
          stepLabel = 'Stopped';
          headerClass = 'stage-none';
        } else if (stepKey === '__none__') {
          stepLabel = 'Not Enrolled';
          headerClass = 'stage-none';
        } else {
          const totalSteps = stepContacts[0]?.total_steps || '?';
          stepLabel = `Step ${stepKey} of ${totalSteps}`;
        }

        html += `
          <div class="pipeline-stage-header ${headerClass}" style="margin-top:0;border-radius:8px 8px 0 0">
            <span class="pipeline-stage-label">
              ${seqName !== '__none__' ? `<span style="font-size:11px;opacity:.75;font-weight:400;margin-right:6px">&#128231; ${esc(displaySeqName)} —</span>` : ''}
              ${esc(stepLabel)}
            </span>
            <span class="pipeline-stage-count">${stepContacts.length} contact${stepContacts.length !== 1 ? 's' : ''}</span>
          </div>
          <table class="data-table pipeline-table" style="border-radius:0 0 8px 8px;margin-bottom:2px">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Company</th>
                <th>Status</th>
                <th>Emails Sent</th>
                <th>Last Contact</th>
              </tr>
            </thead>
            <tbody>
              ${stepContacts.map(c => {
                const stuck = isStuckContact(c);
                return `
                  <tr${stuck ? ' style="background:#fff8f8"' : ''}>
                    <td>
                      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                        ${c.is_primary ? '<span class="primary-badge" title="Primary contact">★</span>' : ''}
                        <a href="#" onclick="event.preventDefault();openContactDetail(${c.id})" style="font-weight:600">${esc(c.first_name)} ${esc(c.last_name || '')}</a>
                        ${stuck ? '<span style="background:#fee2e2;color:#b91c1c;font-size:10px;padding:1px 6px;border-radius:10px;font-weight:600">⚠ Stuck</span>' : ''}
                      </div>
                      ${c.title ? `<div style="font-size:11px;color:var(--text-muted)">${esc(c.title)}</div>` : ''}
                      ${c.email ? `<div style="font-size:11px;color:var(--text-muted)">${esc(c.email)}</div>` : '<div style="font-size:11px;color:var(--danger)">⚠ No email</div>'}
                    </td>
                    <td>
                      ${c.company_id ? `<a href="#" onclick="event.preventDefault();openCompanyDetail(${c.company_id})">${esc(c.company_name || '—')}</a>` : '<span style="color:var(--text-muted)">—</span>'}
                      ${c.company_status ? `<div style="font-size:11px;margin-top:2px"><span class="status-pill status-${(c.company_status||'').replace(/\s/g,'-')}">${esc(c.company_status)}</span></div>` : ''}
                    </td>
                    <td>
                      ${c.enrollment_status === 'active'
                        ? `<span style="color:var(--primary);font-size:12px;font-weight:600">Active</span>`
                        : c.enrollment_status === 'completed'
                        ? `<span style="color:var(--success);font-size:12px;font-weight:600">✓ Completed</span>`
                        : c.enrollment_status === 'replied'
                        ? `<span style="color:var(--success);font-size:12px;font-weight:600">↩ Replied</span>`
                        : c.enrollment_status === 'stopped'
                        ? `<span style="color:var(--text-muted);font-size:12px">Stopped</span>`
                        : `<span style="color:var(--text-muted);font-size:12px">—</span>`
                      }
                    </td>
                    <td>
                      <span class="pipeline-email-count">${c.emails_sent || 0}</span>
                    </td>
                    <td style="color:var(--text-muted)">${fmtDate(c.last_contact_at)}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        `;
      }
      html += `</div>`;
    }

    el.innerHTML = html;
  } catch(e) { toast(e.message, 'error'); }
}

function stageSlug(stage) {
  return stage.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function scrollToStage(slug) {
  const el = document.getElementById('stage-' + slug);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── REPORTS ───────────────────────────────────────────────────────────────
async function loadReports() {
  const el = document.getElementById('reports-content');
  if (!el) return;
  el.innerHTML = '<div class="empty-state">Loading…</div>';

  const stalledDays = parseInt(document.getElementById('stalled-days')?.value || '30', 10);

  try {
    const [stats, pipeline, activity, companies] = await Promise.all([
      apiFetch('/api/dashboard'),
      apiFetch('/api/pipeline'),
      apiFetch('/api/activities?limit=200'),
      apiFetch('/api/companies'),
    ]);

    // ── Weekly Activity (contacts/accounts reached per week) ──────────────
    const weekMap = {};
    (activity || []).forEach(a => {
      const d = new Date(a.created_at || a.timestamp);
      if (isNaN(d)) return;
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay()+6)%7));
      const key = monday.toISOString().slice(0,10);
      if (!weekMap[key]) weekMap[key] = { emails:0, companies:new Set() };
      weekMap[key].emails++;
      if (a.company_id) weekMap[key].companies.add(a.company_id);
    });
    const weeks = Object.entries(weekMap).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,8);

    // ── Stage breakdown ────────────────────────────────────────────────────
    const stageCounts = {};
    const stageOpps = {};
    (pipeline || []).forEach(c => {
      const s = c.pipeline_stage || 'Prospect';
      stageCounts[s] = (stageCounts[s] || 0) + 1;
      stageOpps[s] = (stageOpps[s] || 0) + (parseFloat(c.opportunity_value)||0);
    });

    // ── Next Steps ─────────────────────────────────────────────────────────
    const nextSteps = (companies || [])
      .filter(c => c.next_step && c.next_step.trim())
      .sort((a,b) => (a.next_step_date||'9999') > (b.next_step_date||'9999') ? 1 : -1)
      .slice(0, 15);

    // ── Stalled Deals ──────────────────────────────────────────────────────
    const now = Date.now();
    const stalledMs = stalledDays * 86400000;
    const stalled = (companies || []).filter(c => {
      if (!c.last_activity_at && !c.updated_at) return false;
      const lastActive = new Date(c.last_activity_at || c.updated_at).getTime();
      const inPipeline = c.pipeline_stage && c.pipeline_stage !== 'Prospect' && c.pipeline_stage !== 'Closed Lost';
      return inPipeline && (now - lastActive) > stalledMs;
    });

    // ── Total opportunity ──────────────────────────────────────────────────
    const totalOpp = (companies || []).reduce((s,c)=>s+(parseFloat(c.opportunity_value)||0),0);

    el.innerHTML = `
      <!-- KPI Row -->
      <div class="report-kpi-row">
        <div class="report-kpi">
          <div class="report-kpi-value">${stats.totalCompanies||0}</div>
          <div class="report-kpi-label">Total Prospects</div>
        </div>
        <div class="report-kpi">
          <div class="report-kpi-value">${stats.totalContacts||0}</div>
          <div class="report-kpi-label">Contacts Identified</div>
        </div>
        <div class="report-kpi">
          <div class="report-kpi-value">${stats.emailsSent||0}</div>
          <div class="report-kpi-label">Emails Sent</div>
        </div>
        <div class="report-kpi highlight">
          <div class="report-kpi-value">$${totalOpp.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
          <div class="report-kpi-label">Total Opp Value</div>
        </div>
        <div class="report-kpi ${stalled.length>0?'warn':''}">
          <div class="report-kpi-value">${stalled.length}</div>
          <div class="report-kpi-label">Stalled (&gt;${stalledDays}d)</div>
        </div>
      </div>

      <div class="report-grid">

        <!-- Weekly Activity -->
        <div class="report-card">
          <div class="report-card-title">Weekly Outreach Activity</div>
          <table class="report-table">
            <thead><tr><th>Week of</th><th>Emails Sent</th><th>Accounts Reached</th></tr></thead>
            <tbody>
              ${weeks.length ? weeks.map(([wk,v])=>`
                <tr>
                  <td>${wk}</td>
                  <td><strong>${v.emails}</strong></td>
                  <td>${v.companies.size}</td>
                </tr>`).join('') : '<tr><td colspan="3" style="color:var(--text-muted);text-align:center">No activity yet</td></tr>'}
            </tbody>
          </table>
        </div>

        <!-- Stage Breakdown -->
        <div class="report-card">
          <div class="report-card-title">Pipeline Stages</div>
          <table class="report-table">
            <thead><tr><th>Stage</th><th>Count</th><th>Opp Value</th></tr></thead>
            <tbody>
              ${Object.entries(stageCounts).length ? Object.entries(stageCounts).map(([s,cnt])=>`
                <tr>
                  <td><span class="status-pill status-${s.toLowerCase().replace(/\s/g,'-')}">${esc(s)}</span></td>
                  <td><strong>${cnt}</strong></td>
                  <td>$${(stageOpps[s]||0).toLocaleString(undefined,{maximumFractionDigits:0})}</td>
                </tr>`).join('') : '<tr><td colspan="3" style="color:var(--text-muted);text-align:center">No pipeline data</td></tr>'}
            </tbody>
          </table>
        </div>

        <!-- Next Steps -->
        <div class="report-card report-card-wide">
          <div class="report-card-title">Next Steps</div>
          ${nextSteps.length ? `
          <table class="report-table">
            <thead><tr><th>Company</th><th>Stage</th><th>Next Step</th><th>Due Date</th><th>Opp Value</th></tr></thead>
            <tbody>
              ${nextSteps.map(c=>`
                <tr>
                  <td><a href="#" onclick="event.preventDefault();openCompanyDetail(${c.id})">${esc(c.name)}</a></td>
                  <td><span class="status-pill status-${(c.pipeline_stage||'prospect').toLowerCase().replace(/\s/g,'-')}">${esc(c.pipeline_stage||'Prospect')}</span></td>
                  <td>${esc(c.next_step)}</td>
                  <td style="color:${c.next_step_date && c.next_step_date < new Date().toISOString().slice(0,10) ? 'var(--danger)' : 'var(--text-muted)'}">${c.next_step_date ? fmtDate(c.next_step_date) : '—'}</td>
                  <td>$${(parseFloat(c.opportunity_value)||0).toLocaleString(undefined,{maximumFractionDigits:0})}</td>
                </tr>`).join('')}
            </tbody>
          </table>` : '<div style="color:var(--text-muted);padding:12px 0;font-size:13px">No next steps recorded yet. Add them from company detail cards.</div>'}
        </div>

        <!-- Stalled Deals -->
        <div class="report-card report-card-wide">
          <div class="report-card-title" style="display:flex;justify-content:space-between;align-items:center">
            <span>Stalled Deals <span style="font-size:11px;color:var(--text-muted);font-weight:400">(no activity in ${stalledDays}+ days)</span></span>
            ${stalled.length ? `<span class="report-badge-warn">${stalled.length} stalled</span>` : ''}
          </div>
          ${stalled.length ? `
          <table class="report-table">
            <thead><tr><th>Company</th><th>Stage</th><th>Last Activity</th><th>Days Stalled</th><th>Opp Value</th></tr></thead>
            <tbody>
              ${stalled.map(c=>{
                const lastActive = new Date(c.last_activity_at||c.updated_at);
                const daysStalled = Math.floor((now - lastActive.getTime())/86400000);
                return `<tr>
                  <td><a href="#" onclick="event.preventDefault();openCompanyDetail(${c.id})">${esc(c.name)}</a></td>
                  <td><span class="status-pill status-${(c.pipeline_stage||'prospect').toLowerCase().replace(/\s/g,'-')}">${esc(c.pipeline_stage||'Prospect')}</span></td>
                  <td>${fmtDate(lastActive.toISOString())}</td>
                  <td style="color:var(--danger);font-weight:600">${daysStalled}d</td>
                  <td>$${(parseFloat(c.opportunity_value)||0).toLocaleString(undefined,{maximumFractionDigits:0})}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>` : `<div style="color:var(--success);padding:12px 0;font-size:13px">✓ No stalled deals — great work!</div>`}
        </div>

      </div>`;

  } catch(e) { el.innerHTML = `<div class="empty-state">Error loading reports: ${esc(e.message)}</div>`; }
}

// ── NEWS ───────────────────────────────────────────────────────────────────
let newsSearchTimeout;
async function loadNews(company) {
  const el = document.getElementById('news-feed');
  if (!el) return;
  el.innerHTML = '<div class="empty-state">Loading news…</div>';
  try {
    const url = company ? `/api/news?company=${encodeURIComponent(company)}` : '/api/news';
    const items = await apiFetch(url);
    if (!items || items.length === 0) {
      el.innerHTML = '<div class="empty-state">No news found. Try a company name search.</div>';
      return;
    }
    el.innerHTML = `<div class="news-grid">${items.map(item => `
      <div class="news-card">
        <div class="news-source">${esc(item.source||'')}</div>
        <a class="news-title" href="${esc(item.link||'#')}" target="_blank" rel="noopener">${esc(item.title||'')}</a>
        <div class="news-date">${item.date ? fmtDate(item.date) : ''}</div>
      </div>`).join('')}
    </div>`;
  } catch(e) {
    el.innerHTML = `<div class="empty-state">Could not load news: ${esc(e.message)}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('news-company-search');
  if (inp) {
    inp.addEventListener('input', () => {
      clearTimeout(newsSearchTimeout);
      newsSearchTimeout = setTimeout(() => {
        const v = inp.value.trim();
        loadNews(v || null);
      }, 500);
    });
  }
});

// ── INIT ──────────────────────────────────────────────────────────────────
loadDashboard();
loadAllTags();
