'use strict';

const tableBody = document.getElementById('inboundTableBody');
const countEl = document.getElementById('inboundCount');
const messageEl = document.getElementById('inboundMessage');
const searchInput = document.getElementById('inboundSearch');
const webhookInput = document.getElementById('inboundWebhookUrl');
const patternHintEl = document.getElementById('inboundPatternHint');
const searchBtn = document.getElementById('inboundSearchBtn');
const clearSearchBtn = document.getElementById('inboundClearSearchBtn');
const refreshBtn = document.getElementById('inboundRefreshBtn');
const deleteAllBtn = document.getElementById('inboundDeleteAllBtn');
const copyWebhookBtn = document.getElementById('copyWebhookUrlBtn');
const logoutBtn = document.getElementById('adminLogoutBtn');

function setMessage(text, isError) {
  messageEl.textContent = text || '';
  messageEl.className = 'message' + (text ? (isError ? ' error' : ' success') : '');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value || '');
  }
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
  const day = String(date.getDate()).padStart(2, '0');
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getMonth()];
  const year = String(date.getFullYear());
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return weekday + ' ' + day + ' ' + month + ' ' + year + ' ' + hour + ':' + minute;
}

function truncateBody(text, maxLen) {
  const value = String(text || '');
  if (value.length <= maxLen) {
    return value;
  }
  return value.slice(0, maxLen) + '...';
}

async function checkAdminSession() {
  const res = await fetch('/api/admin/me', { credentials: 'same-origin' });
  if (!res.ok) {
    window.location.href = '/Admin/index.html';
    return false;
  }
  return true;
}

async function loadConfig() {
  const res = await fetch('/api/admin/inbound-mail/config', { credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load inbound mail config.');
  }

  webhookInput.value = String(data.webhookUrl || '');
  if (data.inboundAddressPattern) {
    patternHintEl.textContent = 'Inbound email pattern: ' + String(data.inboundAddressPattern);
  } else {
    patternHintEl.textContent = 'Inbound email pattern: not configured (set INBOUND_MAIL on this server).';
  }

  if (!data.configured) {
    setMessage('INBOUND_MAIL is not configured on this server. Set it to the receiving subdomain for this environment.', true);
  }
}

async function loadInboundEmails() {
  const query = String(searchInput.value || '').trim();
  const params = new URLSearchParams();
  params.set('limit', '1000');
  if (query) {
    params.set('search', query);
  }

  countEl.textContent = 'Loading...';
  tableBody.innerHTML = '<tr><td colspan="5">Loading...</td></tr>';

  const res = await fetch('/api/admin/inbound-mail?' + params.toString(), { credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    window.location.href = '/Admin/index.html';
    return;
  }
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load inbound emails.');
  }

  const entries = Array.isArray(data.entries) ? data.entries : [];
  const total = Number(data.total || 0);
  const filteredText = query ? (' (' + entries.length + ' filtered)') : '';
  countEl.textContent = total + ' total message' + (total === 1 ? '' : 's') + filteredText;

  if (!entries.length) {
    tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#888;">No inbound emails found.</td></tr>';
    return;
  }

  tableBody.innerHTML = entries.map((entry) => {
    const received = escapeHtml(formatDateTime(entry.received_at || ''));
    const fromAddress = escapeHtml(String(entry.from_address || ''));
    const toAddress = escapeHtml(String(entry.to_address || ''));
    const subject = escapeHtml(String(entry.subject || ''));
    const body = escapeHtml(truncateBody(String(entry.body_text || ''), 4000));

    return '<tr>'
      + '<td class="inbound-col-dtg">' + (received || '-') + '</td>'
      + '<td class="inbound-col-address">' + (fromAddress || '-') + '</td>'
      + '<td class="inbound-col-address">' + (toAddress || '-') + '</td>'
      + '<td class="inbound-col-subject">' + (subject || '-') + '</td>'
      + '<td class="inbound-col-body">' + (body || '-') + '</td>'
      + '</tr>';
  }).join('');
}

async function copyWebhookUrl() {
  const value = String(webhookInput.value || '').trim();
  if (!value) {
    setMessage('Webhook URL is empty.', true);
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    setMessage('Webhook URL copied to clipboard.', false);
  } catch (_err) {
    webhookInput.select();
    document.execCommand('copy');
    setMessage('Webhook URL copied to clipboard.', false);
  }
}

async function clearAllInboundEmails() {
  const confirmed = window.confirm('Delete all inbound emails from this log? This cannot be undone.');
  if (!confirmed) {
    return;
  }

  deleteAllBtn.disabled = true;
  try {
    const res = await fetch('/api/admin/inbound-mail', {
      method: 'DELETE',
      credentials: 'same-origin'
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      window.location.href = '/Admin/index.html';
      return;
    }
    if (!res.ok) {
      throw new Error(data.error || 'Failed to clear inbound email log.');
    }

    const deleted = Number(data.deletedCount || 0);
    setMessage('Deleted ' + deleted + ' inbound email ' + (deleted === 1 ? 'entry.' : 'entries.'), false);
    await loadInboundEmails();
  } finally {
    deleteAllBtn.disabled = false;
  }
}

searchBtn.addEventListener('click', async () => {
  try {
    setMessage('', false);
    await loadInboundEmails();
  } catch (err) {
    setMessage(err.message || 'Failed to search inbound emails.', true);
  }
});

clearSearchBtn.addEventListener('click', async () => {
  searchInput.value = '';
  try {
    setMessage('', false);
    await loadInboundEmails();
  } catch (err) {
    setMessage(err.message || 'Failed to reload inbound emails.', true);
  }
});

refreshBtn.addEventListener('click', async () => {
  try {
    setMessage('', false);
    await loadInboundEmails();
  } catch (err) {
    setMessage(err.message || 'Failed to refresh inbound emails.', true);
  }
});

searchInput.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter') {
    return;
  }
  event.preventDefault();
  try {
    setMessage('', false);
    await loadInboundEmails();
  } catch (err) {
    setMessage(err.message || 'Failed to search inbound emails.', true);
  }
});

copyWebhookBtn.addEventListener('click', copyWebhookUrl);
deleteAllBtn.addEventListener('click', async () => {
  try {
    await clearAllInboundEmails();
  } catch (err) {
    setMessage(err.message || 'Failed to clear inbound emails.', true);
  }
});

logoutBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  } catch (_err) {
    // Ignore logout network failures.
  }
  window.location.href = '/Admin/index.html';
});

(async () => {
  try {
    const isAuthed = await checkAdminSession();
    if (!isAuthed) {
      return;
    }
    await loadConfig();
    await loadInboundEmails();
  } catch (err) {
    setMessage(err.message || 'Failed to initialize inbound email inbox.', true);
    tableBody.innerHTML = '<tr><td colspan="5">Failed to load inbound emails.</td></tr>';
    countEl.textContent = 'Error';
  }
})();
