// ── PHIL LEWIS ART CRM — Contacts ──────────────────────────────────────────
// ── CONTACTS ──────────────────────────────────────────────────────────────
// Track selected contact IDs for bulk actions
var _selectedContactIds = new Set();
var _notInSeqActive = false;
var _hasEmailActive = false;
var _missingEmailActive = false;
var _lastFilteredContacts = []; // store last loaded contacts for mass enrollment

var _contactsTagFilters = [];

function renderContactsTagChips() {
  var el = document.getElementById('contacts-tag-chips');
  if (!el) return;
  el.innerHTML = '<span class="tag-filter-chip ' + (_contactsTagFilters.length===0?'active':'') + '" onclick="clearContactTagFilters()">All</span>' +
    INDUSTRY_TAGS.map(function(t) {
      var isActive = _contactsTagFilters.indexOf(t) !== -1;
      return '<span class="tag-filter-chip ' + (isActive?'active':'') + '" onclick="toggleContactTagFilter(\'' + esc(t) + '\')">' + esc(t) + '</span>';
    }).join('');
}

function toggleContactTagFilter(tag) {
  var idx = _contactsTagFilters.indexOf(tag);
  if (idx === -1) _contactsTagFilters.push(tag);
  else _contactsTagFilters.splice(idx, 1);
  renderContactsTagChips();
  loadContacts();
}

function clearContactTagFilters() {
  _contactsTagFilters = [];
  renderContactsTagChips();
  loadContacts();
}

async function loadContacts() {
  var search    = document.getElementById('search-contacts')?.value || '';
  var params    = new URLSearchParams();
  if (search)         params.set('search', search);
  if (_contactsTagFilters.length) params.set('tag', _contactsTagFilters.join(','));
  if (_notInSeqActive) params.set('not_in_sequence', 'true');
  if (_hasEmailActive) params.set('has_email', 'true');
  if (_missingEmailActive) params.set('missing_email', 'true');

  try {
    var contacts = await apiFetch('/api/contacts?' + params.toString());
    _lastFilteredContacts = contacts;
    var container = document.getElementById('contacts-grouped');
    _selectedContactIds.clear();
    updateBulkBar();
    updateMassEnrollBar(contacts);

    if (!contacts.length) {
      container.innerHTML = '<div class="empty-state">No contacts found.</div>';
      return;
    }

    // Group contacts by industry tag → company
    var industryGroups = {};
    contacts.forEach(function(c) {
      var tags = (c.company_tags || '').toLowerCase().split(',').map(function(t) { return t.trim(); }).filter(Boolean);
      var industry = 'Uncategorized';
      for (var ti = 0; ti < INDUSTRY_TAGS.length; ti++) {
        if (tags.indexOf(INDUSTRY_TAGS[ti]) !== -1) { industry = INDUSTRY_TAGS[ti]; break; }
      }
      if (!industryGroups[industry]) industryGroups[industry] = {};
      var coKey = c.company_name || 'No Company';
      if (!industryGroups[industry][coKey]) industryGroups[industry][coKey] = { companyId: c.company_id, contacts: [] };
      industryGroups[industry][coKey].contacts.push(c);
    });

    // Sort industries: INDUSTRY_TAGS order first, then Uncategorized last
    var sortedIndustries = INDUSTRY_TAGS.filter(function(t) { return industryGroups[t]; });
    if (industryGroups['Uncategorized']) sortedIndustries.push('Uncategorized');

    var html = sortedIndustries.map(function(industry) {
      var companies = industryGroups[industry];
      var companyNames = Object.keys(companies).sort();
      var totalContacts = companyNames.reduce(function(sum, co) { return sum + companies[co].contacts.length; }, 0);
      var label = industry === 'Uncategorized' ? 'Uncategorized' : industry.replace(/-/g,' ').replace(/\b\w/g, function(l) { return l.toUpperCase(); });

      return '<div class="contacts-industry-group">' +
        '<div class="contacts-industry-header">' +
          '<span class="contacts-industry-label">' + esc(label) + '</span>' +
          '<span class="contacts-industry-count">' + totalContacts + ' contact' + (totalContacts !== 1 ? 's' : '') + ' · ' + companyNames.length + ' compan' + (companyNames.length !== 1 ? 'ies' : 'y') + '</span>' +
        '</div>' +
        '<div class="contacts-tile-grid">' +
        companyNames.map(function(coName) {
          var group = companies[coName];
          var cts = group.contacts;
          var primary = cts.find(function(c) { return c.is_primary; }) || cts[0];
          // Determine best sequence status for tile badge
          var hasActive = cts.some(function(c) { return c.enrollment_status === 'active'; });
          var hasReplied = cts.some(function(c) { return c.enrollment_status === 'replied'; });
          var hasDone = cts.some(function(c) { return c.enrollment_status === 'completed'; });
          var tileBadge = hasReplied
            ? '<span class="seq-badge seq-replied">Replied</span>'
            : hasActive
            ? '<span class="seq-badge seq-active">In Sequence</span>'
            : hasDone
            ? '<span class="seq-badge seq-completed">Done</span>'
            : '<span class="seq-badge seq-none">No Outreach</span>';

          var contactLines = cts.slice(0, 3).map(function(c) {
            var emailIndicator = c.email ? '' : '<span class="tile-no-email" title="No email address">✉?</span>';
            return '<div class="tile-contact-row' + (c.email ? '' : ' tile-contact-no-email') + '">' +
              (c.is_primary ? '<span class="tile-star">★</span>' : '<span class="tile-star-placeholder"></span>') +
              '<span class="tile-contact-name">' + esc(c.first_name) + ' ' + esc(c.last_name||'') + '</span>' +
              (c.title ? '<span class="tile-contact-title">' + esc(c.title) + '</span>' : '') +
              emailIndicator +
            '</div>';
          }).join('');
          var moreCount = cts.length > 3 ? '<div class="tile-more">+' + (cts.length - 3) + ' more</div>' : '';

          var missingEmails = cts.filter(function(c) { return !c.email; }).length;
          var emailWarning = missingEmails > 0 ? '<div class="tile-email-warning" title="' + missingEmails + ' contact' + (missingEmails !== 1 ? 's' : '') + ' missing email">' + missingEmails + ' missing email' + (missingEmails !== 1 ? 's' : '') + '</div>' : '';

          return '<div class="contact-tile" onclick="openCompanyDetail(' + (group.companyId||0) + ')">' +
            '<div class="tile-header">' +
              '<div class="tile-company-name">' + esc(coName) + '</div>' +
              '<div class="tile-contact-count">' + cts.length + '</div>' +
            '</div>' +
            '<div class="tile-status">' + tileBadge + emailWarning + '</div>' +
            '<div class="tile-contacts">' + contactLines + moreCount + '</div>' +
          '</div>';
        }).join('') +
        '</div>' +
      '</div>';
    }).join('');

    container.innerHTML = html;
    updateBulkBar();
  } catch(e) { toast(e.message, 'error'); }
}

function toggleContactSelect(id, cb) {
  if (cb.checked) _selectedContactIds.add(id);
  else _selectedContactIds.delete(id);
  const row = cb.closest('tr');
  if (row) row.classList.toggle('contact-row-selected', cb.checked);
  const allCbs = document.querySelectorAll('.contact-checkbox');
  const allChecked = [...allCbs].every(c => c.checked);
  const someChecked = [...allCbs].some(c => c.checked);
  const selAll = document.getElementById('select-all-contacts');
  if (selAll) { selAll.checked = allChecked; selAll.indeterminate = someChecked && !allChecked; }
  updateBulkBar();
}

function toggleSelectAllContacts() {
  const selAll = document.getElementById('select-all-contacts');
  const cbs = document.querySelectorAll('.contact-checkbox');
  cbs.forEach(cb => {
    cb.checked = selAll.checked;
    const id = parseInt(cb.value);
    if (selAll.checked) _selectedContactIds.add(id);
    else _selectedContactIds.delete(id);
    const row = cb.closest('tr');
    if (row) row.classList.toggle('contact-row-selected', selAll.checked);
  });
  updateBulkBar();
}

function clearContactSelection() {
  _selectedContactIds.clear();
  document.querySelectorAll('.contact-checkbox').forEach(cb => cb.checked = false);
  document.querySelectorAll('.contact-row-selected').forEach(r => r.classList.remove('contact-row-selected'));
  const selAll = document.getElementById('select-all-contacts');
  if (selAll) { selAll.checked = false; selAll.indeterminate = false; }
  updateBulkBar();
}

function updateBulkBar() {
  const bar = document.getElementById('bulk-action-bar');
  const countEl = document.getElementById('bulk-count');
  if (!bar) return;
  const n = _selectedContactIds.size;
  if (n > 0) {
    bar.style.display = 'flex';
    countEl.textContent = `${n} contact${n !== 1 ? 's' : ''} selected`;
  } else {
    bar.style.display = 'none';
  }
}

async function populateBulkSequenceDropdown() {
  try {
    const seqs = await apiFetch('/api/sequences');
    const sel = document.getElementById('bulk-sequence-select');
    if (!sel) return;
    sel.innerHTML = `<option value="">— Choose sequence —</option>` +
      seqs.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  } catch(e) {}
}

async function bulkEnrollSelected() {
  const seqId = document.getElementById('bulk-sequence-select')?.value;
  if (!seqId) { toast('Please choose a sequence first.', 'error'); return; }
  const ids = [..._selectedContactIds];
  if (!ids.length) return;
  try {
    const r = await apiFetch('/api/enrollments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_ids: ids, sequence_id: parseInt(seqId) }),
    });
    toast(`${r.enrolled} contact${r.enrolled !== 1 ? 's' : ''} added to sequence.`, 'success');
    clearContactSelection();
    loadContacts();
  } catch(e) { toast('Enrollment failed: ' + e.message, 'error'); }
}

// loadContactCategories removed — replaced by curated INDUSTRY_TAGS chips

function toggleNotInSequence() {
  _notInSeqActive = !_notInSeqActive;
  const btn = document.getElementById('btn-not-in-seq');
  if (btn) btn.classList.toggle('filter-toggle-active', _notInSeqActive);
  loadContacts();
}

function toggleHasEmail() {
  _hasEmailActive = !_hasEmailActive;
  if (_hasEmailActive) _missingEmailActive = false;
  var btn = document.getElementById('btn-has-email');
  if (btn) btn.classList.toggle('filter-toggle-active', _hasEmailActive);
  var btn2 = document.getElementById('btn-missing-email');
  if (btn2) btn2.classList.remove('filter-toggle-active');
  loadContacts();
}

function toggleMissingEmail() {
  _missingEmailActive = !_missingEmailActive;
  if (_missingEmailActive) _hasEmailActive = false;
  var btn = document.getElementById('btn-missing-email');
  if (btn) btn.classList.toggle('filter-toggle-active', _missingEmailActive);
  var btn2 = document.getElementById('btn-has-email');
  if (btn2) btn2.classList.remove('filter-toggle-active');
  loadContacts();
}

function clearContactFilters() {
  var search = document.getElementById('search-contacts');
  if (search) search.value = '';
  _contactsTagFilters = [];
  _notInSeqActive = false;
  _hasEmailActive = false;
  _missingEmailActive = false;
  var btn = document.getElementById('btn-not-in-seq');
  if (btn) btn.classList.remove('filter-toggle-active');
  var btn2 = document.getElementById('btn-has-email');
  if (btn2) btn2.classList.remove('filter-toggle-active');
  var btn3 = document.getElementById('btn-missing-email');
  if (btn3) btn3.classList.remove('filter-toggle-active');
  renderContactsTagChips();
  loadContacts();
}

function updateMassEnrollBar(contacts) {
  var bar = document.getElementById('mass-enroll-bar');
  if (!bar) return;
  // Show mass enroll bar when filters are active and there are enrollable contacts
  var hasFilters = _contactsTagFilters.length > 0 || _notInSeqActive || _hasEmailActive || _missingEmailActive;
  var enrollable = contacts.filter(function(c) {
    return c.email && c.enrollment_status !== 'active';
  });
  if (hasFilters && enrollable.length > 0) {
    bar.style.display = 'flex';
    document.getElementById('mass-enroll-count').textContent = enrollable.length + ' contact' + (enrollable.length !== 1 ? 's' : '') + ' can be enrolled';
  } else {
    bar.style.display = 'none';
  }
}

async function massEnrollFiltered() {
  var seqId = document.getElementById('mass-enroll-seq-select').value;
  if (!seqId) { toast('Please choose a sequence first.', 'error'); return; }
  var enrollable = _lastFilteredContacts.filter(function(c) {
    return c.email && c.enrollment_status !== 'active';
  });
  if (!enrollable.length) { toast('No contacts available to enroll.', 'error'); return; }
  var ids = enrollable.map(function(c) { return c.id; });
  if (!confirm('Enroll ' + ids.length + ' contact' + (ids.length !== 1 ? 's' : '') + ' into this sequence?')) return;
  try {
    var r = await apiFetch('/api/enrollments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_ids: ids, sequence_id: parseInt(seqId) }),
    });
    toast(r.enrolled + ' contact' + (r.enrolled !== 1 ? 's' : '') + ' added to sequence!', 'success');
    loadContacts();
  } catch(e) { toast('Enrollment failed: ' + e.message, 'error'); }
}

async function populateMassEnrollDropdown() {
  try {
    var seqs = await apiFetch('/api/sequences');
    var sel = document.getElementById('mass-enroll-seq-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Choose sequence —</option>' +
      seqs.map(function(s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('');
  } catch(e) {}
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

