// ── PHIL LEWIS ART CRM — Core State, Auth & Helpers ──────────────────────────

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

// ── GLOBAL VARIABLES (used across modules) ──────────────────────────────────
let currentEnrollContacts = [];
let currentEnrollmentIdForPreview = null;
let allCompanies = [];
var activeTagFilters = [];
var activeTypeFilters = [];
var activeStatusFilters = [];
let allTags = [];
let currentDetailCompanyId = null;
let _stepArtOverrides = {};    // stepNum -> { id, url, title } or null (explicit "no art")
let _artCache = null;          // cached art_images from /api/art
let _queueArtOverride = null;  // { id, url, title } or 'none' for queue detail art picker
let currentUser = null;        // { id, username, display_name, role, force_password_change }
let editingUserId = null;
let toastTimeout;

// Contact-related globals
let currentContacts = [];
let selectedContactIds = [];
let contactFilterTag = '';

// Sequence-related globals
let currentSequences = [];
let currentSequenceSteps = [];

// Queue-related globals
let queueItems = [];

// Activity-related globals
let activityFilter = '';

// Inbox-related globals
let inboxReplies = [];

// Pipeline-related globals
let pipelineData = {};

// ── TAG HELPERS ────────────────────────────────────────────────────────────
const PRESET_TAGS = [
  'apparel','hard-goods','outdoor','skateboard','snowboard','surf',
  'fishing','camping','drinkware','footwear','puzzles','calendars',
  'fabric','cards','lifestyle'
];

// Phil's core licensing industries — shown as filter chips on the Prospects page
const INDUSTRY_TAGS = [
  'apparel', 'artist-collab', 'hard-goods', 'outdoor', 'surf', 'camping', 'skateboard', 'snowboard',
  'drinkware', 'festival', 'footwear', 'puzzles', 'cards', 'fabric', 'lifestyle', 'licensing'
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
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  clearTimeout(toastTimeout);
  var duration = type === 'error' ? 8000 : 3500;
  toastTimeout = setTimeout(() => { el.className = 'toast hidden'; }, duration);
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

// ── HELPERS (used across all modules) ──────────────────────────────────────
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function cleanReplyBody(text) {
  if (!text) return '';
  // Strip quoted reply lines (lines starting with >)
  var lines = text.split('\n');
  var cleaned = [];
  for (var i = 0; i < lines.length; i++) {
    if (/^>/.test(lines[i])) continue;
    if (/^On .+ wrote:/.test(lines[i])) break;
    if (/^-{2,}\s*(Original Message|Forwarded)/.test(lines[i])) break;
    if (/^From:.*@/.test(lines[i])) break;
    cleaned.push(lines[i]);
  }
  return cleaned.join(' ').replace(/\s+/g, ' ').trim();
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
// ── HYPERLINK INSERT ──────────────────────────────────────────────────────
function insertLink(textareaId) {
  var ta = document.getElementById(textareaId);
  if (!ta) return;
  var selected = ta.value.substring(ta.selectionStart, ta.selectionEnd);
  var text = prompt('Link text:', selected || 'phillewisart.com');
  if (!text) return;
  var url = prompt('URL:', text.match(/\.\w{2,}/) ? (text.match(/^https?:\/\//) ? text : 'https://' + text) : 'https://');
  if (!url) return;
  var linkHtml = '<a href="' + url + '">' + text + '</a>';
  var start = ta.selectionStart;
  var end = ta.selectionEnd;
  ta.value = ta.value.substring(0, start) + linkHtml + ta.value.substring(end);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = start + linkHtml.length;
}

function linkifyUrls(html) {
  // Turn bare URLs into clickable links (skip ones already inside href="...")
  return html.replace(
    /(?<![="\/])(\b(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:\/[^\s<]*)?)/g,
    function(match) {
      // Don't double-wrap if already inside an <a> tag
      var href = match.match(/^https?:\/\//) ? match : 'https://' + match;
      return '<a href="' + esc(href) + '" target="_blank" style="color:#4f46e5">' + esc(match) + '</a>';
    }
  );
}

function renderEmailBody(text, skipMimeClean) {
  if (!text) return '<span style="color:var(--text-muted)">(no message body)</span>';
  var cleaned = skipMimeClean ? text.replace(/\n{3,}/g, '\n\n').trim() : cleanEmailBody(text);
  if (!/<[a-z][\s\S]*>/i.test(cleaned)) {
    // Plain text — escape, convert newlines, then linkify URLs
    var html = esc(cleaned).replace(/\n/g, '<br>');
    return linkifyUrls(html);
  }
  // HTML content — sanitize, linkify, then render
  var sanitized = sanitizeHtml(cleaned).replace(/\n/g, '<br>');
  return linkifyUrls(sanitized);
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

// ── INIT ───────────────────────────────────────────────────────────────────
initAuth();
loadAllTags();
