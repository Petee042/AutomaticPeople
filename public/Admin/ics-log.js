'use strict';

/* ── ICS Transaction Log – Admin Page ────────────────────────────────────── */

const PAGE_SIZE = 50;

let allEntries = [];    // raw data from the API (up to limit=1000)
let filtered   = [];    // after search + status filter
let currentPage = 1;

// ── DOM refs ──────────────────────────────────────────────────────────────
const msgEl        = document.getElementById('icsLogMessage');
const countEl      = document.getElementById('icsLogCount');
const tableBody    = document.getElementById('icsLogTableBody');
const searchInput  = document.getElementById('icsLogSearch');
const statusFilter = document.getElementById('icsLogStatusFilter');
const refreshBtn   = document.getElementById('icsLogRefreshBtn');
const prevBtn      = document.getElementById('icsLogPrevBtn');
const nextBtn      = document.getElementById('icsLogNextBtn');
const pageInfo     = document.getElementById('icsLogPageInfo');
const tooltip      = document.getElementById('icsPayloadTooltip');
const logoutBtn    = document.getElementById('adminLogoutBtn');

// ── Helpers ───────────────────────────────────────────────────────────────

function formatDTG(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return String(isoString);
  // Format: DDMonYYYY HH:MM:SS UTC  (military-style DTG)
  const pad = n => String(n).padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return (
    pad(d.getUTCDate()) + months[d.getUTCMonth()] + d.getUTCFullYear() +
    ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + 'Z'
  );
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(text, maxLen) {
  const s = String(text || '');
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
}

function setMessage(text, isError) {
  msgEl.textContent = text || '';
  msgEl.className = 'message' + (isError ? ' error' : (text ? ' success' : ''));
}

// ── Fetch ─────────────────────────────────────────────────────────────────

async function loadLog() {
  setMessage('');
  countEl.textContent = 'Loading…';
  tableBody.innerHTML = '<tr><td colspan="7">Loading…</td></tr>';
  prevBtn.disabled = true;
  nextBtn.disabled = true;

  try {
    const resp = await fetch('/api/admin/ics-log?limit=1000&offset=0', { credentials: 'same-origin' });
    if (resp.status === 401) {
      setMessage('Admin session expired. Please log in again.', true);
      setTimeout(() => { window.location.href = '/Admin/index.html'; }, 2000);
      return;
    }
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      setMessage(data.error || 'Failed to load ICS log.', true);
      tableBody.innerHTML = '<tr><td colspan="7">Error loading data.</td></tr>';
      return;
    }
    const data = await resp.json();
    allEntries = Array.isArray(data.entries) ? data.entries : [];
    applyFilters();
  } catch (err) {
    console.error('ICS log fetch error:', err);
    setMessage('Network error loading ICS log.', true);
    tableBody.innerHTML = '<tr><td colspan="7">Network error.</td></tr>';
  }
}

// ── Filtering & Rendering ─────────────────────────────────────────────────

function applyFilters() {
  const query  = String(searchInput.value || '').trim().toLowerCase();
  const status = String(statusFilter.value || '').toLowerCase();

  filtered = allEntries.filter(entry => {
    if (status && String(entry.status || '').toLowerCase() !== status) return false;
    if (query) {
      const haystack = [
        entry.importing_channel_label,
        entry.exporting_channel_label,
        entry.import_url,
        entry.status,
        entry.error_text
      ].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  currentPage = 1;
  renderPage();
}

function renderPage() {
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(start, start + PAGE_SIZE);

  countEl.textContent =
    filtered.length === allEntries.length
      ? `${allEntries.length} transactions`
      : `${filtered.length} of ${allEntries.length} transactions (filtered)`;

  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;

  if (pageRows.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#888;">No entries found.</td></tr>';
    return;
  }

  tableBody.innerHTML = pageRows.map(entry => {
    const dtg           = escapeHtml(formatDTG(entry.logged_at));
    const importing     = escapeHtml(entry.importing_channel_label || '—');
    const exporting     = escapeHtml(entry.exporting_channel_label || '—');
    const statusLower   = String(entry.status || '').toLowerCase();
    const statusBadge   = `<span class="ics-status-badge ics-status-${statusLower === 'error' ? 'error' : 'success'}">${escapeHtml(entry.status || 'success')}</span>`;
    const eventCount    = String(entry.event_count || 0);
    const importUrl     = escapeHtml(truncate(entry.import_url, 60));
    const rawPayload    = String(entry.raw_payload || entry.error_text || '');
    const payloadPreview = escapeHtml(truncate(rawPayload, 60) || '(empty)');
    // Store full payload as a data attribute for the tooltip
    const payloadFull   = escapeHtml(rawPayload || '(no payload)');

    return `<tr>
      <td>${dtg}</td>
      <td>${importing}</td>
      <td>${exporting}</td>
      <td>${statusBadge}</td>
      <td style="text-align:right;">${eventCount}</td>
      <td title="${escapeHtml(entry.import_url || '')}">${importUrl}</td>
      <td class="ics-payload-cell"
          data-payload="${payloadFull}"
          tabindex="0"
          aria-label="Hover to view full payload">${payloadPreview}</td>
    </tr>`;
  }).join('');

  // Attach tooltip events
  tableBody.querySelectorAll('.ics-payload-cell').forEach(cell => {
    cell.addEventListener('mouseenter', onPayloadMouseEnter);
    cell.addEventListener('mousemove',  onPayloadMouseMove);
    cell.addEventListener('mouseleave', onPayloadMouseLeave);
    cell.addEventListener('focus',      onPayloadFocus);
    cell.addEventListener('blur',       onPayloadBlur);
  });
}

// ── Tooltip ───────────────────────────────────────────────────────────────

function showTooltip(payloadHtml, x, y) {
  tooltip.innerHTML = payloadHtml;
  tooltip.style.display = 'block';
  tooltip.removeAttribute('aria-hidden');
  positionTooltip(x, y);
}

function positionTooltip(x, y) {
  const margin = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const tw = Math.min(600, vw - margin * 2);
  const th = 420;

  let left = x + 18;
  let top  = y + 12;

  if (left + tw > vw - margin) left = x - tw - 8;
  if (left < margin) left = margin;
  if (top + th > vh - margin) top = y - th - 8;
  if (top < margin) top = margin;

  tooltip.style.left = left + 'px';
  tooltip.style.top  = top + 'px';
}

function hideTooltip() {
  tooltip.style.display = 'none';
  tooltip.setAttribute('aria-hidden', 'true');
}

function onPayloadMouseEnter(e) {
  const payload = e.currentTarget.getAttribute('data-payload') || '(empty)';
  showTooltip(payload, e.clientX, e.clientY);
}

function onPayloadMouseMove(e) {
  positionTooltip(e.clientX, e.clientY);
}

function onPayloadMouseLeave() {
  hideTooltip();
}

function onPayloadFocus(e) {
  const payload = e.currentTarget.getAttribute('data-payload') || '(empty)';
  const rect = e.currentTarget.getBoundingClientRect();
  showTooltip(payload, rect.left, rect.bottom);
}

function onPayloadBlur() {
  hideTooltip();
}

// ── Event Listeners ───────────────────────────────────────────────────────

searchInput.addEventListener('input', applyFilters);
statusFilter.addEventListener('change', applyFilters);
refreshBtn.addEventListener('click', loadLog);

prevBtn.addEventListener('click', () => {
  if (currentPage > 1) { currentPage--; renderPage(); }
});
nextBtn.addEventListener('click', () => {
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  if (currentPage < totalPages) { currentPage++; renderPage(); }
});

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    } catch (_e) { /* ignore */ }
    window.location.href = '/Admin/index.html';
  });
}

// ── Init ──────────────────────────────────────────────────────────────────
loadLog();
