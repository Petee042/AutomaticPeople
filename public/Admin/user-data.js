'use strict';

function setUserDataMessage(text, isError) {
  const el = document.getElementById('userDataMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function getUserIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const value = Number(params.get('userId'));
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

async function checkAdminSession() {
  const res = await fetch('/api/admin/me');
  if (!res.ok) {
    window.location.href = '/Admin/index.html';
    return false;
  }
  return true;
}

function renderUserDataDump(payload) {
  const dump = payload && payload.dump ? payload.dump : null;
  const user = dump && dump.user ? dump.user : null;
  const userIdInput = document.getElementById('userDataUserId');
  const summaryEl = document.getElementById('userDataSummary');
  const dumpEl = document.getElementById('userDataDump');

  if (!dump || !user) {
    if (summaryEl) {
      summaryEl.textContent = 'No user data available.';
    }
    if (dumpEl) {
      dumpEl.textContent = 'No user data available.';
    }
    return;
  }

  if (userIdInput) {
    userIdInput.value = String(user.id || '');
  }

  const counts = {
    clientAccounts: Array.isArray(dump.clientAccounts) ? dump.clientAccounts.length : 0,
    memberships: Array.isArray(dump.memberships) ? dump.memberships.length : 0,
    properties: Array.isArray(dump.properties) ? dump.properties.length : 0,
    listings: Array.isArray(dump.listings) ? dump.listings.length : 0,
    cleaners: Array.isArray(dump.cleaners) ? dump.cleaners.length : 0,
    reservations: Array.isArray(dump.reservationActivity) ? dump.reservationActivity.length : 0,
    guestLinks: Array.isArray(dump.guestRelationships) ? dump.guestRelationships.length : 0,
    auditRows: Array.isArray(dump.userEventLog) ? dump.userEventLog.length : 0
  };

  if (summaryEl) {
    summaryEl.textContent = 'Loaded user #' + String(user.id || '') + ' with ' + counts.clientAccounts + ' client account(s), ' + counts.listings + ' listing(s), and ' + counts.reservations + ' reservation record(s).';
  }

  const warnings = Array.isArray(dump.warnings) ? dump.warnings : [];
  if (warnings.length) {
    setUserDataMessage('User data loaded with ' + warnings.length + ' warning(s).', true);
    if (summaryEl) {
      summaryEl.textContent += ' Some sections could not be loaded.';
    }
  }

  if (dumpEl) {
    dumpEl.textContent = JSON.stringify(payload, null, 2);
  }
}

async function loadUserDataDump() {
  const userId = getUserIdFromUrl();
  if (!userId) {
    setUserDataMessage('Missing or invalid user id.', true);
    document.getElementById('userDataDump').textContent = 'Missing or invalid user id.';
    document.getElementById('userDataSummary').textContent = 'Select a user from the Admin landing page.';
    return;
  }

  const res = await fetch('/api/admin/users/' + encodeURIComponent(String(userId)) + '/dump', { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    window.location.href = '/Admin/index.html';
    return;
  }

  if (!res.ok) {
    setUserDataMessage(data.error || 'Failed to load user data dump.', true);
    document.getElementById('userDataDump').textContent = data.error || 'Failed to load user data dump.';
    document.getElementById('userDataSummary').textContent = 'Unable to load user data.';
    return;
  }

  setUserDataMessage('User data loaded successfully.', false);
  renderUserDataDump(data);
}

(async () => {
  try {
    if (!(await checkAdminSession())) {
      return;
    }
    await loadUserDataDump();
  } catch (err) {
    setUserDataMessage(err.message || 'Failed to initialize user data dump.', true);
  }
})();

document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/Admin/index.html';
});