// ── PHIL LEWIS ART CRM — Companies ──────────────────────────────────────────

// Moved from dashboard - used in company detail
function clearProspectFilters() {
  activeTagFilters = [];
  activeTypeFilters = [];
  activeStatusFilters = [];
  var searchEl = document.getElementById('search-companies');
  if (searchEl) searchEl.value = '';
  renderTagFilterChips();
  renderProspectDropdowns();
  loadCompanies();
}

function clearProspectFilters() {
  activeTagFilters = [];
  activeTypeFilters = [];
  activeStatusFilters = [];
  var searchEl = document.getElementById('search-companies');
  if (searchEl) searchEl.value = '';
  renderTagFilterChips();
  renderProspectDropdowns();
  loadCompanies();
}

// ── COMPANIES ─────────────────────────────────────────────────────────────
async function loadCompanies() {
  var search = document.getElementById('search-companies')?.value || '';
  var type = activeTypeFilters.join(',');
  var status = activeStatusFilters.join(',');
  var tag = activeTagFilters.join(',');
  var url = '/api/companies?';
  if (search) url += 'search=' + encodeURIComponent(search) + '&';
  if (type) url += 'type=' + encodeURIComponent(type) + '&';
  if (status) url += 'status=' + encodeURIComponent(status) + '&';
  if (tag) url += 'tag=' + encodeURIComponent(tag) + '&';
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
          <div style="display:flex;align-items:center;gap:8px">
            <span class="status-pill status-${c.status.replace(/\s/g,'-')}">${esc(c.status)}</span>
            <span class="contact-count">${c.contact_count} contact${c.contact_count!==1?'s':''}</span>
          </div>
          <div class="card-actions" onclick="event.stopPropagation()">
            <button class="btn btn-outline btn-sm" onclick="openEnrollModal(${c.id})" title="Add contacts to a campaign">+ Campaign</button>
            <button class="btn btn-ghost btn-sm" onclick="openCompanyModal(${c.id})">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteCompany(${c.id})">Del</button>
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
            ${c.contacts.map(ct => {
              var seqBadge = '';
              if (ct.sequence_name && ct.enrollment_status) {
                var seqColor = ct.enrollment_status === 'active' ? 'var(--primary)' :
                  ct.enrollment_status === 'replied' ? 'var(--success)' :
                  ct.enrollment_status === 'completed' ? '#6b7280' : 'var(--danger)';
                var seqBg = ct.enrollment_status === 'active' ? 'var(--primary-pale,#eef2ff)' :
                  ct.enrollment_status === 'replied' ? 'var(--success-pale,#f0fdf4)' :
                  ct.enrollment_status === 'completed' ? 'var(--bg)' : 'var(--danger-pale,#fef2f2)';
                var stepLabel = ct.current_step ? ' · Step ' + ct.current_step + (ct.sequence_total_steps ? '/' + ct.sequence_total_steps : '') : '';
                seqBadge = '<div class="cd-seq-badge" style="color:' + seqColor + ';background:' + seqBg + ';border-color:' + seqColor + '">' +
                  '<span class="cd-seq-badge-name">' + esc(ct.sequence_name) + '</span>' +
                  '<span class="cd-seq-badge-status">' + esc(ct.enrollment_status) + stepLabel + '</span>' +
                  (ct.enrollment_status === 'active' ? '<button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();stopEnrollment(' + ct.enrollment_id + ',{onDone:function(){openCompanyDetail(' + c.id + ')}})" style="color:' + seqColor + ';padding:0 4px" title="Remove from sequence">✕</button>' : '') +
                '</div>';
              }
              return `
              <div class="contact-detail-row">
                <div class="contact-detail-main">
                  <div class="contact-detail-name">
                    ${ct.is_primary ? '<span class="primary-badge">★ Primary</span>' : ''}
                    <strong>${esc(ct.first_name)} ${esc(ct.last_name||'')}</strong>
                    ${ct.title ? `<span class="contact-detail-title">${esc(ct.title)}</span>` : ''}
                  </div>
                  ${seqBadge}
                  <div class="contact-detail-links">
                    ${ct.email ? `<a href="mailto:${esc(ct.email)}" class="contact-link email-link">✉ ${esc(ct.email)}</a>` : '<span class="contact-missing-email">✉ No email — add one to send outreach</span>'}
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
            `}).join('')}
          </div>
          <div class="enroll-btn-row" style="margin-top:14px;position:relative;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-outline btn-sm" onclick="toggleEnrollDropdown(${c.id}, this)">＋ Add to Campaign ▾</button>
            <button class="btn btn-primary btn-sm" onclick="closeModal('modal-company-detail');openPortfolioComposer(${c.id}, '${esc((c.contacts[0] && c.contacts[0].email) || '')}', '${esc((c.contacts[0] && c.contacts[0].first_name) || '')}')">📨 Send Portfolio</button>
            <button class="btn btn-danger-outline btn-sm" onclick="stopAllCompanySequences(${c.id})">⏹ Stop All Sequences</button>
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

async function markNextStepDone(companyId) {
  try {
    await apiFetch('/api/companies/' + companyId, {
      method: 'PATCH',
      body: JSON.stringify({ next_step: null, next_step_date: null })
    });
    toast('Step marked done!', 'success');
    loadReports(); // refresh
  } catch(e) { toast(e.message, 'error'); }
}

async function snoozeNextStep(companyId, days) {
  var newDate = new Date(Date.now() + days * 86400000).toISOString().slice(0,10);
  try {
    await apiFetch('/api/companies/' + companyId, {
      method: 'PATCH',
      body: JSON.stringify({ next_step_date: newDate })
    });
    toast('Snoozed ' + days + ' day' + (days !== 1 ? 's' : ''), 'success');
    loadReports();
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
