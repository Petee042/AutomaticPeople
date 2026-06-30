'use strict';

let allListings = [];
let guestUsers = [];
// availabilityMap: listingId -> 'available' | 'unavailable' | 'loading' | null
const availabilityMap = {};
let availabilityCheckId = 0;
let preferredListingIdFromQuery = null;

function getStayNights(arrival, departure) {
  if (!arrival || !departure || departure <= arrival) {
    return 0;
  }
  const start = new Date(arrival + 'T00:00:00');
  const end = new Date(departure + 'T00:00:00');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
}

function getListingEstimatedTotalPrice(listing, stayNights) {
  const nights = Number(stayNights || 0);
  const perNight = Number(listing && listing.per_night_price);
  const perStay = Number(listing && listing.per_stay_price);
  const nightlyCost = Number.isFinite(perNight) ? perNight * nights : 0;
  const stayCost = Number.isFinite(perStay) ? perStay : 0;
  return Math.round((nightlyCost + stayCost) * 100) / 100;
}

function localRankSingleStayOptions(options) {
  return (Array.isArray(options) ? options.slice() : []).sort(function(a, b) {
    const leftTotal = Number(a && a.totalPrice);
    const rightTotal = Number(b && b.totalPrice);
    const safeLeft = Number.isFinite(leftTotal) ? leftTotal : Number.POSITIVE_INFINITY;
    const safeRight = Number.isFinite(rightTotal) ? rightTotal : Number.POSITIVE_INFINITY;
    if (safeLeft !== safeRight) {
      return safeLeft - safeRight;
    }
    const leftName = String(a && a.listingName || '').toLowerCase();
    const rightName = String(b && b.listingName || '').toLowerCase();
    return leftName.localeCompare(rightName);
  });
}

async function rankAvailableListings(arrival, departure) {
  const stayNights = getStayNights(arrival, departure);
  if (stayNights <= 0) {
    return;
  }

  const availableListings = allListings.filter(function(listing) {
    return availabilityMap[listing.id] === 'available';
  });

  if (!availableListings.length) {
    return;
  }

  const selectedListingId = getSelectedListingId();
  const preferredListingId = Number.isInteger(selectedListingId) && selectedListingId > 0
    ? selectedListingId
    : preferredListingIdFromQuery;

  const options = availableListings.map(function(listing) {
    return {
      listingId: Number(listing.id),
      listingName: String(listing.name || ''),
      totalPrice: getListingEstimatedTotalPrice(listing, stayNights),
      segments: [
        {
          listingId: Number(listing.id),
          nights: stayNights
        }
      ]
    };
  });

  let rankedOptions = [];
  try {
    const response = await fetch('/api/public/reservation-enquiry/split-stay/rank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preferredListingId: Number.isInteger(preferredListingId) && preferredListingId > 0 ? preferredListingId : null,
        options
      })
    });

    if (!response.ok) {
      throw new Error('Ranking API unavailable');
    }

    const data = await response.json();
    rankedOptions = Array.isArray(data.rankedOptions) ? data.rankedOptions : [];
  } catch {
    rankedOptions = localRankSingleStayOptions(options);
  }

  if (!rankedOptions.length) {
    return;
  }

  const rankedIds = rankedOptions
    .map(function(option) { return Number(option && option.listingId || 0); })
    .filter(function(id) { return Number.isInteger(id) && id > 0; });

  if (!rankedIds.length) {
    return;
  }

  const listingById = new Map(allListings.map(function(listing) {
    return [Number(listing.id), listing];
  }));
  const used = new Set();
  const reordered = [];

  rankedIds.forEach(function(id) {
    const listing = listingById.get(id);
    if (listing && !used.has(id)) {
      reordered.push(listing);
      used.add(id);
    }
  });

  allListings.forEach(function(listing) {
    const id = Number(listing.id);
    if (!used.has(id)) {
      reordered.push(listing);
      used.add(id);
    }
  });

  allListings = reordered;
}

function setMessage(text, isError) {
  const el = document.getElementById('reservationMessage');
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function toDateOnlyString(value) {
  if (!value) return '';
  const s = String(value);
  // ISO datetime: take first 10 chars
  return s.length >= 10 ? s.slice(0, 10) : s;
}

// Returns true if the event (with start/end date strings) overlaps arrival..departure
// iCal end dates are exclusive (checkout day), so we use: start < departure && end > arrival
function eventOverlapsDates(event, arrival, departure) {
  const eStart = toDateOnlyString(event.start);
  const eEnd = toDateOnlyString(event.end);
  if (!eStart || !eEnd) return false;
  return eStart < departure && eEnd > arrival;
}

function renderListings(listings) {
  const container = document.getElementById('listingsCheckboxList');
  if (!listings || !listings.length) {
    container.innerHTML = '<p class="cleaning-empty">No listings available.</p>';
    return;
  }
  // Preserve existing checked state
  const checkedIds = new Set(
    Array.from(container.querySelectorAll('.cleaning-listing-checkbox:checked'))
      .map(function(cb) { return cb.value; })
  );
  container.innerHTML = listings.map(function(listing) {
    const id = 'listing-chk-' + listing.id;
    const name = String(listing.name || listing.id);
    const avail = availabilityMap[listing.id];
    const isDisabled = avail === 'unavailable';
    let indicatorHtml;
    if (avail === 'loading') {
      indicatorHtml = '<span class="avail-indicator avail-loading" aria-label="Checking">&#8943;</span>';
    } else if (avail === 'available') {
      indicatorHtml = '<span class="avail-indicator avail-yes" aria-label="Available">&#10003;</span>';
    } else if (avail === 'unavailable') {
      indicatorHtml = '<span class="avail-indicator avail-no" aria-label="Not available">&#10007;</span>';
    } else {
      indicatorHtml = '<span class="avail-indicator avail-unknown" aria-label=""></span>';
    }
    const checked = checkedIds.has(String(listing.id)) && !isDisabled ? ' checked' : '';
    const disabled = isDisabled ? ' disabled' : '';
    return (
      '<label class="cleaning-listing-row" for="' + id + '">' +
        indicatorHtml +
        '<input class="cleaning-listing-checkbox" type="checkbox" id="' + id + '" value="' + listing.id + '"' + checked + disabled + ' />' +
        '<span class="cleaning-listing-name">' + name + '</span>' +
      '</label>'
    );
  }).join('');
}

async function checkAvailability(arrival, departure) {
  if (!arrival || !departure || departure <= arrival) {
    // Clear indicators
    allListings.forEach(function(l) { delete availabilityMap[l.id]; });
    renderListings(allListings);
    return;
  }

  // Mark all as loading
  const thisCheckId = ++availabilityCheckId;
  allListings.forEach(function(l) { availabilityMap[l.id] = 'loading'; });
  renderListings(allListings);

  await Promise.all(allListings.map(async function(listing) {
    try {
      const res = await fetch('/api/listings/' + listing.id + '/events');
      if (thisCheckId !== availabilityCheckId) return; // superseded
      if (!res.ok) {
        availabilityMap[listing.id] = null;
        return;
      }
      const data = await res.json();
      const events = (data.events || []).filter(function(e) { return e && e.isReservation !== false; });
      const conflict = events.some(function(e) { return eventOverlapsDates(e, arrival, departure); });
      availabilityMap[listing.id] = conflict ? 'unavailable' : 'available';
    } catch {
      if (thisCheckId === availabilityCheckId) availabilityMap[listing.id] = null;
    }
  }));

  if (thisCheckId !== availabilityCheckId) return;

  await rankAvailableListings(arrival, departure);
  renderListings(allListings);
}

function getSelectedListingIds() {
  return Array.from(
    document.querySelectorAll('#listingsCheckboxList .cleaning-listing-checkbox:checked')
  ).map(function(cb) { return Number(cb.value); });
}

function getSelectedListingId() {
  const selected = getSelectedListingIds();
  return selected.length ? selected[0] : null;
}

function renderGuestUsers(users) {
  const select = document.getElementById('guestUserSelect');
  if (!select) {
    return;
  }
  const options = ['<option value="">Select existing guest (optional)</option>'];
  (users || []).forEach(function(user) {
    const id = Number(user && user.id || 0);
    if (!Number.isInteger(id) || id <= 0) {
      return;
    }
    const firstName = String(user.firstName || '').trim();
    const familyName = String(user.familyName || '').trim();
    const email = String(user.email || '').trim();
    const displayName = String(user.displayName || [firstName, familyName].filter(Boolean).join(' ').trim() || email || ('User #' + id));
    options.push(
      '<option value="' + String(id)
      + '" data-first-name="' + firstName.replace(/"/g, '&quot;')
      + '" data-family-name="' + familyName.replace(/"/g, '&quot;')
      + '" data-email="' + email.replace(/"/g, '&quot;')
      + '">' + displayName + (email ? (' (' + email + ')') : '') + '</option>'
    );
  });
  select.innerHTML = options.join('');
}

document.getElementById('guestUserSelect').addEventListener('change', function() {
  const select = document.getElementById('guestUserSelect');
  const option = select && select.selectedOptions && select.selectedOptions[0] ? select.selectedOptions[0] : null;
  if (!option || !option.value) {
    return;
  }
  const firstName = String(option.getAttribute('data-first-name') || '').trim();
  const familyName = String(option.getAttribute('data-family-name') || '').trim();
  const email = String(option.getAttribute('data-email') || '').trim();
  if (firstName) document.getElementById('guestFirstName').value = firstName;
  if (familyName) document.getElementById('guestFamilyName').value = familyName;
  if (email) document.getElementById('guestEmail').value = email;
});

document.getElementById('backBtn').addEventListener('click', function() {
  window.location.href = '/dashboard.html?tab=panel-dashboard';
});

document.getElementById('cancelReservationBtn').addEventListener('click', function() {
  window.location.href = '/dashboard.html?tab=panel-dashboard';
});

document.getElementById('listingsCheckboxList').addEventListener('change', function(e) {
  const target = e.target;
  if (!target || !target.classList || !target.classList.contains('cleaning-listing-checkbox')) {
    return;
  }
  if (!target.checked) {
    return;
  }
  // Single-select logic: if one listing is checked, uncheck all others.
  Array.from(document.querySelectorAll('#listingsCheckboxList .cleaning-listing-checkbox')).forEach(function(cb) {
    if (cb !== target) {
      cb.checked = false;
    }
  });
});

// Trigger availability check when either date changes
(function() {
  var debounceTimer = null;
  function onDateChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function() {
      var arrival = document.getElementById('arrivalDate').value;
      var departure = document.getElementById('departureDate').value;
      checkAvailability(arrival, departure);
    }, 300);
  }
  document.getElementById('arrivalDate').addEventListener('change', onDateChange);
  document.getElementById('departureDate').addEventListener('change', onDateChange);
})();

document.getElementById('privateReservationForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  setMessage('', false);

  const arrivalDate = document.getElementById('arrivalDate').value;
  const departureDate = document.getElementById('departureDate').value;
  const listingId = getSelectedListingId();
  const firstName = document.getElementById('guestFirstName').value.trim();
  const familyName = document.getElementById('guestFamilyName').value.trim();
  const email = document.getElementById('guestEmail').value.trim();
  const guestCount = Number(document.getElementById('guestCount').value || 0);
  const cost = document.getElementById('reservationCost').value;
  const holdHours = document.getElementById('holdHours').value;
  const paymentMethod = document.getElementById('paymentMethod').value;

  if (!arrivalDate) { setMessage('Arrival date is required.', true); return; }
  if (!departureDate) { setMessage('Departure date is required.', true); return; }
  if (departureDate <= arrivalDate) { setMessage('Departure date must be after arrival date.', true); return; }
  if (!listingId) { setMessage('Please select one listing.', true); return; }
  if (!firstName) { setMessage('First name is required.', true); return; }
  if (!familyName) { setMessage('Family name is required.', true); return; }
  if (!email) { setMessage('Email address is required.', true); return; }
  if (!Number.isInteger(guestCount) || guestCount <= 0) { setMessage('Number of guests is required.', true); return; }
  if (paymentMethod === 'No Charge') {
    if (cost !== '' && Number(cost) < 0) { setMessage('Cost cannot be negative.', true); return; }
  } else if (cost === '' || Number(cost) < 0) {
    setMessage('Cost is required.', true);
    return;
  }
  if (holdHours === '' || Number(holdHours) <= 0) { setMessage('Hold period in hours is required.', true); return; }
  if (!paymentMethod) { setMessage('Payment method is required.', true); return; }

  setMessage('Saving reservation\u2026', false);
  document.getElementById('saveReservationBtn').disabled = true;

  try {
    const res = await fetch('/api/private-reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        arrivalDate,
        departureDate,
        listingId,
        firstName,
        familyName,
        email,
        guestCount,
        cost: paymentMethod === 'No Charge'
          ? (cost === '' ? 0 : Number(cost))
          : (cost === '' ? null : Number(cost)),
        holdHours: holdHours ? Number(holdHours) : null,
        paymentMethod
      })
    });

    if (res.status === 401) {
      window.location.href = '/';
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to save reservation.');
    }

    if (data.nextUrl) {
      const warning = data.emailDeliveryWarning ? '&warning=email-unavailable' : '';
      const reason = data.emailDeliveryWarning && data.emailDeliveryReason
        ? ('&reason=' + encodeURIComponent(String(data.emailDeliveryReason)))
        : '';
      window.location.href = data.nextUrl + warning + reason;
      return;
    }

    setMessage(data.message || 'Reservation saved.', false);
    setTimeout(function() {
      window.location.href = '/dashboard.html?tab=panel-dashboard';
    }, 900);
  } catch (err) {
    setMessage(err.message || 'Failed to save reservation.', true);
    document.getElementById('saveReservationBtn').disabled = false;
  }
});

// ── Initialise ────────────────────────────────────────────────

(async function init() {
  try {
    const params = new URLSearchParams(window.location.search);
    const preferredFromQuery = Number(params.get('preferredListingId') || 0);
    preferredListingIdFromQuery = Number.isInteger(preferredFromQuery) && preferredFromQuery > 0
      ? preferredFromQuery
      : null;

    const meRes = await fetch('/api/me');
    if (!meRes.ok) {
      window.location.href = '/';
      return;
    }

    const guestsRes = await fetch('/api/private-reservations/guest-users');
    if (guestsRes.status === 401) {
      window.location.href = '/';
      return;
    }
    if (guestsRes.ok) {
      const guestsData = await guestsRes.json();
      guestUsers = Array.isArray(guestsData.guestUsers) ? guestsData.guestUsers : [];
      renderGuestUsers(guestUsers);
    } else {
      renderGuestUsers([]);
    }

    const listingsRes = await fetch('/api/listings');
    if (listingsRes.status === 401) {
      window.location.href = '/';
      return;
    }
    if (listingsRes.ok) {
      const data = await listingsRes.json();
      allListings = data.listings || [];
      renderListings(allListings);
    } else {
      renderListings([]);
    }

    // Keep defaults explicit so all fields can be validated consistently.
    if (!document.getElementById('holdHours').value) {
      document.getElementById('holdHours').value = '24';
    }
    if (!document.getElementById('guestCount').value) {
      document.getElementById('guestCount').value = '1';
    }
  } catch (err) {
    setMessage('Failed to load page data. Please try again.', true);
  }
})();
