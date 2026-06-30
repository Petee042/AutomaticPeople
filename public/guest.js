'use strict';

const params = new URLSearchParams(window.location.search);
const guestIdParam = Number(params.get('id'));
const isCreateMode = String(params.get('new') || '').trim() === '1' || !(Number.isInteger(guestIdParam) && guestIdParam > 0);
let guestId = Number.isInteger(guestIdParam) && guestIdParam > 0 ? guestIdParam : null;
let canManageGuests = false;
let initialGuestState = '';

function setGuestMessage(text, isError) {
  const el = document.getElementById('guestMessage');
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function getGuestState() {
  return JSON.stringify({
    firstName: String(document.getElementById('guestFirstName').value || ''),
    familyName: String(document.getElementById('guestFamilyName').value || ''),
    email: String(document.getElementById('guestEmail').value || ''),
    phone: String(document.getElementById('guestPhone').value || '')
  });
}

function hasUnsavedGuestChanges() {
  return getGuestState() !== initialGuestState;
}

function goBackToConfig() {
  window.location.href = '/dashboard.html?tab=panel-config';
}

function confirmDiscardGuestChanges() {
  if (!hasUnsavedGuestChanges()) {
    return true;
  }
  return window.confirm('You have unsaved changes. Cancel changes and continue?');
}

async function loadGuest() {
  const response = await fetch('/api/access/guests/' + encodeURIComponent(guestId));
  if (response.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load guest.');
  }

  const guest = data.guest;
  document.getElementById('guestTitle').textContent = 'Guest: ' + ([guest.guest_first_name, guest.guest_family_name].filter(Boolean).join(' ') || guest.guest_email || ('#' + guest.id));
  document.getElementById('guestFirstName').value = guest.guest_first_name || '';
  document.getElementById('guestFamilyName').value = guest.guest_family_name || '';
  document.getElementById('guestEmail').value = guest.guest_email || '';
  document.getElementById('guestPhone').value = guest.guest_phone || '';
  document.getElementById('guestSourceType').value = guest.source_type || '';

  const deleteBtn = document.getElementById('deleteGuestBtn');
  if (deleteBtn && guest.has_future_reservations === true) {
    deleteBtn.disabled = true;
    setGuestMessage('Delete disabled: this guest has future reservations.', true);
  }
}

(async () => {
  try {
    const meRes = await fetch('/api/me');
    if (!meRes.ok) {
      window.location.href = '/';
      return;
    }

    const meData = await meRes.json();
    const activeRole = String((meData && meData.accessContext && meData.accessContext.activeRole) || '');
    canManageGuests = activeRole === 'Client' || activeRole === 'Manager';

    if (!canManageGuests) {
      document.getElementById('saveGuestBtn').disabled = true;
      document.getElementById('deleteGuestBtn').disabled = true;
      setGuestMessage('Read-only access: your role cannot edit guests.', false);
    }

    if (isCreateMode) {
      document.getElementById('guestTitle').textContent = 'Create Guest';
      document.getElementById('deleteGuestBtn').classList.add('hidden');
      document.getElementById('guestSourceType').value = 'manual';
      initialGuestState = getGuestState();
      return;
    }

    await loadGuest();
    initialGuestState = getGuestState();
  } catch (err) {
    setGuestMessage(err.message || 'Failed to load guest.', true);
  }
})();

document.getElementById('guestForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!canManageGuests) {
    setGuestMessage('Your role cannot save guest configuration.', true);
    return;
  }

  const button = document.getElementById('saveGuestBtn');
  const firstName = document.getElementById('guestFirstName').value.trim();
  const familyName = document.getElementById('guestFamilyName').value.trim();
  const email = document.getElementById('guestEmail').value.trim().toLowerCase();
  const phone = document.getElementById('guestPhone').value.trim();

  if (!email) {
    setGuestMessage('Guest email is required.', true);
    return;
  }

  button.disabled = true;
  try {
    const endpoint = isCreateMode
      ? '/api/access/guests'
      : ('/api/access/guests/' + encodeURIComponent(guestId));
    const method = isCreateMode ? 'POST' : 'PUT';
    const response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName, familyName, email, phone })
    });
    const data = await response.json();
    if (!response.ok) {
      setGuestMessage(data.error || 'Failed to save guest.', true);
      return;
    }

    if (isCreateMode) {
      const nextGuestId = Number(data && data.guest && data.guest.id);
      if (Number.isInteger(nextGuestId) && nextGuestId > 0) {
        window.location.href = '/guest.html?id=' + encodeURIComponent(nextGuestId);
        return;
      }
    }

    setGuestMessage('Guest saved.', false);
    initialGuestState = getGuestState();
  } catch {
    setGuestMessage('Network error saving guest.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('deleteGuestBtn').addEventListener('click', async () => {
  if (isCreateMode) {
    return;
  }

  if (!canManageGuests) {
    setGuestMessage('Your role cannot delete guests.', true);
    return;
  }

  const guestName = [
    document.getElementById('guestFirstName').value,
    document.getElementById('guestFamilyName').value
  ].filter(Boolean).join(' ').trim() || 'this guest';

  if (!window.confirm('Delete ' + guestName + '?')) {
    return;
  }

  const button = document.getElementById('deleteGuestBtn');
  button.disabled = true;
  try {
    const response = await fetch('/api/access/guests/' + encodeURIComponent(guestId), { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) {
      setGuestMessage(data.error || 'Failed to delete guest.', true);
      return;
    }
    goBackToConfig();
  } catch {
    setGuestMessage('Network error deleting guest.', true);
  } finally {
    if (!window.location.href.includes('/dashboard.html')) {
      button.disabled = false;
    }
  }
});

document.getElementById('backBtn').addEventListener('click', () => {
  if (!confirmDiscardGuestChanges()) {
    return;
  }
  goBackToConfig();
});

document.getElementById('cancelGuestBtn').addEventListener('click', () => {
  if (!confirmDiscardGuestChanges()) {
    return;
  }
  goBackToConfig();
});

window.addEventListener('beforeunload', (event) => {
  if (!hasUnsavedGuestChanges()) {
    return;
  }
  event.preventDefault();
  event.returnValue = '';
});
