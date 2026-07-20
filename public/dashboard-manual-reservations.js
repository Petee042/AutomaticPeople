'use strict';

let currentManualReservations = [];

function setPageMessage(text, isError) {
  const el = document.getElementById('manualReservationsPageMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function setManualReservationsMessage(text, isError) {
  const el = document.getElementById('manualReservationsMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

const DISPLAY_WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DISPLAY_MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function padDisplayNumber(value) {
  return String(Number(value || 0)).padStart(2, '0');
}

function formatDateOnlyForMessage(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(raw + 'T00:00:00')
    : new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }
  return DISPLAY_WEEKDAY_SHORT[parsed.getDay()] + ' '
    + padDisplayNumber(parsed.getDate()) + ' '
    + DISPLAY_MONTH_SHORT[parsed.getMonth()] + ' '
    + String(parsed.getFullYear());
}

function formatDateTimeForMessage(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }
  return DISPLAY_WEEKDAY_SHORT[parsed.getDay()] + ' '
    + padDisplayNumber(parsed.getDate()) + ' '
    + DISPLAY_MONTH_SHORT[parsed.getMonth()] + ' '
    + String(parsed.getFullYear()) + ' '
    + padDisplayNumber(parsed.getHours()) + ':' + padDisplayNumber(parsed.getMinutes());
}

function renderManualReservationListingOptions(listings) {
  const select = document.getElementById('manualReservationListing');
  if (!select) {
    return;
  }

  const currentValue = String(select.value || '');
  select.innerHTML = '';

  const prompt = document.createElement('option');
  prompt.value = '';
  prompt.textContent = 'Select listing';
  select.appendChild(prompt);

  (listings || []).forEach((listing) => {
    const option = document.createElement('option');
    option.value = String(listing.id);
    option.textContent = String(listing.name || ('Listing #' + listing.id));
    select.appendChild(option);
  });

  if (currentValue && Array.from(select.options).some((opt) => opt.value === currentValue)) {
    select.value = currentValue;
  }
}

function normalizeManualReservationRows(reservations) {
  const rows = Array.isArray(reservations)
    ? reservations
    : Array.isArray(reservations && reservations.reservations)
      ? reservations.reservations
      : [];

  return rows.map((reservation) => ({
    id: Number(reservation && (reservation.id || reservation.reservation_id) ? (reservation.id || reservation.reservation_id) : 0),
    listingId: Number(reservation && (reservation.listingId || reservation.listing_id) ? (reservation.listingId || reservation.listing_id) : 0),
    listingName: String(
      reservation && (reservation.listingName || reservation.listing_name)
        ? (reservation.listingName || reservation.listing_name)
        : ''
    ),
    checkinDate: String(
      reservation && (reservation.checkinDate || reservation.reservation_checkin_date)
        ? (reservation.checkinDate || reservation.reservation_checkin_date)
        : ''
    ).slice(0, 10),
    checkoutDate: String(
      reservation && (reservation.checkoutDate || reservation.reservation_checkout_date)
        ? (reservation.checkoutDate || reservation.reservation_checkout_date)
        : ''
    ).slice(0, 10),
    notes: String(reservation && reservation.notes ? reservation.notes : ''),
    createdAt: String(
      reservation && (reservation.createdAt || reservation.created_at)
        ? (reservation.createdAt || reservation.created_at)
        : ''
    )
  }));
}

function renderManualReservations(reservations) {
  currentManualReservations = normalizeManualReservationRows(reservations);
  const tbody = document.getElementById('manualReservationsTableBody');
  if (!tbody) {
    return;
  }

  tbody.innerHTML = '';
  if (!currentManualReservations.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.textContent = 'No manual reservations.';
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  currentManualReservations.forEach((reservation) => {
    const row = document.createElement('tr');

    const listingCell = document.createElement('td');
    listingCell.textContent = String(reservation.listingName || ('Listing #' + reservation.listingId));

    const startCell = document.createElement('td');
    startCell.textContent = formatDateOnlyForMessage(reservation.checkinDate);

    const endCell = document.createElement('td');
    endCell.textContent = formatDateOnlyForMessage(reservation.checkoutDate);

    const notesCell = document.createElement('td');
    notesCell.textContent = String(reservation.notes || '');

    const createdCell = document.createElement('td');
    createdCell.textContent = formatDateTimeForMessage(reservation.createdAt) || '';

    const actionCell = document.createElement('td');
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn secondary';
    deleteBtn.textContent = 'Delete';
    deleteBtn.dataset.reservationId = String(reservation.id || '');
    deleteBtn.dataset.action = 'delete-manual-reservation';
    actionCell.appendChild(deleteBtn);

    row.appendChild(listingCell);
    row.appendChild(startCell);
    row.appendChild(endCell);
    row.appendChild(notesCell);
    row.appendChild(createdCell);
    row.appendChild(actionCell);
    tbody.appendChild(row);
  });
}

async function fetchListings() {
  const res = await fetch('/api/listings');
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load listings.');
  }

  renderManualReservationListingOptions(data.listings || []);
}

async function fetchManualReservations() {
  const res = await fetch('/api/manual-reservations');
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load manual reservations.');
  }

  const reservations = Array.isArray(data)
    ? data
    : Array.isArray(data.reservations)
      ? data.reservations
      : Array.isArray(data.manualReservations)
        ? data.manualReservations
        : Array.isArray(data.rows)
          ? data.rows
          : [];

  renderManualReservations(reservations);
}

async function createManualReservation(payload) {
  const res = await fetch('/api/manual-reservations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.status === 401) {
    window.location.href = '/';
    return { ok: false, error: 'Session expired.' };
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to create manual reservation.');
  }

  return data;
}

async function deleteManualReservation(reservationId) {
  const res = await fetch('/api/manual-reservations/' + encodeURIComponent(String(reservationId)), {
    method: 'DELETE'
  });

  if (res.status === 401) {
    window.location.href = '/';
    return { ok: false, error: 'Session expired.' };
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to delete manual reservation.');
  }

  return data;
}

async function handleCreateManualReservation(event) {
  event.preventDefault();

  const button = document.getElementById('createManualReservationBtn');
  const listingId = Number(document.getElementById('manualReservationListing').value || 0);
  const startDate = String(document.getElementById('manualReservationStartDate').value || '').trim();
  const endDate = String(document.getElementById('manualReservationEndDate').value || '').trim();
  const notes = String(document.getElementById('manualReservationNotes').value || '').trim();

  if (!Number.isInteger(listingId) || listingId <= 0) {
    setManualReservationsMessage('Please select a listing.', true);
    return;
  }
  if (!startDate || !endDate || endDate <= startDate) {
    setManualReservationsMessage('Please select valid start/end dates (end must be after start).', true);
    return;
  }
  if (!notes) {
    setManualReservationsMessage('Please enter a note.', true);
    return;
  }

  button.disabled = true;
  try {
    await createManualReservation({ listingId, startDate, endDate, notes });
    setManualReservationsMessage('Manual reservation created.', false);
    document.getElementById('manualReservationStartDate').value = '';
    document.getElementById('manualReservationEndDate').value = '';
    document.getElementById('manualReservationNotes').value = '';
    await fetchManualReservations();
  } catch (err) {
    setManualReservationsMessage(err.message || 'Failed to create manual reservation.', true);
  } finally {
    button.disabled = false;
  }
}

async function handleManualReservationsTableClick(event) {
  const target = event.target;
  if (!target || target.dataset.action !== 'delete-manual-reservation') {
    return;
  }

  const reservationId = Number(target.dataset.reservationId || 0);
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    setManualReservationsMessage('Invalid manual reservation id.', true);
    return;
  }

  const reservation = currentManualReservations.find((item) => Number(item.id) === reservationId);
  const summary = reservation
    ? (String(reservation.listingName || '') + ' ' + String(reservation.checkinDate || '') + ' to ' + String(reservation.checkoutDate || '')).trim()
    : ('Reservation #' + String(reservationId));
  const confirmed = window.confirm('Delete manual reservation ' + summary + '?');
  if (!confirmed) {
    return;
  }

  target.disabled = true;
  try {
    await deleteManualReservation(reservationId);
    setManualReservationsMessage('Manual reservation deleted.', false);
    await fetchManualReservations();
  } catch (err) {
    setManualReservationsMessage(err.message || 'Failed to delete manual reservation.', true);
  } finally {
    target.disabled = false;
  }
}

(function initManualReservationsPage() {
  const backBtn = document.getElementById('backBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      window.location.href = '/dashboard.html?tab=panel-dashboard';
    });
  }

  const form = document.getElementById('manualReservationForm');
  if (form) {
    form.addEventListener('submit', (event) => {
      handleCreateManualReservation(event).catch(() => {
        setManualReservationsMessage('Failed to create manual reservation.', true);
      });
    });
  }

  const tbody = document.getElementById('manualReservationsTableBody');
  if (tbody) {
    tbody.addEventListener('click', (event) => {
      handleManualReservationsTableClick(event).catch(() => {
        setManualReservationsMessage('Failed to delete manual reservation.', true);
      });
    });
  }

  Promise.all([fetchListings(), fetchManualReservations()]).catch((err) => {
    setPageMessage(err.message || 'Failed to load manual reservations page.', true);
  });
})();
