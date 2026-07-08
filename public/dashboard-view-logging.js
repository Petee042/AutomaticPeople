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

function formatDetailObject(detailObject) {
  const detail = detailObject && typeof detailObject === 'object' ? detailObject : {};
  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return '{}';
  }
}

function buildInlineDetailHtml(entry) {
  const row = entry && typeof entry === 'object' ? entry : {};
  const detail = row.detail && typeof row.detail === 'object' ? row.detail : {};

  const dtg = String(detail.dtg || row.dtg || '').trim();
  const fromAddress = String(detail.fromAddress || '').trim();
  const toAddress = String(detail.toAddress || '').trim();
  const subject = String(detail.subject || '').trim();
  const eventType = String(row.eventType || '').trim();
  const messageContent = String(detail.messageContent || '').trim();
  const detailJson = formatDetailObject(detail);

  const lines = [];
  if (dtg) lines.push('<div><strong>DTG:</strong> ' + escapeHtml(dtg) + '</div>');
  if (eventType) lines.push('<div><strong>Event Type:</strong> ' + escapeHtml(eventType) + '</div>');
  if (fromAddress) lines.push('<div><strong>From Address:</strong> ' + escapeHtml(fromAddress) + '</div>');
  if (toAddress) lines.push('<div><strong>To Address:</strong> ' + escapeHtml(toAddress) + '</div>');
  if (subject) lines.push('<div><strong>Subject:</strong> ' + escapeHtml(subject) + '</div>');
  if (messageContent) {
    lines.push('<div><strong>Message Content:</strong></div>');
    lines.push('<pre class="event-log-detail-pre">' + escapeHtml(messageContent) + '</pre>');
  }
  lines.push('<div><strong>Full Detail:</strong></div>');
  lines.push('<pre class="event-log-detail-pre">' + escapeHtml(detailJson) + '</pre>');

  return '<div class="event-log-inline-detail">' + lines.join('') + '</div>';
}

async function loadViewLoggingEntryDetails(entryId) {
  const id = Number(entryId || 0);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Select a valid log entry first.');
  }

  const response = await fetch('/api/user-event-log/' + encodeURIComponent(String(id)) + '/details');
  if (response.status === 401) {
    window.location.href = '/';
    return null;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load log entry details.');
  }

  return data.entry || {};
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
      tr.className = 'event-log-main-row';

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
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'btn secondary config-icon-btn event-log-info-btn event-log-toggle-btn';
      toggleBtn.textContent = 'v';
      toggleBtn.title = 'Expand event details';
      toggleBtn.setAttribute('aria-label', 'Expand event details');
      toggleBtn.setAttribute('aria-expanded', 'false');
      infoCell.appendChild(toggleBtn);

      const detailRow = document.createElement('tr');
      detailRow.className = 'event-log-detail-row hidden';
      const detailCell = document.createElement('td');
      detailCell.colSpan = 3;
      detailCell.innerHTML = '<div class="event-log-inline-detail-loading">Loading details...</div>';
      detailRow.appendChild(detailCell);

      let detailLoaded = false;
      toggleBtn.addEventListener('click', async () => {
        const isOpen = !detailRow.classList.contains('hidden');
        if (isOpen) {
          detailRow.classList.add('hidden');
          toggleBtn.textContent = 'v';
          toggleBtn.title = 'Expand event details';
          toggleBtn.setAttribute('aria-label', 'Expand event details');
          toggleBtn.setAttribute('aria-expanded', 'false');
          return;
        }

        detailRow.classList.remove('hidden');
        toggleBtn.textContent = '^';
        toggleBtn.title = 'Collapse event details';
        toggleBtn.setAttribute('aria-label', 'Collapse event details');
        toggleBtn.setAttribute('aria-expanded', 'true');

        if (!detailLoaded) {
          try {
            detailCell.innerHTML = '<div class="event-log-inline-detail-loading">Loading details...</div>';
            const fullEntry = await loadViewLoggingEntryDetails(entry.id);
            if (!fullEntry) {
              return;
            }
            detailCell.innerHTML = buildInlineDetailHtml(fullEntry);
            detailLoaded = true;
          } catch (err) {
            detailCell.innerHTML = '<div class="event-log-inline-detail-error">'
              + escapeHtml(err.message || 'Failed to load log entry details.')
              + '</div>';
            setViewLoggingMessage(err.message || 'Failed to load log entry details.', true);
          }
        }
      });

      tr.appendChild(dtgCell);
      tr.appendChild(descriptionCell);
      tr.appendChild(infoCell);
      tbody.appendChild(tr);
      tbody.appendChild(detailRow);
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
