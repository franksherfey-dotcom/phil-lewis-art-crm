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
var activeTagFilters = [];
var activeTypeFilters = [];
var activeStatusFilters = [];
let allTags = [];
let currentDetailCompanyId = null; // tracks which company detail is open when adding/editing contacts

// ── TAG HELPERS ────────────────────────────────────────────────────────────
const PRESET_TAGS = [
  'apparel','hard-goods','outdoor','skateboard','snowboard','surf',
  'fishing','camping','drinkware','footwear','puzzles','calendars',
  'fabric','cards','lifestyle'
];

// Phil's core licensing industries — shown as filter chips on the Prospects page
const INDUSTRY_TAGS = [
  'apparel', 'hard-goods', 'outdoor', 'surf', 'skateboard', 'snowboard',
  'drinkware', 'footwear', 'puzzles', 'cards', 'fabric', 'lifestyle'
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
  renderTagFilterChips();
}

function renderTagFilterChips() {
  var el = document.getElementById('tag-filter-chips');
  if (!el) return;
  el.innerHTML = INDUSTRY_TAGS.map(function(t) {
    var isActive = activeTagFilters.indexOf(t) !== -1;
    return '<span class="tag-filter-chip ' + (isActive ? 'active' : '') + '" onclick="toggleTagFilter(\'' + esc(t) + '\')">' + esc(t) + '</span>';
  }).join('');
}

function toggleTagFilter(tag) {
  var idx = activeTagFilters.indexOf(tag);
  if (idx === -1) activeTagFilters.push(tag);
  else activeTagFilters.splice(idx, 1);
  renderTagFilterChips();
  loadCompanies();
}

/* ── Multi-select dropdown helper ── */
function renderMultiSelectDropdown(containerId, label, options, activeArr, toggleFn) {
  var el = document.getElementById(containerId);
  if (!el) return;
  var count = activeArr.length;
  var btnLabel = count ? label + ' (' + count + ')' : label;
  el.innerHTML = '<div class="ms-dropdown">' +
    '<button class="ms-dropdown-btn" onclick="event.stopPropagation();toggleMsDropdown(\'' + containerId + '\')">' +
      esc(btnLabel) + ' <span class="ms-arrow">▾</span>' +
    '</button>' +
    '<div class="ms-dropdown-menu" id="' + containerId + '-menu">' +
      options.map(function(o) {
        var checked = activeArr.indexOf(o.value) !== -1;
        return '<label class="ms-option" onclick="event.stopPropagation()">' +
          '<input type="checkbox" ' + (checked ? 'checked' : '') + ' onchange="' + toggleFn + '(\'' + esc(o.value) + '\')">' +
          '<span>' + esc(o.label) + '</span>' +
        '</label>';
      }).join('') +
    '</div>' +
  '</div>';
}

function toggleMsDropdown(containerId) {
  var menu = document.getElementById(containerId + '-menu');
  if (!menu) return;
  document.querySelectorAll('.ms-dropdown-menu.open').forEach(function(m) { if (m !== menu) m.classList.remove('open'); });
  menu.classList.toggle('open');
}

var TYPE_OPTIONS = [
  { value: 'manufacturer', label: 'Manufacturer' },
  { value: 'retailer', label: 'Retailer' },
  { value: 'publisher', label: 'Publisher' },
  { value: 'agent', label: 'Agent / Rep' },
  { value: 'other', label: 'Other' }
];

var STATUS_OPTIONS = [
  { value: 'prospect', label: 'Prospect' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'interested', label: 'Interested' },
  { value: 'licensed', label: 'Licensed' },
  { value: 'not-interested', label: 'Not Interested' }
];

function toggleTypeFilter(val) {
  var idx = activeTypeFilters.indexOf(val);
  if (idx === -1) activeTypeFilters.push(val);
  else activeTypeFilters.splice(idx, 1);
  renderProspectDropdowns();
  loadCompanies();
}

function toggleStatusFilter(val) {
  var idx = activeStatusFilters.indexOf(val);
  if (idx === -1) activeStatusFilters.push(val);
  else activeStatusFilters.splice(idx, 1);
  renderProspectDropdowns();
  loadCompanies();
}

function renderProspectDropdowns() {
  renderMultiSelectDropdown('ms-type', 'All Types', TYPE_OPTIONS, activeTypeFilters, 'toggleTypeFilter');
  renderMultiSelectDropdown('ms-status', 'All Statuses', STATUS_OPTIONS, activeStatusFilters, 'toggleStatusFilter');
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
  if (page === 'prospects') { loadAllTags(); renderProspectDropdowns(); loadCompanies(); }
  if (page === 'contacts') { populateBulkSequenceDropdown(); populateMassEnrollDropdown(); renderContactsTagChips(); loadContacts(); }
  if (page === 'pipeline') loadPipeline();
  if (page === 'sequences') loadSequences();
  if (page === 'gallery') loadArtGallery();
  if (page === 'queue') loadQueue();
  if (page === 'inbox') loadInbox();
  if (page === 'activity') loadActivity();
  if (page === 'settings') loadSettings();
  if (page === 'reports') loadReports();
  if (page === 'news') { loadNews(null); loadLeadHeatmap(); }
  if (page === 'users') loadUsers();
}

// ── AUTH ───────────────────────────────────────────────────────────────────
let currentUser = null; // { id, username, display_name, role, force_password_change }

function getToken() { return localStorage.getItem('pla_token'); }
function setToken(t) { if (t) localStorage.setItem('pla_token', t); else localStorage.removeItem('pla_token'); }

// Helper: show/hide an error element by id
function showFormError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? '' : 'none';
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  showFormError('login-error', '');
  try {
    const data = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Login failed'); return d; });
    setToken(data.token);
    currentUser = data.user;
    if (data.user.force_password_change) {
      showForcePasswordChange();
    } else {
      showApp();
    }
  } catch(err) {
    showFormError('login-error', err.message);
  }
}

function showForcePasswordChange() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('change-password-screen').style.display = 'flex';
  showFormError('force-pw-error', '');
  document.getElementById('force-pw-new').value = '';
  document.getElementById('force-pw-confirm').value = '';
}

async function handleForcePasswordChange(e) {
  e.preventDefault();
  const newPw = document.getElementById('force-pw-new').value;
  const confirmPw = document.getElementById('force-pw-confirm').value;
  showFormError('force-pw-error', '');
  if (newPw !== confirmPw) { showFormError('force-pw-error', 'Passwords do not match.'); return; }
  if (newPw.length < 8) { showFormError('force-pw-error', 'Password must be at least 8 characters.'); return; }
  try {
    const data = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
      body: JSON.stringify({ newPassword: newPw }),
    }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Error'); return d; });
    if (data.token) setToken(data.token);
    currentUser = { ...currentUser, force_password_change: false };
    document.getElementById('change-password-screen').style.display = 'none';
    showApp();
  } catch(err) {
    showFormError('force-pw-error', err.message);
  }
}

async function handleChangePassword(e) {
  e.preventDefault();
  const current = document.getElementById('cpw-current').value;
  const newPw   = document.getElementById('cpw-new').value;
  const confirm = document.getElementById('cpw-confirm').value;
  showFormError('cpw-error', '');
  if (newPw !== confirm) { showFormError('cpw-error', 'Passwords do not match.'); return; }
  if (newPw.length < 8)  { showFormError('cpw-error', 'Password must be at least 8 characters.'); return; }
  try {
    const data = await apiFetch('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: current, newPassword: newPw }),
    });
    if (data.token) setToken(data.token);
    closeModal('modal-change-password');
    toast('Password updated successfully.', 'success');
    document.getElementById('change-pw-form').reset();
  } catch(err) {
    showFormError('cpw-error', err.message);
  }
}

function handleLogout() {
  setToken(null);
  currentUser = null;
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-password').value = '';
  showFormError('login-error', '');
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('change-password-screen').style.display = 'none';
  document.getElementById('app').style.display = '';

  // Populate sidebar user info
  const nameEl = document.getElementById('sidebar-user-name');
  const roleEl = document.getElementById('sidebar-user-role');
  if (nameEl) nameEl.textContent = currentUser.display_name || currentUser.username;
  if (roleEl) roleEl.textContent = currentUser.role;

  // Role-based UI adjustments
  applyRoleUI(currentUser.role);

  // Load initial page
  showPage('dashboard');
}

function applyRoleUI(role) {
  // Users nav: admin only
  document.querySelectorAll('.nav-item[data-page="users"]').forEach(el => {
    el.style.display = role === 'admin' ? '' : 'none';
  });
  // Settings nav: admin only
  document.querySelectorAll('.nav-item[data-page="settings"]').forEach(el => {
    el.style.display = role === 'admin' ? '' : 'none';
  });
  // Write actions: hidden for readonly
  if (role === 'readonly') {
    document.querySelectorAll('.btn-add, .btn-primary, .btn-save, [data-requires-write]').forEach(el => {
      el.style.display = 'none';
    });
  }
}

async function initAuth() {
  const token = getToken();
  if (!token) {
    document.getElementById('login-screen').style.display = 'flex';
    return;
  }
  try {
    const data = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Auth failed'); return d; });
    currentUser = data;
    if (data.force_password_change) {
      showForcePasswordChange();
    } else {
      showApp();
    }
  } catch(err) {
    // Token invalid/expired — show login
    setToken(null);
    document.getElementById('login-screen').style.display = 'flex';
  }
}

// ── USERS PAGE ─────────────────────────────────────────────────────────────
async function loadUsers() {
  const el = document.getElementById('users-tbody');
  if (!el) return;
  el.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-light)">Loading…</td></tr>';
  try {
    const users = await apiFetch('/api/users');
    if (!users.length) {
      el.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-light)">No users found.</td></tr>';
      return;
    }
    el.innerHTML = users.map(u => `
      <tr>
        <td>${esc(u.display_name || '—')}</td>
        <td>${esc(u.username)}</td>
        <td>${esc(u.email || '—')}</td>
        <td><span class="role-badge role-${u.role}">${esc(u.role)}</span></td>
        <td>${u.last_login_at ? fmtDate(u.last_login_at) : '<span style="color:var(--text-light)">Never</span>'}</td>
        <td>
          <button class="btn btn-sm" onclick="openUserModal(${u.id})">Edit</button>
          <button class="btn btn-sm btn-warning" onclick="adminResetPassword(${u.id}, '${esc(u.username)}')">Reset PW</button>
          ${u.id !== currentUser.id ? `<button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id}, '${esc(u.username)}')">Delete</button>` : ''}
        </td>
      </tr>`).join('');
  } catch(e) {
    el.innerHTML = `<tr><td colspan="6" style="color:var(--danger)">${esc(e.message)}</td></tr>`;
  }
}

let editingUserId = null;

// Live password strength indicator
function checkPwRequirements(pw) {
  const checks = {
    'req-length': pw.length >= 8,
    'req-upper':  /[A-Z]/.test(pw),
    'req-lower':  /[a-z]/.test(pw),
    'req-number': /[0-9]/.test(pw),
  };
  Object.entries(checks).forEach(([id, ok]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('req-met', ok);
    el.classList.toggle('req-unmet', !ok);
  });
  return Object.values(checks).every(Boolean);
}

function validatePassword(pw) {
  if (!pw) return 'Password is required.';
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(pw)) return 'Password must include at least one uppercase letter.';
  if (!/[a-z]/.test(pw)) return 'Password must include at least one lowercase letter.';
  if (!/[0-9]/.test(pw)) return 'Password must include at least one number.';
  return null;
}

// Attach live listener once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const pwInput = document.getElementById('user-pw-input');
  if (pwInput) {
    pwInput.addEventListener('input', () => checkPwRequirements(pwInput.value));
  }
});

async function openUserModal(userId) {
  editingUserId = userId || null;
  const form    = document.getElementById('user-form');
  const title   = document.getElementById('user-modal-title');
  const pwInput = document.getElementById('user-pw-input');
  const pwConfirm = document.getElementById('user-pw-confirm');
  const pwHint  = document.getElementById('user-pw-hint');
  const pwReqs  = document.getElementById('user-pw-requirements');
  const pwConfirmGroup = document.getElementById('user-pw-confirm-group');
  showFormError('user-form-error', '');
  form.reset();
  // Reset requirement indicators
  ['req-length','req-upper','req-lower','req-number'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('req-met','req-unmet'); }
  });

  if (userId) {
    title.textContent = 'Edit User';
    if (pwHint) pwHint.style.display = '';
    if (pwReqs) pwReqs.style.display = 'none';
    if (pwConfirmGroup) pwConfirmGroup.style.display = 'none';
    if (pwInput) pwInput.required = false;
    if (pwConfirm) pwConfirm.required = false;
    try {
      const users = await apiFetch('/api/users');
      const u = users.find(x => x.id === userId);
      if (u) {
        form.elements['displayName'].value = u.display_name || '';
        form.elements['username'].value    = u.username;
        form.elements['email'].value       = u.email || '';
        form.elements['role'].value        = u.role;
      }
    } catch(e) { showFormError('user-form-error', e.message); }
  } else {
    title.textContent = 'Add User';
    if (pwHint) pwHint.style.display = 'none';
    if (pwReqs) pwReqs.style.display = '';
    if (pwConfirmGroup) pwConfirmGroup.style.display = '';
    if (pwInput) pwInput.required = true;
    if (pwConfirm) pwConfirm.required = true;
  }
  openModal('modal-user');
}

async function saveUser(e) {
  e.preventDefault();
  showFormError('user-form-error', '');
  const form = e.target;
  const pw      = form.elements['password'].value;
  const pwConf  = form.elements['passwordConfirm']?.value || '';

  // Validate password when set
  if (pw) {
    const pwError = validatePassword(pw);
    if (pwError) { showFormError('user-form-error', pwError); return; }
    // Only check confirm match when creating new user (confirm field is hidden in edit mode)
    if (!editingUserId && pw !== pwConf) {
      showFormError('user-form-error', 'Passwords do not match.'); return;
    }
  } else if (!editingUserId) {
    showFormError('user-form-error', 'Password is required for new users.');
    return;
  }

  const body = {
    display_name: form.elements['displayName'].value.trim(),
    username:     form.elements['username'].value.trim(),
    email:        form.elements['email'].value.trim() || null,
    role:         form.elements['role'].value,
  };
  if (pw) body.password = pw;

  try {
    if (editingUserId) {
      await apiFetch(`/api/users/${editingUserId}`, { method: 'PUT', body: JSON.stringify(body) });
      toast('User updated.', 'success');
    } else {
      await apiFetch('/api/users', { method: 'POST', body: JSON.stringify(body) });
      toast('User created.', 'success');
    }
    closeModal('modal-user');
    loadUsers();
  } catch(err) {
    showFormError('user-form-error', err.message);
  }
}

async function adminResetPassword(userId, username) {
  const newPw = prompt(`Set a new temporary password for "${username}":\n\nMust be 8+ chars, include uppercase, lowercase, and a number.`);
  if (!newPw) return;
  const err = validatePassword(newPw);
  if (err) { alert(err); return; }
  try {
    await apiFetch(`/api/users/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password: newPw }),
    });
    toast(`Password reset for ${username}. They'll be prompted to change it on next login.`, 'success');
  } catch(e) {
    toast(e.message, 'error');
  }
}

async function deleteUser(userId, username) {
  if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
  try {
    await apiFetch(`/api/users/${userId}`, { method: 'DELETE' });
    toast('User deleted.', 'success');
    loadUsers();
  } catch(e) {
    toast(e.message, 'error');
  }
}

// ── API HELPERS ────────────────────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
  const token = getToken();
  const { headers: optHeaders, ...restOpts } = opts;
  const res = await fetch(API + url, {
    ...restOpts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...optHeaders,
    },
  });
  if (res.status === 401) {
    // Token expired or invalid
    setToken(null);
    document.getElementById('app').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    throw new Error('Session expired. Please log in again.');
  }
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
    // Sort replies newest-first (query uses DISTINCT ON which orders by contact)
    const replies = (d.recentActivity || []).sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at));
    if (!replies.length) {
      actEl.innerHTML = `<div class="empty-state">No replies yet. Replies from prospects will show up here.</div>`;
      return;
    }
    actEl.innerHTML = `<div class="activity-list">${replies.map(a => {
      const isNew = !a.notes || a.notes !== 'read';
      const rawSnippet = cleanReplyBody(a.body || '');
      const snippet = rawSnippet.length > 120 ? rawSnippet.substring(0,120) + '…' : rawSnippet;
      const hasSequence = !!a.enrollment_id;
      return `
      <div class="activity-row${isNew ? ' activity-unread' : ''}" data-activity-id="${a.id}">
        <div class="activity-content" onclick="openContactDetail(${a.contact_id})" style="cursor:pointer">
          <div class="activity-header">
            <span class="activity-name">${esc(a.first_name)} ${esc(a.last_name||'')}</span>
            <span class="activity-co">${esc(a.company_name||'')}</span>
            <span class="activity-date">${fmtDate(a.sent_at)}</span>
          </div>
          ${snippet ? `<div class="activity-snippet">"${esc(snippet)}"</div>` : ''}
        </div>
        <div class="activity-actions">
          <button class="btn btn-sm btn-primary activity-reply-btn" onclick="event.stopPropagation();openQuickReply(${a.id})">Reply</button>
          <div class="activity-menu-wrap">
            <button class="activity-menu-btn" onclick="event.stopPropagation();toggleActivityMenu(this)" title="More actions">⋯</button>
            <div class="activity-menu">
              <button onclick="event.stopPropagation();archiveReply(${a.id})">Archive</button>
              <button onclick="event.stopPropagation();toggleReadReply(${a.id})">${isNew ? 'Mark read' : 'Mark unread'}</button>
              ${hasSequence ? `<button onclick="event.stopPropagation();removeFromSequence(${a.enrollment_id},${a.id})">Remove from sequence</button>` : ''}
              <button class="activity-menu-danger" onclick="event.stopPropagation();deleteReply(${a.id})">Delete</button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('')}</div>`;
  } catch(e) { toast(e.message, 'error'); }
}

/* ── Reply body cleanup (handles base64, HTML, encoding artifacts) ── */
function cleanReplyBody(body) {
  if (!body) return '';
  var text = body;
  // Detect base64-encoded content (long alphanumeric strings with no spaces)
  if (/^[A-Za-z0-9+/=\s]{50,}$/.test(text.trim()) || /[A-Za-z0-9+/]{40,}/.test(text)) {
    try {
      var decoded = atob(text.replace(/\s/g, ''));
      if (/[a-z ]{10,}/i.test(decoded)) text = decoded;
    } catch(e) { /* not valid base64, keep original */ }
  }
  // Strip HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

/* ── Prospect Reply action handlers ── */
function toggleActivityMenu(btn) {
  var menu = btn.nextElementSibling;
  // Close any other open menus first
  document.querySelectorAll('.activity-menu.open').forEach(function(m) {
    if (m !== menu) m.classList.remove('open');
  });
  menu.classList.toggle('open');
}

// Close menus when clicking outside (activity menus + ms-dropdown menus)
document.addEventListener('click', function() {
  document.querySelectorAll('.activity-menu.open, .ms-dropdown-menu.open').forEach(function(m) { m.classList.remove('open'); });
});

async function archiveReply(activityId) {
  try {
    await fetch('/api/activities/' + activityId + '/archive', { method: 'PATCH' });
    toast('Reply archived');
    loadDashboard();
  } catch(e) { toast(e.message, 'error'); }
}

async function toggleReadReply(activityId) {
  try {
    var res = await fetch('/api/activities/' + activityId + '/toggle-read', { method: 'PATCH' });
    var data = await res.json();
    toast(data.notes === 'read' ? 'Marked as read' : 'Marked as unread');
    loadDashboard();
  } catch(e) { toast(e.message, 'error'); }
}

async function removeFromSequence(enrollmentId, activityId) {
  if (!confirm('Remove this contact from their active sequence?')) return;
  try {
    await fetch('/api/enrollments/' + enrollmentId, { method: 'DELETE' });
    toast('Removed from sequence');
    loadDashboard();
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteReply(activityId) {
  if (!confirm('Permanently delete this reply? This cannot be undone.')) return;
  try {
    await fetch('/api/activities/' + activityId, { method: 'DELETE' });
    toast('Reply deleted');
    loadDashboard();
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
    const [contact, activities, enrollments] = await Promise.all([
      apiFetch(`/api/contacts/${contactId}`),
      apiFetch(`/api/activities?contact_id=${contactId}`),
      apiFetch(`/api/contacts/${contactId}/enrollments`),
    ]);

    // Fetch company detail for context
    let company = null;
    if (contact.company_id) {
      try { company = await apiFetch(`/api/companies/${contact.company_id}`); } catch(e) {}
    }

    const replies = activities.filter(a => a.type === 'received_email');
    const sent = activities.filter(a => a.type === 'email');
    const latestReply = replies[0]; // already sorted newest-first

    // Find the latest inbound activity ID for Quick Reply
    const latestInboundId = latestReply ? latestReply.id : null;

    document.getElementById('contact-detail-title').textContent =
      `${contact.first_name} ${contact.last_name || ''}`.trim();

    // ── Build the redesigned modal content ──
    let html = '';

    // Top bar: name, title, company, email — compact row
    html += `<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:4px">`;
    if (contact.title) html += `<span style="font-size:13px;color:var(--text-muted)">${esc(contact.title)}</span>`;
    if (contact.company_name) {
      html += `<span style="font-size:13px">at <strong>${contact.company_id
        ? `<a href="#" onclick="event.preventDefault();closeModal('modal-contact-detail');openCompanyDetail(${contact.company_id})">${esc(contact.company_name)}</a>`
        : esc(contact.company_name)}</strong></span>`;
    }
    if (contact.email) html += `<span style="font-size:12px;color:var(--text-muted)">· <a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a></span>`;
    html += `</div>`;

    // Company intel bar (if we have company data)
    if (company) {
      const chips = [];
      if (company.pipeline_stage) chips.push(`<span class="cd-chip cd-chip-stage">${esc(company.pipeline_stage)}</span>`);
      if (company.opportunity_value && parseFloat(company.opportunity_value) > 0) chips.push(`<span class="cd-chip cd-chip-opp">$${parseFloat(company.opportunity_value).toLocaleString(undefined,{maximumFractionDigits:0})}</span>`);
      if (company.tags) company.tags.split(',').forEach(t => { if(t.trim()) chips.push(`<span class="cd-chip">${esc(t.trim())}</span>`); });
      if (company.status) chips.push(`<span class="cd-chip">${esc(company.status)}</span>`);
      html += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${chips.join('')}</div>`;
      if (company.notes) {
        html += `<div style="font-size:12px;color:var(--text-muted);background:var(--bg);border-radius:6px;padding:10px;margin-bottom:14px;line-height:1.5">${esc(company.notes)}</div>`;
      }
    }

    // Latest reply — the main event
    if (latestReply && latestReply.body) {
      html += `<div style="margin-bottom:14px">`;
      html += `<div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Their Latest Reply · ${fmtDate(latestReply.sent_at)}</div>`;
      html += `<div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:6px;padding:12px 14px;font-size:13px;line-height:1.6;max-height:200px;overflow-y:auto;white-space:pre-wrap">${esc(latestReply.body)}</div>`;
      html += `</div>`;
    }

    // Action buttons row
    html += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">`;
    if (latestInboundId) {
      html += `<button class="btn btn-primary" onclick="closeModal('modal-contact-detail');openQuickReply(${latestInboundId})">Reply to ${esc(contact.first_name)}</button>`;
    }
    if (contact.email) {
      html += `<button class="btn btn-outline" onclick="closeModal('modal-contact-detail');openPortfolioComposer(${contact.company_id || 'null'}, '${esc(contact.email)}', '${esc(contact.first_name)}')">📨 Send Portfolio</button>`;
    }
    html += `</div>`;

    // Active sequence enrollments with remove buttons
    html += renderEnrollmentBadges(enrollments, 'openContactDetail(' + contactId + ')');

    // Thread history — compact, expandable
    html += `<div style="margin-bottom:6px;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">Thread History (${activities.length})</div>`;
    html += `<div style="border:1px solid var(--border);border-radius:6px;overflow:hidden;max-height:220px;overflow-y:auto">`;
    activities.forEach(a => {
      const isReply = a.type === 'received_email';
      const icon = isReply ? '←' : '→';
      const iconColor = isReply ? 'var(--accent)' : 'var(--primary)';
      const label = isReply ? 'Received' : 'Sent';
      html += `<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 12px;border-bottom:1px solid var(--border);font-size:12px" class="cd-thread-row" onclick="this.querySelector('.cd-body')?.classList.toggle('hidden')">`;
      html += `<span style="color:${iconColor};font-weight:700;flex-shrink:0" title="${label}">${icon}</span>`;
      html += `<div style="flex:1;min-width:0">`;
      html += `<div style="display:flex;justify-content:space-between;gap:8px"><span style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.subject||'(no subject)')}</span><span style="color:var(--text-muted);white-space:nowrap;flex-shrink:0">${fmtDate(a.sent_at)}</span></div>`;
      if (a.body) {
        const preview = a.body.replace(/\n/g,' ').substring(0, 100);
        html += `<div class="cd-body hidden" style="margin-top:4px;color:var(--text-muted);white-space:pre-wrap;line-height:1.5;max-height:150px;overflow-y:auto;cursor:text" onclick="event.stopPropagation()">${esc(a.body)}</div>`;
        html += `<div style="color:var(--text-muted);margin-top:2px;font-size:11px;cursor:pointer">${esc(preview)}…</div>`;
      }
      html += `</div></div>`;
    });
    html += `</div>`;

    // Footer actions
    html += `<div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">`;
    if (contact.company_id) {
      html += `<a href="#" class="btn btn-outline btn-sm" onclick="event.preventDefault();closeModal('modal-contact-detail');openCompanyDetail(${contact.company_id})">Company Detail</a>`;
      html += `<a href="#" class="btn btn-outline btn-sm" onclick="event.preventDefault();closeModal('modal-contact-detail');showPage('pipeline')">Pipeline</a>`;
    }
    html += `</div>`;

    document.getElementById('contact-detail-body').innerHTML = html;
    openModal('modal-contact-detail');
  } catch(e) { toast(e.message, 'error'); }
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

// ── CONTACTS ──────────────────────────────────────────────────────────────
// Track selected contact IDs for bulk actions
var _selectedContactIds = new Set();
var _notInSeqActive = false;
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
            return '<div class="tile-contact-row">' +
              (c.is_primary ? '<span class="tile-star">★</span>' : '<span class="tile-star-placeholder"></span>') +
              '<span class="tile-contact-name">' + esc(c.first_name) + ' ' + esc(c.last_name||'') + '</span>' +
              (c.title ? '<span class="tile-contact-title">' + esc(c.title) + '</span>' : '') +
            '</div>';
          }).join('');
          var moreCount = cts.length > 3 ? '<div class="tile-more">+' + (cts.length - 3) + ' more</div>' : '';

          return '<div class="contact-tile" onclick="openCompanyDetail(' + (group.companyId||0) + ')">' +
            '<div class="tile-header">' +
              '<div class="tile-company-name">' + esc(coName) + '</div>' +
              '<div class="tile-contact-count">' + cts.length + '</div>' +
            '</div>' +
            '<div class="tile-status">' + tileBadge + '</div>' +
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

function clearContactFilters() {
  var search = document.getElementById('search-contacts');
  if (search) search.value = '';
  _contactsTagFilters = [];
  _notInSeqActive = false;
  var btn = document.getElementById('btn-not-in-seq');
  if (btn) btn.classList.remove('filter-toggle-active');
  renderContactsTagChips();
  loadContacts();
}

function updateMassEnrollBar(contacts) {
  var bar = document.getElementById('mass-enroll-bar');
  if (!bar) return;
  // Show mass enroll bar when filters are active and there are enrollable contacts
  var hasFilters = _contactsTagFilters.length > 0 || _notInSeqActive;
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

// ── SEQUENCES ─────────────────────────────────────────────────────────────
async function loadSequences() {
  try {
    const seqs = await apiFetch('/api/sequences');
    const el = document.getElementById('sequences-list');
    if (!seqs.length) {
      el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div style="font-size:32px;margin-bottom:8px">◈</div><p>No sequences yet. Create one to start automating your outreach.</p></div>`;
      return;
    }
    el.innerHTML = seqs.map(function(s) {
      var st = s.stats || { active:0, replied:0, completed:0, stopped:0, total:0 };
      var replyRate = st.total > 0 ? Math.round((st.replied / st.total) * 100) : 0;
      var completionRate = st.total > 0 ? Math.round(((st.completed + st.replied) / st.total) * 100) : 0;

      // Mini stats bar segments
      var barHtml = '';
      if (st.total > 0) {
        var segs = [
          { n: st.replied, color: 'var(--success)', label: 'Replied' },
          { n: st.active, color: 'var(--primary)', label: 'Active' },
          { n: st.completed, color: '#6b7280', label: 'Completed' },
          { n: st.stopped || 0, color: 'var(--danger)', label: 'Stopped' }
        ];
        barHtml = '<div style="display:flex;height:6px;border-radius:3px;overflow:hidden;background:var(--border-light,#eef0f3);margin:8px 0">';
        segs.forEach(function(seg) {
          if (seg.n > 0) {
            var pct = Math.round((seg.n / st.total) * 100);
            barHtml += '<div style="width:' + pct + '%;background:' + seg.color + '" title="' + seg.label + ': ' + seg.n + '"></div>';
          }
        });
        barHtml += '</div>';
      }

      function statChip(count, label, color, seqId, seqName, statusFilter) {
        if (count === 0) return '';
        return '<span class="seq-stat-chip" style="cursor:pointer" onclick="event.stopPropagation();openSequenceRoster(' + seqId + ',' + JSON.stringify(esc(seqName)) + ',\'' + statusFilter + '\')">' +
          '<strong style="color:' + color + '">' + count + '</strong> ' + label + '</span>';
      }

      var statsLine = st.total > 0
        ? '<div style="display:flex;gap:12px;font-size:12px;color:var(--text-muted);margin-top:4px;flex-wrap:wrap">' +
            statChip(st.total, 'enrolled', 'var(--text)', s.id, s.name, '') +
            statChip(st.active, 'active', 'var(--primary)', s.id, s.name, 'active') +
            statChip(st.replied, 'replied', 'var(--success)', s.id, s.name, 'replied') +
            '<span>Reply rate: <strong style="color:' + (replyRate > 5 ? 'var(--success)' : 'var(--text)') + '">' + replyRate + '%</strong></span>' +
            (st.stopped > 0 ? statChip(st.stopped, 'stopped', 'var(--danger)', s.id, s.name, 'stopped') : '') +
          '</div>'
        : '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">No enrollments yet</div>';

      return '<div class="seq-card">' +
        '<div class="seq-card-header">' +
          '<div class="seq-name">' + esc(s.name) + '</div>' +
          '<div style="display:flex;gap:6px">' +
            '<button class="btn btn-ghost btn-sm" onclick="openSequenceModal(' + s.id + ')">Edit</button>' +
            '<button class="btn btn-danger btn-sm" onclick="deleteSequence(' + s.id + ')">Delete</button>' +
          '</div>' +
        '</div>' +
        (s.description ? '<div class="seq-desc">' + esc(s.description) + '</div>' : '') +
        barHtml + statsLine +
        '<div class="seq-steps-preview">' +
          s.steps.map(function(step) {
            return '<div class="seq-step-row">' +
              '<div class="seq-step-num">' + step.step_number + '</div>' +
              '<div class="seq-step-info">' + esc(step.subject) + '</div>' +
              '<div class="seq-step-delay">' + (step.step_number===1 ? 'Day 0 (immediate)' : '+' + step.delay_days + ' day' + (step.delay_days!==1?'s':'')) + '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<div class="seq-footer">' +
          '<button class="enrolled-count enrolled-count-btn" onclick="openSequenceRoster(' + s.id + ', ' + JSON.stringify(esc(s.name)) + ')">' + s.enrollment_count + ' contact' + (s.enrollment_count!==1?'s':'') + ' enrolled</button>' +
          '<button class="btn btn-primary btn-sm" onclick="openEnrollModalForSeq(' + s.id + ')">Enroll Contacts</button>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch(e) { toast(e.message, 'error'); }
}

// ── Sequence Roster Panel ─────────────────────────────────────────────────────
async function openSequenceRoster(seqId, seqName, filterStatus) {
  const existing = document.getElementById('seq-roster-panel');
  if (existing) existing.remove();

  var activeFilter = filterStatus || '';

  const panel = document.createElement('div');
  panel.id = 'seq-roster-panel';
  panel.className = 'seq-roster-panel';
  panel.innerHTML = '<div class="seq-roster-loading">Loading roster…</div>';
  const seqList = document.getElementById('sequences-list');
  seqList.parentNode.insertBefore(panel, seqList.nextSibling);
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const { enrolled, suggestions } = await apiFetch('/api/sequences/' + seqId + '/roster');

    // Compute stats
    var rosterActive = enrolled.filter(function(c) { return c.enrollment_status === 'active'; }).length;
    var rosterReplied = enrolled.filter(function(c) { return c.enrollment_status === 'replied'; }).length;
    var rosterCompleted = enrolled.filter(function(c) { return c.enrollment_status === 'completed'; }).length;
    var rosterStopped = enrolled.filter(function(c) { return c.enrollment_status === 'stopped' || c.enrollment_status === 'paused'; }).length;
    var rosterReplyRate = enrolled.length > 0 ? Math.round((rosterReplied / enrolled.length) * 100) : 0;

    // Filter chips
    function rosterChip(label, count, status, color) {
      var isActive = activeFilter === status;
      return '<span class="roster-filter-chip' + (isActive ? ' roster-filter-active' : '') + '"' +
        ' style="cursor:pointer;border-color:' + (isActive ? color : 'var(--border)') + '"' +
        ' onclick="openSequenceRoster(' + seqId + ',' + JSON.stringify(esc(seqName)) + ',\'' + (isActive ? '' : status) + '\')">' +
        '<strong style="color:' + color + '">' + count + '</strong> ' + label + '</span>';
    }

    var filterHtml = '<div class="roster-filter-bar">' +
      rosterChip('All', enrolled.length, '', 'var(--text)') +
      rosterChip('Active', rosterActive, 'active', 'var(--primary)') +
      rosterChip('Replied', rosterReplied, 'replied', 'var(--success)') +
      rosterChip('Completed', rosterCompleted, 'completed', '#6b7280') +
      (rosterStopped > 0 ? rosterChip('Stopped', rosterStopped, 'stopped', 'var(--danger)') : '') +
      '<span style="margin-left:auto;font-size:12px;color:var(--text-muted)">Reply rate: <strong style="color:' + (rosterReplyRate > 5 ? 'var(--success)' : 'var(--text)') + '">' + rosterReplyRate + '%</strong></span>' +
    '</div>';

    // Filter enrolled list
    var filteredEnrolled = enrolled;
    if (activeFilter) {
      if (activeFilter === 'stopped') {
        filteredEnrolled = enrolled.filter(function(c) { return c.enrollment_status === 'stopped' || c.enrollment_status === 'paused'; });
      } else {
        filteredEnrolled = enrolled.filter(function(c) { return c.enrollment_status === activeFilter; });
      }
    }

    // Build enrolled rows — with action buttons and reply status
    var enrolledRowsHtml = '';
    if (filteredEnrolled.length) {
      filteredEnrolled.forEach(function(c) {
        var statusBadge =
          c.enrollment_status === 'active'    ? '<span class="seq-badge seq-active">● Active</span>' :
          c.enrollment_status === 'replied'   ? '<span class="seq-badge seq-replied">✓ Replied</span>' :
          c.enrollment_status === 'completed' ? '<span class="seq-badge seq-completed">✓ Done</span>' :
          c.enrollment_status === 'paused'    ? '<span class="seq-badge seq-completed">⏸ Paused</span>' :
                                                '<span class="seq-badge seq-completed">Stopped</span>';

        // Reply status: did they reply? Did Frank respond back?
        var replyInfo = '';
        if (c.enrollment_status === 'replied' && c.last_reply_at) {
          var youReplied = c.last_sent_at && new Date(c.last_sent_at) > new Date(c.last_reply_at);
          if (youReplied) {
            replyInfo = '<div style="font-size:11px;color:var(--success);margin-top:2px">✓ You responded ' + fmtDate(c.last_sent_at) + '</div>';
          } else {
            replyInfo = '<div style="font-size:11px;color:var(--danger);font-weight:600;margin-top:2px">⚠ Awaiting your reply (replied ' + fmtDate(c.last_reply_at) + ')</div>';
          }
        }

        // Action buttons based on status
        var actions = '';
        if (c.enrollment_status === 'replied') {
          var youReplied2 = c.last_sent_at && new Date(c.last_sent_at) > new Date(c.last_reply_at);
          if (!youReplied2) {
            actions = '<button class="btn btn-primary btn-sm" onclick="openContactDetail(' + c.id + ')">Reply Now</button>';
          } else {
            actions = '<button class="btn btn-outline btn-sm" onclick="openContactDetail(' + c.id + ')">View</button>';
          }
        } else if (c.enrollment_status === 'active') {
          actions = '<button class="btn btn-outline btn-sm" onclick="openContactDetail(' + c.id + ')">View</button>';
        } else {
          actions = '<button class="btn btn-ghost btn-sm" onclick="openContactDetail(' + c.id + ')">View</button>';
        }
        actions += ' <button class="btn btn-ghost btn-sm" style="color:var(--text-muted)" onclick="unenrollFromRoster(' + c.enrollment_id + ',' + seqId + ',\'' + esc(seqName) + '\')">Remove</button>';

        enrolledRowsHtml += '<tr' + (c.enrollment_status === 'replied' && !(c.last_sent_at && new Date(c.last_sent_at) > new Date(c.last_reply_at)) ? ' style="background:var(--success-pale,#f0fdf4)"' : '') + '>' +
          '<td><a href="#" onclick="event.preventDefault();openContactDetail(' + c.id + ')" style="font-weight:600;color:var(--text);text-decoration:none">' + esc(c.first_name) + ' ' + esc(c.last_name||'') + '</a>' + replyInfo + '</td>' +
          '<td>' + esc(c.title||'—') + '</td>' +
          '<td>' + (c.company_name ? '<a href="#" onclick="event.preventDefault();openCompanyDetail(' + (c.company_id||0) + ')" style="color:var(--text);text-decoration:none">' + esc(c.company_name) + '</a>' : '—') + '</td>' +
          '<td>' + esc(c.email||'—') + '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td style="white-space:nowrap">' + actions + '</td>' +
        '</tr>';
      });
    } else {
      enrolledRowsHtml = '<tr><td colspan="6" class="empty-state" style="padding:16px">No contacts match this filter.</td></tr>';
    }

    var suggestRows = suggestions.length
      ? suggestions.map(function(c) {
          return '<tr>' +
            '<td><strong>' + esc(c.first_name) + ' ' + esc(c.last_name||'') + '</strong></td>' +
            '<td>' + esc(c.title||'—') + '</td>' +
            '<td>' + (c.company_name ? esc(c.company_name) : '—') + '</td>' +
            '<td>' + esc(c.email||'—') + '</td>' +
            '<td>' + (c.other_enrollment_status === 'active'
              ? '<span class="seq-badge seq-completed" title="In another sequence">In sequence</span>'
              : '<span style="color:var(--success,#16a34a);font-size:12px;font-weight:600">● Available</span>') + '</td>' +
            '<td><button class="btn btn-primary btn-sm" onclick="enrollFromRoster(' + c.id + ',' + seqId + ',\'' + esc(seqName) + '\')">Add</button></td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="6" class="empty-state" style="padding:16px">All contacts with emails are already enrolled.</td></tr>';

    var filterLabel = activeFilter ? ' — ' + activeFilter.charAt(0).toUpperCase() + activeFilter.slice(1) : '';
    panel.innerHTML =
      '<div class="seq-roster-header">' +
        '<div>' +
          '<div class="seq-roster-title">' + esc(seqName) + ' — Roster' + filterLabel + '</div>' +
          '<div class="seq-roster-sub">' + enrolled.length + ' enrolled · ' + suggestions.filter(function(s) { return s.other_enrollment_status !== 'active'; }).length + ' available to add</div>' +
        '</div>' +
        '<button class="inbox-rp-close" onclick="document.getElementById(\'seq-roster-panel\').remove()">✕</button>' +
      '</div>' +
      filterHtml +
      '<div class="seq-roster-section-title">' + (activeFilter ? activeFilter.charAt(0).toUpperCase() + activeFilter.slice(1) + ' (' + filteredEnrolled.length + ')' : 'Currently Enrolled (' + enrolled.length + ')') + '</div>' +
      '<div class="table-scroll-wrapper" style="margin-bottom:24px">' +
        '<table class="data-table">' +
          '<thead><tr><th>Name</th><th>Title</th><th>Company</th><th>Email</th><th>Status</th><th></th></tr></thead>' +
          '<tbody>' + enrolledRowsHtml + '</tbody>' +
        '</table>' +
      '</div>' +
      (activeFilter ? '' :
        '<div class="seq-roster-section-title">Suggested Contacts to Add (' + suggestions.length + ')</div>' +
        '<div class="seq-roster-hint">● Available = not in any active sequence. Sorted by availability first.</div>' +
        '<div class="table-scroll-wrapper">' +
          '<table class="data-table">' +
            '<thead><tr><th>Name</th><th>Title</th><th>Company</th><th>Email</th><th>Status</th><th></th></tr></thead>' +
            '<tbody>' + suggestRows + '</tbody>' +
          '</table>' +
        '</div>'
      );
  } catch(e) {
    panel.innerHTML = '<div style="padding:20px;color:red">Failed to load roster: ' + esc(e.message) + '</div>';
  }
}

async function enrollFromRoster(contactId, seqId, seqName) {
  try {
    const r = await apiFetch('/api/enrollments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_ids: [contactId], sequence_id: seqId }),
    });
    toast(`Added to "${seqName}"`, 'success');
    openSequenceRoster(seqId, seqName);
    loadSequences();
  } catch(e) { toast('Failed: ' + e.message, 'error'); }
}

async function unenrollFromRoster(enrollmentId, seqId, seqName) {
  try {
    await apiFetch(`/api/enrollments/${enrollmentId}`, { method: 'DELETE' });
    toast('Contact removed from sequence.', 'success');
    openSequenceRoster(seqId, seqName);
    loadSequences();
  } catch(e) { toast('Failed: ' + e.message, 'error'); }
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
      <div class="step-body-tabs">
        <button type="button" class="step-tab step-tab-active" onclick="switchStepTab(${n}, 'edit', this)">Edit</button>
        <button type="button" class="step-tab" onclick="switchStepTab(${n}, 'preview', this)">Preview</button>
      </div>
      <textarea id="step-body-textarea-${n}" name="step_body_${n}" rows="10" placeholder="Hi {{first_name}},&#10;&#10;I'm Frank Sherfey, licensing representative for Phil Lewis..." required>${data ? esc(data.body) : ''}</textarea>
      <div id="step-body-preview-${n}" class="step-body-preview" style="display:none"></div>
    </div>
    <div class="step-art-row" id="step-art-row-${n}">
      <div class="step-art-label">
        🎨 Art Image
        <button type="button" class="btn btn-ghost btn-sm" onclick="openArtPicker(${n})">Choose Art</button>
      </div>
      <div id="step-art-preview-${n}" class="step-art-preview"></div>
    </div>
  `;
  container.appendChild(div);
  // Show initial art status
  if (typeof updateStepArtPreview === 'function') updateStepArtPreview(n);
  // Update art indicators on all steps (recalculate which is "closing")
  updateArtStepIndicators();
}

function updateArtStepIndicators() {
  const blocks = document.querySelectorAll('.step-block');
  blocks.forEach((block, i) => {
    const stepNum = parseInt(block.id.replace('step-block-',''));
    const row = document.getElementById(`step-art-row-${stepNum}`);
    if (!row) return;
    const realIdx = i + 1;
    const isLast = i === blocks.length - 1;
    const willGetArt = (realIdx % 2 === 1) || isLast;
    const label = row.querySelector('.step-art-label');
    if (label && !_stepArtOverrides[stepNum]) {
      const hint = willGetArt ? ' <span style="font-size:11px;color:var(--text-muted)">(auto-included)</span>' : ' <span style="font-size:11px;color:var(--text-muted)">(no art — even step)</span>';
      label.innerHTML = `🎨 Art Image${hint} <button type="button" class="btn btn-ghost btn-sm" onclick="openArtPicker(${stepNum})">Choose Art</button>`;
    }
  });
}

function removeStep(n) {
  const el = document.getElementById(`step-block-${n}`);
  if (el) el.remove();
}

function switchStepTab(n, tab, btn) {
  const textarea = document.getElementById(`step-body-textarea-${n}`);
  const preview  = document.getElementById(`step-body-preview-${n}`);
  const tabs     = btn.closest('.step-body-tabs').querySelectorAll('.step-tab');
  tabs.forEach(t => t.classList.remove('step-tab-active'));
  btn.classList.add('step-tab-active');
  if (tab === 'preview') {
    let html = renderEmailBody(textarea.value, true);
    // For step 1, show art image preview based on sequence description tags
    const block = btn.closest('.step-block');
    const stepNum = block ? parseInt(block.id.replace('step-block-','')) : n;
    const allBlocks = document.querySelectorAll('.step-block');
    const isFirstStep = block === allBlocks[0];
    if (isFirstStep && typeof getArtForTags === 'function') {
      const descField = document.querySelector('#sequence-form [name="description"]');
      const desc = descField ? descField.value : '';
      // Extract tags from description (e.g. "Tags: skateboard, surf, snowboard")
      const tagMatch = desc.match(/tags?:\s*([^\n]+)/i);
      const tagsStr = tagMatch ? tagMatch[1] : desc;
      const artImg = getArtForTags(tagsStr);
      html += buildArtPreviewCard(artImg);
    }
    preview.innerHTML = html;
    textarea.style.display = 'none';
    preview.style.display  = 'block';
  } else {
    textarea.style.display = 'block';
    preview.style.display  = 'none';
  }
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

let _queueExpanded = {}; // seqId -> bool (default open)

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
    infoEl.textContent = `${queue.length} email${queue.length!==1?'s':''} ready to send across ${countCampaigns(queue)} campaign${countCampaigns(queue)!==1?'s':''}`;

    // Group by sequence
    const groups = {};
    queue.forEach((item, i) => {
      const key = item.sequence_id;
      if (!groups[key]) groups[key] = { name: item.sequence_name, id: key, items: [] };
      groups[key].items.push({ ...item, _index: i });
    });

    // Default: all expanded
    Object.keys(groups).forEach(k => {
      if (_queueExpanded[k] === undefined) _queueExpanded[k] = true;
    });

    listEl.innerHTML = Object.values(groups).map(g => {
      const isOpen = _queueExpanded[g.id];
      const stepCounts = {};
      g.items.forEach(item => {
        const k = `Step ${item.current_step}`;
        stepCounts[k] = (stepCounts[k] || 0) + 1;
      });
      const stepSummary = Object.entries(stepCounts).map(([k,v]) => `${k}: ${v}`).join(' · ');

      return `
        <div class="queue-group">
          <div class="queue-group-header" onclick="toggleQueueGroup(${g.id})">
            <div class="queue-group-left">
              <span class="queue-group-arrow">${isOpen ? '▾' : '▸'}</span>
              <span class="queue-group-name">${esc(g.name)}</span>
              <span class="queue-group-count">${g.items.length} recipient${g.items.length!==1?'s':''}</span>
              <span class="queue-group-steps">${stepSummary}</span>
            </div>
            <div class="queue-group-actions" onclick="event.stopPropagation()">
              <button class="btn btn-outline btn-sm" onclick="openEnrollModalForSeq(${g.id})">+ Add Contacts</button>
              <button class="btn btn-ghost btn-sm" onclick="openSequenceModal(${g.id})">Edit Sequence</button>
            </div>
          </div>
          ${isOpen ? `<div class="queue-group-body">${g.items.map(item => `
            <div class="queue-item queue-item-clickable" onclick="openQueueDetail(${item._index})">
              <div class="queue-item-info">
                <div class="queue-contact">${esc(item.first_name)} ${esc(item.last_name||'')}</div>
                <div class="queue-company">${esc(item.company_name||'No company')} ${item.company_type ? `· ${typeName(item.company_type)}` : ''}</div>
                ${item.email ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(item.email)}</div>` : ''}
                <span class="queue-step-badge">Step ${item.current_step} of ${item.total_steps}</span>
                <div class="queue-subject">"${esc(item.step_subject)}"</div>
              </div>
              <div class="queue-actions" onclick="event.stopPropagation()">
                <button class="btn btn-ghost btn-sm" onclick="previewEmail(${item.enrollment_id})">Preview</button>
                <button class="btn btn-primary btn-sm" onclick="sendOne(${item.enrollment_id})">Send</button>
              </div>
            </div>
          `).join('')}</div>` : ''}
        </div>`;
    }).join('');
  } catch(e) { toast(e.message, 'error'); }
}

function countCampaigns(queue) {
  return new Set(queue.map(q => q.sequence_id)).size;
}

function toggleQueueGroup(seqId) {
  _queueExpanded[seqId] = !_queueExpanded[seqId];
  loadQueue();
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
      <button class="btn btn-outline" onclick="previewFromQueueDetail(${item.enrollment_id})">Preview</button>
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

async function previewFromQueueDetail(enrollmentId) {
  const subject = document.getElementById('queue-edit-subject').value;
  const body = document.getElementById('queue-edit-body').value;
  try {
    const preview = await apiFetch(`/api/queue/preview/${enrollmentId}`);
    let bodyHtml = renderEmailBody(body || preview.body);
    if (preview.step_number === 1 && preview.company_tags && typeof getArtForTags === 'function') {
      const artImg = getArtForTags(preview.company_tags);
      bodyHtml += buildArtPreviewCard(artImg);
    }
    document.getElementById('preview-content').innerHTML = `
      <div class="preview-subject">Subject: ${esc(subject || preview.subject)}</div>
      <div class="preview-body">${bodyHtml}</div>
    `;
    currentEnrollmentIdForPreview = enrollmentId;
    document.getElementById('preview-send-btn').onclick = () => {
      closeModal('modal-preview');
      sendFromQueueDetail(enrollmentId);
    };
    openModal('modal-preview');
  } catch(e) { toast(e.message, 'error'); }
}

async function previewEmail(enrollmentId) {
  try {
    const preview = await apiFetch(`/api/queue/preview/${enrollmentId}`);
    let bodyHtml = renderEmailBody(preview.body);
    // Show art preview if this is a step 1 email and we have company tags
    if (preview.step_number === 1 && preview.company_tags && typeof getArtForTags === 'function') {
      const artImg = getArtForTags(preview.company_tags);
      bodyHtml += buildArtPreviewCard(artImg);
    }
    document.getElementById('preview-content').innerHTML = `
      <div class="preview-subject">Subject: ${esc(preview.subject)}</div>
      <div class="preview-body">${bodyHtml}</div>
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

let _inboxDeduped = false;
async function loadInbox() {
  try {
    // One-time dedup on first inbox load per session
    if (!_inboxDeduped) {
      _inboxDeduped = true;
      apiFetch('/api/inbox/dedup', { method: 'POST' }).catch(() => {});
    }
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

    el.innerHTML = `
      <div class="inbox-bulk-bar" id="inbox-bulk-bar" style="display:none">
        <label class="inbox-select-all"><input type="checkbox" id="inbox-select-all" onchange="toggleSelectAllInbox(this)"> Select all</label>
        <button class="btn btn-danger-outline btn-sm" onclick="bulkDeleteInbox()">&#128465; Delete selected</button>
        <span id="inbox-selected-count" class="inbox-selected-count"></span>
      </div>
      <div class="inbox-messages">${_inboxCache.map((m, i) => {
      const isRead = _inboxTab === 'sent' ? true : m.notes === 'read';
      const fullName = [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Unknown';
      const label = _inboxTab === 'sent' ? `To: ${fullName}` : fullName;
      const preview = cleanEmailBody(m.body || '').slice(0, 140);
      const sentimentDot = m.sentiment ? `<span class="sentiment-dot sentiment-${m.sentiment}" title="${m.sentiment}"></span>` : '';
      return `
        <div class="inbox-row ${isRead ? 'inbox-read' : 'inbox-unread'}" onclick="openInboxMessage(${i})">
          <div class="inbox-checkbox" onclick="event.stopPropagation()">
            <input type="checkbox" class="inbox-msg-check" data-index="${i}" data-id="${m.id}" onchange="updateInboxSelection()">
          </div>
          <div class="inbox-row-left">
            <div class="inbox-sender">
              ${sentimentDot}
              <a href="#" onclick="event.stopPropagation();openContactDetail(${m.contact_id})" style="color:inherit;text-decoration:none">${esc(label)}</a>
              ${m.company_name ? `<span class="inbox-company-pill">${esc(m.company_name)}</span>` : ''}
            </div>
            <div class="inbox-subject">${esc(m.subject || '(no subject)')}</div>
            <div class="inbox-preview">${esc(preview)}${preview.length >= 140 ? '...' : ''}</div>
          </div>
          <div class="inbox-row-right">
            <div class="inbox-date">${fmtDate(m.sent_at)}</div>
            <div class="inbox-row-actions" onclick="event.stopPropagation()">
              <div class="sentiment-btns sentiment-btns-sm">
                <button class="sentiment-btn sentiment-btn-positive ${m.sentiment==='positive'?'active':''}" title="Positive" onclick="setSentiment(${i},'positive')">&#9679;</button>
                <button class="sentiment-btn sentiment-btn-neutral ${m.sentiment==='neutral'?'active':''}" title="Neutral" onclick="setSentiment(${i},'neutral')">&#9679;</button>
                <button class="sentiment-btn sentiment-btn-negative ${m.sentiment==='negative'?'active':''}" title="Negative" onclick="setSentiment(${i},'negative')">&#9679;</button>
              </div>
              <button class="inbox-delete-btn" title="Delete" onclick="deleteInboxMessage(${i})">&#128465;</button>
            </div>
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
      <div style="display:flex;align-items:center;gap:8px">
        <div class="sentiment-btns" id="rp-sentiment-btns">
          <button class="sentiment-btn sentiment-btn-positive ${m.sentiment==='positive'?'active':''}" title="Positive" onclick="setSentiment(${index},'positive')">&#9679; Hot</button>
          <button class="sentiment-btn sentiment-btn-neutral ${m.sentiment==='neutral'?'active':''}" title="Neutral" onclick="setSentiment(${index},'neutral')">&#9679; Warm</button>
          <button class="sentiment-btn sentiment-btn-negative ${m.sentiment==='negative'?'active':''}" title="Negative" onclick="setSentiment(${index},'negative')">&#9679; Cold</button>
        </div>
        <button class="inbox-rp-close" onclick="closeInboxPane()">&#10005;</button>
      </div>
    </div>
    <div class="inbox-rp-body">${renderEmailBody(m.body)}</div>
    <div class="inbox-rp-actions">
      ${m.email ? `<button class="btn btn-primary" onclick="openReplyCompose(${index}, false)">&#9166; Reply</button>` : ''}
      ${m.email ? `<button class="btn btn-outline" onclick="openReplyCompose(${index}, true)">&#8627; Forward</button>` : ''}
      ${m.contact_id ? `<button class="btn btn-outline" onclick="openContactDetail(${m.contact_id})">View Contact</button>` : ''}
      ${m.company_id ? `<button class="btn btn-outline" onclick="openCompanyDetail(${m.company_id})">View Company</button>` : ''}
      <button class="btn btn-danger-outline" onclick="deleteInboxMessage(${index})">&#128465; Delete</button>
    </div>
    <div id="inbox-enrollment-badges"></div>
    <div id="inbox-compose-area" style="display:none"></div>
  `;
  pane.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Load active enrollments for this contact and show remove buttons
  if (m.contact_id) {
    try {
      var enrollments = await apiFetch('/api/contacts/' + m.contact_id + '/enrollments');
      var badgesEl = document.getElementById('inbox-enrollment-badges');
      if (badgesEl) badgesEl.innerHTML = renderEnrollmentBadges(enrollments, 'openInboxMessage(' + index + ')');
    } catch(e) {}
  }
}

// ── EMAIL SIGNATURE ───────────────────────────────────────────────────────
let _cachedSignature = null;

const DEFAULT_SIGNATURE = `<br><br>Best,<br>
<b>Frank Sherfey</b><br>
Licensing @ <a href="https://www.phillewisart.com" target="_blank">Phil Lewis Art</a><br>
(656) 296-7917<br>
<a href="https://www.phillewisart.com" target="_blank" style="display:inline-block;margin-top:6px">
  <img src="https://cdn.shopify.com/s/files/1/0579/0921/4404/files/Phil_Lewis_Art_Logo_Banner.png"
       onerror="this.style.display='none'"
       alt="Phil Lewis Art" style="height:40px;max-width:200px;object-fit:contain">
</a>`;

async function getSignature() {
  if (_cachedSignature !== null) return _cachedSignature;
  try {
    const s = await apiFetch('/api/settings');
    _cachedSignature = s.email_signature || DEFAULT_SIGNATURE;
  } catch(e) {
    _cachedSignature = DEFAULT_SIGNATURE;
  }
  return _cachedSignature;
}

function switchSigTab(tab, btn) {
  document.querySelectorAll('.sig-tab').forEach(t => t.classList.remove('sig-tab-active'));
  btn.classList.add('sig-tab-active');
  const editPane    = document.getElementById('sig-edit-pane');
  const previewPane = document.getElementById('sig-preview-pane');
  if (tab === 'edit') {
    editPane.style.display = ''; previewPane.style.display = 'none';
  } else {
    editPane.style.display = 'none'; previewPane.style.display = '';
    const raw = document.getElementById('sig-editor')?.value || '';
    const el  = document.getElementById('sig-preview-render');
    if (el) el.innerHTML = raw;
  }
}

async function saveSignature() {
  const val = document.getElementById('sig-editor')?.value || '';
  const msgEl = document.getElementById('sig-msg');
  try {
    await apiFetch('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ email_signature: val }),
    });
    _cachedSignature = val;
    msgEl.textContent = 'Signature saved.';
    msgEl.className = 'settings-msg success';
    setTimeout(() => { msgEl.textContent = ''; }, 3000);
  } catch(e) {
    msgEl.textContent = e.message;
    msgEl.className = 'settings-msg error';
  }
}

function resetDefaultSignature() {
  const el = document.getElementById('sig-editor');
  if (el) el.value = DEFAULT_SIGNATURE;
}

async function openReplyCompose(index, isForward) {
  const m = _inboxCache[index];
  if (!m) return;
  const area = document.getElementById('inbox-compose-area');
  if (!area) return;

  const sig = await getSignature();
  const reSubject = isForward
    ? `Fwd: ${m.subject || ''}`
    : (m.subject && !/^re:/i.test(m.subject) ? `Re: ${m.subject}` : (m.subject || ''));
  const toEmail  = isForward ? '' : (m.email || '');
  const toName   = isForward ? '' : ([m.first_name, m.last_name].filter(Boolean).join(' ') || '');
  const fullName = [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email || '';
  const quoteDate = m.sent_at ? new Date(m.sent_at).toLocaleString() : '';
  const quotedBody = `\n\n\n---\nOn ${quoteDate}, ${esc(fullName)} wrote:\n${(m.body || '').split('\n').map(l => '> ' + l).join('\n')}`;
  // Strip HTML tags for the textarea preview (signature is injected as HTML at send time)
  const sigPlain = sig.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const bodyWithSig = `\n\n${sigPlain}${quotedBody}`;

  area.style.display = 'block';
  area.innerHTML = `
    <div class="inbox-compose-box">
      <div class="inbox-compose-row">
        <label class="inbox-compose-label">To</label>
        <input id="ic-to" class="inbox-compose-input" type="email" value="${esc(toEmail)}" placeholder="recipient@example.com" ${!isForward ? 'readonly' : ''}>
      </div>
      <div class="inbox-compose-row">
        <label class="inbox-compose-label">Subject</label>
        <input id="ic-subject" class="inbox-compose-input" type="text" value="${esc(reSubject)}">
      </div>
      <div class="inbox-compose-row">
        <label class="inbox-compose-label">Message</label>
        <textarea id="ic-body" class="inbox-compose-textarea" rows="10">${esc(bodyWithSig)}</textarea>
      </div>
      <div class="inbox-sig-note">✉ Your email signature will be appended automatically</div>
      <div class="inbox-compose-actions">
        <button class="btn btn-primary" onclick="sendInboxReply(${index}, ${isForward})">Send</button>
        <button class="btn btn-outline" onclick="closeReplyCompose()">Cancel</button>
        <span id="ic-status" style="margin-left:12px;font-size:13px;color:#666"></span>
      </div>
    </div>`;

  // Place cursor at very top (before signature/quote)
  const ta = document.getElementById('ic-body');
  if (ta) { ta.focus(); ta.setSelectionRange(0, 0); ta.scrollTop = 0; }
}

function closeReplyCompose() {
  const area = document.getElementById('inbox-compose-area');
  if (area) { area.style.display = 'none'; area.innerHTML = ''; }
}

async function sendInboxReply(index, isForward) {
  const m = _inboxCache[index];
  if (!m) return;
  const toEmail  = document.getElementById('ic-to')?.value?.trim();
  const subject  = document.getElementById('ic-subject')?.value?.trim();
  const body     = document.getElementById('ic-body')?.value?.trim();
  const statusEl = document.getElementById('ic-status');

  if (!toEmail || !subject || !body) {
    toast('To, Subject, and Message are all required.', 'error'); return;
  }

  // Build HTML body: user text + HTML signature
  const sig = await getSignature();
  const bodyHtml = body.replace(/\n/g, '<br>') + '<br><br>' + sig;

  const btn = document.querySelector('#inbox-compose-area .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  if (statusEl) statusEl.textContent = '';

  try {
    await apiFetch('/api/inbox/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toEmail,
        toName: isForward ? '' : ([m.first_name, m.last_name].filter(Boolean).join(' ') || ''),
        subject,
        body: bodyHtml,
        isHtml: true,
        contactId:  m.contact_id  || null,
        companyId:  m.company_id  || null,
        inReplyTo:  isForward ? null : (m.message_id || null),
        references: isForward ? null : (m.message_id || null),
      }),
    });
    toast(isForward ? 'Forwarded successfully.' : 'Reply sent!', 'success');
    closeReplyCompose();
    // Refresh the sent tab count badge
    loadInbox();
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
    if (statusEl) statusEl.textContent = '✗ ' + e.message;
    toast('Send failed: ' + e.message, 'error');
  }
}

function closeInboxPane() {
  const pane = document.getElementById('inbox-reading-pane');
  if (pane) pane.remove();
}

async function setSentiment(index, sentiment) {
  const m = _inboxCache[index];
  if (!m) return;
  // Toggle off if already set to same value
  const newVal = m.sentiment === sentiment ? null : sentiment;
  try {
    await apiFetch(`/api/inbox/${m.id}/sentiment`, {
      method: 'PATCH',
      body: JSON.stringify({ sentiment: newVal }),
    });
    m.sentiment = newVal;
    loadInbox(); // refresh list to show updated dots
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteInboxMessage(index) {
  const m = _inboxCache[index];
  if (!m) return;
  if (!confirm('Delete this message from the CRM? (This won\u2019t delete it from your email server.)')) return;
  try {
    await apiFetch(`/api/inbox/${m.id}`, { method: 'DELETE' });
    toast('Message deleted.', 'success');
    closeInboxPane();
    loadInbox();
  } catch(e) { toast(e.message, 'error'); }
}

// updateInboxSelection, toggleSelectAllInbox, bulkDeleteInbox
// → defined in app-extras.js (authoritative version)

async function syncInboxFromInbox() {
  toast('Syncing inbox...');
  try {
    const r = await apiFetch('/api/inbox/sync', { method: 'POST' });
    // Auto-dedup after sync to clean up any existing duplicates
    const dedup = await apiFetch('/api/inbox/dedup', { method: 'POST' });
    const parts = [`${r.imported} new repl${r.imported !== 1 ? 'ies' : 'y'}`];
    if (r.autoStopped > 0) parts.push(`${r.autoStopped} sequence${r.autoStopped !== 1 ? 's' : ''} stopped`);
    if (r.opportunitiesCreated > 0) parts.push(`${r.opportunitiesCreated} new opportunit${r.opportunitiesCreated !== 1 ? 'ies' : 'y'} created`);
    if (dedup.removed > 0) parts.push(`${dedup.removed} duplicate${dedup.removed !== 1 ? 's' : ''} cleaned`);
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
    // Signature
    const sigEl = document.getElementById('sig-editor');
    if (sigEl) {
      sigEl.value = s.email_signature || DEFAULT_SIGNATURE;
      _cachedSignature = sigEl.value;
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

// Sanitize HTML — strips scripts/event handlers but allows safe tags
function sanitizeHtml(text) {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
    .replace(/href\s*=\s*["']?\s*javascript:[^"'\s>]*/gi, 'href="#"');
}

// Renders email body as HTML — strips scripts/event handlers but allows
// safe tags like <img>, <a>, <br>, <p>, <strong> so images actually render.
// skipMimeClean=true for user-authored templates (sequence steps) where
// quoted-printable decoding would corrupt URLs in <img> tags.
function renderEmailBody(text, skipMimeClean) {
  if (!text) return '<span style="color:var(--text-muted)">(no message body)</span>';
  var cleaned = skipMimeClean ? text.replace(/\n{3,}/g, '\n\n').trim() : cleanEmailBody(text);
  if (!/<[a-z][\s\S]*>/i.test(cleaned)) {
    // Plain text — escape and convert newlines to <br>
    return esc(cleaned).replace(/\n/g, '<br>');
  }
  // HTML content — sanitize then render
  return sanitizeHtml(cleaned).replace(/\n/g, '<br>');
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

// ── NEWS ───────────────────────────────────────────────────────────────────
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
    return `
      <div class="news-card">
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

// ── LEAD HEAT MAP ─────────────────────────────────────────────────────────
// _heatmapCache, TAG_GROUP_MAP, loadLeadHeatmap, applyHeatmapFilter,
// scoreLeadTemperature, renderLeadHeatmap → all defined in app-extras.js

// ── INIT ──────────────────────────────────────────────────────────────────
initAuth();
loadAllTags();
