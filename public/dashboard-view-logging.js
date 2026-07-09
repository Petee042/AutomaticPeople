'use strict';

let viewLoggingFilterText = '';

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
    const query = viewLoggingFilterText
      ? ('?q=' + encodeURIComponent(viewLoggingFilterText))
      : '';
    const response = await fetch('/api/user-event-log' + query);
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

function getViewLoggingDeleteLabel(scope) {
  if (scope === 'older_7_days') {
    return 'entries older than 7 days';
  }
  if (scope === 'older_31_days') {
    return 'entries older than 31 days';
  }
  return 'all entries';
}

async function deleteViewLoggingEntries() {
  const deleteBtn = document.getElementById('viewLoggingDeleteBtn');
  const scopeEl = document.getElementById('viewLoggingDeleteScope');
  if (!deleteBtn || !scopeEl) {
    return;
  }

  const scope = String(scopeEl.value || 'all').trim();
  const label = getViewLoggingDeleteLabel(scope);
  const confirmed = window.confirm('Delete ' + label + '? This cannot be undone.');
  if (!confirmed) {
    return;
  }

  deleteBtn.disabled = true;
  setViewLoggingMessage('Deleting ' + label + '...', false);
  try {
    const response = await fetch('/api/user-event-log', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ scope })
    });

    if (response.status === 401) {
      window.location.href = '/';
      return;
    }
    if (response.status === 403) {
      setViewLoggingMessage('Access restricted.', true);
      return;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setViewLoggingMessage(data.error || 'Failed to delete log entries.', true);
      return;
    }

    setViewLoggingMessage(
      'Deleted ' + String(Number(data.deletedCount || 0)) + ' ' + label + '.',
      false
    );
    await loadViewLoggingEntries();
  } catch (err) {
    setViewLoggingMessage(err.message || 'Failed to delete log entries.', true);
  } finally {
    deleteBtn.disabled = false;
  }
}

function applyViewLoggingFilter() {
  const filterInput = document.getElementById('viewLoggingFilterInput');
  if (!filterInput) {
    return;
  }
  viewLoggingFilterText = String(filterInput.value || '').trim();
  loadViewLoggingEntries().catch(() => {
    setViewLoggingMessage('Failed to apply log filter.', true);
  });
}

(function initViewLoggingPage() {
  const backBtn = document.getElementById('backBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = '/dashboard.html?tab=panel-dashboard';
    });
  }

  const filterBtn = document.getElementById('viewLoggingFilterBtn');
  if (filterBtn) {
    filterBtn.addEventListener('click', () => {
      applyViewLoggingFilter();
    });
  }

  const filterClearBtn = document.getElementById('viewLoggingFilterClearBtn');
  const filterInput = document.getElementById('viewLoggingFilterInput');
  if (filterClearBtn && filterInput) {
    filterClearBtn.addEventListener('click', () => {
      filterInput.value = '';
      applyViewLoggingFilter();
    });
  }

  if (filterInput) {
    filterInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyViewLoggingFilter();
      }
    });
  }

  const deleteBtn = document.getElementById('viewLoggingDeleteBtn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      deleteViewLoggingEntries().catch(() => {
        setViewLoggingMessage('Failed to delete log entries.', true);
      });
    });
  }

  loadViewLoggingEntries().catch(() => {
    setViewLoggingMessage('Failed to load view logging page.', true);
  });
})();
