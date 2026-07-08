'use strict';

function setViewLoggingMessage(text, isError) {
  const el = document.getElementById('viewLoggingMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function formatViewLoggingDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '-';
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }
  return parsed.toLocaleDateString([], { dateStyle: 'short' }) + ' ' + parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;');
}

function openEntryDetailsInNewTab(entry) {
  const row = entry || {};
  const detail = row.detail && typeof row.detail === 'object' ? row.detail : {};

  const fullDetail = {
    dtg: String(detail.dtg || row.dtg || ''),
    fromAddress: String(detail.fromAddress || ''),
    toAddress: String(detail.toAddress || ''),
    subject: String(detail.subject || ''),
    messageContent: String(detail.messageContent || '')
  };

  const popup = window.open('', '_blank', 'noopener');
  if (!popup) {
    setViewLoggingMessage('Popup blocked. Please allow popups to view details.', true);
    return;
  }

  const title = 'Event Log Detail #' + String(row.id || '');
  popup.document.open();
  popup.document.write(
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>' + escapeHtml(title) + '</title>'
    + '<style>body{font-family:Segoe UI,Tahoma,sans-serif;padding:1.2rem;color:#1f2937}h1{font-size:1.1rem;margin:0 0 0.9rem}dl{display:grid;grid-template-columns:160px 1fr;gap:0.6rem 0.9rem}dt{font-weight:700}dd{margin:0;white-space:pre-wrap}pre{white-space:pre-wrap;background:#f5f7fb;border:1px solid #dbe1ef;padding:0.8rem;border-radius:8px}</style>'
    + '</head><body>'
    + '<h1>' + escapeHtml(title) + '</h1>'
    + '<dl>'
    + '<dt>DTG</dt><dd>' + escapeHtml(fullDetail.dtg || row.dtg || '') + '</dd>'
    + '<dt>From Address</dt><dd>' + escapeHtml(fullDetail.fromAddress) + '</dd>'
    + '<dt>To Address</dt><dd>' + escapeHtml(fullDetail.toAddress) + '</dd>'
    + '<dt>Subject</dt><dd>' + escapeHtml(fullDetail.subject) + '</dd>'
    + '</dl>'
    + '<h2 style="font-size:1rem;margin:1rem 0 0.5rem">Message Content</h2>'
    + '<pre>' + escapeHtml(fullDetail.messageContent) + '</pre>'
    + '</body></html>'
  );
  popup.document.close();
}

async function openViewLoggingEntryDetails(entryId) {
  const id = Number(entryId || 0);
  if (!Number.isInteger(id) || id <= 0) {
    setViewLoggingMessage('Select a valid log entry first.', true);
    return;
  }

  try {
    const response = await fetch('/api/user-event-log/' + encodeURIComponent(String(id)) + '/details');
    if (response.status === 401) {
      window.location.href = '/';
      return;
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to load log entry details.');
    }

    openEntryDetailsInNewTab(data.entry || {});
  } catch (err) {
    setViewLoggingMessage(err.message || 'Failed to load log entry details.', true);
  }
}

async function loadViewLoggingEntries() {
  const tbody = document.getElementById('viewLoggingTableBody');
  if (!tbody) {
    return;
  }

  tbody.innerHTML = '<tr><td colspan="3">Loading log entries...</td></tr>';
  setViewLoggingMessage('', false);

  try {
    const response = await fetch('/api/user-event-log');
    if (response.status === 401) {
      window.location.href = '/';
      return;
    }
    if (response.status === 403) {
      tbody.innerHTML = '<tr><td colspan="3">Access restricted.</td></tr>';
      return;
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to load event log.');
    }

    const entries = Array.isArray(data.entries) ? data.entries : [];
    if (!entries.length) {
      tbody.innerHTML = '<tr><td colspan="3">No log entries found.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    entries.forEach((entry) => {
      const tr = document.createElement('tr');

      const dtgCell = document.createElement('td');
      dtgCell.textContent = formatViewLoggingDateTime(entry.dtg);

      const descriptionCell = document.createElement('td');
      const descriptionBox = document.createElement('textarea');
      descriptionBox.className = 'event-log-description-box';
      descriptionBox.readOnly = true;
      descriptionBox.rows = 2;
      descriptionBox.value = String(entry.description || '-');
      descriptionCell.appendChild(descriptionBox);

      const infoCell = document.createElement('td');
      const infoBtn = document.createElement('button');
      infoBtn.type = 'button';
      infoBtn.className = 'btn secondary config-icon-btn event-log-info-btn';
      infoBtn.textContent = 'i';
      infoBtn.title = 'View event details';
      infoBtn.setAttribute('aria-label', 'View event details');
      infoBtn.addEventListener('click', () => {
        openViewLoggingEntryDetails(entry.id);
      });
      infoCell.appendChild(infoBtn);

      tr.appendChild(dtgCell);
      tr.appendChild(descriptionCell);
      tr.appendChild(infoCell);
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="3">Failed to load log entries.</td></tr>';
    setViewLoggingMessage(err.message || 'Failed to load event log.', true);
  }
}

(function initViewLoggingPage() {
  const backBtn = document.getElementById('backBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = '/dashboard.html?tab=panel-dashboard';
    });
  }

  loadViewLoggingEntries().catch(() => {
    setViewLoggingMessage('Failed to load view logging page.', true);
  });
})();
