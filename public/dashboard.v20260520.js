'use strict';

const SOURCE_COLOR_OPTIONS = [
  { name: 'Red', value: '#e63946' },
  { name: 'Blue', value: '#1d4ed8' },
  { name: 'Green', value: '#2e7d32' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Teal', value: '#0f766e' },
  { name: 'Navy', value: '#1e3a8a' },
  { name: 'Pink', value: '#db2777' },
  { name: 'Yellow', value: '#ca8a04' }
];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_SHORT_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let currentListings = [];
let currentProperties = [];
let currentCleaners = [];
let currentSharedResources = [];
let schedulePreviewRequestId = 0;
let currentScheduleRows = [];
let currentScheduleErrors = [];
let currentNotificationRows = [];
let currentAccessContext = null;
let currentTeamMembers = [];
let currentUserEmail = '';
let currentManagerAssignments = {
  managers: [],
  propertyAssignments: [],
  listingAssignments: []
};
let currentGuests = [];
let currentEditingTeamUserId = null;
let currentTeamMemberDeleteImpact = null;
let currentMeProfile = null;
let currentDashboardSettings = {
  activityOutlookDays: 7,
  highlightEmptyNightsDays: 7
};
let currentDashboardContextMode = 'hosting';
let dashboardContextAvailability = { hosting: true, guest: false };
let dashboardTabController = null;

let opsCalCurrentMonth = new Date();
let opsCalCurrentEvents = [];
let opsCalCurrentCleaningChanges = [];
let opsCalCurrentFetchedAt = null;
let opsCalSelectedListingIds = new Set();
let opsCalRequestId = 0;
let currentManualReservations = [];
let dashboardActivityRequestId = 0;
let savedDashboardState = null;
let hasAppliedGuestReservationReturnMessage = false;

const opsCalSourceColorMap = {};
const opsCalSourcePalette = ['#ff5a5f', '#003580', '#2a9d8f', '#e76f51', '#264653', '#f4a261', '#8a5cf6'];
const opsCalListingColorMap = {};
const opsCalListingColorPalette = ['#1d4ed8', '#0f766e', '#b45309', '#be123c', '#4338ca', '#166534', '#0369a1', '#7c3aed'];
const opsCalCleanerBadgeColorMap = {};
const opsCalCleanerBadgePalette = ['#0f766e', '#1d4ed8', '#b45309', '#be123c', '#4338ca', '#166534', '#92400e', '#0369a1'];

function getDashboardStateStorageKey() {
  const identity = currentUserEmail || 'anonymous';
  return 'dashboard-state:v1:' + identity;
}

function loadDashboardState() {
  try {
    const raw = window.localStorage.getItem(getDashboardStateStorageKey());
    savedDashboardState = raw ? JSON.parse(raw) : null;
  } catch {
    savedDashboardState = null;
  }
}

function saveDashboardState(patch) {
  const nextState = Object.assign({}, savedDashboardState || {}, patch || {});
  savedDashboardState = nextState;
  try {
    window.localStorage.setItem(getDashboardStateStorageKey(), JSON.stringify(nextState));
  } catch {
    // Ignore storage failures.
  }
}

function getSavedListingIdSet(stateKey) {
  if (!savedDashboardState || !Array.isArray(savedDashboardState[stateKey])) {
    return null;
  }
  return new Set(savedDashboardState[stateKey].map((id) => String(id)));
}

function getListingDisplayNameFromEvent(event) {
  const listingName = String(event && (event.listingName || event.listing_name || event.listing || '')).trim();
  return listingName || 'Unknown listing';
}

function getListingKeyFromEvent(event) {
  const listingId = Number(event && event.listingId ? event.listingId : event && event.listing_id ? event.listing_id : 0);
  if (Number.isInteger(listingId) && listingId > 0) {
    return 'id:' + String(listingId);
  }
  return 'name:' + getListingDisplayNameFromEvent(event).toLowerCase();
}

function getListingColor(listingKey) {
  if (!opsCalListingColorMap[listingKey]) {
    const idx = Object.keys(opsCalListingColorMap).length % opsCalListingColorPalette.length;
    opsCalListingColorMap[listingKey] = opsCalListingColorPalette[idx];
  }
  return opsCalListingColorMap[listingKey];
}

function getOpsCalendarListings(events) {
  const listings = [];
  const seen = new Set();
  (events || []).forEach((event) => {
    const key = getListingKeyFromEvent(event);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    listings.push({
      key,
      name: getListingDisplayNameFromEvent(event),
      color: getListingColor(key)
    });
  });
  listings.sort((a, b) => a.name.localeCompare(b.name));
  return listings;
}

function getDefaultCleanerForListing(usualCleanerValue) {
  const value = Number(usualCleanerValue || 0);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }

  const cleaner = (currentCleaners || []).find((item) => {
    const cleanerId = Number(item && item.id ? item.id : 0);
    const cleanerUserId = Number(item && item.cleaner_user_id ? item.cleaner_user_id : 0);
    return cleanerId === value || cleanerUserId === value;
  });

  if (!cleaner) {
    return null;
  }

  return {
    id: Number(cleaner.id || value),
    userId: Number(cleaner.cleaner_user_id || 0) || null,
    name: getCleanerDisplayName(cleaner)
  };
}

function getDefaultCleanerNameForListing(usualCleanerValue) {
  const cleaner = getDefaultCleanerForListing(usualCleanerValue);
  return cleaner ? cleaner.name : '';
}

function getListingMetaById(listingId) {
  const id = Number(listingId || 0);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return (currentListings || []).find((listing) => Number(listing.id) === id) || null;
}

function reservationChangeKey(listingId, checkinDate, checkoutDate) {
  return String(listingId || '') + '|' + String(checkinDate || '') + '|' + String(checkoutDate || '');
}

function buildOpsDefaultCleaningChanges(events, changes) {
  const existingKeys = new Set(
    (changes || []).map((change) => reservationChangeKey(
      Number(change.listingId || change.listing_id || 0),
      toDateKey(change.reservation_checkin_date),
      toDateKey(change.reservation_checkout_date)
    ))
  );

  const synthetic = [];

  (events || []).forEach((event) => {
    if (event && event.isReservation === false) {
      return;
    }

    const listingId = Number(event && (event.listingId || event.listing_id) ? (event.listingId || event.listing_id) : 0);
    const checkinKey = toDateKey(event && event.start);
    const checkoutKey = toDateKey(event && event.end);
    if (!Number.isInteger(listingId) || listingId <= 0 || !checkinKey || !checkoutKey) {
      return;
    }

    const listingMeta = getListingMetaById(listingId);
    if (!listingMeta) {
      return;
    }

    const defaultCleaner = getDefaultCleanerForListing(listingMeta.usual_cleaner_id);
    const defaultCleanerId = defaultCleaner ? defaultCleaner.id : Number(listingMeta.usual_cleaner_id || 0);
    const defaultCleanerName = defaultCleaner ? defaultCleaner.name : '';
    if (!defaultCleanerName) {
      return;
    }

    const key = reservationChangeKey(listingId, checkinKey, checkoutKey);
    if (existingKeys.has(key)) {
      return;
    }
    existingKeys.add(key);

    const basis = listingMeta.date_basis === 'checkin' ? 'checkin' : 'checkout';
    synthetic.push({
      listingId,
      listing_id: listingId,
      listingName: listingMeta.name || ('Listing #' + listingId),
      reservation_checkin_date: checkinKey,
      reservation_checkout_date: checkoutKey,
      changeover_date: basis === 'checkin' ? checkinKey : checkoutKey,
      cleaner_id: null,
      cleaner_name: '',
      default_cleaner_id: defaultCleanerId,
      default_cleaner_name: defaultCleanerName
    });
  });

  return synthetic;
}

function setScheduleEmailMessage(text, isError) {
  const el = document.getElementById('scheduleEmailMessage');
  if (!el) return;
  el.textContent = text || '';
  el.className = text ? ('schedule-email-message ' + (isError ? 'error' : 'success')) : 'schedule-email-message';
}

function setConsolidatedIcsUrl(token) {
  const input = document.getElementById('consolidatedIcsExportUrl');
  if (!input) {
    return;
  }

  const baseUrl = window.location.origin + '/api/calendar.ics';
  input.value = token ? (baseUrl + '?token=' + encodeURIComponent(token)) : baseUrl;
}

function setMessage(text, isError) {
  const el = document.getElementById('dashboardMessage');
  el.textContent = text;
  el.className = text ? 'message ' + (isError ? 'error' : 'success') : 'message';
}

function setManualReservationsMessage(text, isError) {
  const el = document.getElementById('manualReservationsMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? 'message ' + (isError ? 'error' : 'success') : 'message';
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
  return parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function setStripeConnectStatus(text, isError) {
  const el = document.getElementById('stripeConnectStatus');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = isError ? 'hint error' : 'hint';
}

function isStrongPassword(password) {
  const value = String(password || '');
  return value.length >= 8
    && /[A-Z]/.test(value)
    && /[0-9]/.test(value)
    && /[^A-Za-z0-9]/.test(value);
}

function canManageTeam() {
  return Boolean(currentAccessContext && currentAccessContext.activeRole === 'Client');
}

function canViewTeam() {
  if (!currentAccessContext) return false;
  return currentAccessContext.activeRole === 'Client' || currentAccessContext.activeRole === 'Manager';
}

function canManageAssignments() {
  return Boolean(currentAccessContext && currentAccessContext.activeRole === 'Client');
}

function canViewAssignments() {
  if (!currentAccessContext) return false;
  return currentAccessContext.activeRole === 'Client' || currentAccessContext.activeRole === 'Manager';
}

function canViewGuests() {
  if (!currentAccessContext) return false;
  return currentAccessContext.activeRole === 'Client' || currentAccessContext.activeRole === 'Manager';
}

function getCleanerDisplayName(cleaner) {
  if (!cleaner) {
    return 'Unallocated';
  }
  const fullName = [cleaner.first_name || '', cleaner.last_name || ''].join(' ').trim();
  if (fullName) {
    return fullName;
  }
  return String(cleaner.email || '').trim() || 'Unallocated';
}

function getCleanerUserId(cleaner) {
  const cleanerUserId = Number(cleaner && cleaner.cleaner_user_id ? cleaner.cleaner_user_id : 0);
  return Number.isInteger(cleanerUserId) && cleanerUserId > 0 ? cleanerUserId : null;
}

function getCleanerByUserIdMap(cleaners) {
  return new Map(
    (cleaners || currentCleaners || [])
      .filter((cleaner) => getCleanerUserId(cleaner))
      .map((cleaner) => [getCleanerUserId(cleaner), cleaner])
  );
}

function resolveCleanerNameFromChange(change, cleaners) {
  if (!change) {
    return 'Unallocated';
  }

  const explicitName = String(change.cleaner_name || '').trim();
  if (explicitName) {
    return explicitName;
  }

  const cleanerList = cleaners || currentCleaners || [];
  const byUserId = getCleanerByUserIdMap(cleanerList);
  const cleanerUserId = Number(change.cleaner_user_id || 0);
  if (Number.isInteger(cleanerUserId) && cleanerUserId > 0 && byUserId.has(cleanerUserId)) {
    return getCleanerDisplayName(byUserId.get(cleanerUserId));
  }

  const cleanerId = Number(change.cleaner_id || 0);
  if (Number.isInteger(cleanerId) && cleanerId > 0) {
    const fallbackCleaner = cleanerList.find((cleaner) => Number(cleaner.id) === cleanerId);
    if (fallbackCleaner) {
      return getCleanerDisplayName(fallbackCleaner);
    }
  }

  return 'Unallocated';
}

function getCurrentManagerScopeState() {
  const empty = {
    managerMembershipId: null,
    hasAssignments: false,
    propertyIdSet: new Set(),
    listingIdSet: new Set()
  };

  if (!currentAccessContext || currentAccessContext.activeRole !== 'Manager') {
    return empty;
  }

  const managers = Array.isArray(currentManagerAssignments.managers) ? currentManagerAssignments.managers : [];
  const membership = managers.find((row) => String(row.email || '').toLowerCase() === String(currentUserEmail || '').toLowerCase()) || null;
  if (!membership) {
    return empty;
  }

  const managerMembershipId = Number(membership.membership_id);
  const propertyIdSet = new Set(
    (currentManagerAssignments.propertyAssignments || [])
      .filter((row) => Number(row.manager_membership_id) === managerMembershipId)
      .map((row) => Number(row.property_id))
      .filter((value) => Number.isInteger(value) && value > 0)
  );
  const listingIdSet = new Set(
    (currentManagerAssignments.listingAssignments || [])
      .filter((row) => Number(row.manager_membership_id) === managerMembershipId)
      .map((row) => Number(row.listing_id))
      .filter((value) => Number.isInteger(value) && value > 0)
  );

  return {
    managerMembershipId,
    hasAssignments: propertyIdSet.size > 0 || listingIdSet.size > 0,
    propertyIdSet,
    listingIdSet
  };
}

function createScopeBadge(text) {
  const badge = document.createElement('span');
  badge.className = 'scope-badge';
  badge.textContent = text;
  return badge;
}

async function copyTextToClipboard(text) {
  const value = String(text || '');
  if (!value) {
    throw new Error('Nothing to copy.');
  }

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(value);
    return;
  }

  const temp = document.createElement('textarea');
  temp.value = value;
  temp.setAttribute('readonly', 'readonly');
  temp.style.position = 'fixed';
  temp.style.opacity = '0';
  document.body.appendChild(temp);
  temp.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(temp);
  if (!ok) {
    throw new Error('Clipboard unavailable.');
  }
}

function buildReservationEnquiryLandingPublicUrl(row) {
  const params = new URLSearchParams();
  const slug = String(row && row.public_slug || '').trim();
  const selectedListingIds = Array.isArray(row && row.selected_listing_ids) ? row.selected_listing_ids : [];
  const fallbackListingId = selectedListingIds.length ? Number(selectedListingIds[0]) : 0;
  const preferredListingId = Number(row && row.preferred_listing_id ? row.preferred_listing_id : fallbackListingId);

  if (slug) {
    params.set('landingPage', slug);
  }
  if (Number.isInteger(preferredListingId) && preferredListingId > 0) {
    params.set('preferredListingId', String(preferredListingId));
  }
  if (!slug && (!Number.isInteger(preferredListingId) || preferredListingId <= 0)) {
    params.set('landingPageId', String(row && row.id ? row.id : ''));
  }

  const query = params.toString();
  return window.location.origin + '/reservation-enquiry.html' + (query ? ('?' + query) : '');
}

function buildFacilityEnquiryLandingPublicUrl(row) {
  const slug = String(row && row.public_slug || '').trim();
  if (!slug) {
    return '';
  }
  return window.location.origin + '/resource-booking.html?facilityLandingPage=' + encodeURIComponent(slug);
}

function renderReservationEnquiryLandingPageRows(containerId, rows) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  container.innerHTML = '';
  if (!Array.isArray(rows) || !rows.length) {
    const empty = document.createElement('div');
    empty.className = 'config-item-empty';
    empty.textContent = 'No reservation enquiry landing pages yet.';
    container.appendChild(empty);
    return;
  }

  rows.forEach((rowData) => {
    const row = document.createElement('div');
    row.className = 'config-item-row';

    const name = document.createElement('span');
    name.className = 'config-item-name';
    name.textContent = (rowData.name || ('Landing Page #' + rowData.id)) + (rowData.is_active === false ? ' (Inactive)' : '');

    const actions = document.createElement('div');
    actions.className = 'config-row-actions';

    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'btn secondary config-mini-btn';
    previewBtn.textContent = 'Preview';
    previewBtn.title = 'Open public URL';
    previewBtn.setAttribute('aria-label', 'Preview public URL for ' + (rowData.name || 'landing page'));
    previewBtn.addEventListener('click', () => {
      const url = buildReservationEnquiryLandingPublicUrl(rowData);
      window.location.href = url;
    });

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn secondary config-mini-btn';
    copyBtn.textContent = 'Copy URL';
    copyBtn.title = 'Copy public URL';
    copyBtn.setAttribute('aria-label', 'Copy public URL for ' + (rowData.name || 'landing page'));
    copyBtn.addEventListener('click', async () => {
      const url = buildReservationEnquiryLandingPublicUrl(rowData);
      try {
        await copyTextToClipboard(url);
        setMessage('Copied landing page URL.', false);
      } catch {
        setMessage('Could not copy landing page URL.', true);
      }
    });

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn secondary config-edit-btn';
    editBtn.textContent = '✎';
    editBtn.title = 'Edit';
    editBtn.setAttribute('aria-label', 'Edit ' + (rowData.name || 'landing page'));
    editBtn.addEventListener('click', () => {
      window.location.href = '/reservation-enquiry-landing-page.html?id=' + encodeURIComponent(rowData.id);
    });

    actions.appendChild(previewBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(editBtn);

    row.appendChild(name);
    row.appendChild(actions);
    container.appendChild(row);
  });
}

function renderFacilityEnquiryLandingPageRows(containerId, rows) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  container.innerHTML = '';
  if (!Array.isArray(rows) || !rows.length) {
    const empty = document.createElement('div');
    empty.className = 'config-item-empty';
    empty.textContent = 'No facility enquiry landing pages yet.';
    container.appendChild(empty);
    return;
  }

  rows.forEach((rowData) => {
    const row = document.createElement('div');
    row.className = 'config-item-row';

    const name = document.createElement('span');
    name.className = 'config-item-name';
    const facilityName = String(rowData.shared_resource_name || '').trim();
    const label = (rowData.name || ('Landing Page #' + rowData.id)) + (facilityName ? (' - ' + facilityName) : '');
    name.textContent = label + (rowData.is_active === false ? ' (Inactive)' : '');

    const actions = document.createElement('div');
    actions.className = 'config-row-actions';

    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'btn secondary config-mini-btn';
    previewBtn.textContent = 'Preview';
    previewBtn.title = 'Open public URL';
    previewBtn.setAttribute('aria-label', 'Preview public URL for ' + (rowData.name || 'landing page'));
    previewBtn.addEventListener('click', () => {
      const url = buildFacilityEnquiryLandingPublicUrl(rowData);
      if (!url) {
        setMessage('Public URL is not available yet.', true);
        return;
      }
      window.location.href = url;
    });

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn secondary config-mini-btn';
    copyBtn.textContent = 'Copy URL';
    copyBtn.title = 'Copy public URL';
    copyBtn.setAttribute('aria-label', 'Copy public URL for ' + (rowData.name || 'landing page'));
    copyBtn.addEventListener('click', async () => {
      const url = buildFacilityEnquiryLandingPublicUrl(rowData);
      if (!url) {
        setMessage('Public URL is not available yet.', true);
        return;
      }
      try {
        await copyTextToClipboard(url);
        setMessage('Copied facility landing page URL.', false);
      } catch {
        setMessage('Could not copy facility landing page URL.', true);
      }
    });

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn secondary config-edit-btn';
    editBtn.textContent = '✎';
    editBtn.title = 'Edit';
    editBtn.setAttribute('aria-label', 'Edit ' + (rowData.name || 'landing page'));
    editBtn.addEventListener('click', () => {
      window.location.href = '/facility-enquiry-landing-page.html?id=' + encodeURIComponent(rowData.id);
    });

    actions.appendChild(previewBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(editBtn);

    row.appendChild(name);
    row.appendChild(actions);
    container.appendChild(row);
  });
}

function renderConfigRows(containerId, items, emptyText) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  container.innerHTML = '';
  if (!Array.isArray(items) || !items.length) {
    const empty = document.createElement('div');
    empty.className = 'config-item-empty';
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'config-item-row';

    const name = document.createElement('span');
    name.className = 'config-item-name';
    name.textContent = item.name || 'Untitled';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn secondary config-edit-btn';
    editBtn.textContent = '✎';
    editBtn.title = 'Edit';
    editBtn.setAttribute('aria-label', 'Edit ' + (item.name || 'item'));
    editBtn.addEventListener('click', () => {
      if (item.href) {
        window.location.href = item.href;
      }
    });

    row.appendChild(name);
    row.appendChild(editBtn);
    container.appendChild(row);
  });
}

function applyAccessRoleVisibility() {
  const addTeamForm = document.getElementById('addTeamMemberForm');
  const saveAssignmentsBtn = document.getElementById('saveManagerAssignmentsBtn');

  if (addTeamForm) {
    addTeamForm.classList.toggle('hidden', !canManageTeam());
  }
  if (saveAssignmentsBtn) {
    saveAssignmentsBtn.classList.toggle('hidden', !canManageAssignments());
  }
}

function renderAccessContext(context) {
  currentAccessContext = context || null;

  const summary = document.getElementById('accessContextSummary');
  const memberships = (context && Array.isArray(context.memberships)) ? context.memberships : [];
  const activeClientAccountId = context ? Number(context.activeClientAccountId) : null;
  const activeRole = context ? String(context.activeRole || '') : '';

  if (summary) {
    const activeMembership = memberships.find((membership) => Number(membership.client_account_id) === activeClientAccountId) || null;
    if (!activeMembership) {
      summary.textContent = 'No active client access context.';
    } else {
      let nextText = 'Active: ' + (activeMembership.account_name || ('Client #' + activeClientAccountId)) + ' as ' + (activeRole || activeMembership.role);
      const scopeState = getCurrentManagerScopeState();
      if (activeRole === 'Manager' && scopeState.hasAssignments) {
        nextText += ' | Assignment scope active (' + scopeState.propertyIdSet.size + ' properties, ' + scopeState.listingIdSet.size + ' listings).';
      }
      summary.textContent = nextText;
    }
  }

  updateDashboardContextAvailabilityFromMemberships();
  applyAccessRoleVisibility();
}

function renderTeamMembers(team) {
  currentTeamMembers = Array.isArray(team) ? team : [];

  const tbody = document.getElementById('teamTableBody');

  if (!currentTeamMembers.length) {
    if (tbody) {
      tbody.innerHTML = '';
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = 'No team members found.';
      row.appendChild(cell);
      tbody.appendChild(row);
      closeTeamMemberEditor();
    }
    renderConfigRows('configTeamList', [], 'No team members yet.');
    return;
  }

  const groupedByUser = new Map();
  currentTeamMembers
    .filter((member) => member && (member.status === 'active' || member.status === 'invited'))
    .forEach((member) => {
      const userId = Number(member.user_id);
      if (!Number.isInteger(userId) || userId <= 0) {
        return;
      }
      if (!groupedByUser.has(userId)) {
        groupedByUser.set(userId, {
          user_id: userId,
          first_name: member.first_name || '',
          family_name: member.family_name || '',
          email: member.email || '',
          country_of_residence: member.country_of_residence || '',
          is_validated: member.is_validated !== false,
          statuses: new Set(),
          roles: new Set()
        });
      }
      const grouped = groupedByUser.get(userId);
      grouped.statuses.add(String(member.status || ''));
      if (member.role === 'Manager' || member.role === 'Staff') {
        grouped.roles.add(member.role);
      }
    });

  if (!groupedByUser.size) {
    if (tbody) {
      tbody.innerHTML = '';
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = 'No team members found.';
      row.appendChild(cell);
      tbody.appendChild(row);
      closeTeamMemberEditor();
    }
    renderConfigRows('configTeamList', [], 'No team members yet.');
    return;
  }

  const groupedMembers = Array.from(groupedByUser.values());

  renderConfigRows(
    'configTeamList',
    groupedMembers.map((member) => {
      const fullName = [member.first_name, member.family_name].filter(Boolean).join(' ').trim();
      const emailFallback = String(member.email || '').trim();
      return {
        name: fullName || emailFallback || ('Team Member #' + member.user_id),
        href: '/team-member.html?id=' + encodeURIComponent(member.user_id)
      };
    }),
    'No team members yet.'
  );

  if (!tbody) {
    return;
  }

  tbody.innerHTML = '';

  groupedMembers.forEach((member) => {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    const fullName = [member.first_name, member.family_name].filter(Boolean).join(' ').trim();
    const emailFallback = String(member.email || '').trim();
    nameCell.textContent = fullName || (emailFallback || 'Name not set');

    const emailCell = document.createElement('td');
    emailCell.textContent = member.email || '';

    const roleCell = document.createElement('td');
    const roleLabels = [];
    if (member.roles.has('Manager')) roleLabels.push('Manager');
    if (member.roles.has('Staff')) roleLabels.push('Staff');
    roleCell.textContent = roleLabels.length ? roleLabels.join(' / ') : 'None';

    const statusCell = document.createElement('td');
    if (member.is_validated === false) {
      statusCell.textContent = 'unvalidated';
    } else if (member.statuses.has('invited') && !member.statuses.has('active')) {
      statusCell.textContent = 'invited';
    } else {
      statusCell.textContent = 'active';
    }

    const actionCell = document.createElement('td');
    if (canManageTeam() || canViewTeam()) {
      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'btn secondary config-edit-btn';
      actionBtn.textContent = '✎';
      actionBtn.title = 'View/Update/Delete';
      actionBtn.setAttribute('aria-label', 'View/Update/Delete');
      actionBtn.addEventListener('click', () => {
        openTeamMemberEditor(member);
      });
      actionCell.appendChild(actionBtn);
    } else {
      actionCell.textContent = '-';
    }

    row.appendChild(nameCell);
    row.appendChild(emailCell);
    row.appendChild(roleCell);
    row.appendChild(statusCell);
    row.appendChild(actionCell);
    tbody.appendChild(row);
  });

  if (currentEditingTeamUserId) {
    const selected = groupedMembers.find((member) => Number(member.user_id) === Number(currentEditingTeamUserId)) || null;
    if (selected) {
      openTeamMemberEditor(selected);
    } else {
      closeTeamMemberEditor();
    }
  }
}

function openTeamMemberEditor(member) {
  const panel = document.getElementById('teamMemberEditor');
  if (!panel || !member) {
    return;
  }

  const fullName = [member.first_name, member.family_name].filter(Boolean).join(' ').trim();
  const emailFallback = String(member.email || '').trim();

  document.getElementById('editTeamMemberUserId').value = String(member.user_id || '');
  document.getElementById('editTeamMemberName').value = fullName || (emailFallback || 'Name not set');
  document.getElementById('editTeamMemberEmail').value = member.email || '';
  document.getElementById('editTeamMemberCountry').value = member.country_of_residence || '';

  const managerBox = document.getElementById('editTeamMemberRoleManager');
  const staffBox = document.getElementById('editTeamMemberRoleStaff');
  managerBox.checked = member.roles.has('Manager');
  staffBox.checked = member.roles.has('Staff');
  managerBox.disabled = !canManageTeam();
  staffBox.disabled = !canManageTeam();

  const saveBtn = document.getElementById('saveTeamMemberEditorBtn');
  const deleteBtn = document.getElementById('deleteTeamMemberBtn');
  if (saveBtn) saveBtn.classList.toggle('hidden', !canManageTeam());
  if (deleteBtn) deleteBtn.classList.toggle('hidden', !canManageTeam());

  const impactEl = document.getElementById('teamMemberDeleteImpact');
  currentTeamMemberDeleteImpact = null;
  if (impactEl) {
    if (!canManageTeam()) {
      impactEl.textContent = 'Delete impact is available to Client role only.';
    } else {
      impactEl.textContent = 'Delete impact: loading...';
    }
  }

  panel.classList.remove('hidden');
  currentEditingTeamUserId = Number(member.user_id) || null;

  if (canManageTeam()) {
    fetchTeamMemberDeleteImpact(member.user_id)
      .then((impact) => {
        if (Number(currentEditingTeamUserId) !== Number(member.user_id)) {
          return;
        }
        currentTeamMemberDeleteImpact = impact;
        if (!impactEl) {
          return;
        }
        if (impact.deletedFromSite) {
          impactEl.textContent = 'Delete impact: this will remove the user from this client and delete the site user account (no other client associations found).';
        } else {
          impactEl.textContent = 'Delete impact: this will remove the user from this client scope only (other client associations exist).';
        }
      })
      .catch((err) => {
        if (Number(currentEditingTeamUserId) !== Number(member.user_id)) {
          return;
        }
        currentTeamMemberDeleteImpact = null;
        if (impactEl) {
          impactEl.textContent = 'Delete impact unavailable: ' + (err.message || 'Failed to load delete impact.');
        }
      });
  }
}

function closeTeamMemberEditor() {
  const panel = document.getElementById('teamMemberEditor');
  if (!panel) {
    return;
  }
  panel.classList.add('hidden');
  currentEditingTeamUserId = null;
  currentTeamMemberDeleteImpact = null;
}

function renderGuests(guests) {
  currentGuests = Array.isArray(guests) ? guests : [];
  const tbody = document.getElementById('guestsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!currentGuests.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.textContent = 'No guest contacts found.';
    row.appendChild(cell);
    tbody.appendChild(row);
    renderConfigRows('configGuestsList', [], 'No guests yet.');
    return;
  }

  renderConfigRows(
    'configGuestsList',
    currentGuests.map((guest) => {
      const guestName = [guest.guest_first_name, guest.guest_family_name].filter(Boolean).join(' ').trim();
      return {
        name: guestName || guest.guest_email || guest.guest_phone || ('Guest #' + guest.id),
        href: '/guest.html?id=' + encodeURIComponent(guest.id)
      };
    }),
    'No guests yet.'
  );

  currentGuests.forEach((guest) => {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    const guestName = [guest.guest_first_name, guest.guest_family_name].filter(Boolean).join(' ').trim();
    nameCell.textContent = guestName || 'Guest';

    const emailCell = document.createElement('td');
    emailCell.textContent = guest.guest_email || '';

    const phoneCell = document.createElement('td');
    phoneCell.textContent = guest.guest_phone || '';

    const sourceCell = document.createElement('td');
    sourceCell.textContent = guest.source_type || '';

    row.appendChild(nameCell);
    row.appendChild(emailCell);
    row.appendChild(phoneCell);
    row.appendChild(sourceCell);
    tbody.appendChild(row);
  });
}

function renderManagerAssignmentSelectors(snapshot) {
  currentManagerAssignments = snapshot || { managers: [], propertyAssignments: [], listingAssignments: [] };

  const managerSelect = document.getElementById('managerAssignmentMembership');
  if (!managerSelect) {
    return;
  }

  const managers = Array.isArray(currentManagerAssignments.managers) ? currentManagerAssignments.managers : [];
  managerSelect.innerHTML = '';

  if (!managers.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No active managers';
    managerSelect.appendChild(option);
    renderManagerScopeOptions(null);
    return;
  }

  managers.forEach((manager) => {
    const option = document.createElement('option');
    option.value = String(manager.membership_id);
    option.textContent = (manager.email || ('Manager #' + manager.membership_id));
    managerSelect.appendChild(option);
  });

  renderManagerScopeOptions(Number(managerSelect.value));
}

function renderManagerScopeOptions(membershipId) {
  const propertyContainer = document.getElementById('managerPropertyScope');
  const listingContainer = document.getElementById('managerListingScope');
  if (!propertyContainer || !listingContainer) {
    return;
  }

  const managerMembershipId = Number(membershipId);
  const propertyAssignments = new Set(
    (currentManagerAssignments.propertyAssignments || [])
      .filter((row) => Number(row.manager_membership_id) === managerMembershipId)
      .map((row) => Number(row.property_id))
  );
  const listingAssignments = new Set(
    (currentManagerAssignments.listingAssignments || [])
      .filter((row) => Number(row.manager_membership_id) === managerMembershipId)
      .map((row) => Number(row.listing_id))
  );

  propertyContainer.innerHTML = '';
  if (!(currentProperties || []).length) {
    propertyContainer.innerHTML = '<p class="cleaning-empty">No properties available.</p>';
  } else {
    currentProperties.forEach((property) => {
      const row = document.createElement('label');
      row.className = 'cleaning-listing-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'manager-property-checkbox';
      checkbox.value = String(property.id);
      checkbox.checked = propertyAssignments.has(Number(property.id));

      const text = document.createElement('span');
      text.className = 'cleaning-listing-name';
      text.textContent = property.name;

      row.appendChild(checkbox);
      row.appendChild(text);
      propertyContainer.appendChild(row);
    });
  }

  listingContainer.innerHTML = '';
  if (!(currentListings || []).length) {
    listingContainer.innerHTML = '<p class="cleaning-empty">No listings available.</p>';
  } else {
    currentListings.forEach((listing) => {
      const row = document.createElement('label');
      row.className = 'cleaning-listing-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'manager-listing-checkbox';
      checkbox.value = String(listing.id);
      checkbox.checked = listingAssignments.has(Number(listing.id));

      const text = document.createElement('span');
      text.className = 'cleaning-listing-name';
      text.textContent = listing.name;

      row.appendChild(checkbox);
      row.appendChild(text);
      listingContainer.appendChild(row);
    });
  }

  const disabled = !canManageAssignments();
  Array.from(document.querySelectorAll('.manager-property-checkbox, .manager-listing-checkbox')).forEach((checkbox) => {
    checkbox.disabled = disabled;
  });
}

function renderStripeConnectStatus(status) {
  const button = document.getElementById('startStripeConnectBtn');
  const connected = Boolean(status && status.onboardingComplete && status.chargesEnabled && status.payoutsEnabled);
  const accountId = status && status.stripeAccountId ? String(status.stripeAccountId) : '';

  if (connected) {
    setStripeConnectStatus('Stripe account connected and ready to receive payments.' + (accountId ? (' (' + accountId + ')') : ''), false);
    if (button) {
      button.textContent = 'Manage Stripe Account';
    }
    return;
  }

  if (accountId) {
    setStripeConnectStatus('Stripe account linked but onboarding is incomplete. Complete setup to enable online payments.', false);
    if (button) {
      button.textContent = 'Complete Stripe Setup';
    }
    return;
  }

  setStripeConnectStatus('No Stripe account connected yet. Connect one to accept online payments.', false);
  if (button) {
    button.textContent = 'Connect Stripe Account';
  }
}

async function fetchStripeConnectStatus() {
  const response = await fetch('/api/stripe/connect/status');

  if (response.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load Stripe Connect status.');
  }

  renderStripeConnectStatus(data.stripeConnect || null);
}

async function fetchAccessContext() {
  const response = await fetch('/api/access/context');
  if (response.status === 401) {
    window.location.href = '/';
    return;
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load access context.');
  }
  renderAccessContext(data);
}

function getDashboardContextStorageKey() {
  return 'dashboardContextMode';
}

function getDashboardContextPersistentStorageKey() {
  const identity = currentUserEmail || 'anonymous';
  return 'dashboardContextMode:v1:' + identity;
}

function hasDashboardContextSwitchAvailable() {
  return dashboardContextAvailability.hosting === true && dashboardContextAvailability.guest === true;
}

function updateDashboardContextAvailabilityFromMemberships() {
  const memberships = currentAccessContext && Array.isArray(currentAccessContext.memberships)
    ? currentAccessContext.memberships
    : [];

  const hasGuest = memberships.some((membership) => String(membership && membership.role || '').trim() === 'Guest');
  const hasHosting = memberships.some((membership) => {
    const role = String(membership && membership.role || '').trim();
    return role === 'Client' || role === 'Manager' || role === 'Staff';
  });

  dashboardContextAvailability = {
    hosting: hasHosting || !hasGuest,
    guest: hasGuest
  };

  renderDashboardContextToggle();
}

function normalizeDashboardContextMode(mode) {
  const next = String(mode || '').trim().toLowerCase();
  if (next === 'guest' && dashboardContextAvailability.guest) {
    return 'guest';
  }
  if (next === 'hosting' && dashboardContextAvailability.hosting) {
    return 'hosting';
  }
  if (dashboardContextAvailability.hosting) {
    return 'hosting';
  }
  if (dashboardContextAvailability.guest) {
    return 'guest';
  }
  return 'hosting';
}

function getAllowedPanelsForContext(mode) {
  return mode === 'guest'
    ? ['panel-guest-reservations', 'panel-guest-account']
    : ['panel-dashboard', 'panel-config', 'panel-ops', 'panel-account'];
}

function getDefaultPanelForContext(mode) {
  return mode === 'guest' ? 'panel-guest-reservations' : 'panel-dashboard';
}

function setTabButtonState(button, label, panelId, isHidden) {
  if (!button) {
    return;
  }
  button.textContent = label;
  button.dataset.panel = panelId;
  button.setAttribute('aria-controls', panelId);
  button.classList.toggle('hidden', Boolean(isHidden));
}

function applyTabDefinitionsForContext(mode) {
  const primary = document.getElementById('tabBtnPrimary');
  const secondary = document.getElementById('tabBtnSecondary');
  const tertiary = document.getElementById('tabBtnTertiary');
  const quaternary = document.getElementById('tabBtnQuaternary');

  if (mode === 'guest') {
    setTabButtonState(primary, 'Reservations', 'panel-guest-reservations', false);
    setTabButtonState(secondary, 'Personal Account', 'panel-guest-account', false);
    setTabButtonState(tertiary, 'Ops', 'panel-ops', true);
    setTabButtonState(quaternary, 'Host Account', 'panel-account', true);
    return;
  }

  setTabButtonState(primary, 'Dashboard', 'panel-dashboard', false);
  setTabButtonState(secondary, 'Config', 'panel-config', false);
  setTabButtonState(tertiary, 'Ops', 'panel-ops', false);
  setTabButtonState(quaternary, 'Host Account', 'panel-account', false);
}

function getContextToggleIconSvg(mode) {
  if (mode === 'guest') {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 10.5 12 4l8 6.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 9.8V20h11V9.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 20v-5.5h4V20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5.5 18.5c1.2-3.2 3.6-4.8 6.5-4.8s5.3 1.6 6.5 4.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
}

function renderDashboardContextToggle() {
  const toggleBtn = document.getElementById('dashboardContextToggle');
  const iconEl = document.getElementById('dashboardContextToggleIcon');
  const labelEl = document.getElementById('dashboardContextLabel');
  if (!toggleBtn || !iconEl || !labelEl) {
    return;
  }

  const canSwitchModes = hasDashboardContextSwitchAvailable();
  toggleBtn.classList.toggle('hidden', !canSwitchModes);
  toggleBtn.disabled = !canSwitchModes;
  labelEl.textContent = '';
  labelEl.classList.add('hidden');
  if (!canSwitchModes) {
    return;
  }

  iconEl.innerHTML = getContextToggleIconSvg(currentDashboardContextMode);

  if (currentDashboardContextMode === 'guest') {
    toggleBtn.setAttribute('aria-label', 'Switch to hosting context');
    toggleBtn.setAttribute('title', 'Switch to Hosting');
  } else {
    toggleBtn.setAttribute('aria-label', 'Switch to guest context');
    toggleBtn.setAttribute('title', 'Switch to Guest');
  }
}

async function applyDashboardContextMode(mode, options) {
  const settings = Object.assign({ loadData: false }, options || {});
  const normalizedMode = normalizeDashboardContextMode(mode);
  currentDashboardContextMode = normalizedMode;

  applyTabDefinitionsForContext(normalizedMode);
  renderDashboardContextToggle();

  try {
    sessionStorage.setItem(getDashboardContextStorageKey(), normalizedMode);
  } catch {
    // ignore
  }

  try {
    window.localStorage.setItem(getDashboardContextPersistentStorageKey(), normalizedMode);
  } catch {
    // ignore
  }

  saveDashboardState({ contextMode: normalizedMode });

  const activePanelId = dashboardTabController ? dashboardTabController.getActivePanel() : '';
  const allowedPanels = getAllowedPanelsForContext(normalizedMode);
  const targetPanel = allowedPanels.includes(activePanelId)
    ? activePanelId
    : getDefaultPanelForContext(normalizedMode);

  if (dashboardTabController) {
    dashboardTabController.activateTab(targetPanel);
  }

  if (settings.loadData) {
    if (normalizedMode === 'guest') {
      await loadGuestDashboardData();
    } else {
      await loadDashboardData();
      if (targetPanel === 'panel-dashboard') {
        await loadEventLog();
      }
    }
  }
}

async function fetchTeamMembers() {
  if (!canViewTeam()) {
    renderTeamMembers([]);
    return;
  }

  const response = await fetch('/api/access/team');
  if (response.status === 401) {
    window.location.href = '/';
    return;
  }
  if (response.status === 403) {
    renderTeamMembers([]);
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load team memberships.');
  }

  renderTeamMembers(data.team || []);
}

async function inviteTeamMember(payload) {
  const response = await fetch('/api/access/team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (response.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    if (response.status === 409 && data.code === 'EXISTING_USER_CONFIRMATION_REQUIRED') {
      const accepted = window.confirm('Site user already exists, send invitation?');
      if (!accepted) {
        return { cancelled: true };
      }

      const retryResponse = await fetch('/api/access/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          confirmExisting: true
        })
      });

      if (retryResponse.status === 401) {
        window.location.href = '/';
        return;
      }

      const retryData = await retryResponse.json();
      if (!retryResponse.ok) {
        throw new Error(retryData.error || 'Failed to add existing site user to client.');
      }
      return retryData;
    }
    throw new Error(data.error || 'Failed to add team member.');
  }

  return data;
}

async function updateTeamMemberRoles(userId, roles) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Invalid user id.');
  }

  const response = await fetch('/api/access/team/' + encodeURIComponent(id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roles })
  });

  if (response.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to update team member roles.');
  }

  return data;
}

async function deleteTeamMember(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Invalid user id.');
  }

  const response = await fetch('/api/access/team/' + encodeURIComponent(id), {
    method: 'DELETE'
  });

  if (response.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to delete team member.');
  }

  return data;
}

async function fetchTeamMemberDeleteImpact(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('Invalid user id.');
  }

  const response = await fetch('/api/access/team/' + encodeURIComponent(id) + '/delete-impact');
  if (response.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load delete impact.');
  }

  return data;
}

async function fetchManagerAssignments() {
  if (!canViewAssignments()) {
    renderManagerAssignmentSelectors({ managers: [], propertyAssignments: [], listingAssignments: [] });
    return;
  }

  const response = await fetch('/api/access/manager-assignments');
  if (response.status === 401) {
    window.location.href = '/';
    return;
  }
  if (response.status === 403) {
    renderManagerAssignmentSelectors({ managers: [], propertyAssignments: [], listingAssignments: [] });
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load manager assignments.');
  }

  renderManagerAssignmentSelectors(data);
  renderAccessContext(currentAccessContext);
  renderProperties(currentProperties || []);
  renderListings(currentListings || []);
  renderSharedResources(currentSharedResources || []);
}

async function saveManagerAssignments() {
  if (!canManageAssignments()) {
    setMessage('Only Client role can change manager assignments.', true);
    return;
  }

  const managerMembershipId = Number(document.getElementById('managerAssignmentMembership').value);
  if (!Number.isInteger(managerMembershipId) || managerMembershipId <= 0) {
    setMessage('Please select a manager.', true);
    return;
  }

  const propertyIds = Array.from(document.querySelectorAll('.manager-property-checkbox:checked')).map((checkbox) => Number(checkbox.value));
  const listingIds = Array.from(document.querySelectorAll('.manager-listing-checkbox:checked')).map((checkbox) => Number(checkbox.value));

  const response = await fetch('/api/access/manager-assignments/' + encodeURIComponent(managerMembershipId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ propertyIds, listingIds })
  });

  if (response.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to save manager assignments.');
  }

  setMessage('Manager assignments saved.', false);
  await fetchManagerAssignments();
}

async function fetchGuests() {
  if (!canViewGuests()) {
    renderGuests([]);
    return;
  }

  const response = await fetch('/api/access/guests');
  if (response.status === 401) {
    window.location.href = '/';
    return;
  }
  if (response.status === 403) {
    renderGuests([]);
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load guests.');
  }
  renderGuests(data.guests || []);
}

async function fetchReservationEnquiryLandingPages() {
  const containerId = 'configReservationEnquiryLandingPagesList';
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  try {
    const response = await fetch('/api/reservation-enquiry-landing-pages');
    if (response.status === 401) {
      window.location.href = '/';
      return;
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to load reservation enquiry landing pages.');
    }

    const rows = Array.isArray(data.landingPages) ? data.landingPages : [];
    renderReservationEnquiryLandingPageRows(containerId, rows);
  } catch (err) {
    renderReservationEnquiryLandingPageRows(containerId, []);
    setMessage(err.message || 'Failed to load reservation enquiry landing pages.', true);
  }
}

async function fetchFacilityEnquiryLandingPages() {
  const containerId = 'configFacilityEnquiryLandingPagesList';
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  try {
    const response = await fetch('/api/facility-enquiry-landing-pages');
    if (response.status === 401) {
      window.location.href = '/';
      return;
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to load facility enquiry landing pages.');
    }

    const rows = Array.isArray(data.landingPages) ? data.landingPages : [];
    renderFacilityEnquiryLandingPageRows(containerId, rows);
  } catch (err) {
    renderFacilityEnquiryLandingPageRows(containerId, []);
    setMessage(err.message || 'Failed to load facility enquiry landing pages.', true);
  }
}

function sortListingsByProperty(listings) {
  return (listings || []).slice().sort((a, b) => {
    const pa = (a.property_name || '').toLowerCase();
    const pb = (b.property_name || '').toLowerCase();
    if (pa !== pb) return pa < pb ? -1 : 1;
    const na = (a.name || '').toLowerCase();
    const nb = (b.name || '').toLowerCase();
    return na < nb ? -1 : na > nb ? 1 : 0;
  });
}

function renderListings(listings) {
  const sorted = sortListingsByProperty(listings);
  const tbody = document.getElementById('listingsTableBody');
  if (tbody) {
    tbody.innerHTML = '';
  }

  renderConfigRows(
    'configListingsList',
    (sorted || []).map((listing) => ({
      name: listing.name || ('Listing #' + listing.id),
      href: '/listing.html?id=' + encodeURIComponent(listing.id)
    })),
    'No listings yet.'
  );

  if (!tbody) {
    return;
  }

  if (!sorted.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'No listings yet.';
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  sorted.forEach((listing) => {
    const row = document.createElement('tr');

    const scopeState = getCurrentManagerScopeState();
    let scopeLabel = '';
    if (scopeState.hasAssignments) {
      if (scopeState.listingIdSet.has(Number(listing.id))) {
        scopeLabel = 'Direct listing assignment';
      } else if (scopeState.propertyIdSet.has(Number(listing.property_id))) {
        scopeLabel = 'Property-based assignment';
      }
    }

    const nameCell = document.createElement('td');
    nameCell.textContent = listing.name;
    if (scopeLabel) {
      nameCell.appendChild(document.createTextNode(' '));
      nameCell.appendChild(createScopeBadge(scopeLabel));
    }

    const propertyCell = document.createElement('td');
    propertyCell.textContent = listing.property_name || 'default';

    const actionCell = document.createElement('td');
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'btn secondary config-edit-btn';
    openBtn.textContent = '✎';
    openBtn.title = 'View/Edit';
    openBtn.setAttribute('aria-label', 'View/Edit');
    openBtn.addEventListener('click', () => {
      window.location.href = '/listing.html?id=' + encodeURIComponent(listing.id);
    });

    actionCell.appendChild(openBtn);
    row.appendChild(nameCell);
    row.appendChild(propertyCell);
    row.appendChild(actionCell);
    tbody.appendChild(row);
  });
}

function renderProperties(properties) {
  currentProperties = properties || [];

  const tbody = document.getElementById('propertiesTableBody');
  if (tbody) {
    tbody.innerHTML = '';
  }

  renderConfigRows(
    'configPropertiesList',
    currentProperties.map((property) => ({
      name: property.name || ('Property #' + property.id),
      href: '/property.html?id=' + encodeURIComponent(property.id)
    })),
    'No properties yet.'
  );

  if (tbody && !currentProperties.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'No properties yet.';
    row.appendChild(cell);
    tbody.appendChild(row);
  } else if (tbody) {
    currentProperties.forEach((property) => {
      const row = document.createElement('tr');

      const scopeState = getCurrentManagerScopeState();
      const scopeLabel = scopeState.hasAssignments && scopeState.propertyIdSet.has(Number(property.id))
        ? 'Direct property assignment'
        : '';

      const nameCell = document.createElement('td');
      nameCell.textContent = property.name;
      if (scopeLabel) {
        nameCell.appendChild(document.createTextNode(' '));
        nameCell.appendChild(createScopeBadge(scopeLabel));
      }

      const managerCell = document.createElement('td');
      managerCell.textContent = property.manager_name || property.manager_email || 'Not set';

      const actionCell = document.createElement('td');
      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'btn secondary config-edit-btn';
      openBtn.textContent = '✎';
      openBtn.title = 'View/Edit';
      openBtn.setAttribute('aria-label', 'View/Edit');
      openBtn.addEventListener('click', () => {
        window.location.href = '/property.html?id=' + encodeURIComponent(property.id);
      });

      actionCell.appendChild(openBtn);
      row.appendChild(nameCell);
      row.appendChild(managerCell);
      row.appendChild(actionCell);
      tbody.appendChild(row);
    });
  }

  const select = document.getElementById('listingPropertyId');
  if (select) {
    select.innerHTML = '';
    currentProperties.forEach((property) => {
      const option = document.createElement('option');
      option.value = String(property.id);
      option.textContent = property.name;
      select.appendChild(option);
    });
  }
}

function resetCleanerForm() {
  if (!document.getElementById('cleanerId')) {
    return;
  }
  document.getElementById('cleanerId').value = '';
  document.getElementById('cleanerFirstName').value = '';
  document.getElementById('cleanerLastName').value = '';
  document.getElementById('cleanerEmail').value = '';
  document.getElementById('cleanerTelephone').value = '';
  document.getElementById('cleanerPassword').value = '';
  document.getElementById('cleanerPassword').required = true;
  document.getElementById('cleanerPassword').placeholder = '';
  document.getElementById('cleanerFormTitle').textContent = 'Add Changeover Staff';
  document.getElementById('saveCleanerBtn').textContent = 'Add Changeover Staff';
  document.getElementById('cancelCleanerEditBtn').classList.add('hidden');
}

function startCleanerEdit(cleanerId) {
  if (!document.getElementById('cleanerId')) {
    return;
  }
  const cleaner = currentCleaners.find((item) => Number(item.id) === Number(cleanerId));
  if (!cleaner) {
    setMessage('Changeover staff entry not found.', true);
    return;
  }

  document.getElementById('cleanerId').value = String(cleaner.id);
  document.getElementById('cleanerFirstName').value = cleaner.first_name || '';
  document.getElementById('cleanerLastName').value = cleaner.last_name || '';
  document.getElementById('cleanerEmail').value = cleaner.email || '';
  document.getElementById('cleanerTelephone').value = cleaner.telephone || '';
  document.getElementById('cleanerPassword').value = '';
  document.getElementById('cleanerPassword').required = false;
  document.getElementById('cleanerPassword').placeholder = 'Leave blank to keep current password';
  document.getElementById('cleanerFormTitle').textContent = 'Edit Changeover Staff';
  document.getElementById('saveCleanerBtn').textContent = 'Save Changeover Staff';
  document.getElementById('cancelCleanerEditBtn').classList.remove('hidden');
}

function renderCleaners(cleaners) {
  currentCleaners = cleaners || [];

  const tbody = document.getElementById('cleanersTableBody');
  if (!tbody) {
    return;
  }
  tbody.innerHTML = '';

  if (!currentCleaners.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = 'No changeover staff configured yet.';
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  currentCleaners.forEach((cleaner) => {
    const row = document.createElement('tr');

    const firstNameCell = document.createElement('td');
    firstNameCell.textContent = cleaner.first_name || '';

    const lastNameCell = document.createElement('td');
    lastNameCell.textContent = cleaner.last_name || '';

    const actionCell = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn secondary config-edit-btn';
    editBtn.textContent = '✎';
    editBtn.title = 'View Details/Edit';
    editBtn.setAttribute('aria-label', 'View Details/Edit');
    editBtn.addEventListener('click', () => {
      startCleanerEdit(cleaner.id);
    });

    actionCell.appendChild(editBtn);

    row.appendChild(firstNameCell);
    row.appendChild(lastNameCell);
    row.appendChild(actionCell);

    tbody.appendChild(row);
  });
}

function renderSharedResources(resources) {
  currentSharedResources = resources || [];
  const propertyNameById = new Map((currentProperties || []).map((property) => [Number(property.id), property.name || '']));
  const listingNameById = new Map((currentListings || []).map((listing) => [Number(listing.id), listing.name || '']));

  const tbody = document.getElementById('sharedResourcesTableBody');
  if (!tbody) {
    renderConfigRows(
      'configFacilitiesList',
      currentSharedResources.map((resource) => ({
        name: resource.short_description || ('Facility #' + resource.id),
        href: '/shared-resource.html?id=' + encodeURIComponent(resource.id)
      })),
      'No facilities yet.'
    );
    return;
  }
  tbody.innerHTML = '';

  renderConfigRows(
    'configFacilitiesList',
    currentSharedResources.map((resource) => ({
      name: resource.short_description || ('Facility #' + resource.id),
      href: '/shared-resource.html?id=' + encodeURIComponent(resource.id)
    })),
    'No facilities yet.'
  );

  if (!currentSharedResources.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 4;
    cell.textContent = 'No shared resources yet.';
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  currentSharedResources.forEach((resource) => {
    const row = document.createElement('tr');

    const scopeState = getCurrentManagerScopeState();
    let scopeLabel = '';
    if (scopeState.hasAssignments) {
      if (scopeState.listingIdSet.has(Number(resource.listing_id))) {
        scopeLabel = 'Listing-assigned scope';
      } else if (scopeState.propertyIdSet.has(Number(resource.property_id))) {
        scopeLabel = 'Property-assigned scope';
      }
    }

    const shortCell = document.createElement('td');
    shortCell.textContent = resource.short_description || '';
    if (scopeLabel) {
      shortCell.appendChild(document.createTextNode(' '));
      shortCell.appendChild(createScopeBadge(scopeLabel));
    }

    const propertyCell = document.createElement('td');
    const propertyId = Number(resource.property_id || 0);
    propertyCell.textContent = propertyId > 0 ? (propertyNameById.get(propertyId) || 'Unknown property') : 'All Properties';

    const listingCell = document.createElement('td');
    const listingId = Number(resource.listing_id || 0);
    listingCell.textContent = listingId > 0 ? (listingNameById.get(listingId) || 'Unknown listing') : 'All Listings';

    const actionCell = document.createElement('td');
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn secondary config-edit-btn';
    editBtn.textContent = '✎';
    editBtn.title = 'View/Edit';
    editBtn.setAttribute('aria-label', 'View/Edit');
    editBtn.addEventListener('click', () => {
      window.location.href = '/shared-resource.html?id=' + encodeURIComponent(resource.id);
    });
    actionCell.appendChild(editBtn);

    row.appendChild(shortCell);
    row.appendChild(propertyCell);
    row.appendChild(listingCell);
    row.appendChild(actionCell);
    tbody.appendChild(row);
  });
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function keyFromUtcDate(date) {
  return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
}

function utcDateFromKey(key) {
  const parts = key.split('-').map((v) => Number(v));
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function addUtcDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function toDateKey(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return keyFromUtcDate(d);
}

function formatMonthLabel(date) {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return monthNames[date.getUTCMonth()] + ' ' + date.getUTCFullYear();
}

function setDashboardActivityStatus(text) {
  const el = document.getElementById('dashboardActivityStatus');
  if (!el) {
    return;
  }
  el.textContent = String(text || '').trim();
}

function setDashboardEmptyNightsStatus(text) {
  const el = document.getElementById('dashboardEmptyNightsStatus');
  if (!el) {
    return;
  }
  el.textContent = String(text || '').trim();
}

function getDashboardActivityOutlookDays() {
  const value = Number(currentDashboardSettings && currentDashboardSettings.activityOutlookDays);
  return Number.isInteger(value) && value >= 1 ? value : 7;
}

function getDashboardHighlightEmptyNightsDays() {
  const value = Number(currentDashboardSettings && currentDashboardSettings.highlightEmptyNightsDays);
  return Number.isInteger(value) && value >= 1 ? value : 7;
}

function applyDashboardSettings(settings) {
  const activityOutlookDays = Number(settings && settings.activityOutlookDays);
  const highlightEmptyNightsDays = Number(settings && settings.highlightEmptyNightsDays);

  currentDashboardSettings = {
    activityOutlookDays: Number.isInteger(activityOutlookDays) && activityOutlookDays >= 1 ? activityOutlookDays : 7,
    highlightEmptyNightsDays: Number.isInteger(highlightEmptyNightsDays) && highlightEmptyNightsDays >= 1 ? highlightEmptyNightsDays : 7
  };

  const activityInput = document.getElementById('dashboardActivityOutlookDays');
  const emptyNightsInput = document.getElementById('dashboardHighlightEmptyNightsDays');
  if (activityInput) {
    activityInput.value = String(currentDashboardSettings.activityOutlookDays);
  }
  if (emptyNightsInput) {
    emptyNightsInput.value = String(currentDashboardSettings.highlightEmptyNightsDays);
  }
}

function formatActivityDayHeader(dayKey) {
  const date = utcDateFromKey(dayKey);
  return WEEKDAY_NAMES[date.getUTCDay()] + ' ' + date.getUTCDate() + ' ' + MONTH_SHORT_NAMES[date.getUTCMonth()];
}

function getActivityGuestName(event) {
  const explicit = String(
    event && (
      event.guestName
      || event.guest_name
      || event.guest
      || event.reservationGuestName
      || event.reservation_guest_name
      || ''
    )
  ).trim();
  if (explicit) {
    return explicit;
  }

  const description = String(event && event.description ? event.description : '');
  if (description) {
    const guestMatch = description.match(/guest\s*:\s*([^\n\r]+)/i);
    if (guestMatch && guestMatch[1]) {
      return String(guestMatch[1]).trim();
    }
  }

  return '';
}

function getActivityFeedSource(event, listingName) {
  const sourceKey = opsCalendarSourceKey(event && event.source);
  const reservationActivityId = Number(event && event.reservationActivityId || 0);
  if (
    (Number.isInteger(reservationActivityId) && reservationActivityId > 0)
    || sourceKey === 'direct booking'
    || sourceKey === 'automaticpeople'
  ) {
    return 'Private';
  }

  const metadata = parseApMetadataFromDescription(event && event.description);
  return deriveOpsEventSource(event, metadata, listingName) || 'Unknown';
}

function renderDashboardActivityRows(dayKeys, activityByDay) {
  const container = document.getElementById('dashboardActivityRows');
  if (!container) {
    return;
  }

  container.innerHTML = '';

  dayKeys.forEach((dayKey) => {
    const dayRow = document.createElement('div');
    dayRow.className = 'activity-day-row';

    const dayHeader = document.createElement('div');
    dayHeader.className = 'activity-day-header';
    dayHeader.textContent = formatActivityDayHeader(dayKey);
    dayRow.appendChild(dayHeader);

    const entries = activityByDay.get(dayKey) || [];
    if (!entries.length) {
      const emptyRow = document.createElement('div');
      emptyRow.className = 'activity-empty-row';
      emptyRow.textContent = 'No activity';
      dayRow.appendChild(emptyRow);
    }
    entries.forEach((entry) => {
      const itemRow = document.createElement('div');
      itemRow.className = 'activity-item-row';

      const title = document.createElement('div');
      title.className = 'activity-item-title';
      title.textContent = entry.type;

      const details = document.createElement('div');
      details.className = 'activity-item-details';

      const parts = [
        entry.propertyName || 'Unknown property',
        entry.listingName || 'Unknown listing'
      ];
      if (entry.changeoverName) {
        parts.push('ch: ' + entry.changeoverName);
      }
      if (entry.guestName) {
        parts.push('Guest: ' + entry.guestName);
      }
      if (entry.type === 'Check-in' && entry.feedSource) {
        parts.push('Source: ' + entry.feedSource);
      }

      parts.forEach((part) => {
        const chip = document.createElement('span');
        chip.className = 'activity-item-chip';
        chip.textContent = part;
        details.appendChild(chip);
      });

      itemRow.appendChild(title);
      itemRow.appendChild(details);
      dayRow.appendChild(itemRow);
    });

    container.appendChild(dayRow);
  });
}

function renderDashboardEmptyNights(dayKeys, emptyListingsByDay) {
  const container = document.getElementById('dashboardEmptyNightsContent');
  if (!container) {
    return;
  }

  container.innerHTML = '';

  const rows = dayKeys
    .map((dayKey) => ({ dayKey, listings: emptyListingsByDay.get(dayKey) || [] }))
    .filter((row) => row.listings.length);

  const listingColumns = Array.from(
    rows.reduce((set, row) => {
      (row.listings || []).forEach((listingName) => {
        const name = String(listingName || '').trim();
        if (name) {
          set.add(name);
        }
      });
      return set;
    }, new Set())
  ).sort((a, b) => a.localeCompare(b));

  if (!rows.length || !listingColumns.length) {
    const empty = document.createElement('p');
    empty.className = 'cleaning-empty';
    empty.textContent = 'No empty nights in the selected outlook period.';
    container.appendChild(empty);
    return;
  }

  const tableWrap = document.createElement('div');
  tableWrap.className = 'table-wrap';

  const table = document.createElement('table');
  table.className = 'calendar-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['Date'].concat(listingColumns).forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((row, index) => {
    if (index > 0) {
      const previousDayKey = rows[index - 1].dayKey;
      const currentDayKey = row.dayKey;
      const previousDate = utcDateFromKey(previousDayKey);
      const currentDate = utcDateFromKey(currentDayKey);
      const dayDelta = Math.round((currentDate.getTime() - previousDate.getTime()) / 86400000);
      if (dayDelta > 1) {
        const gapRow = document.createElement('tr');
        gapRow.className = 'empty-nights-gap-row';

        const gapCell = document.createElement('td');
        gapCell.colSpan = listingColumns.length + 1;
        gapRow.appendChild(gapCell);
        tbody.appendChild(gapRow);
      }
    }

    const tr = document.createElement('tr');

    const dateCell = document.createElement('td');
    dateCell.textContent = formatActivityDayHeader(row.dayKey);
    tr.appendChild(dateCell);

    const rowListingSet = new Set((row.listings || []).map((name) => String(name || '').trim()).filter(Boolean));
    listingColumns.forEach((listingName) => {
      const listingCell = document.createElement('td');
      listingCell.textContent = rowListingSet.has(listingName) ? listingName : '';
      tr.appendChild(listingCell);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  tableWrap.appendChild(table);
  container.appendChild(tableWrap);
}

async function refreshDashboardActivity() {
  const container = document.getElementById('dashboardActivityRows');
  const emptyNightsContainer = document.getElementById('dashboardEmptyNightsContent');
  if (!container || !emptyNightsContainer) {
    return;
  }

  const requestId = ++dashboardActivityRequestId;
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayKeys = [];
  for (let i = 0; i < getDashboardActivityOutlookDays(); i += 1) {
    dayKeys.push(keyFromUtcDate(addUtcDays(todayUtc, i)));
  }
  const emptyNightKeys = [];
  for (let i = 0; i < getDashboardHighlightEmptyNightsDays(); i += 1) {
    emptyNightKeys.push(keyFromUtcDate(addUtcDays(todayUtc, i)));
  }

  const listings = Array.isArray(currentListings) ? currentListings.filter((listing) => Number(listing.id) > 0) : [];
  if (!listings.length) {
    setDashboardActivityStatus('');
    setDashboardEmptyNightsStatus('');
    renderDashboardActivityRows(dayKeys, new Map(dayKeys.map((key) => [key, []])));
    renderDashboardEmptyNights(emptyNightKeys, new Map(emptyNightKeys.map((key) => [key, []])));
    return;
  }

  setDashboardActivityStatus('Loading activity...');
  setDashboardEmptyNightsStatus('Loading empty nights...');

  const results = await Promise.all(listings.map(async (listing) => {
    try {
      const data = await fetchOpsCalendarListingData(listing, false);
      return { listing, data };
    } catch (err) {
      return { listing, error: err };
    }
  }));

  if (requestId !== dashboardActivityRequestId) {
    return;
  }

  const events = [];
  const cleaningChanges = [];
  const issues = [];

  results.forEach((result) => {
    if (result.error) {
      issues.push((result.listing.name || ('Listing #' + result.listing.id)) + ': ' + (result.error.message || 'Failed to load activity.'));
      return;
    }

    const data = result.data || {};
    const listingMeta = getListingMetaById(result.listing.id) || {};
    const listingName = result.listing.name || listingMeta.name || ('Listing #' + result.listing.id);
    const propertyName = listingMeta.property_name || '';

    events.push(...(data.events || []).map((event) => Object.assign({}, event, {
      listingId: result.listing.id,
      listingName,
      listingPropertyName: propertyName
    })));

    cleaningChanges.push(...(data.cleaningChanges || []).map((change) => Object.assign({}, change, {
      listingId: result.listing.id,
      listingName,
      reservation_checkin_date: toDateKey(change.reservation_checkin_date),
      reservation_checkout_date: toDateKey(change.reservation_checkout_date),
      changeover_date: toDateKey(change.changeover_date)
    })));
  });

  const normalizedChanges = cleaningChanges.concat(buildOpsDefaultCleaningChanges(events, cleaningChanges));
  const cleanerByReservationKey = new Map();
  normalizedChanges.forEach((change) => {
    const listingId = Number(change.listingId || change.listing_id || 0);
    const checkinKey = toDateKey(change.reservation_checkin_date);
    const checkoutKey = toDateKey(change.reservation_checkout_date);
    if (!Number.isInteger(listingId) || listingId <= 0 || !checkinKey || !checkoutKey) {
      return;
    }

    let cleanerName = resolveCleanerNameFromChange(change, currentCleaners);
    if (!cleanerName || cleanerName === 'Unallocated') {
      cleanerName = String(change.default_cleaner_name || '').trim();
    }
    if (!cleanerName || cleanerName === 'Unallocated') {
      return;
    }

    const key = reservationChangeKey(listingId, checkinKey, checkoutKey);
    if (!cleanerByReservationKey.has(key)) {
      cleanerByReservationKey.set(key, cleanerName);
    }
  });

  const dayKeySet = new Set(dayKeys);
  const activityByDay = new Map(dayKeys.map((key) => [key, []]));
  const emptyNightKeySet = new Set(emptyNightKeys);
  const occupiedListingsByNight = new Map(emptyNightKeys.map((key) => [key, new Set()]));
  (events || []).forEach((event) => {
    if (event && event.isReservation === false) {
      return;
    }

    const listingId = Number(event && (event.listingId || event.listing_id || 0));
    const listingMeta = getListingMetaById(listingId) || {};
    const listingName = String(event && event.listingName ? event.listingName : listingMeta.name || ('Listing #' + listingId)).trim();
    const propertyName = String(event && event.listingPropertyName ? event.listingPropertyName : listingMeta.property_name || '').trim() || 'Unknown property';
    const checkinKey = toDateKey(event && event.start);
    const checkoutKey = toDateKey(event && event.end);
    const guestName = getActivityGuestName(event);
    const feedSource = getActivityFeedSource(event, listingName);
    const dateBasis = listingMeta.date_basis === 'checkin' ? 'checkin' : 'checkout';
    const reservationKeyValue = reservationChangeKey(listingId, checkinKey, checkoutKey);
    const changeoverName = cleanerByReservationKey.get(reservationKeyValue) || '';

    if (checkinKey && dayKeySet.has(checkinKey)) {
      activityByDay.get(checkinKey).push({
        type: 'Check-in',
        propertyName,
        listingName,
        changeoverName: dateBasis === 'checkin' ? changeoverName : '',
        guestName,
        feedSource
      });
    }

    if (checkoutKey && dayKeySet.has(checkoutKey)) {
      activityByDay.get(checkoutKey).push({
        type: 'Check-out',
        propertyName,
        listingName,
        changeoverName: dateBasis === 'checkout' ? changeoverName : '',
        guestName
      });
    }

    if (checkinKey && checkoutKey && Number.isInteger(listingId) && listingId > 0) {
      const startDate = utcDateFromKey(checkinKey);
      const endDate = utcDateFromKey(checkoutKey);
      for (let cursor = new Date(startDate.getTime()); cursor < endDate; cursor = addUtcDays(cursor, 1)) {
        const nightKey = keyFromUtcDate(cursor);
        if (emptyNightKeySet.has(nightKey) && occupiedListingsByNight.has(nightKey)) {
          occupiedListingsByNight.get(nightKey).add(listingId);
        }
      }
    }
  });

  dayKeys.forEach((dayKey) => {
    const entries = activityByDay.get(dayKey) || [];
    entries.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'Check-out' ? -1 : 1;
      }
      const propertySort = String(a.propertyName || '').localeCompare(String(b.propertyName || ''));
      if (propertySort !== 0) {
        return propertySort;
      }
      return String(a.listingName || '').localeCompare(String(b.listingName || ''));
    });
  });

  const emptyListingsByDay = new Map();
  emptyNightKeys.forEach((dayKey) => {
    const occupiedSet = occupiedListingsByNight.get(dayKey) || new Set();
    const emptyListings = listings
      .filter((listing) => !occupiedSet.has(Number(listing.id)))
      .map((listing) => String(listing.name || ('Listing #' + listing.id)).trim())
      .sort((a, b) => a.localeCompare(b));
    emptyListingsByDay.set(dayKey, emptyListings);
  });

  renderDashboardActivityRows(dayKeys, activityByDay);
  renderDashboardEmptyNights(emptyNightKeys, emptyListingsByDay);
  if (issues.length) {
    setDashboardActivityStatus('Loaded with some feed issues.');
    setDashboardEmptyNightsStatus('Loaded with some feed issues.');
  } else {
    setDashboardActivityStatus('');
    setDashboardEmptyNightsStatus('');
  }
}

function renderCleaningListings(listings) {
  const sorted = sortListingsByProperty(listings);
  const container = document.getElementById('cleaningListings');
  container.innerHTML = '';
  const savedListingIds = getSavedListingIdSet('scheduleListingIds');

  if (!sorted.length) {
    const text = document.createElement('p');
    text.className = 'cleaning-empty';
    text.textContent = 'No listings available.';
    container.appendChild(text);
    return;
  }

  sorted.forEach((listing) => {
    const row = document.createElement('label');
    row.className = 'cleaning-listing-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'cleaning-listing-checkbox';
    checkbox.value = String(listing.id);
    checkbox.setAttribute('data-listing-name', listing.name);
    checkbox.setAttribute('data-property-name', listing.property_name || '');
    checkbox.setAttribute('data-date-basis', listing.date_basis === 'checkin' ? 'checkin' : 'checkout');
    checkbox.setAttribute('data-usual-cleaner-id', listing.usual_cleaner_id ? String(listing.usual_cleaner_id) : '');
    if (savedListingIds) {
      checkbox.checked = savedListingIds.has(String(listing.id));
    }

    const name = document.createElement('span');
    name.className = 'cleaning-listing-name';
    name.textContent = listing.name;

    row.appendChild(checkbox);
    row.appendChild(name);
    container.appendChild(row);
  });

  Array.from(container.querySelectorAll('.cleaning-listing-checkbox')).forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      saveDashboardState({
        scheduleListingIds: Array.from(container.querySelectorAll('.cleaning-listing-checkbox:checked')).map((box) => String(box.value))
      });
    });
  });
}

function getSelectedCleaningListings() {
  const checked = Array.from(document.querySelectorAll('.cleaning-listing-checkbox:checked'));
  return checked.map((box) => ({
    id: Number(box.value),
    name: box.getAttribute('data-listing-name') || 'Listing',
    propertyName: box.getAttribute('data-property-name') || '',
    dateBasis: box.getAttribute('data-date-basis') === 'checkin' ? 'checkin' : 'checkout',
    usualCleanerId: box.getAttribute('data-usual-cleaner-id') ? Number(box.getAttribute('data-usual-cleaner-id')) : null
  }));
}

function formatCleaningScheduleLine(dayKey, listingNames) {
  const date = utcDateFromKey(dayKey);
  const weekday = WEEKDAY_NAMES[date.getUTCDay()];
  const day = date.getUTCDate();
  const month = MONTH_SHORT_NAMES[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const text = listingNames.length ? listingNames.join(', ') : 'No checkouts';
  return weekday + ' ' + day + ' ' + month + ' ' + year + ': ' + text;
}

function formatPreparationScheduleLine(dayKey, listingNames) {
  const date = utcDateFromKey(dayKey);
  const weekday = WEEKDAY_NAMES[date.getUTCDay()];
  const day = date.getUTCDate();
  const month = MONTH_SHORT_NAMES[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const text = listingNames.length ? listingNames.join(', ') : 'No checkins';
  return weekday + ' ' + day + ' ' + month + ' ' + year + ': ' + text;
}

function csvEscape(value) {
  const text = String(value || '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

function rowsToCsv(rows) {
  const header = 'Checkin Date,Checkout Date,Change Date,Property,Listing,Cleaner';
  const body = rows.map((row) => {
    return [
      csvEscape(row.checkinDate || ''),
      csvEscape(row.checkoutDate || ''),
      csvEscape(row.changeDate || row.date || ''),
      csvEscape(row.property),
      csvEscape(row.listing),
      csvEscape(row.cleanerName || 'Unallocated')
    ].join(',');
  });
  return [header].concat(body).join('\n');
}

function preparationRowsToCsv(rows) {
  const header = 'Date,Checkout Date,Property,Listing';
  const body = rows.map((row) => {
    return [
      csvEscape(row.date),
      csvEscape(row.checkoutDate || ''),
      csvEscape(row.property),
      csvEscape(row.listing)
    ].join(',');
  });
  return [header].concat(body).join('\n');
}

function rowsToText(rows, lineFormatter) {
  const headers = [];

  const properties = Array.from(new Set(rows.map((row) => String(row.property || '').trim()).filter(Boolean)));
  const singleProperty = properties.length === 1;
  if (singleProperty) {
    headers.push(properties[0]);
  }

  const cleaners = Array.from(new Set(rows.map((row) => String(row.cleanerName || 'Unallocated').trim()).filter(Boolean)));
  const singleCleaner = cleaners.length === 1;
  if (singleCleaner) {
    headers.push(cleaners[0]);
  }

  const grouped = {};
  rows.forEach((row) => {
    const changeDateKey = row.changeDate || row.date;
    if (!grouped[changeDateKey]) {
      grouped[changeDateKey] = [];
    }
    const propertyPrefix = singleProperty ? '' : (row.property ? row.property + ' - ' : '');
    const cleanerSuffix = singleCleaner ? '' : ' [' + (row.cleanerName || 'Unallocated') + ']';
    grouped[changeDateKey].push(propertyPrefix + row.listing + cleanerSuffix);
  });

  const body = Object.keys(grouped)
    .sort()
    .map((dateKey) => lineFormatter(dateKey, grouped[dateKey].sort((a, b) => a.localeCompare(b))))
    .join('\n');

  return headers.length ? headers.join('\n') + '\n' + body : body;
}

function downloadTextFile(fileName, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function toDateInputValue(date) {
  return date.getUTCFullYear() + '-' + pad2(date.getUTCMonth() + 1) + '-' + pad2(date.getUTCDate());
}

function getSelectedStartDateUtc() {
  const raw = document.getElementById('cleaningStartDate').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return utcDateFromKey(raw);
}

function reservationKey(listingId, checkinDate, checkoutDate) {
  return String(listingId) + '|' + String(checkinDate || '') + '|' + String(checkoutDate || '');
}

function renderNotificationLog(lines) {
  const container = document.getElementById('notificationLog');
  if (!container) return;

  container.innerHTML = '';

  if (!lines.length) {
    const empty = document.createElement('p');
    empty.className = 'cleaning-empty';
    empty.textContent = 'No notifications.';
    container.appendChild(empty);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'notification-list';
  lines.forEach((line) => {
    const item = document.createElement('li');
    item.textContent = line;
    list.appendChild(item);
  });
  container.appendChild(list);
}

async function deleteBookedInChanges(changes) {
  const rows = Array.isArray(changes) ? changes : [];
  if (!rows.length) {
    return { deleted: 0 };
  }

  const res = await fetch('/api/booked-in-changes/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ changes: rows })
  });

  if (res.status === 401) {
    window.location.href = '/';
    return { deleted: 0 };
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to delete stale booked-in changes.');
  }

  return { deleted: Number(data.deleted || 0) };
}

async function buildSchedule(selectedListings, days, startDateUtc) {
  const rangeKeySet = new Set();
  for (let i = 0; i < days; i += 1) {
    rangeKeySet.add(keyFromUtcDate(addUtcDays(startDateUtc, i)));
  }

  const rows = [];
  const errors = [];

  await Promise.all(selectedListings.map(async (listing) => {
    try {
      const res = await fetch('/api/listings/' + encodeURIComponent(listing.id) + '/events');
      if (res.status === 401) {
        window.location.href = '/';
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        errors.push(listing.name + ': ' + (data.error || 'Failed to load events.'));
        return;
      }

      (data.events || []).forEach((event) => {
        if (event && event.isReservation === false) {
          return;
        }

        const checkinKey = toDateKey(event.start);
        const checkoutKey = toDateKey(event.end);
        if (!checkinKey || !checkoutKey) {
          return;
        }

        const basis = listing.dateBasis === 'checkin' ? 'checkin' : 'checkout';
        const basisDate = basis === 'checkin' ? checkinKey : checkoutKey;
        if (!rangeKeySet.has(basisDate)) {
          return;
        }

        const cleanerByUserId = getCleanerByUserIdMap(currentCleaners);
        const usualCleanerId = listing.usualCleanerId || null;
        let defaultCleanerId = null;
        let defaultCleanerName = 'Unallocated';
        const listingCleaner = (currentCleaners || []).find((c) => Number(c.id) === Number(usualCleanerId));
        const defaultCleanerUserId = listingCleaner && listingCleaner.cleaner_user_id
          ? Number(listingCleaner.cleaner_user_id)
          : null;
        if (defaultCleanerUserId && cleanerByUserId.has(defaultCleanerUserId)) {
          const uc = cleanerByUserId.get(defaultCleanerUserId);
          defaultCleanerId = defaultCleanerUserId;
          defaultCleanerName = getCleanerDisplayName(uc);
        }

        rows.push({
          listingId: Number(listing.id),
          property: listing.propertyName || '',
          listing: listing.name || '',
          listingDateBasis: basis,
          checkinDate: checkinKey,
          checkoutDate: checkoutKey,
          date: basisDate,
          reservationKey: reservationKey(listing.id, checkinKey, checkoutKey),
          changeDate: basisDate,
          cleanerId: defaultCleanerId,
          cleanerName: defaultCleanerName
        });
      });
    } catch {
      errors.push(listing.name + ': Network error while loading events.');
    }
  }));

  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.property !== b.property) return a.property.localeCompare(b.property);
    return a.listing.localeCompare(b.listing);
  });

  let bookedChanges = [];
  try {
    const lookupRes = await fetch('/api/booked-in-changes/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingIds: selectedListings.map((listing) => Number(listing.id)) })
    });

    if (lookupRes.status === 401) {
      window.location.href = '/';
      return { rows: [], errors: [], text: '', csv: '', rowCount: 0, notifications: [] };
    }

    const lookupData = await lookupRes.json();
    if (lookupRes.ok) {
      bookedChanges = lookupData.changes || [];
    }
  } catch {
    errors.push('Could not load booked-in changes.');
  }

  const bookedMap = new Map();
  bookedChanges.forEach((row) => {
    const key = reservationKey(row.listing_id, row.reservation_checkin_date, row.reservation_checkout_date);
    bookedMap.set(key, row);
  });
  rows.forEach((row) => {
    const existing = bookedMap.get(row.reservationKey);
    if (!existing) {
      return;
    }
    row.changeDate = existing.changeover_date || row.changeDate;
    row.cleanerName = resolveCleanerNameFromChange(existing, currentCleaners);
    row.cleanerId = existing.cleaner_user_id ? Number(existing.cleaner_user_id) : null;
    if (!row.cleanerId && existing.cleaner_id) {
      const fallbackCleaner = (currentCleaners || []).find((cleaner) => Number(cleaner.id) === Number(existing.cleaner_id));
      row.cleanerId = fallbackCleaner && fallbackCleaner.cleaner_user_id ? Number(fallbackCleaner.cleaner_user_id) : null;
    }
  });

  const reservationKeySet = new Set(rows.map((row) => row.reservationKey));
  const notifications = bookedChanges
    .filter((row) => !reservationKeySet.has(reservationKey(row.listing_id, row.reservation_checkin_date, row.reservation_checkout_date)))
    .map((row) => {
      const listing = selectedListings.find((item) => Number(item.id) === Number(row.listing_id));
      const listingName = listing ? listing.name : ('Listing #' + row.listing_id);
      return listingName + ': booked-in change ' + row.reservation_checkin_date + ' to ' + row.reservation_checkout_date + ' no longer matches a reservation.';
    });

  const staleChanges = bookedChanges
    .filter((row) => !reservationKeySet.has(reservationKey(row.listing_id, row.reservation_checkin_date, row.reservation_checkout_date)))
    .map((row) => ({
      listingId: Number(row.listing_id),
      reservationCheckinDate: row.reservation_checkin_date,
      reservationCheckoutDate: row.reservation_checkout_date
    }));

  return {
    text: rowsToText(rows, formatCleaningScheduleLine),
    csv: rowsToCsv(rows),
    rows,
    rowCount: rows.length,
    errors,
    notifications,
    staleChanges
  };
}

function buildScheduleEditSnapshot(rows) {
  const snapshot = new Map();
  (rows || []).forEach((row) => {
    if (!row || !row.reservationKey) {
      return;
    }
    snapshot.set(row.reservationKey, {
      changeDate: row.changeDate || row.date || '',
      cleanerId: Number.isInteger(Number(row.cleanerId)) && Number(row.cleanerId) > 0
        ? Number(row.cleanerId)
        : null,
      cleanerName: row.cleanerName || ''
    });
  });
  return snapshot;
}

function mergeScheduleRowsWithSnapshot(rows, snapshot) {
  if (!snapshot || !snapshot.size) {
    return rows || [];
  }

  (rows || []).forEach((row) => {
    if (!row || !row.reservationKey) {
      return;
    }

    const saved = snapshot.get(row.reservationKey);
    if (!saved) {
      return;
    }

    row.changeDate = saved.changeDate || row.changeDate || row.date;
    row.cleanerId = Number.isInteger(saved.cleanerId) && saved.cleanerId > 0
      ? saved.cleanerId
      : null;

    if (!row.cleanerId) {
      row.cleanerName = 'Unallocated';
      return;
    }

    if (saved.cleanerName) {
      row.cleanerName = saved.cleanerName;
      return;
    }

    const cleaner = (currentCleaners || []).find((item) => Number(item && item.cleaner_user_id ? item.cleaner_user_id : 0) === row.cleanerId);
    row.cleanerName = cleaner ? getCleanerDisplayName(cleaner) : row.cleanerName;
  });

  return rows;
}

function formatDisplayDate(dateKey) {
  if (!dateKey) return '';
  const utcDate = utcDateFromKey(dateKey);
  const dayName = WEEKDAY_NAMES[utcDate.getUTCDay()].substring(0, 3);
  const day = utcDate.getUTCDate();
  const monthName = MONTH_SHORT_NAMES[utcDate.getUTCMonth()];
  const year = String(utcDate.getUTCFullYear()).slice(-2);
  return dayName + ' ' + day + ' ' + monthName + ' ' + year;
}

function renderSchedulePreviewTable(rows, errors, notifications) {
  const container = document.getElementById('schedulePreviewContent') || document.getElementById('schedulePreview');
  container.innerHTML = '';
  renderNotificationLog(notifications || []);

  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'cleaning-empty';
    empty.textContent = 'No schedule entries for the selected listings and date range.';
    container.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'calendar-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const headers = ['Checkin Date', 'Checkout Date', 'Property', 'Listing'];
  headers.forEach((label) => {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((row, idx) => {
    const dividerRow = document.createElement('tr');
    dividerRow.className = 'schedule-entry-divider';
    const dividerCell = document.createElement('td');
    dividerCell.colSpan = headers.length;
    dividerRow.appendChild(dividerCell);
    tbody.appendChild(dividerRow);

    // Main data row
    const altClass = '';
    const mainRow = document.createElement('tr');
    mainRow.className = 'schedule-main-row' + altClass;

    const dateCell = document.createElement('td');
    dateCell.textContent = formatDisplayDate(row.checkinDate || row.date);
    mainRow.appendChild(dateCell);

    const checkoutCell = document.createElement('td');
    checkoutCell.textContent = formatDisplayDate(row.checkoutDate || row.date);
    mainRow.appendChild(checkoutCell);

    const propertyCell = document.createElement('td');
    propertyCell.textContent = row.property || '';
    mainRow.appendChild(propertyCell);

    const listingCell = document.createElement('td');
    listingCell.textContent = row.listing || '';
    mainRow.appendChild(listingCell);

    tbody.appendChild(mainRow);

    // Sub-row with Change Date and Cleaner
    const subRow = document.createElement('tr');
    subRow.className = 'schedule-sub-row' + altClass;

    const controlsCell = document.createElement('td');
    controlsCell.colSpan = headers.length;
    controlsCell.className = 'schedule-controls-cell';

    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'schedule-controls';

    // Change Date input
    const dateInputDiv = document.createElement('div');
    dateInputDiv.className = 'schedule-control-group';
    const dateLabel = document.createElement('label');
    dateLabel.textContent = 'Change Date:';
    dateLabel.className = 'schedule-control-label';
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.value = row.changeDate || row.date;
    dateInput.className = 'schedule-change-date';
    dateInput.dataset.rowIndex = idx;
    dateInput.addEventListener('change', (event) => {
      const rowIndex = Number(event.target.dataset.rowIndex);
      if (!Number.isInteger(rowIndex) || !currentScheduleRows[rowIndex]) return;
      currentScheduleRows[rowIndex].changeDate = event.target.value || currentScheduleRows[rowIndex].changeDate;
    });
    dateInputDiv.appendChild(dateLabel);
    dateInputDiv.appendChild(dateInput);
    controlsContainer.appendChild(dateInputDiv);

    // Cleaner select
    const cleanerDiv = document.createElement('div');
    cleanerDiv.className = 'schedule-control-group';
    const cleanerLabel = document.createElement('label');
    cleanerLabel.textContent = 'Cleaner:';
    cleanerLabel.className = 'schedule-control-label';
    const cleanerSelect = document.createElement('select');
    cleanerSelect.className = 'schedule-cleaner';
    cleanerSelect.dataset.rowIndex = idx;

    const unallocatedOption = document.createElement('option');
    unallocatedOption.value = '';
    unallocatedOption.textContent = 'Unallocated';
    cleanerSelect.appendChild(unallocatedOption);

    currentCleaners.forEach((cleaner) => {
      const cleanerUserId = Number(cleaner.cleaner_user_id || 0);
      if (!Number.isInteger(cleanerUserId) || cleanerUserId <= 0) {
        return;
      }
      const option = document.createElement('option');
      option.value = String(cleanerUserId);
      option.textContent = getCleanerDisplayName(cleaner);
      cleanerSelect.appendChild(option);
    });
    cleanerSelect.value = row.cleanerId ? String(row.cleanerId) : '';
    cleanerSelect.addEventListener('change', (event) => {
      const rowIndex = Number(event.target.dataset.rowIndex);
      if (!Number.isInteger(rowIndex) || !currentScheduleRows[rowIndex]) return;
      const cleanerId = event.target.value ? Number(event.target.value) : null;
      currentScheduleRows[rowIndex].cleanerId = cleanerId;
      currentScheduleRows[rowIndex].cleanerName = cleanerId
        ? event.target.options[event.target.selectedIndex].textContent
        : 'Unallocated';
    });

    cleanerDiv.appendChild(cleanerLabel);
    cleanerDiv.appendChild(cleanerSelect);
    controlsContainer.appendChild(cleanerDiv);

    controlsCell.appendChild(controlsContainer);
    subRow.appendChild(controlsCell);

    tbody.appendChild(subRow);
  });
  table.appendChild(tbody);
  container.appendChild(table);

  if (errors && errors.length) {
    const warning = document.createElement('p');
    warning.className = 'hint';
    warning.textContent = 'Some listings could not be loaded: ' + errors.join(' | ');
    container.appendChild(warning);
  }
}

function opsCalendarSetMessage(text, isError) {
  const el = document.getElementById('opsCalendarMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function opsCalendarSetFetchedAt(isoString) {
  const el = document.getElementById('opsCalendarFetchedAt');
  if (!el) {
    return;
  }
  if (!isoString) {
    el.textContent = '';
    return;
  }
  const date = new Date(isoString);
  el.textContent = 'Last updated: ' + date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderOpsCalendarListingSelector(listings) {
  const sorted = sortListingsByProperty(listings);
  const container = document.getElementById('opsCalendarListings');
  if (!container) {
    return;
  }

  container.innerHTML = '';
  const savedListingIds = getSavedListingIdSet('opsCalendarListingIds');
  if (!Array.isArray(sorted) || !sorted.length) {
    const empty = document.createElement('p');
    empty.className = 'cleaning-empty';
    empty.textContent = 'No listings available.';
    container.appendChild(empty);
    opsCalSelectedListingIds = new Set();
    return;
  }

  const validIds = new Set(sorted.map((listing) => String(listing.id)));
  const hasSavedSelection = !!savedListingIds;
  const nextSelectedIds = hasSavedSelection
    ? new Set(Array.from(savedListingIds).filter((id) => validIds.has(String(id))))
    : new Set(Array.from(opsCalSelectedListingIds || []).filter((id) => validIds.has(String(id))));
  if (!hasSavedSelection && !nextSelectedIds.size) {
    sorted.forEach((listing) => nextSelectedIds.add(String(listing.id)));
  }
  opsCalSelectedListingIds = nextSelectedIds;

  sorted.forEach((listing) => {
    const row = document.createElement('label');
    row.className = 'cleaning-listing-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'ops-calendar-listing-checkbox';
    checkbox.value = String(listing.id);
    checkbox.checked = opsCalSelectedListingIds.has(String(listing.id));

    const textWrap = document.createElement('span');
    textWrap.className = 'cleaning-listing-name';
    textWrap.textContent = listing.name || ('Listing #' + listing.id);

    const detail = document.createElement('span');
    detail.className = 'hint';
    const propertyName = listing.property_name || 'Unknown property';
    const dateBasis = listing.date_basis === 'checkin' ? 'Check-in basis' : 'Check-out basis';
    detail.textContent = propertyName + ' - ' + dateBasis;

    row.appendChild(checkbox);
    row.appendChild(textWrap);
    row.appendChild(detail);
    container.appendChild(row);
  });

  Array.from(container.querySelectorAll('.ops-calendar-listing-checkbox')).forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const checkedBoxes = Array.from(container.querySelectorAll('.ops-calendar-listing-checkbox:checked'));
      opsCalSelectedListingIds = new Set(checkedBoxes.map((box) => String(box.value)));
      saveDashboardState({ opsCalendarListingIds: Array.from(opsCalSelectedListingIds) });
      refreshOpsCalendar(false);
    });
  });
}

function getOpsSelectedListings() {
  return Array.from(document.querySelectorAll('.ops-calendar-listing-checkbox:checked')).map((box) => ({
    id: Number(box.value),
    name: box.closest('label') ? String(box.closest('label').querySelector('.cleaning-listing-name')?.textContent || '') : ''
  })).filter((listing) => Number.isInteger(listing.id) && listing.id > 0);
}

function opsCalendarSourceKey(source) {
  return String(source || 'Unknown').trim().toLowerCase();
}

function opsCalendarSourceColor(source) {
  const key = opsCalendarSourceKey(source);
  if (!opsCalSourceColorMap[key]) {
    const idx = Object.keys(opsCalSourceColorMap).length % opsCalSourcePalette.length;
    opsCalSourceColorMap[key] = opsCalSourcePalette[idx];
  }
  return opsCalSourceColorMap[key];
}

function opsCalendarGetCleanerKey(change) {
  if (change && change.cleaner_id) {
    return 'id:' + String(change.cleaner_id);
  }
  if (change && change.default_cleaner_id) {
    return 'default:' + String(change.default_cleaner_id);
  }
  const name = opsCalendarGetCleanerDisplayName(change).trim().toLowerCase();
  return name ? ('name:' + name) : '';
}

function opsCalendarGetCleanerInitials(change) {
  const key = opsCalendarGetCleanerKey(change);
  if (!key) {
    return '';
  }
  const name = opsCalendarGetCleanerDisplayName(change);
  if (!name) {
    return '';
  }
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function opsCalendarGetCleanerColor(change) {
  const key = opsCalendarGetCleanerKey(change);
  if (!key) {
    return '#2d3d66';
  }
  if (!opsCalCleanerBadgeColorMap[key]) {
    const idx = Object.keys(opsCalCleanerBadgeColorMap).length % opsCalCleanerBadgePalette.length;
    opsCalCleanerBadgeColorMap[key] = opsCalCleanerBadgePalette[idx];
  }
  return opsCalCleanerBadgeColorMap[key];
}

function opsCalendarGetCleanerDisplayName(change) {
  if (!change) {
    return '';
  }
  const explicitName = String(change.cleaner_name || '').trim();
  if (explicitName && explicitName.toLowerCase() !== 'unallocated') {
    return explicitName;
  }
  const defaultName = String(change.default_cleaner_name || '').trim();
  return !defaultName || defaultName.toLowerCase() === 'unallocated' ? '' : defaultName;
}

function opsCalendarGetSources(events) {
  const sources = [];
  const seen = new Set();

  function addSource(source) {
    const label = String(source || 'Unknown').trim() || 'Unknown';
    const key = opsCalendarSourceKey(label);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    sources.push(label);
  }

  (events || []).forEach((event) => addSource(event.source || 'Unknown'));
  return sources;
}

function eachDateKeyInclusive(startKey, endKey, callback) {
  if (!startKey || !endKey) {
    return;
  }
  const startDate = utcDateFromKey(startKey);
  const endDate = utcDateFromKey(endKey);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return;
  }
  const step = startDate <= endDate ? 1 : -1;
  for (let cursor = new Date(startDate.getTime()); ; cursor = addUtcDays(cursor, step)) {
    callback(keyFromUtcDate(cursor));
    if (cursor.getTime() === endDate.getTime()) {
      break;
    }
  }
}

function buildDayTooltip(dayEntry) {
  if (!dayEntry || !dayEntry.events.length) {
    return '';
  }

  return dayEntry.events.map((event) => {
    const rawLines = Object.entries(event.raw || {}).map(([key, value]) => key + ': ' + value).join(' | ');
    const title = event.title ? event.title : '(untitled)';
    return (event.source || 'Unknown') + ' - ' + title + (rawLines ? ' - ' + rawLines : '');
  }).join('\n');
}

function buildBarTooltip(events) {
  if (!events || !events.length) {
    return '';
  }

  const hasConflict = hasConflictInOpsEventSet(events);

  return events.map((event) => {
    const metadata = parseApMetadataFromDescription(event && event.description);
    const eventType = deriveOpsEventType(event, metadata);
    const eventSource = deriveOpsEventSource(event, metadata, event && event.listingName);
    const eventOrigin = deriveOpsEventOrigin(event, metadata);
    const checkin = formatDateKeyForTooltip(toDateKey(event.start));
    const checkout = formatDateKeyForTooltip(toDateKey(event.end));
    return 'Type: ' + eventType
      + '\nSource: ' + eventSource
      + '\nOrigin: ' + eventOrigin
      + '\nConflict: ' + ((hasConflict || (event && event.isInConflict === true)) ? 'YES' : 'No')
      + '\nSummary: ' + (event.title || (event.raw && event.raw.SUMMARY) || '(untitled)')
      + '\nCheck-in: ' + checkin
      + '\nCheck-out: ' + checkout;
  }).join('\n\n');
}

function formatDateKeyForTooltip(key) {
  if (!key) {
    return 'Unknown';
  }
  const date = utcDateFromKey(key);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return date.getUTCDate() + ' ' + monthNames[date.getUTCMonth()] + ' ' + date.getUTCFullYear();
}

function getOpsEventRange(event) {
  const startKey = toDateKey(event && event.start);
  const rawEndKey = toDateKey(event && event.end);
  if (!startKey) {
    return null;
  }

  let endKey = rawEndKey || keyFromUtcDate(addUtcDays(utcDateFromKey(startKey), 1));
  if (!endKey || endKey <= startKey) {
    endKey = keyFromUtcDate(addUtcDays(utcDateFromKey(startKey), 1));
  }
  return { startKey, endKey };
}

function isOpsConflictCandidate(event) {
  return Boolean(event && event.isReservation !== false && event.isUnavailableBlock !== true);
}

function getOpsConflictIdentity(event) {
  if (!event || typeof event !== 'object') {
    return '';
  }
  const reservationActivityId = Number(event.reservationActivityId || 0);
  if (Number.isInteger(reservationActivityId) && reservationActivityId > 0) {
    return 'reservation:' + reservationActivityId;
  }
  const calendarEventId = Number(event.calendarEventId || 0);
  if (Number.isInteger(calendarEventId) && calendarEventId > 0) {
    return 'calendar:' + calendarEventId;
  }
  return [
    String(event.listingId || ''),
    String(event.source || ''),
    String(event.start || ''),
    String(event.end || ''),
    String(event.title || '')
  ].join('|');
}

function hasConflictInOpsEventSet(events) {
  const list = [];
  const seen = new Set();
  (Array.isArray(events) ? events : []).forEach((event) => {
    const key = getOpsConflictIdentity(event);
    if (key && seen.has(key)) {
      return;
    }
    if (key) {
      seen.add(key);
    }
    list.push(event);
  });
  const ranges = list.map((event) => getOpsEventRange(event));

  for (let i = 0; i < list.length; i += 1) {
    const left = list[i];
    if (!isOpsConflictCandidate(left)) continue;
    if (left && left.isInConflict === true) return true;

    for (let j = i + 1; j < list.length; j += 1) {
      const right = list[j];
      if (!isOpsConflictCandidate(right)) continue;
      const leftRange = ranges[i];
      const rightRange = ranges[j];
      if (!leftRange || !rightRange) continue;
      if (leftRange.startKey < rightRange.endKey && leftRange.endKey > rightRange.startKey) {
        return true;
      }
    }
  }

  return false;
}

function getOpsEventSummary(event) {
  return event.title || (event.raw && event.raw.SUMMARY) || '(untitled)';
}

function parseApMetadataFromDescription(descriptionText) {
  const metadata = {
    type: '',
    source: '',
    origin: '',
    scope: ''
  };

  String(descriptionText || '')
    .split(/\n|\\n/)
    .forEach((line) => {
      const text = String(line || '').trim();
      if (!text) return;

      const idx = text.indexOf(':');
      if (idx <= 0) return;
      const key = text.slice(0, idx).trim().toUpperCase();
      const value = text.slice(idx + 1).trim();
      if (!value) return;

      if (key === 'AP-TYPE') metadata.type = value;
      if (key === 'AP-SOURCE') metadata.source = value;
      if (key === 'AP-ORIGIN') metadata.origin = value;
      if (key === 'AP-SCOPE') metadata.scope = value;
    });

  return metadata;
}

function deriveOpsEventType(event, metadata) {
  const explicitType = String(metadata && metadata.type || event && event.eventType || '').trim().toLowerCase();
  if (explicitType === 'block') return 'Block';
  if (explicitType === 'reservation') return 'Reservation';
  if (event && (event.isReservation === false || event.isUnavailableBlock === true)) return 'Block';
  return 'Reservation';
}

function deriveOpsEventSource(event, metadata, listingName) {
  const explicit = String(metadata && metadata.source || event && event.source || '').trim();
  if (explicit) return explicit;
  return String(listingName || getListingDisplayNameFromEvent(event) || 'Unknown source');
}

function deriveOpsEventOrigin(event, metadata) {
  const explicit = String(metadata && metadata.origin || event && event.eventOrigin || '').trim();
  if (explicit) return explicit;

  const sourceKey = opsCalendarSourceKey(event && event.source || '');
  if (sourceKey === 'direct booking' || sourceKey === 'automaticpeople' || Number(event && event.reservationActivityId || 0) > 0) {
    return 'Local';
  }
  return 'Remote';
}

function isOpsAirbnbNotAvailableEvent(event, sourceLabel) {
  const sourceKey = opsCalendarSourceKey(sourceLabel || (event && event.source));
  if (!sourceKey.includes('airbnb')) {
    return false;
  }
  return String(getOpsEventSummary(event) || '').toLowerCase().includes('not available');
}

function shouldDimBar(events) {
  return (events || []).some((event) => isOpsAirbnbNotAvailableEvent(event));
}

function hasDisplayUnavailable(events) {
  return (events || []).some((event) => event && event.isUnavailableBlock);
}

function hasReservationEligible(events) {
  return (events || []).some((event) => event && event.isReservation !== false);
}

function applyUnavailableHatch(bar) {
  bar.classList.add('day-bar-unavailable');
  const hatch = document.createElement('span');
  hatch.className = 'day-bar-hatch';
  bar.appendChild(hatch);
}

function opsCalendarMonthStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function opsCalendarBuildDayIndex(events) {
  const index = {};

  function ensureDay(key) {
    if (!index[key]) {
      index[key] = {
        listings: new Map(),
        events: [],
        conflict: false
      };
    }
    return index[key];
  }

  function ensureListing(day, listingKey, listingName, color) {
    if (!day.listings.has(listingKey)) {
      day.listings.set(listingKey, {
        name: listingName,
        color,
        conflict: false,
        stays: new Set(),
        checkins: new Set(),
        checkouts: new Set(),
        stayEvents: [],
        checkinEvents: [],
        checkoutEvents: [],
        events: []
      });
    }
    return day.listings.get(listingKey);
  }

  (events || []).forEach((event) => {
    const listingKey = getListingKeyFromEvent(event);
    const listingName = getListingDisplayNameFromEvent(event);
    const listingColor = getListingColor(listingKey);
    const startKey = toDateKey(event.start);
    const rawEndKey = toDateKey(event.end);
    if (!startKey) {
      return;
    }

    const startDate = utcDateFromKey(startKey);
    let endDate = rawEndKey ? utcDateFromKey(rawEndKey) : addUtcDays(startDate, 1);
    if (endDate <= startDate) {
      endDate = addUtcDays(startDate, 1);
    }

    const checkinDay = ensureDay(startKey);
    checkinDay.events.push(event);
    const checkinListing = ensureListing(checkinDay, listingKey, listingName, listingColor);
    checkinListing.checkins.add(listingKey);
    checkinListing.checkinEvents.push(event);
    checkinListing.events.push(event);

    const checkoutKey = keyFromUtcDate(endDate);
    const checkoutDay = ensureDay(checkoutKey);
    checkoutDay.events.push(event);
    const checkoutListing = ensureListing(checkoutDay, listingKey, listingName, listingColor);
    checkoutListing.checkouts.add(listingKey);
    checkoutListing.checkoutEvents.push(event);
    checkoutListing.events.push(event);

    for (let cursor = new Date(startDate.getTime()); cursor < endDate; cursor = addUtcDays(cursor, 1)) {
      const day = ensureDay(keyFromUtcDate(cursor));
      day.events.push(event);
      const listingEntry = ensureListing(day, listingKey, listingName, listingColor);
      listingEntry.stays.add(listingKey);
      listingEntry.stayEvents.push(event);
      listingEntry.events.push(event);
    }
  });

  Object.values(index).forEach((day) => {
    let dayConflict = false;
    day.listings.forEach((listingEntry) => {
      const listingConflict = hasConflictInOpsEventSet(listingEntry.events || []);
      listingEntry.conflict = listingConflict;
      if (listingConflict) {
        dayConflict = true;
      }
    });
    day.conflict = dayConflict || hasConflictInOpsEventSet(day.events || []);
  });

  return index;
}

function opsCalendarBuildReservationCleanerBadgeMap(changes) {
  const map = new Map();

  (changes || []).forEach((change) => {
    const listingId = Number(change && (change.listingId || change.listing_id) || 0);
    const checkinKey = toDateKey(change && change.reservation_checkin_date);
    const checkoutKey = toDateKey(change && change.reservation_checkout_date);
    const changeoverDateKey = toDateKey(change && change.changeover_date);
    const initials = opsCalendarGetCleanerInitials(change);
    if (!Number.isInteger(listingId) || listingId <= 0 || !checkinKey || !checkoutKey || !changeoverDateKey || !initials) {
      return;
    }

    const key = reservationChangeKey(listingId, checkinKey, checkoutKey);
    if (!map.has(key)) {
      map.set(key, {
        listingId,
        initials,
        color: opsCalendarGetCleanerColor(change),
        name: opsCalendarGetCleanerDisplayName(change),
        changeoverDate: changeoverDateKey
      });
    }
  });

  return map;
}

function opsCalendarGetReservationCleanerBadgeForEvent(event, reservationCleanerBadgeMap) {
  if (!event || !reservationCleanerBadgeMap || !reservationCleanerBadgeMap.size) {
    return null;
  }

  const listingId = Number(event && (event.listingId || event.listing_id) || 0);
  const checkinKey = toDateKey(event && event.start);
  const checkoutKey = toDateKey(event && event.end);
  if (!Number.isInteger(listingId) || listingId <= 0 || !checkinKey || !checkoutKey) {
    return null;
  }

  const key = reservationChangeKey(listingId, checkinKey, checkoutKey);
  return reservationCleanerBadgeMap.get(key) || null;
}

function opsCalendarBuildDefaultCleanerBadgeForEvent(event, dayKey) {
  if (!event || event.isReservation === false || !dayKey) {
    return null;
  }

  const listingId = Number(event && (event.listingId || event.listing_id) || 0);
  if (!Number.isInteger(listingId) || listingId <= 0) {
    return null;
  }

  const checkinKey = toDateKey(event && event.start);
  const checkoutKey = toDateKey(event && event.end);
  if (!checkinKey || !checkoutKey) {
    return null;
  }

  const listingMeta = getListingMetaById(listingId);
  if (!listingMeta) {
    return null;
  }

  const basis = listingMeta.date_basis === 'checkin' ? 'checkin' : 'checkout';
  const basisDay = basis === 'checkin' ? checkinKey : checkoutKey;
  if (basisDay !== dayKey) {
    return null;
  }

  const defaultCleaner = getDefaultCleanerForListing(listingMeta.usual_cleaner_id);
  const defaultCleanerName = defaultCleaner ? String(defaultCleaner.name || '').trim() : '';
  if (!defaultCleanerName || defaultCleanerName.toLowerCase() === 'unallocated') {
    return null;
  }

  const badgeSource = {
    default_cleaner_id: defaultCleaner.id,
    default_cleaner_name: defaultCleanerName
  };
  const initials = opsCalendarGetCleanerInitials(badgeSource);
  if (!initials) {
    return null;
  }

  return {
    initials,
    color: opsCalendarGetCleanerColor(badgeSource),
    name: defaultCleanerName,
    changeoverDate: basisDay
  };
}

function opsCalendarGetReservationCleanerBadgeForDay(events, dayKey, reservationCleanerBadgeMap) {
  if (!Array.isArray(events) || !events.length || !dayKey || !reservationCleanerBadgeMap || !reservationCleanerBadgeMap.size) {
    if (!Array.isArray(events) || !events.length || !dayKey) {
      return null;
    }

    for (let i = 0; i < events.length; i += 1) {
      const fallbackBadge = opsCalendarBuildDefaultCleanerBadgeForEvent(events[i], dayKey);
      if (fallbackBadge) {
        return fallbackBadge;
      }
    }

    return null;
  }

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (!event || event.isReservation === false) {
      continue;
    }

    const cleanerBadge = opsCalendarGetReservationCleanerBadgeForEvent(event, reservationCleanerBadgeMap);
    if (cleanerBadge && cleanerBadge.initials && cleanerBadge.changeoverDate === dayKey) {
      return cleanerBadge;
    }

    const fallbackBadge = opsCalendarBuildDefaultCleanerBadgeForEvent(event, dayKey);
    if (fallbackBadge) {
      return fallbackBadge;
    }
  }

  // If reservation keys drift due source date formatting/timezone differences,
  // fall back to listing + changeover day so allocated initials still render.
  const firstReservationEvent = events.find((event) => event && event.isReservation !== false) || null;
  const listingId = Number(firstReservationEvent && (firstReservationEvent.listingId || firstReservationEvent.listing_id) || 0);
  if (Number.isInteger(listingId) && listingId > 0) {
    for (const badge of reservationCleanerBadgeMap.values()) {
      if (
        badge
        && Number(badge.listingId) === listingId
        && badge.changeoverDate === dayKey
        && badge.initials
      ) {
        return badge;
      }
    }
  }

  return null;
}

function opsCalendarRenderCleanerLegend(changes) {
  const legend = document.getElementById('opsCalendarCleanerLegend');
  if (!legend) {
    return;
  }
  legend.innerHTML = '';

  const byKey = new Map();
  (changes || []).forEach((change) => {
    const initials = opsCalendarGetCleanerInitials(change);
    const name = opsCalendarGetCleanerDisplayName(change);
    if (!initials || !name) {
      return;
    }
    const key = opsCalendarGetCleanerKey(change) || ('name:' + name.toLowerCase());
    if (!byKey.has(key)) {
      byKey.set(key, {
        initials,
        name,
        color: opsCalendarGetCleanerColor(change)
      });
    }
  });

  Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name)).forEach((itemData) => {
    const item = document.createElement('div');
    item.className = 'cleaner-legend-item';

    const badge = document.createElement('span');
    badge.className = 'calendar-day-cleaner-badge';
    badge.textContent = itemData.initials;
    badge.style.backgroundColor = itemData.color;

    const name = document.createElement('span');
    name.className = 'cleaner-legend-name';
    name.textContent = itemData.name;

    item.appendChild(badge);
    item.appendChild(name);
    legend.appendChild(item);
  });
}

function opsCalendarRenderReservationCalendar(events, changes) {
  const calendar = document.getElementById('opsReservationCalendar');
  const monthLabel = document.getElementById('opsCalendarMonthLabel');
  if (!calendar || !monthLabel) {
    return;
  }

  const monthStart = opsCalendarMonthStart(opsCalCurrentMonth);
  const dayIndex = opsCalendarBuildDayIndex(events);
  const reservationCleanerBadgeMap = opsCalendarBuildReservationCleanerBadgeMap(changes);
  const listings = getOpsCalendarListings(events);

  monthLabel.textContent = formatMonthLabel(monthStart);
  calendar.innerHTML = '';

  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const corner = document.createElement('div');
  corner.className = 'calendar-weekday calendar-weekday-corner';
  calendar.appendChild(corner);

  weekdayNames.forEach((name) => {
    const header = document.createElement('div');
    header.className = 'calendar-weekday';
    header.textContent = name;
    calendar.appendChild(header);
  });

  const firstDayOfWeek = monthStart.getUTCDay();
  const nextMonthStart = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
  const daysInMonth = Math.round((nextMonthStart - monthStart) / 86400000);

  const dayNumbers = [];
  for (let i = 0; i < firstDayOfWeek; i += 1) {
    dayNumbers.push(null);
  }
  for (let dayNum = 1; dayNum <= daysInMonth; dayNum += 1) {
    dayNumbers.push(dayNum);
  }
  while (dayNumbers.length % 7 !== 0) {
    dayNumbers.push(null);
  }

  const dayListings = listings.length ? listings : [{ key: 'unknown', name: 'Unknown listing', color: '#667085' }];

  for (let weekStart = 0; weekStart < dayNumbers.length; weekStart += 7) {
    if (weekStart === 0) {
      const labelsCell = document.createElement('div');
      labelsCell.className = 'calendar-channel-labels';

      dayListings.forEach((listing) => {
        const row = document.createElement('div');
        row.className = 'calendar-channel-label-row';

        const swatch = document.createElement('span');
        swatch.className = 'calendar-channel-label-swatch';
        swatch.style.backgroundColor = listing.color;

        const text = document.createElement('span');
        text.className = 'calendar-channel-label-text';
        text.textContent = listing.name;
        text.title = listing.name;

        row.appendChild(swatch);
        row.appendChild(text);
        labelsCell.appendChild(row);
      });

      calendar.appendChild(labelsCell);
    } else {
      const spacer = document.createElement('div');
      spacer.className = 'calendar-channel-labels-spacer';
      calendar.appendChild(spacer);
    }

    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      const dayNum = dayNumbers[weekStart + dayOffset];
      if (dayNum === null) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-day calendar-day-empty';
        calendar.appendChild(emptyCell);
        continue;
      }

      const date = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), dayNum));
      const key = keyFromUtcDate(date);
      const dayEntry = dayIndex[key];

      const cell = document.createElement('div');
      cell.className = 'calendar-day';
      cell.title = buildDayTooltip(dayEntry);

      const num = document.createElement('div');
      num.className = 'calendar-day-number';
      num.textContent = String(dayNum);
      cell.appendChild(num);

      const bars = document.createElement('div');
      bars.className = 'calendar-day-bars';

      dayListings.forEach((listing) => {
        const slot = document.createElement('div');
        slot.className = 'day-bar-slot';

        const bar = document.createElement('div');
        bar.className = 'day-bar';
        let activeBarEvents = [];

        if (!dayEntry) {
          bar.classList.add('day-bar-empty');
          slot.appendChild(bar);
          bars.appendChild(slot);
          return;
        }

        const listingEntry = dayEntry.listings.get(listing.key);
        const hasCheckout = !!(listingEntry && listingEntry.checkouts.size);
        const hasCheckin = !!(listingEntry && listingEntry.checkins.size);
        const hasStay = !!(listingEntry && listingEntry.stays.size);
        const color = listing.color;
        const transparentStop = color.length === 7 ? (color + '00') : 'rgba(0,0,0,0)';

        if (hasCheckout && hasCheckin) {
          const transitionEvents = (listingEntry.checkoutEvents || []).concat(listingEntry.checkinEvents || []);
          activeBarEvents = transitionEvents;
          bar.classList.add('day-transition-bar');
          bar.style.background = 'linear-gradient(90deg, ' + color + ' 0 47%, ' + transparentStop + ' 47% 53%, ' + color + ' 53% 100%)';
          if (shouldDimBar(transitionEvents, listing.name)) {
            bar.style.opacity = '0.5';
          }
          bar.title = buildBarTooltip(transitionEvents);
          if (hasDisplayUnavailable(transitionEvents) && !hasReservationEligible(transitionEvents)) {
            applyUnavailableHatch(bar);
          }
        } else if (hasCheckout) {
          const checkoutEvents = listingEntry.checkoutEvents || [];
          activeBarEvents = checkoutEvents;
          bar.classList.add('day-transition-bar');
          bar.style.background = 'linear-gradient(90deg, ' + color + ' 0 68%, ' + transparentStop + ' 68% 100%)';
          if (shouldDimBar(checkoutEvents, listing.name)) {
            bar.style.opacity = '0.5';
          }
          bar.title = buildBarTooltip(checkoutEvents);
          if (hasDisplayUnavailable(checkoutEvents) && !hasReservationEligible(checkoutEvents)) {
            applyUnavailableHatch(bar);
          }
        } else if (hasCheckin) {
          const checkinEvents = listingEntry.checkinEvents || [];
          activeBarEvents = checkinEvents;
          bar.classList.add('day-transition-bar');
          bar.style.background = 'linear-gradient(90deg, ' + transparentStop + ' 0 32%, ' + color + ' 32% 100%)';
          if (shouldDimBar(checkinEvents, listing.name)) {
            bar.style.opacity = '0.5';
          }
          bar.title = buildBarTooltip(checkinEvents);
          if (hasDisplayUnavailable(checkinEvents) && !hasReservationEligible(checkinEvents)) {
            applyUnavailableHatch(bar);
          }
        } else if (hasStay) {
          const stayEvents = listingEntry.stayEvents || [];
          activeBarEvents = stayEvents;
          bar.style.backgroundColor = color;
          if (shouldDimBar(stayEvents, listing.name)) {
            bar.style.opacity = '0.5';
          }
          bar.title = buildBarTooltip(stayEvents);
          if (hasDisplayUnavailable(stayEvents) && !hasReservationEligible(stayEvents)) {
            applyUnavailableHatch(bar);
          }
        } else {
          bar.classList.add('day-bar-empty');
        }

        if (listingEntry && listingEntry.conflict && !bar.classList.contains('day-bar-empty')) {
          bar.classList.add('day-bar-conflict');
        }

        if (!bar.classList.contains('day-bar-empty') && hasReservationEligible(activeBarEvents)) {
          const cleanerBadge = opsCalendarGetReservationCleanerBadgeForDay(activeBarEvents, key, reservationCleanerBadgeMap);
          if (cleanerBadge && cleanerBadge.initials) {
            const initialsEl = document.createElement('span');
            initialsEl.className = 'day-bar-initials';
            initialsEl.textContent = cleanerBadge.initials;
            initialsEl.title = cleanerBadge.name || '';
            bar.appendChild(initialsEl);
          }
        }

        slot.appendChild(bar);
        bars.appendChild(slot);
      });

      cell.appendChild(bars);
      calendar.appendChild(cell);
    }
  }
}

async function fetchOpsCalendarListingData(listing, refresh) {
  const listingId = Number(listing.id);
  const endpoint = '/api/listings/' + encodeURIComponent(listingId) + '/events' + (refresh ? '/refresh' : '');
  const res = await fetch(endpoint, refresh ? { method: 'POST' } : undefined);

  if (res.status === 401) {
    window.location.href = '/';
    return null;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || ('Failed to load calendar data for ' + (listing.name || ('Listing #' + listingId)) + '.'));
  }

  return data;
}

function syncOpsCalendarSelection() {
  const checkedBoxes = Array.from(document.querySelectorAll('.ops-calendar-listing-checkbox:checked'));
  opsCalSelectedListingIds = new Set(checkedBoxes.map((box) => String(box.value)));
}

async function refreshOpsCalendar(refresh) {
  const selectedListings = getOpsSelectedListings();
  const container = document.getElementById('opsReservationCalendar');
  if (!container) {
    return;
  }

  if (!selectedListings.length) {
    opsCalCurrentEvents = [];
    opsCalCurrentCleaningChanges = [];
    opsCalCurrentFetchedAt = null;
    container.innerHTML = '<p class="cleaning-empty">Select at least one listing to display the calendar.</p>';
    opsCalendarSetMessage('Select at least one listing to display the calendar.', true);
    opsCalendarSetFetchedAt(null);
    return;
  }

  const requestId = ++opsCalRequestId;
  opsCalendarSetMessage(refresh ? 'Refreshing calendar...' : 'Loading calendar...', false);

  const results = await Promise.all(selectedListings.map(async (listing) => {
    try {
      const data = await fetchOpsCalendarListingData(listing, refresh);
      return { listing, data };
    } catch (err) {
      return { listing, error: err };
    }
  }));

  if (requestId !== opsCalRequestId) {
    return;
  }

  const events = [];
  const cleaningChanges = [];
  const fetchedAts = [];
  const issues = [];

  results.forEach((result) => {
    if (result.error) {
      issues.push((result.listing.name || ('Listing #' + result.listing.id)) + ': ' + (result.error.message || 'Failed to load.'));
      return;
    }

    const data = result.data || {};
    const listingMeta = getListingMetaById(result.listing.id) || {};
    const listingName = result.listing.name || listingMeta.name || ('Listing #' + result.listing.id);
    const listingColorName = listingMeta.property_name || '';
    const defaultCleaner = getDefaultCleanerForListing(listingMeta.usual_cleaner_id);
    const defaultCleanerId = defaultCleaner ? defaultCleaner.id : (listingMeta.usual_cleaner_id || null);
    const listingDateBasis = listingMeta.date_basis === 'checkin' ? 'checkin' : 'checkout';
    events.push(...(data.events || []).map((event) => Object.assign({}, event, {
      listingId: result.listing.id,
      listingName,
      listingPropertyName: listingColorName
    })));
    cleaningChanges.push(...(data.cleaningChanges || []).map((change) => {
      const checkinKey = toDateKey(change.reservation_checkin_date);
      const checkoutKey = toDateKey(change.reservation_checkout_date);
      const fallbackChangeDate = listingDateBasis === 'checkin' ? checkinKey : checkoutKey;
      return Object.assign({}, change, {
        listingId: result.listing.id,
        listingName,
        changeover_date: toDateKey(change.changeover_date) || fallbackChangeDate,
        default_cleaner_id: defaultCleanerId,
        default_cleaner_name: defaultCleaner ? defaultCleaner.name : ''
      });
    }));
    if (data.fetchedAt) {
      fetchedAts.push(data.fetchedAt);
    }
    if (Array.isArray(data.feedErrors)) {
      data.feedErrors.forEach((feedError) => {
        issues.push((result.listing.name || ('Listing #' + result.listing.id)) + ': ' + (feedError.error || 'Feed issue'));
      });
    }
  });

  opsCalCurrentEvents = events;
  opsCalCurrentCleaningChanges = cleaningChanges.concat(buildOpsDefaultCleaningChanges(events, cleaningChanges));
  opsCalCurrentFetchedAt = fetchedAts.length ? fetchedAts.sort().slice(-1)[0] : null;

  opsCalendarRenderCleanerLegend(opsCalCurrentCleaningChanges);
  opsCalendarRenderReservationCalendar(events, opsCalCurrentCleaningChanges);
  opsCalendarSetFetchedAt(opsCalCurrentFetchedAt);

  if (issues.length) {
    opsCalendarSetMessage('Loaded with feed issues: ' + issues.join(' | '), true);
  } else {
    opsCalendarSetMessage('Loaded ' + selectedListings.length + ' listing' + (selectedListings.length === 1 ? '' : 's') + '.', false);
  }
}

function renderOpsCalendarForCurrentMonth() {
  opsCalendarRenderCleanerLegend(opsCalCurrentCleaningChanges);
  opsCalendarRenderReservationCalendar(opsCalCurrentEvents, opsCalCurrentCleaningChanges);
}

async function updateSchedulePreview() {
  const container = document.getElementById('schedulePreviewContent') || document.getElementById('schedulePreview');
  const daysValue = Number(document.getElementById('cleaningDays').value);
  const startDateUtc = getSelectedStartDateUtc();
  const selectedListings = getSelectedCleaningListings();
  const pendingScheduleEdits = buildScheduleEditSnapshot(currentScheduleRows);
  const requestId = ++schedulePreviewRequestId;

  if (!selectedListings.length) {
    container.innerHTML = '<p class="cleaning-empty">Select listings to preview the schedule.</p>';
    return;
  }
  if (!Number.isInteger(daysValue) || daysValue < 1 || daysValue > 365 || !startDateUtc) {
    container.innerHTML = '<p class="cleaning-empty">Choose a valid start date and day range to preview the schedule.</p>';
    return;
  }

  container.innerHTML = '<p class="cleaning-empty">Loading schedule preview...</p>';

  try {
    const result = await buildSchedule(selectedListings, daysValue, startDateUtc);

    if (requestId !== schedulePreviewRequestId) {
      return;
    }

    let notifications = result.notifications || [];
    currentNotificationRows = result.staleChanges || [];

    if (currentNotificationRows.length) {
      try {
        const deletionResult = await deleteBookedInChanges(currentNotificationRows);
        if (deletionResult.deleted > 0) {
          notifications = notifications.concat('Removed ' + deletionResult.deleted + ' stale booked-in change(s) from the system.');
        }
        currentNotificationRows = [];
      } catch (err) {
        notifications = notifications.concat(err.message || 'Failed to remove stale booked-in changes from the system.');
      }
    }

    currentScheduleRows = mergeScheduleRowsWithSnapshot(result.rows || [], pendingScheduleEdits);
    currentScheduleErrors = result.errors || [];
    renderSchedulePreviewTable(currentScheduleRows, currentScheduleErrors, notifications);
  } catch {
    if (requestId !== schedulePreviewRequestId) {
      return;
    }
    container.innerHTML = '<p class="cleaning-empty">Failed to build schedule preview.</p>';
    renderNotificationLog([]);
  }
}

function renderFeedSources(sources) {
  const tbody = document.getElementById('feedSourcesTableBody');
  if (!tbody) {
    return;
  }
  tbody.innerHTML = '';

  if (!sources.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 2;
    cell.textContent = 'No feed sources configured yet.';
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  sources.forEach((source) => {
    const row = document.createElement('tr');

    const labelCell = document.createElement('td');
    labelCell.textContent = source.label;

    const colorCell = document.createElement('td');
    colorCell.className = 'source-color-cell';

    const select = document.createElement('select');
    select.className = 'source-color-select';
    select.setAttribute('aria-label', 'Primary color for ' + source.label);

    SOURCE_COLOR_OPTIONS.forEach((opt) => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.name;
      if ((source.color || '').toLowerCase() === opt.value.toLowerCase()) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    if (!source.color && SOURCE_COLOR_OPTIONS.length) {
      select.value = SOURCE_COLOR_OPTIONS[0].value;
    }

    const preview = document.createElement('span');
    preview.className = 'source-color-preview';
    preview.style.backgroundColor = select.value;

    select.addEventListener('change', async () => {
      const chosen = select.value;
      preview.style.backgroundColor = chosen;

      select.disabled = true;
      try {
        const res = await fetch('/api/feed-sources/color', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: source.label, color: chosen })
        });
        const data = await res.json();

        if (!res.ok) {
          setMessage(data.error || 'Failed to save source color.', true);
          return;
        }

        setMessage('Saved color for ' + source.label + '.', false);
      } catch {
        setMessage('Network error saving source color.', true);
      } finally {
        select.disabled = false;
      }
    });

    colorCell.appendChild(select);
    colorCell.appendChild(preview);
    row.appendChild(labelCell);
    row.appendChild(colorCell);
    tbody.appendChild(row);
  });
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

function renderManualReservations(reservations) {
  const rows = Array.isArray(reservations)
    ? reservations
    : Array.isArray(reservations && reservations.reservations)
      ? reservations.reservations
      : [];

  currentManualReservations = rows.map((reservation) => ({
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
    startCell.textContent = String(reservation.checkinDate || '');

    const endCell = document.createElement('td');
    endCell.textContent = String(reservation.checkoutDate || '');

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

  currentListings = data.listings || [];
  renderListings(currentListings);
  renderCleaningListings(currentListings);
  renderOpsCalendarListingSelector(currentListings);
  await refreshOpsCalendar(false);
  await refreshDashboardActivity();
}

async function fetchProperties() {
  const res = await fetch('/api/properties');
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load properties.');
  }

  renderProperties(data.properties || []);
}

async function fetchFeedSources() {
  const res = await fetch('/api/feed-sources');
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load feed sources.');
  }

  renderFeedSources(data.sources || []);
}

async function fetchCleaners() {
  const res = await fetch('/api/cleaners');
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load changeover staff.');
  }

  renderCleaners(data.cleaners || []);
}

async function fetchSharedResources() {
  const res = await fetch('/api/shared-resources');
  if (res.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load shared resources.');
  }

  renderSharedResources(data.resources || []);
}

async function persistCurrentScheduleChanges() {
  if (!currentScheduleRows.length) {
    return { ok: false, error: 'Generate a schedule preview before saving changes.' };
  }

  const saveRes = await fetch('/api/booked-in-changes/upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      changes: currentScheduleRows.map((row) => ({
        listingId: row.listingId,
        reservationCheckinDate: row.checkinDate,
        reservationCheckoutDate: row.checkoutDate,
        changeoverDate: row.changeDate || row.date,
        cleanerUserId: row.cleanerId
      }))
    })
  });

  if (saveRes.status === 401) {
    window.location.href = '/';
    return { ok: false, error: 'Session expired.' };
  }

  const saveData = await saveRes.json();
  if (!saveRes.ok) {
    return { ok: false, error: saveData.error || 'Failed to save schedule changes.' };
  }

  return { ok: true, saved: Number(saveData.saved || 0) };
}

async function loadDashboardData() {
  await fetchProperties();
  await fetchFeedSources();
  await fetchCleaners();
  await fetchListings();
  await fetchSharedResources();
  await fetchTeamMembers();
  await fetchManagerAssignments();
  await fetchGuests();
  await fetchReservationEnquiryLandingPages();
  await fetchFacilityEnquiryLandingPages();
  await fetchStripeConnectStatus();
  await fetchBankDetails();

  const managerSelect = document.getElementById('managerAssignmentMembership');
  if (managerSelect) {
    renderManagerScopeOptions(Number(managerSelect.value));
  }
}

function restorePersistedScheduleControls() {
  const startDateInput = document.getElementById('cleaningStartDate');
  const daysInput = document.getElementById('cleaningDays');
  const formatInput = document.getElementById('cleaningFormat');

  // Always default start date to today (local date) on page load
  if (startDateInput) {
    const today = new Date();
    startDateInput.value = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
  }
  if (daysInput && savedDashboardState && savedDashboardState.cleaningDays) {
    daysInput.value = String(savedDashboardState.cleaningDays);
  }
  if (formatInput && savedDashboardState && savedDashboardState.cleaningFormat) {
    formatInput.value = savedDashboardState.cleaningFormat;
  }
}

function persistScheduleControls() {
  const startDateInput = document.getElementById('cleaningStartDate');
  const daysInput = document.getElementById('cleaningDays');
  const formatInput = document.getElementById('cleaningFormat');
  saveDashboardState({
    cleaningStartDate: startDateInput ? startDateInput.value : '',
    cleaningDays: daysInput ? daysInput.value : '',
    cleaningFormat: formatInput ? formatInput.value : 'csv'
  });
}

function openScheduleEmailDialog() {
  const dialog = document.getElementById('scheduleEmailDialog');
  const input = document.getElementById('scheduleEmailDialogTo');
  if (!dialog || typeof dialog.showModal !== 'function') {
    return;
  }
  if (input) {
    input.value = currentUserEmail || input.value || '';
  }
  dialog.showModal();
  if (input) {
    input.focus();
    input.select();
  }
}

function closeScheduleEmailDialog() {
  const dialog = document.getElementById('scheduleEmailDialog');
  if (dialog && typeof dialog.close === 'function' && dialog.open) {
    dialog.close();
  }
}

async function sendScheduleEmailToRecipient(toEmail) {
  const format = String((document.getElementById('cleaningFormat') && document.getElementById('cleaningFormat').value) || 'csv').toLowerCase() === 'txt' ? 'txt' : 'csv';
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(toEmail)) {
    setMessage('Enter a valid email address.', true);
    setScheduleEmailMessage('Enter a valid email address.', true);
    return;
  }

  const daysValue = Number(document.getElementById('cleaningDays').value);
  const startDateUtc = getSelectedStartDateUtc();
  const selectedListings = getSelectedCleaningListings();

  if (!selectedListings.length) {
    setMessage('Select at least one listing for the schedule.', true);
    setScheduleEmailMessage('Select at least one listing for the schedule.', true);
    return;
  }
  if (!Number.isInteger(daysValue) || daysValue < 1 || daysValue > 365) {
    setMessage('Number of days must be between 1 and 365.', true);
    setScheduleEmailMessage('Number of days must be between 1 and 365.', true);
    return;
  }
  if (!startDateUtc) {
    setMessage('Please select a valid start date.', true);
    setScheduleEmailMessage('Please select a valid start date.', true);
    return;
  }

  setMessage('Preparing schedule email...', false);
  setScheduleEmailMessage('Preparing schedule email...', false);

  try {
    let rows = currentScheduleRows || [];
    let errors = currentScheduleErrors || [];

    if (!rows.length) {
      const result = await buildSchedule(selectedListings, daysValue, startDateUtc);
      rows = result.rows || [];
      errors = result.errors || [];
      currentScheduleRows = rows;
      currentScheduleErrors = errors;
      renderSchedulePreviewTable(rows, errors, result.notifications || []);
    }

    if (!rows.length) {
      setMessage('No reservations found in the selected range.', true);
      setScheduleEmailMessage('No reservations found in the selected range.', true);
      return;
    }

    const startKey = keyFromUtcDate(startDateUtc);
    const listingNames = Array.from(new Set(rows.map((row) => String(row.listing || '').trim()).filter(Boolean)));
    const subjectPrefix = listingNames.length ? listingNames.join(', ') : 'Listings';
    const subject = subjectPrefix + ' Schedule';
    const textContent = rowsToText(rows, formatCleaningScheduleLine) + '\n';
    const csvContent = rowsToCsv(rows) + '\n';
    const fileName = 'schedule-' + startKey + (format === 'csv' ? '.csv' : '.txt');
    const bodyText = format === 'txt'
      ? textContent
      : ('Please find the schedule attached as CSV.\n\nListings: ' + (listingNames.join(', ') || 'N/A') + '\nDate range start: ' + startKey + '\n');

    const button = document.getElementById('sendScheduleEmailBtn');
    if (button) {
      button.disabled = true;
    }

    const sendRes = await fetch('/api/schedules/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: toEmail,
        subject,
        format,
        fileName,
        textContent: bodyText,
        csvContent
      })
    });

    if (sendRes.status === 401) {
      window.location.href = '/';
      return;
    }

    const sendData = await sendRes.json();
    if (!sendRes.ok) {
      setMessage(sendData.error || 'Failed to send schedule email.', true);
      setScheduleEmailMessage(sendData.error || 'Failed to send schedule email.', true);
      return;
    }

    if (errors.length) {
      setMessage('Email sent with some feed issues: ' + errors.join(' | '), true);
      setScheduleEmailMessage('Email sent with some feed issues.', false);
    } else {
      setMessage('Schedule email sent to ' + toEmail + '.', false);
      setScheduleEmailMessage('Schedule email sent to ' + toEmail + '.', false);
    }
    closeScheduleEmailDialog();
  } catch {
    setMessage('Failed to send schedule email.', true);
    setScheduleEmailMessage('Failed to send schedule email.', true);
  } finally {
    const button = document.getElementById('sendScheduleEmailBtn');
    if (button) {
      button.disabled = false;
    }
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
    currentMeProfile = meData;
    applyDashboardSettings({
      activityOutlookDays: meData.dashboardActivityOutlookDays,
      highlightEmptyNightsDays: meData.dashboardHighlightEmptyNightsDays
    });
    setConsolidatedIcsUrl(meData.consolidated_ics_token || '');
    currentUserEmail = String(meData.email || '').toLowerCase();
    loadDashboardState();
    renderStripeConnectStatus(meData.stripeConnect || null);

    await fetchAccessContext();

    let persistedMode = String(savedDashboardState && savedDashboardState.contextMode || '').trim().toLowerCase();
    if (!persistedMode) {
      try {
        persistedMode = String(window.localStorage.getItem(getDashboardContextPersistentStorageKey()) || '').trim().toLowerCase();
      } catch {
        persistedMode = '';
      }
    }
    if (!persistedMode) {
      try {
        persistedMode = String(sessionStorage.getItem(getDashboardContextStorageKey()) || '').trim().toLowerCase();
      } catch {
        persistedMode = '';
      }
    }
    const initialMode = normalizeDashboardContextMode(persistedMode || (dashboardContextAvailability.guest && !dashboardContextAvailability.hosting ? 'guest' : 'hosting'));
    await applyDashboardContextMode(initialMode, { loadData: false });

    if (currentDashboardContextMode === 'guest') {
      await loadGuestDashboardData();
    } else {
      await loadDashboardData();
      await loadEventLog();
    }

    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const cleaningStartDate = document.getElementById('cleaningStartDate');
    if (cleaningStartDate && !cleaningStartDate.value) {
      cleaningStartDate.value = toDateInputValue(todayUtc);
    }
    restorePersistedScheduleControls();
    persistScheduleControls();
    resetCleanerForm();

    const savedSelection = savedDashboardState && Array.isArray(savedDashboardState.scheduleListingIds)
      ? savedDashboardState.scheduleListingIds.length
      : 0;
    if (savedSelection && currentDashboardContextMode === 'hosting') {
      await updateSchedulePreview();
    }
  } catch (err) {
    setMessage(err.message || 'Failed to load page.', true);
  }
})();

const addListingForm = document.getElementById('addListingForm');
if (addListingForm) addListingForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = e.target.querySelector('button[type="submit"]');
  const name = document.getElementById('listingName').value.trim();
  const propertyId = Number(document.getElementById('listingPropertyId').value);

  if (!name) {
    setMessage('Listing name is required.', true);
    return;
  }

  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    setMessage('Property selection is required.', true);
    return;
  }

  button.disabled = true;
  try {
    const res = await fetch('/api/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, propertyId, dateBasis: 'checkout' })
    });

    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || 'Failed to create listing.', true);
      return;
    }

    document.getElementById('listingName').value = '';
    setMessage('Listing added.', false);
    await fetchProperties();
    await fetchListings();
    await fetchFeedSources();
  } catch {
    setMessage('Network error creating listing.', true);
  } finally {
    button.disabled = false;
  }
});

const addPropertyForm = document.getElementById('addPropertyForm');
if (addPropertyForm) addPropertyForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const button = e.target.querySelector('button[type="submit"]');
  const name = document.getElementById('propertyName').value.trim();

  if (!name) {
    setMessage('Property name is required.', true);
    return;
  }

  button.disabled = true;
  try {
    const res = await fetch('/api/properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();

    if (!res.ok) {
      setMessage(data.error || 'Failed to create property.', true);
      return;
    }

    document.getElementById('propertyName').value = '';
    setMessage('Property added.', false);
    await fetchProperties();
    await fetchListings();
  } catch {
    setMessage('Network error creating property.', true);
  } finally {
    button.disabled = false;
  }
});

const addSharedResourceForm = document.getElementById('addSharedResourceForm');
if (addSharedResourceForm) addSharedResourceForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const button = e.target.querySelector('button[type="submit"]');
  const shortDescription = document.getElementById('sharedResourceShortDescription').value.trim();

  if (!shortDescription) {
    setMessage('Shared resource short description is required.', true);
    return;
  }

  button.disabled = true;
  try {
    const res = await fetch('/api/shared-resources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shortDescription })
    });
    const data = await res.json();

    if (!res.ok) {
      setMessage(data.error || 'Failed to create shared resource.', true);
      return;
    }

    window.location.href = '/shared-resource.html?id=' + encodeURIComponent(data.resource.id);
  } catch {
    setMessage('Network error creating shared resource.', true);
  } finally {
    button.disabled = false;
  }
});

const createPropertyConfigBtn = document.getElementById('createPropertyConfigBtn');
if (createPropertyConfigBtn) {
  createPropertyConfigBtn.addEventListener('click', () => {
    window.location.href = '/property.html?new=1';
  });
}

const createListingConfigBtn = document.getElementById('createListingConfigBtn');
if (createListingConfigBtn) {
  createListingConfigBtn.addEventListener('click', () => {
    window.location.href = '/listing.html?new=1';
  });
}

const createTeamConfigBtn = document.getElementById('createTeamConfigBtn');
if (createTeamConfigBtn) {
  createTeamConfigBtn.addEventListener('click', () => {
    window.location.href = '/team-member.html?new=1';
  });
}

const createFacilityConfigBtn = document.getElementById('createFacilityConfigBtn');
if (createFacilityConfigBtn) {
  createFacilityConfigBtn.addEventListener('click', () => {
    window.location.href = '/shared-resource.html?new=1';
  });
}

const createGuestConfigBtn = document.getElementById('createGuestConfigBtn');
if (createGuestConfigBtn) {
  createGuestConfigBtn.addEventListener('click', () => {
    window.location.href = '/guest.html?new=1';
  });
}

const createReservationEnquiryLandingPageConfigBtn = document.getElementById('createReservationEnquiryLandingPageConfigBtn');
if (createReservationEnquiryLandingPageConfigBtn) {
  createReservationEnquiryLandingPageConfigBtn.addEventListener('click', () => {
    window.location.href = '/reservation-enquiry-landing-page.html?new=1';
  });
}

const createFacilityEnquiryLandingPageConfigBtn = document.getElementById('createFacilityEnquiryLandingPageConfigBtn');
if (createFacilityEnquiryLandingPageConfigBtn) {
  createFacilityEnquiryLandingPageConfigBtn.addEventListener('click', () => {
    window.location.href = '/facility-enquiry-landing-page.html?new=1';
  });
}

const _addTeamMemberForm = document.getElementById('addTeamMemberForm');
if (_addTeamMemberForm) _addTeamMemberForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const button = form.querySelector('button[type="submit"]');
  const firstName = document.getElementById('teamMemberFirstName').value.trim();
  const familyName = document.getElementById('teamMemberFamilyName').value.trim();
  const country = document.getElementById('teamMemberCountry').value.trim();
  const email = document.getElementById('teamMemberEmail').value.trim();
  const password = document.getElementById('teamMemberPassword').value;
  const roles = [];
  if (document.getElementById('teamInviteRoleManager').checked) roles.push('Manager');
  if (document.getElementById('teamInviteRoleStaff').checked) roles.push('Staff');

  if (!firstName || !familyName || !country || !email || !password) {
    setMessage('First name, family name, country, email, and password are required.', true);
    return;
  }

  if (!roles.length) {
    setMessage('Select at least one role (Manager and/or Staff).', true);
    return;
  }

  if (!isStrongPassword(password)) {
    setMessage('Password must be at least 8 characters and include one uppercase, one number, and one special character.', true);
    return;
  }

  button.disabled = true;
  try {
    const result = await inviteTeamMember({
      firstName,
      familyName,
      country,
      email,
      password,
      roles
    });

    if (result && result.cancelled) {
      setMessage('Invitation cancelled.', false);
      return;
    }

    setMessage('Team member invitation saved.', false);
    document.getElementById('teamMemberFirstName').value = '';
    document.getElementById('teamMemberFamilyName').value = '';
    document.getElementById('teamMemberCountry').value = '';
    document.getElementById('teamMemberEmail').value = '';
    document.getElementById('teamMemberPassword').value = '';
    document.getElementById('teamInviteRoleManager').checked = false;
    document.getElementById('teamInviteRoleStaff').checked = false;
    await fetchTeamMembers();
    await fetchManagerAssignments();
  } catch (err) {
    setMessage(err.message || 'Failed to add team member.', true);
  } finally {
    button.disabled = false;
  }
});

const _saveTeamMemberEditorBtn = document.getElementById('saveTeamMemberEditorBtn');
if (_saveTeamMemberEditorBtn) _saveTeamMemberEditorBtn.addEventListener('click', async () => {
  const button = document.getElementById('saveTeamMemberEditorBtn');
  const userId = Number(document.getElementById('editTeamMemberUserId').value);
  const roles = [];
  if (document.getElementById('editTeamMemberRoleManager').checked) roles.push('Manager');
  if (document.getElementById('editTeamMemberRoleStaff').checked) roles.push('Staff');

  if (!Number.isInteger(userId) || userId <= 0) {
    setMessage('Select a valid team member first.', true);
    return;
  }

  button.disabled = true;
  try {
    await updateTeamMemberRoles(userId, roles);
    setMessage('Team member updated.', false);
    await fetchTeamMembers();
    await fetchManagerAssignments();
  } catch (err) {
    setMessage(err.message || 'Failed to update team member.', true);
  } finally {
    button.disabled = false;
  }
});

const _deleteTeamMemberBtn = document.getElementById('deleteTeamMemberBtn');
if (_deleteTeamMemberBtn) _deleteTeamMemberBtn.addEventListener('click', async () => {
  const button = document.getElementById('deleteTeamMemberBtn');
  const userId = Number(document.getElementById('editTeamMemberUserId').value);

  if (!Number.isInteger(userId) || userId <= 0) {
    setMessage('Select a valid team member first.', true);
    return;
  }

  let impact = currentTeamMemberDeleteImpact;
  if (!impact) {
    try {
      impact = await fetchTeamMemberDeleteImpact(userId);
      currentTeamMemberDeleteImpact = impact;
    } catch (err) {
      setMessage(err.message || 'Failed to load delete impact.', true);
      return;
    }
  }

  const impactMessage = impact.deletedFromSite
    ? 'This action will remove the user from this client and delete the site user account.'
    : 'This action will remove the user from this client scope only.';
  const confirmed = window.confirm(impactMessage + ' Continue?');
  if (!confirmed) {
    return;
  }

  button.disabled = true;
  try {
    const result = await deleteTeamMember(userId);
    closeTeamMemberEditor();
    if (result && result.deletedFromSite) {
      setMessage('Team member deleted from this client and removed from the site.', false);
    } else {
      setMessage('Team member removed from this client scope.', false);
    }
    await fetchTeamMembers();
    await fetchManagerAssignments();
  } catch (err) {
    setMessage(err.message || 'Failed to delete team member.', true);
  } finally {
    button.disabled = false;
  }
});

const _closeTeamMemberEditorBtn = document.getElementById('closeTeamMemberEditorBtn');
if (_closeTeamMemberEditorBtn) _closeTeamMemberEditorBtn.addEventListener('click', () => {
  closeTeamMemberEditor();
});

const _logoutBtn = document.getElementById('logoutBtn');
if (_logoutBtn) _logoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

const _guestLogoutBtn = document.getElementById('guestLogoutBtn');
if (_guestLogoutBtn) _guestLogoutBtn.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

const _guestAccountForm = document.getElementById('guestAccountForm');
if (_guestAccountForm) _guestAccountForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setGuestAccountMessage('', false);

  const saveBtn = document.getElementById('saveGuestAccountBtn');
  const telephone = String((document.getElementById('guestTelephone') || {}).value || '').trim();
  const postalAddress = String((document.getElementById('guestPostalAddress') || {}).value || '').trim();

  if (telephone.length > 60) {
    setGuestAccountMessage('Telephone must be 60 characters or fewer.', true);
    return;
  }
  if (postalAddress.length > 500) {
    setGuestAccountMessage('Postal address must be 500 characters or fewer.', true);
    return;
  }

  if (saveBtn) {
    saveBtn.disabled = true;
  }
  try {
    const response = await fetch('/api/guest/dashboard/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telephone, postalAddress })
    });

    if (response.status === 401) {
      window.location.href = '/';
      return;
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to save guest account details.');
    }

    applyGuestProfile(data);
    setGuestAccountMessage('Personal account saved.', false);
  } catch (err) {
    setGuestAccountMessage(err.message || 'Failed to save guest account details.', true);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
    }
  }
});

const _dashboardContextToggle = document.getElementById('dashboardContextToggle');
if (_dashboardContextToggle) _dashboardContextToggle.addEventListener('click', async () => {
  if (!hasDashboardContextSwitchAvailable()) {
    return;
  }

  const nextMode = currentDashboardContextMode === 'guest' ? 'hosting' : 'guest';
  const menuBtn = document.getElementById('tabMenuBtn');
  const menuEl = document.getElementById('tabContextMenu');
  if (menuBtn && menuEl) {
    menuEl.classList.add('hidden');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.classList.remove('open');
  }

  await applyDashboardContextMode(nextMode, { loadData: true });
});

// ── Bank Details ──────────────────────────────────────────────

function setBankDetailsMessage(text, isError) {
  const el = document.getElementById('bankDetailsMessage');
  if (!el) return;
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function setDashboardSettingsMessage(text, isError) {
  const el = document.getElementById('dashboardSettingsMessage');
  if (!el) return;
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function setPrivateReservationsMessage(text, isError) {
  const el = document.getElementById('privateReservationsMessage');
  if (!el) return;
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function formatPrivateReservationArrival(dateValue) {
  const value = String(dateValue || '').trim();
  if (!value) {
    return '—';
  }
  const parsed = new Date(value + 'T00:00:00');
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString([], { dateStyle: 'medium' });
}

function formatPrivateReservationAmount(amount) {
  const numeric = Number(amount);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : '—';
}

function createPrivateReservationActionButton(symbol, title, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn secondary config-icon-btn private-res-action-btn ' + className;
  button.textContent = symbol;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.addEventListener('click', onClick);
  return button;
}

function createSharedReservationActionButton(symbol, title, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn secondary config-icon-btn resource-res-action-btn ' + className;
  button.textContent = symbol;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.addEventListener('click', onClick);
  return button;
}

async function deleteSharedReservation(resourceId, reservationId, button) {
  const parsedResourceId = Number(resourceId || 0);
  const parsedReservationId = Number(reservationId || 0);
  if (!Number.isInteger(parsedResourceId) || parsedResourceId <= 0 || !Number.isInteger(parsedReservationId) || parsedReservationId <= 0) {
    setMessage('Select a valid shared resource reservation first.', true);
    return;
  }

  const confirmed = window.confirm('Delete this shared resource reservation? This cannot be undone.');
  if (!confirmed) {
    return;
  }

  if (button) {
    button.disabled = true;
  }
  setMessage('Deleting reservation...', false);

  try {
    const res = await fetch(
      '/api/shared-resources/' + encodeURIComponent(String(parsedResourceId))
      + '/reservations/' + encodeURIComponent(String(parsedReservationId)),
      { method: 'DELETE' }
    );
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to delete reservation.');
    }

    await loadAllReservations();
    setMessage('Reservation deleted.', false);
  } catch (err) {
    setMessage(err.message || 'Failed to delete reservation.', true);
    if (button) {
      button.disabled = false;
    }
  }
}

async function confirmSharedReservationPayment(resourceId, reservationId, status, button) {
  const parsedResourceId = Number(resourceId || 0);
  const parsedReservationId = Number(reservationId || 0);
  const nextStatus = String(status || '').trim();

  if (!Number.isInteger(parsedResourceId) || parsedResourceId <= 0 || !Number.isInteger(parsedReservationId) || parsedReservationId <= 0 || !nextStatus) {
    setMessage('Select a valid shared resource reservation first.', true);
    return;
  }

  const confirmed = window.confirm('Confirm payment received for this reservation?');
  if (!confirmed) {
    return;
  }

  if (button) {
    button.disabled = true;
  }
  setMessage('Registering payment receipt...', false);

  try {
    const res = await fetch(
      '/api/shared-resources/' + encodeURIComponent(String(parsedResourceId))
      + '/reservations/' + encodeURIComponent(String(parsedReservationId))
      + '/status',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      }
    );
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to register payment receipt.');
    }

    await loadAllReservations();
    setMessage('Payment receipt registered.', false);
  } catch (err) {
    setMessage(err.message || 'Failed to register payment receipt.', true);
    if (button) {
      button.disabled = false;
    }
  }
}

async function cancelPrivateReservation(reservationId, button) {
  const id = Number(reservationId || 0);
  if (!Number.isInteger(id) || id <= 0) {
    setPrivateReservationsMessage('Select a valid reservation first.', true);
    return;
  }

  const confirmed = window.confirm('Cancel this reservation? No automatic refund will be issued if the reservation is cancelled.');
  if (!confirmed) {
    return;
  }

  if (button) {
    button.disabled = true;
  }
  setPrivateReservationsMessage('Cancelling reservation...', false);

  try {
    const res = await fetch('/api/private-reservations/' + encodeURIComponent(String(id)), {
      method: 'DELETE'
    });
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to cancel reservation.');
    }

    await loadPrivateReservations();
    setPrivateReservationsMessage('Reservation cancelled.', false);
  } catch (err) {
    setPrivateReservationsMessage(err.message || 'Failed to cancel reservation.', true);
    if (button) {
      button.disabled = false;
    }
  }
}

async function confirmPrivateReservationPayment(reservationId, button) {
  const id = Number(reservationId || 0);
  if (!Number.isInteger(id) || id <= 0) {
    setPrivateReservationsMessage('Select a valid reservation first.', true);
    return;
  }

  const confirmed = window.confirm('Confirm payment receipt');
  if (!confirmed) {
    return;
  }

  if (button) {
    button.disabled = true;
  }
  setPrivateReservationsMessage('Confirming payment...', false);

  try {
    const res = await fetch('/api/private-reservations/' + encodeURIComponent(String(id)) + '/confirm-payment', {
      method: 'POST'
    });
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to confirm payment.');
    }

    await loadPrivateReservations();
    setPrivateReservationsMessage('Payment confirmed.', false);
  } catch (err) {
    setPrivateReservationsMessage(err.message || 'Failed to confirm payment.', true);
    if (button) {
      button.disabled = false;
    }
  }
}

async function loadPrivateReservations() {
  const tbody = document.getElementById('privateReservationsTableBody');
  if (!tbody) {
    return;
  }

  tbody.innerHTML = '<tr><td colspan="8">Loading private reservations...</td></tr>';
  setPrivateReservationsMessage('', false);

  try {
    const res = await fetch('/api/private-reservations');
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }
    if (res.status === 403) {
      tbody.innerHTML = '<tr><td colspan="8">Access restricted.</td></tr>';
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to load private reservations.');
    }

    const reservations = Array.isArray(data.reservations) ? data.reservations : [];
    if (!reservations.length) {
      tbody.innerHTML = '<tr><td colspan="8">No private reservations found.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    reservations.forEach((reservation) => {
      const tr = document.createElement('tr');
      if (reservation && reservation.isOverduePayment === true) {
        tr.classList.add('conflict-row');
      }

      const reservationIdCell = document.createElement('td');
      reservationIdCell.textContent = reservation.reservationIdentifier || '—';

      const guestCell = document.createElement('td');
      guestCell.textContent = reservation.guestName || '—';

      const listingCell = document.createElement('td');
      listingCell.textContent = reservation.listingName || '—';

      const arrivalCell = document.createElement('td');
      arrivalCell.textContent = formatPrivateReservationArrival(reservation.arrivalDate);

      const nightsCell = document.createElement('td');
      nightsCell.textContent = String(Number(reservation.stayNights || 0) || 0);

      const amountCell = document.createElement('td');
      amountCell.textContent = formatPrivateReservationAmount(reservation.amount);

      const paymentStatusCell = document.createElement('td');
      paymentStatusCell.textContent = String(reservation.paymentStatus || '—');

      const actionCell = document.createElement('td');
      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'feed-actions';

      const cancelBtn = createPrivateReservationActionButton('✖', 'Cancel Reservation', 'private-res-cancel-btn', () => {
        cancelPrivateReservation(reservation.id, cancelBtn);
      });
      actionsWrap.appendChild(cancelBtn);

      if (reservation.canConfirmPayment) {
        const confirmBtn = createPrivateReservationActionButton('✔', 'Confirm Payment Receipt', 'private-res-confirm-btn', () => {
          confirmPrivateReservationPayment(reservation.id, confirmBtn);
        });
        actionsWrap.appendChild(confirmBtn);
      }
      actionCell.appendChild(actionsWrap);

      tr.appendChild(reservationIdCell);
      tr.appendChild(guestCell);
      tr.appendChild(listingCell);
      tr.appendChild(arrivalCell);
      tr.appendChild(nightsCell);
      tr.appendChild(amountCell);
      tr.appendChild(paymentStatusCell);
      tr.appendChild(actionCell);
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="8">Failed to load private reservations.</td></tr>';
    setPrivateReservationsMessage(err.message || 'Failed to load private reservations.', true);
  }
}

function setGuestReservationsMessage(text, isError) {
  const el = document.getElementById('guestReservationsMessage');
  if (!el) return;
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function setGuestAccountMessage(text, isError) {
  const el = document.getElementById('guestAccountMessage');
  if (!el) return;
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function formatGuestDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '—';
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }
  return parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function formatGuestAmount(amount) {
  const numeric = Number(amount);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : '—';
}

function normalizeGuestReservationValue(value) {
  return String(value || '').trim().toLowerCase();
}

function getGuestAccommodationReservationAction(reservation) {
  const statusValue = normalizeGuestReservationValue(reservation && reservation.status);
  const paymentMethodValue = normalizeGuestReservationValue(reservation && reservation.paymentMethod);

  const isAwaitingOnline = statusValue === 'awaiting_online_payment' || statusValue === 'awaiting online payment';
  const isAwaitingBankTransfer = statusValue === 'awaiting_bank_transfer' || statusValue === 'awaiting bank transfer';

  if (isAwaitingOnline && paymentMethodValue === 'online payment') {
    return {
      key: 'pay-now',
      label: 'Pay Now'
    };
  }

  if (isAwaitingBankTransfer && paymentMethodValue === 'bank transfer') {
    return {
      key: 'notify-payment',
      label: 'Notify Payment'
    };
  }

  return null;
}

function getGuestFacilityReservationAction(reservation) {
  const statusValue = normalizeGuestReservationValue(reservation && reservation.status);
  const isAwaitingOnline = statusValue === 'awaiting online confirmation' || statusValue === 'awaiting_online_confirmation';
  const isAwaitingBankTransfer = statusValue === 'awaiting bank transfer' || statusValue === 'awaiting_bank_transfer';

  if (isAwaitingOnline) {
    return {
      key: 'pay-now-facility',
      label: 'Make Payment'
    };
  }

  if (isAwaitingBankTransfer) {
    return {
      key: 'notify-payment-facility',
      label: 'Confirm Transfer'
    };
  }

  return null;
}

function consumeGuestReservationReturnMessageFromUrl() {
  let paymentState = '';
  let reservationId = '';
  let sessionId = '';
  let reservationType = '';
  try {
    const params = new URLSearchParams(window.location.search);
    paymentState = String(params.get('payment') || '').trim().toLowerCase();
    reservationId = String(params.get('reservationId') || '').trim();
    sessionId = String(params.get('session_id') || params.get('sessionId') || '').trim();
    reservationType = String(params.get('reservationType') || '').trim().toLowerCase();
    if (!paymentState) {
      return { paymentState: '', reservationId: '', sessionId: '', reservationType: '' };
    }

    params.delete('payment');
    params.delete('reservationId');
    params.delete('session_id');
    params.delete('sessionId');
    params.delete('reservationType');
    const nextQuery = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (nextQuery ? ('?' + nextQuery) : ''));
  } catch {
    return { paymentState: '', reservationId: '', sessionId: '', reservationType: '' };
  }

  if (paymentState === 'success') {
    setGuestReservationsMessage(
      'Payment completed for reservation' + (reservationId ? (' #' + reservationId) : '') + '. Status will refresh once payment is confirmed.',
      false
    );
    return { paymentState, reservationId, sessionId, reservationType };
  }

  if (paymentState === 'cancelled') {
    setGuestReservationsMessage('Payment was cancelled. You can try again using Pay Now.', true);
  }

  return { paymentState, reservationId, sessionId, reservationType };
}

async function reconcileGuestReservationPaymentIfNeeded(paymentState, reservationId, sessionId, reservationType) {
  if (paymentState !== 'success' || !reservationId) {
    return null;
  }

  const syncEndpoint = reservationType === 'facility'
    ? '/api/guest/dashboard/facility-reservations/' + encodeURIComponent(String(reservationId)) + '/sync-payment'
    : '/api/guest/dashboard/reservations/' + encodeURIComponent(String(reservationId)) + '/sync-payment';
  const syncUrl = syncEndpoint
    + (sessionId ? ('?sessionId=' + encodeURIComponent(String(sessionId))) : '');

  const response = await fetch(syncUrl, {
    method: 'POST'
  });

  if (response.status === 401) {
    window.location.href = '/';
    return null;
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Failed to reconcile reservation payment.');
  }

  return data;
}

async function startGuestReservationOnlinePayment(reservationId, button) {
  if (button) {
    button.disabled = true;
  }
  setGuestReservationsMessage('Starting secure payment...', false);

  try {
    const response = await fetch('/api/guest/dashboard/reservations/' + encodeURIComponent(String(reservationId)) + '/pay-now', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 401) {
      window.location.href = '/';
      return;
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to start reservation payment.');
    }

    if (!data || !data.checkoutUrl) {
      throw new Error('Stripe checkout URL is missing.');
    }

    window.location.href = String(data.checkoutUrl);
  } catch (err) {
    setGuestReservationsMessage(err.message || 'Failed to start reservation payment.', true);
    if (button) {
      button.disabled = false;
    }
  }
}

async function notifyGuestReservationBankTransfer(reservationId, button) {
  if (button) {
    button.disabled = true;
  }
  setGuestReservationsMessage('Sending payment notification...', false);

  try {
    const response = await fetch('/api/guest/dashboard/reservations/' + encodeURIComponent(String(reservationId)) + '/notify-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 401) {
      window.location.href = '/';
      return;
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to notify payment.');
    }

    setGuestReservationsMessage(data.message || 'Payment notification sent.', false);
    await loadGuestReservations();
  } catch (err) {
    setGuestReservationsMessage(err.message || 'Failed to notify payment.', true);
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function startGuestFacilityOnlinePayment(reservationId, button) {
  if (button) {
    button.disabled = true;
  }
  setGuestReservationsMessage('Starting secure payment...', false);

  try {
    const response = await fetch('/api/guest/dashboard/facility-reservations/' + encodeURIComponent(String(reservationId)) + '/pay-now', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 401) {
      window.location.href = '/';
      return;
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to start facility reservation payment.');
    }

    if (!data || !data.checkoutUrl) {
      throw new Error('Stripe checkout URL is missing.');
    }

    window.location.href = String(data.checkoutUrl);
  } catch (err) {
    setGuestReservationsMessage(err.message || 'Failed to start facility reservation payment.', true);
    if (button) {
      button.disabled = false;
    }
  }
}

async function notifyGuestFacilityBankTransfer(reservationId, button) {
  if (button) {
    button.disabled = true;
  }
  setGuestReservationsMessage('Sending payment notification...', false);

  try {
    const response = await fetch('/api/guest/dashboard/facility-reservations/' + encodeURIComponent(String(reservationId)) + '/notify-payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 401) {
      window.location.href = '/';
      return;
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to notify transfer.');
    }

    setGuestReservationsMessage(data.message || 'Transfer confirmation sent.', false);
    await loadGuestReservations();
  } catch (err) {
    setGuestReservationsMessage(err.message || 'Failed to notify transfer.', true);
  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

async function loadGuestReservations() {
  const accommodationBody = document.getElementById('guestAccommodationTableBody');
  const facilityBody = document.getElementById('guestFacilityTableBody');
  if (!accommodationBody || !facilityBody) {
    return;
  }

  let returnMessage = { paymentState: '', reservationId: '', sessionId: '', reservationType: '' };
  if (!hasAppliedGuestReservationReturnMessage) {
    returnMessage = consumeGuestReservationReturnMessageFromUrl() || { paymentState: '', reservationId: '', sessionId: '', reservationType: '' };
    hasAppliedGuestReservationReturnMessage = true;
  }

  accommodationBody.innerHTML = '<tr><td colspan="9">Loading accommodation reservations...</td></tr>';
  facilityBody.innerHTML = '<tr><td colspan="7">Loading facility reservations...</td></tr>';
  if (!String(document.getElementById('guestReservationsMessage') && document.getElementById('guestReservationsMessage').textContent || '').trim()) {
    setGuestReservationsMessage('', false);
  }

  try {
    if (returnMessage.paymentState === 'success' && returnMessage.reservationId) {
      setGuestReservationsMessage('Reconciling payment status...', false);
      const syncResult = await reconcileGuestReservationPaymentIfNeeded(returnMessage.paymentState, returnMessage.reservationId, returnMessage.sessionId, returnMessage.reservationType);
      const reservationStatus = String(syncResult && syncResult.reservation && syncResult.reservation.status || '').trim().toLowerCase();
      if (reservationStatus === 'confirmed') {
        setGuestReservationsMessage(
          'Payment confirmed for reservation #' + String(returnMessage.reservationId) + '.',
          false
        );
      } else {
        setGuestReservationsMessage(
          'Payment submitted for reservation #' + String(returnMessage.reservationId) + '. Status will change once payment is confirmed.',
          false
        );
      }
    }

    const response = await fetch('/api/guest/dashboard/reservations');
    if (response.status === 401) {
      window.location.href = '/';
      return;
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to load guest reservations.');
    }

    const accommodation = Array.isArray(data.accommodation) ? data.accommodation : [];
    const facilities = Array.isArray(data.facilities) ? data.facilities : [];

    if (!accommodation.length) {
      accommodationBody.innerHTML = '<tr><td colspan="9">No accommodation reservations found.</td></tr>';
    } else {
      accommodationBody.innerHTML = '';
      accommodation.forEach((reservation) => {
        const tr = document.createElement('tr');

        const actionCell = document.createElement('td');
        const action = getGuestAccommodationReservationAction(reservation);
        if (action) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn secondary inline-btn guest-reservation-action-btn';
          button.textContent = action.label;
          if (action.key === 'pay-now') {
            button.addEventListener('click', () => {
              startGuestReservationOnlinePayment(reservation.id, button);
            });
          }
          if (action.key === 'notify-payment') {
            button.addEventListener('click', () => {
              notifyGuestReservationBankTransfer(reservation.id, button);
            });
          }
          actionCell.appendChild(button);
        } else {
          actionCell.textContent = '—';
        }

        const idCell = document.createElement('td');
        idCell.textContent = reservation.reservationIdentifier || '—';

        const listingCell = document.createElement('td');
        listingCell.textContent = reservation.listingName || '—';

        const arrivalCell = document.createElement('td');
        arrivalCell.textContent = formatPrivateReservationArrival(reservation.arrivalDate);

        const departureCell = document.createElement('td');
        departureCell.textContent = formatPrivateReservationArrival(reservation.departureDate);

        const nightsCell = document.createElement('td');
        nightsCell.textContent = String(Number(reservation.stayNights || 0) || 0);

        const amountCell = document.createElement('td');
        amountCell.textContent = formatGuestAmount(reservation.amount);

        const paymentCell = document.createElement('td');
        paymentCell.textContent = reservation.paymentStatus || '—';

        const statusCell = document.createElement('td');
        statusCell.textContent = reservation.status || '—';

        tr.appendChild(actionCell);
        tr.appendChild(idCell);
        tr.appendChild(listingCell);
        tr.appendChild(arrivalCell);
        tr.appendChild(departureCell);
        tr.appendChild(nightsCell);
        tr.appendChild(amountCell);
        tr.appendChild(paymentCell);
        tr.appendChild(statusCell);
        accommodationBody.appendChild(tr);
      });
    }

    if (!facilities.length) {
      facilityBody.innerHTML = '<tr><td colspan="7">No facility reservations found.</td></tr>';
    } else {
      facilityBody.innerHTML = '';
      facilities.forEach((reservation) => {
        const tr = document.createElement('tr');

        const actionCell = document.createElement('td');
        const action = getGuestFacilityReservationAction(reservation);
        if (action) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'btn secondary inline-btn guest-reservation-action-btn';
          button.textContent = action.label;
          if (action.key === 'pay-now-facility') {
            button.addEventListener('click', () => {
              startGuestFacilityOnlinePayment(reservation.id, button);
            });
          }
          if (action.key === 'notify-payment-facility') {
            button.addEventListener('click', () => {
              notifyGuestFacilityBankTransfer(reservation.id, button);
            });
          }
          actionCell.appendChild(button);
        } else {
          actionCell.textContent = '—';
        }

        const resourceCell = document.createElement('td');
        resourceCell.textContent = reservation.resourceName || '—';

        const startCell = document.createElement('td');
        startCell.textContent = formatGuestDateTime(reservation.requestedStartAt);

        const endCell = document.createElement('td');
        endCell.textContent = formatGuestDateTime(reservation.requestedEndAt);

        const amountCell = document.createElement('td');
        amountCell.textContent = formatGuestAmount(reservation.amount);

        const paymentCell = document.createElement('td');
        paymentCell.textContent = reservation.paymentStatus || '—';

        const statusCell = document.createElement('td');
        statusCell.textContent = reservation.status || '—';

        tr.appendChild(actionCell);
        tr.appendChild(resourceCell);
        tr.appendChild(startCell);
        tr.appendChild(endCell);
        tr.appendChild(amountCell);
        tr.appendChild(paymentCell);
        tr.appendChild(statusCell);
        facilityBody.appendChild(tr);
      });
    }
  } catch (err) {
    accommodationBody.innerHTML = '<tr><td colspan="9">Failed to load accommodation reservations.</td></tr>';
    facilityBody.innerHTML = '<tr><td colspan="7">Failed to load facility reservations.</td></tr>';
    setGuestReservationsMessage(err.message || 'Failed to load guest reservations.', true);
  }
}

function applyGuestProfile(profile) {
  const firstNameEl = document.getElementById('guestAccountFirstName');
  const familyNameEl = document.getElementById('guestAccountFamilyName');
  const emailEl = document.getElementById('guestAccountEmail');
  const telephoneEl = document.getElementById('guestTelephone');
  const postalAddressEl = document.getElementById('guestPostalAddress');

  if (firstNameEl) firstNameEl.value = String(profile && profile.firstName || '');
  if (familyNameEl) familyNameEl.value = String(profile && profile.familyName || '');
  if (emailEl) emailEl.value = String(profile && profile.email || '');
  if (telephoneEl) telephoneEl.value = String(profile && profile.telephone || '');
  if (postalAddressEl) postalAddressEl.value = String(profile && profile.postalAddress || '');
}

async function loadGuestAccountProfile() {
  setGuestAccountMessage('', false);
  try {
    const response = await fetch('/api/guest/dashboard/profile');
    if (response.status === 401) {
      window.location.href = '/';
      return;
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to load guest account details.');
    }

    applyGuestProfile(data);
  } catch (err) {
    setGuestAccountMessage(err.message || 'Failed to load guest account details.', true);
  }
}

async function loadGuestDashboardData() {
  await loadGuestReservations();
  await loadGuestAccountProfile();
}

async function fetchBankDetails() {
  try {
    const res = await fetch('/api/account/bank-details');
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.warn('[BankDetails] Failed to load bank details:', res.status, errorData.error || 'Unknown error');
      // Only show message if it's an auth or account error, not just empty data
      if (res.status === 401 || res.status === 403) {
        setBankDetailsMessage('You do not have permission to view bank details.', true);
      } else if (res.status === 404) {
        console.warn('[BankDetails] Client account not found - this should not happen');
      }
      return;
    }
    const data = await res.json();
    const bankAccountNameEl = document.getElementById('bankAccountName');
    const bankSortCodeEl = document.getElementById('bankSortCode');
    const bankAccountNumberEl = document.getElementById('bankAccountNumber');
    const bankIbanEl = document.getElementById('bankIban');
    const bankBicEl = document.getElementById('bankBic');
    const bankIsBusinessEl = document.getElementById('bankIsBusiness');

    if (bankAccountNameEl) bankAccountNameEl.value = data.accountName || '';
    if (bankSortCodeEl) bankSortCodeEl.value = data.sortCode || '';
    if (bankAccountNumberEl) bankAccountNumberEl.value = data.accountNumber || '';
    if (bankIbanEl) bankIbanEl.value = data.iban || '';
    if (bankBicEl) bankBicEl.value = data.bic || '';
    if (bankIsBusinessEl) bankIsBusinessEl.checked = data.isBusiness === true;

    console.log('[BankDetails] Loaded bank details successfully');
  } catch (err) {
    console.error('[BankDetails] Error loading bank details:', err);
    // Non-fatal error - don't show message to user for network/parse errors
  }
}

async function saveDashboardSettings() {
  const activityOutlookDays = Number(String((document.getElementById('dashboardActivityOutlookDays') || {}).value || '').trim());
  const highlightEmptyNightsDays = Number(String((document.getElementById('dashboardHighlightEmptyNightsDays') || {}).value || '').trim());

  if (!Number.isInteger(activityOutlookDays) || activityOutlookDays < 1) {
    throw new Error('Activity Outlook Period must be 1 day or more.');
  }
  if (!Number.isInteger(highlightEmptyNightsDays) || highlightEmptyNightsDays < 1) {
    throw new Error('Highlight Empty Nights must be 1 day or more.');
  }

  const res = await fetch('/api/account/dashboard-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      activityOutlookDays,
      highlightEmptyNightsDays
    })
  });

  if (res.status === 401) {
    window.location.href = '/';
    throw new Error('Session expired.');
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to save dashboard settings.');
  }

  applyDashboardSettings({
    activityOutlookDays: data.activityOutlookDays,
    highlightEmptyNightsDays: data.highlightEmptyNightsDays
  });
}

const _bankDetailsForm = document.getElementById('bankDetailsForm');
if (_bankDetailsForm) _bankDetailsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setBankDetailsMessage('', false);
  const btn = document.getElementById('saveBankDetailsBtn');
  const accountName = String((document.getElementById('bankAccountName') || {}).value || '').trim();
  const sortCode = String((document.getElementById('bankSortCode') || {}).value || '').trim();
  const accountNumber = String((document.getElementById('bankAccountNumber') || {}).value || '').trim();
  const iban = String((document.getElementById('bankIban') || {}).value || '').trim();
  const bic = String((document.getElementById('bankBic') || {}).value || '').trim();

  if (!accountName || !sortCode || !accountNumber) {
    setBankDetailsMessage('Account name, sort code, and account number are required.', true);
    return;
  }
  if (!iban) {
    setBankDetailsMessage('IBAN is required.', true);
    return;
  }
  if (!bic) {
    setBankDetailsMessage('BIC is required.', true);
    return;
  }

  if (btn) btn.disabled = true;
  try {
    console.log('[BankDetails] Saving bank details:', { accountName, sortCode, iban, bic });
    const res = await fetch('/api/account/bank-details', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountName,
        sortCode,
        accountNumber,
        iban,
        bic,
        isBusiness: !!(document.getElementById('bankIsBusiness') || {}).checked
      })
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[BankDetails] Save failed with status', res.status, data);
      throw new Error(data.error || 'Failed to save bank details.');
    }
    console.log('[BankDetails] Bank details saved successfully');
    setBankDetailsMessage('Bank details saved.', false);
  } catch (err) {
    console.error('[BankDetails] Error saving bank details:', err);
    setBankDetailsMessage(err.message || 'Failed to save bank details.', true);
  } finally {
    if (btn) btn.disabled = false;
  }
});

const _dashboardSettingsForm = document.getElementById('dashboardSettingsForm');
if (_dashboardSettingsForm) _dashboardSettingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setDashboardSettingsMessage('', false);
  const btn = document.getElementById('saveDashboardSettingsBtn');
  if (btn) btn.disabled = true;

  try {
    await saveDashboardSettings();
    setDashboardSettingsMessage('Dashboard settings saved.', false);
    await refreshDashboardActivity();
  } catch (err) {
    setDashboardSettingsMessage(err.message || 'Failed to save dashboard settings.', true);
  } finally {
    if (btn) btn.disabled = false;
  }
});


const _startStripeConnectBtn = document.getElementById('startStripeConnectBtn');
if (_startStripeConnectBtn) _startStripeConnectBtn.addEventListener('click', async () => {
  const button = document.getElementById('startStripeConnectBtn');
  button.disabled = true;
  setStripeConnectStatus('Opening Stripe onboarding...', false);

  try {
    const response = await fetch('/api/stripe/connect/start', { method: 'POST' });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to start Stripe onboarding.');
    }

    if (!data.onboardingUrl) {
      throw new Error('Stripe onboarding URL is missing.');
    }

    window.location.href = data.onboardingUrl;
  } catch (err) {
    setStripeConnectStatus(err.message || 'Failed to start Stripe onboarding.', true);
    button.disabled = false;
  }
});

const _clearNotificationLogBtn = document.getElementById('clearNotificationLogBtn');
if (_clearNotificationLogBtn) _clearNotificationLogBtn.addEventListener('click', () => {
  currentNotificationRows = [];
  renderNotificationLog([]);
});

const _opsCalendarRefreshBtn = document.getElementById('opsCalendarRefreshBtn');
if (_opsCalendarRefreshBtn) _opsCalendarRefreshBtn.addEventListener('click', async () => {
  const button = document.getElementById('opsCalendarRefreshBtn');
  button.disabled = true;
  try {
    await refreshOpsCalendar(true);
  } finally {
    button.disabled = false;
  }
});

const _manualReservationForm = document.getElementById('manualReservationForm');
if (_manualReservationForm) _manualReservationForm.addEventListener('submit', async (e) => {
  e.preventDefault();
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
    await refreshOpsCalendar(true);
  } catch (err) {
    setManualReservationsMessage(err.message || 'Failed to create manual reservation.', true);
  } finally {
    button.disabled = false;
  }
});

const _manualReservationsTableBody = document.getElementById('manualReservationsTableBody');
if (_manualReservationsTableBody) _manualReservationsTableBody.addEventListener('click', async (event) => {
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
    await refreshOpsCalendar(true);
  } catch (err) {
    setManualReservationsMessage(err.message || 'Failed to delete manual reservation.', true);
  } finally {
    target.disabled = false;
  }
});

const _opsCalendarPrevBtn = document.getElementById('opsCalendarPrevBtn');
if (_opsCalendarPrevBtn) _opsCalendarPrevBtn.addEventListener('click', () => {
  opsCalCurrentMonth = new Date(Date.UTC(opsCalCurrentMonth.getUTCFullYear(), opsCalCurrentMonth.getUTCMonth() - 1, 1));
  renderOpsCalendarForCurrentMonth();
});

const _opsCalendarNextBtn = document.getElementById('opsCalendarNextBtn');
if (_opsCalendarNextBtn) _opsCalendarNextBtn.addEventListener('click', () => {
  opsCalCurrentMonth = new Date(Date.UTC(opsCalCurrentMonth.getUTCFullYear(), opsCalCurrentMonth.getUTCMonth() + 1, 1));
  renderOpsCalendarForCurrentMonth();
});

const _refreshScheduleBtn = document.getElementById('refreshScheduleBtn');
if (_refreshScheduleBtn) _refreshScheduleBtn.addEventListener('click', async () => {
  _refreshScheduleBtn.disabled = true;
  try {
    await updateSchedulePreview();
  } finally {
    _refreshScheduleBtn.disabled = false;
  }
});

const _sendScheduleEmailBtn = document.getElementById('sendScheduleEmailBtn');
if (_sendScheduleEmailBtn) _sendScheduleEmailBtn.addEventListener('click', () => {
  openScheduleEmailDialog();
});

const _scheduleEmailDialogForm = document.getElementById('scheduleEmailDialogForm');
if (_scheduleEmailDialogForm) _scheduleEmailDialogForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('scheduleEmailDialogTo');
  await sendScheduleEmailToRecipient(String(input ? input.value : '').trim().toLowerCase());
});

const _cancelScheduleEmailDialogBtn = document.getElementById('cancelScheduleEmailDialogBtn');
if (_cancelScheduleEmailDialogBtn) _cancelScheduleEmailDialogBtn.addEventListener('click', () => {
  closeScheduleEmailDialog();
});

['cleaningStartDate', 'cleaningDays', 'cleaningFormat'].forEach((id) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('change', () => {
      persistScheduleControls();
    });
  }
});

document.querySelectorAll('.cleaning-listing-checkbox, .ops-calendar-listing-checkbox').forEach((checkbox) => {
  checkbox.addEventListener('change', () => {
    persistScheduleControls();
  });
});

const _cleaningScheduleForm = document.getElementById('cleaningScheduleForm');
if (_cleaningScheduleForm) _cleaningScheduleForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const button = document.getElementById('downloadCleaningScheduleBtn');
  const daysValue = Number(document.getElementById('cleaningDays').value);
  const format = document.getElementById('cleaningFormat').value;
  const startDateUtc = getSelectedStartDateUtc();
  const selectedListings = getSelectedCleaningListings();

  if (!selectedListings.length) {
    setMessage('Select at least one listing for the schedule.', true);
    return;
  }

  if (!Number.isInteger(daysValue) || daysValue < 1 || daysValue > 365) {
    setMessage('Number of days must be between 1 and 365.', true);
    return;
  }

  if (!startDateUtc) {
    setMessage('Please select a valid start date.', true);
    return;
  }

  const pendingScheduleEdits = buildScheduleEditSnapshot(currentScheduleRows);

  button.disabled = true;
  setMessage('Building schedule from latest feeds...', false);

  try {
    const result = await buildSchedule(selectedListings, daysValue, startDateUtc);
    currentScheduleRows = mergeScheduleRowsWithSnapshot(result.rows || [], pendingScheduleEdits);
    currentScheduleErrors = result.errors || [];
    renderSchedulePreviewTable(currentScheduleRows, currentScheduleErrors, result.notifications || []);

    const startKey = keyFromUtcDate(startDateUtc);
    if (result.rowCount < 1) {
      setMessage('No reservations found in the selected range.', true);
      return;
    }

    const saveResult = await persistCurrentScheduleChanges();
    if (!saveResult.ok) {
      setMessage(saveResult.error || 'Failed to save schedule changes.', true);
      return;
    }

    if (format === 'csv') {
      const fileName = 'schedule-' + startKey + '.csv';
      downloadTextFile(fileName, rowsToCsv(currentScheduleRows) + '\n');
    } else {
      const fileName = 'schedule-' + startKey + '.txt';
      downloadTextFile(fileName, rowsToText(currentScheduleRows, formatCleaningScheduleLine) + '\n');
    }

    if (currentScheduleErrors.length) {
      setMessage('Downloaded with some issues: ' + currentScheduleErrors.join(' | '), true);
    } else {
      setMessage('Schedule downloaded.', false);
    }
  } catch {
    setMessage('Failed to build schedule.', true);
  } finally {
    button.disabled = false;
  }
});

const _saveScheduleChangesBtn = document.getElementById('saveScheduleChangesBtn');
if (_saveScheduleChangesBtn) _saveScheduleChangesBtn.addEventListener('click', async () => {
  const button = document.getElementById('saveScheduleChangesBtn');
  button.disabled = true;
  try {
    const saveResult = await persistCurrentScheduleChanges();
    if (!saveResult.ok) {
      setMessage(saveResult.error || 'Failed to save schedule changes.', true);
      return;
    }
    setMessage('Saved ' + saveResult.saved + ' schedule change(s).', false);
  } catch {
    setMessage('Failed to save schedule changes.', true);
  } finally {
    button.disabled = false;
  }
});

const cleanerForm = document.getElementById('cleanerForm');
if (cleanerForm) cleanerForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const cleanerId = Number(document.getElementById('cleanerId').value);
  const isEdit = Number.isInteger(cleanerId) && cleanerId > 0;

  const button = document.getElementById('saveCleanerBtn');
  const firstName = document.getElementById('cleanerFirstName').value.trim();
  const lastName = document.getElementById('cleanerLastName').value.trim();
  const email = document.getElementById('cleanerEmail').value.trim();
  const telephone = document.getElementById('cleanerTelephone').value.trim();
  const password = document.getElementById('cleanerPassword').value;

  if (!firstName || !lastName || !email || !telephone) {
    setMessage('First name, last name, email, and telephone are required.', true);
    return;
  }

  if (!isEdit && !password) {
    setMessage('Password is required when adding changeover staff.', true);
    return;
  }

  button.disabled = true;
  try {
    const res = await fetch(
      isEdit ? '/api/cleaners/' + encodeURIComponent(cleanerId) : '/api/cleaners',
      {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email, telephone, password })
      }
    );

    const data = await res.json();
    if (!res.ok) {
      setMessage(data.error || 'Failed to save changeover staff.', true);
      return;
    }

    setMessage(isEdit ? 'Changeover staff updated.' : 'Changeover staff added.', false);
    resetCleanerForm();
    await fetchCleaners();
  } catch {
    setMessage('Network error saving changeover staff.', true);
  } finally {
    button.disabled = false;
  }
});

const cancelCleanerEditBtn = document.getElementById('cancelCleanerEditBtn');
if (cancelCleanerEditBtn) {
  cancelCleanerEditBtn.addEventListener('click', () => {
    resetCleanerForm();
  });
}

const _copyConsolidatedIcsUrlBtn = document.getElementById('copyConsolidatedIcsUrlBtn');
if (_copyConsolidatedIcsUrlBtn) _copyConsolidatedIcsUrlBtn.addEventListener('click', async () => {
  const url = document.getElementById('consolidatedIcsExportUrl').value;
  if (!url) return;

  try {
    await navigator.clipboard.writeText(url);
    const btn = document.getElementById('copyConsolidatedIcsUrlBtn');
    const originalText = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => {
      btn.textContent = originalText;
    }, 1800);
  } catch {
    setMessage('Could not copy consolidated calendar URL.', true);
  }
});

// ── Dashboard tab switching ───────────────────────────────────

(function initDashboardTabs() {
  const STORAGE_KEY = 'dashboardActiveTab';
  const tabBtns = Array.from(document.querySelectorAll('.dashboard-tab-btn'));
  const panels = Array.from(document.querySelectorAll('.dashboard-tab-panel'));

  function getVisibleTabButtons() {
    return tabBtns.filter((btn) => !btn.classList.contains('hidden'));
  }

  function activateTab(panelId) {
    const visibleButtons = getVisibleTabButtons();
    const visiblePanelIds = new Set(visibleButtons.map((btn) => btn.dataset.panel));

    let targetPanelId = panelId;
    if (!targetPanelId || !visiblePanelIds.has(targetPanelId) || !document.getElementById(targetPanelId)) {
      targetPanelId = visibleButtons.length ? visibleButtons[0].dataset.panel : getDefaultPanelForContext(currentDashboardContextMode);
    }

    tabBtns.forEach((btn) => {
      const isTarget = !btn.classList.contains('hidden') && btn.dataset.panel === targetPanelId;
      btn.classList.toggle('active', isTarget);
      btn.setAttribute('aria-selected', String(isTarget));
    });
    panels.forEach((panel) => {
      panel.classList.toggle('hidden', panel.id !== targetPanelId);
    });
    try {
      sessionStorage.setItem(STORAGE_KEY, targetPanelId);
    } catch {
      // ignore
    }
    if (targetPanelId === 'panel-dashboard' && currentDashboardContextMode === 'hosting') {
      refreshDashboardActivity();
      loadEventLog();
    }
    if (targetPanelId === 'panel-guest-reservations') {
      loadGuestReservations();
    }
    if (targetPanelId === 'panel-guest-account') {
      loadGuestAccountProfile();
    }

    return targetPanelId;
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.dataset.panel));
  });

  // restore last tab or default to panel-dashboard
  let initial = 'panel-dashboard';
  let hasExplicitTab = false;
  try {
    const requested = String(new URLSearchParams(window.location.search).get('tab') || '').trim();
    if (requested && document.getElementById(requested)) {
      initial = requested;
      hasExplicitTab = true;
    }
  } catch {
    // ignore
  }
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (!hasExplicitTab && initial === 'panel-dashboard' && saved && document.getElementById(saved)) {
      initial = saved;
    }
  } catch {
    // ignore
  }
  activateTab(initial);

  dashboardTabController = {
    activateTab,
    getActivePanel() {
      const active = document.querySelector('.dashboard-tab-btn.active');
      return active ? String(active.dataset.panel || '') : '';
    }
  };
})();

// ── Consolidated reservations (Ops tab) ──────────────────────

async function loadAllReservations() {
  const tbody = document.getElementById('allReservationsTableBody');
  const msgEl = document.getElementById('allReservationsMessage');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';
  if (msgEl) {
    msgEl.textContent = '';
    msgEl.className = 'message';
  }

  try {
    const res = await fetch('/api/shared-resources/all-reservations');
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }
    if (res.status === 403) {
      tbody.innerHTML = '<tr><td colspan="6">Access restricted.</td></tr>';
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to load reservations.');
    }

    const reservations = Array.isArray(data.reservations) ? data.reservations : [];
    if (!reservations.length) {
      tbody.innerHTML = '<tr><td colspan="6">No reservations found.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    reservations.forEach((row) => {
      const tr = document.createElement('tr');

      const resourceCell = document.createElement('td');
      resourceCell.textContent = row.resource_short_description || ('Resource #' + row.shared_resource_id);

      const guestCell = document.createElement('td');
      guestCell.textContent = ((row.first_name || '') + ' ' + (row.family_name || '')).trim() || row.email_address || '—';

      const startCell = document.createElement('td');
      startCell.textContent = row.requested_start_at ? new Date(row.requested_start_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—';

      const endCell = document.createElement('td');
      endCell.textContent = row.requested_end_at ? new Date(row.requested_end_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—';

      const statusCell = document.createElement('td');
      statusCell.textContent = row.status || '—';

      const actionCell = document.createElement('td');
      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'feed-actions';

      const deleteBtn = createSharedReservationActionButton('✖', 'Delete Reservation', 'resource-delete-btn', () => {
        deleteSharedReservation(row.shared_resource_id, row.id, deleteBtn);
      });

      const statusText = String(row.status || '').trim();
      if (statusText === 'cash') {
        const confirmCashBtn = createSharedReservationActionButton('◍◍$', 'Register Cash Payment Received', 'resource-pay-cash-btn', () => {
          confirmSharedReservationPayment(row.shared_resource_id, row.id, 'Cash Received', confirmCashBtn);
        });
        actionsWrap.appendChild(confirmCashBtn);
      } else if (statusText === 'Awaiting Bank Transfer') {
        const confirmBankBtn = createSharedReservationActionButton('⌂⇄', 'Register Bank Transfer Received', 'resource-pay-bank-btn', () => {
          confirmSharedReservationPayment(row.shared_resource_id, row.id, 'Bank Transfer Confirmed', confirmBankBtn);
        });
        actionsWrap.appendChild(confirmBankBtn);
      }

      actionsWrap.appendChild(deleteBtn);

      actionCell.appendChild(actionsWrap);

      tr.appendChild(resourceCell);
      tr.appendChild(guestCell);
      tr.appendChild(startCell);
      tr.appendChild(endCell);
      tr.appendChild(statusCell);
      tr.appendChild(actionCell);
      tbody.appendChild(tr);
    });
  } catch (err) {
    if (msgEl) {
      msgEl.textContent = err.message || 'Failed to load reservations.';
      msgEl.className = 'message error';
    }
    tbody.innerHTML = '<tr><td colspan="6">—</td></tr>';
  }
}


// -- Tab context menu ------------------------------------------

(function initTabContextMenu() {
  const HOST_SUBMENU_ITEMS = [
    { label: 'Private Reservations', href: '/dashboard-private-reservations.html' },
    { label: 'Facility Reservations', href: '/dashboard-facility-reservations.html' },
    { label: 'Manual Reservations', href: '/dashboard-manual-reservations.html' },
    { label: 'View Logging', href: '/dashboard-view-logging.html' }
  ];

  const GUEST_SUBMENUS = {
    'panel-guest-reservations': [],
    'panel-guest-account': []
  };

  const menuBtn = document.getElementById('tabMenuBtn');
  const menuEl = document.getElementById('tabContextMenu');
  if (!menuBtn || !menuEl) return;

  function hasVisibleTopLevelTabs() {
    return Array.from(document.querySelectorAll('.dashboard-tab-btn'))
      .some((btn) => !btn.classList.contains('hidden'));
  }

  function refreshMenuButtonVisibility() {
    const shouldShow = hasVisibleTopLevelTabs();
    menuBtn.classList.toggle('hidden', !shouldShow);
    if (!shouldShow) {
      menuEl.classList.add('hidden');
      menuBtn.setAttribute('aria-expanded', 'false');
      menuBtn.classList.remove('open');
    }
  }

  function getActivePanel() {
    const active = document.querySelector('.dashboard-tab-btn.active');
    return active ? active.dataset.panel : getDefaultPanelForContext(currentDashboardContextMode);
  }

  function buildMenu(panelId) {
    const items = currentDashboardContextMode === 'guest'
      ? (GUEST_SUBMENUS[panelId] || [])
      : HOST_SUBMENU_ITEMS;
    if (!items.length) {
      menuEl.innerHTML = '<span class="tab-context-menu-empty">No actions for this section.</span>';
    } else {
      menuEl.innerHTML = items.map(function(item) {
        return '<a class="tab-context-menu-item" href="' + item.href + '">' + item.label + '</a>';
      }).join('');
    }
  }

  function openMenu() {
    refreshMenuButtonVisibility();
    if (menuBtn.classList.contains('hidden')) {
      return;
    }
    buildMenu(getActivePanel());
    menuEl.classList.remove('hidden');
    menuBtn.setAttribute('aria-expanded', 'true');
    menuBtn.classList.add('open');
  }

  function closeMenu() {
    menuEl.classList.add('hidden');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.classList.remove('open');
  }

  menuBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (menuEl.classList.contains('hidden')) {
      openMenu();
    } else {
      closeMenu();
    }
  });

  document.addEventListener('click', function() { closeMenu(); });

  menuEl.addEventListener('click', function(e) {
    const item = e.target.closest('.tab-context-menu-item');
    if (item) { closeMenu(); }
  });

  // Rebuild submenu if user changes tab while menu is open
  document.querySelectorAll('.dashboard-tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      refreshMenuButtonVisibility();
      if (!menuEl.classList.contains('hidden')) {
        buildMenu(btn.dataset.panel);
      }
    });
  });

  // Keep menu icon visibility in sync when tab buttons are shown/hidden during context switches.
  const tabButtons = Array.from(document.querySelectorAll('.dashboard-tab-btn'));
  if (tabButtons.length && typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(() => {
      refreshMenuButtonVisibility();
    });
    tabButtons.forEach((btn) => {
      observer.observe(btn, { attributes: true, attributeFilter: ['class'] });
    });
  }

  refreshMenuButtonVisibility();
})();

// ── Calendar Event Log ────────────────────────────────────────

function setEventLogMessage(text, isError) {
  const el = document.getElementById('eventLogMessage');
  if (!el) return;
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function formatEventLogTime(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleDateString([], { dateStyle: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatEventLogType(entryType) {
  const type = String(entryType || '').trim();
  if (type === 'conflict') return '⚠ Conflict';
  if (type === 'reservation_changed') return '✎ Date Change';
  if (type === 'new_reservation') return '+ New';
  if (type === 'sync') return '↻ Sync';
  return type || '—';
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatEventLogDateRange(entry) {
  const startDate = String(entry && (entry.new_start_date || entry.old_start_date) || '').trim();
  const endDate = String(entry && (entry.new_end_date || entry.old_end_date) || '').trim();
  return {
    startDate: startDate || '—',
    endDate: endDate || '—'
  };
}

function formatEventLogDescription(entry) {
  let text = String(entry && entry.description || '—');
  const listingName = String(entry && entry.listing_name || '').trim();
  if (listingName && String(entry && entry.entry_type || '').trim() === 'conflict') {
    text = text.replace(/listing\s+\d+/ig, 'listing "' + listingName + '"');
  }
  return text;
}

function buildEventLogDetailsText(entry, conflictEvents) {
  const dateRange = formatEventLogDateRange(entry);
  const lines = [
    'Type: ' + formatEventLogType(entry && entry.entry_type),
    'Listing: ' + String(entry && entry.listing_name || '—'),
    'Channel: ' + String(entry && (entry.channel_label || entry.channel_id) || '—'),
    'Start Date: ' + dateRange.startDate,
    'End Date: ' + dateRange.endDate,
    'Description: ' + formatEventLogDescription(entry)
  ];

  if (String(entry && entry.entry_type || '').trim() === 'conflict') {
    lines.push('');
    lines.push('All Events In This Conflict: ' + String(Array.isArray(conflictEvents) ? conflictEvents.length : 0));
    if (Array.isArray(conflictEvents) && conflictEvents.length) {
      conflictEvents.forEach((event, index) => {
        lines.push(
          String(index + 1) + '. '
          + 'Summary: ' + String(event && event.summary || 'Reservation')
          + ' | Channel: ' + String(event && event.channel_label || 'Unknown')
          + ' | Listing: ' + String(event && event.listing_name || (entry && entry.listing_name) || '—')
          + ' | Start: ' + String(event && event.start_date || '—')
          + ' | End: ' + String(event && event.end_date || '—')
        );
      });
    } else {
      lines.push('No related conflict events found.');
    }
  }

  return lines.join('\n');
}

async function fetchEventLogDetails(entryId) {
  const id = Number(entryId || 0);
  if (!Number.isInteger(id) || id <= 0) {
    return { entry: null, conflictEvents: [] };
  }

  const res = await fetch('/api/event-log/' + id + '/details');
  if (res.status === 401) {
    window.location.href = '/';
    throw new Error('Your session expired. Please log in again.');
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload.error || 'Failed to load event details.');
  }
  return {
    entry: payload && payload.entry ? payload.entry : null,
    conflictEvents: Array.isArray(payload && payload.conflictEvents) ? payload.conflictEvents : []
  };
}

function getOrCreateEventLogDetailsModalElements() {
  let overlay = document.getElementById('eventLogDetailsOverlay');
  if (overlay) {
    return {
      overlay,
      title: document.getElementById('eventLogDetailsTitle'),
      content: document.getElementById('eventLogDetailsPre')
    };
  }

  overlay = document.createElement('div');
  overlay.id = 'eventLogDetailsOverlay';
  overlay.className = 'event-log-details-overlay hidden';
  overlay.innerHTML = `
    <div class="event-log-details-modal" role="dialog" aria-modal="true" aria-labelledby="eventLogDetailsTitle">
      <div class="event-log-details-header">
        <h3 id="eventLogDetailsTitle">Calendar Event Log Details</h3>
        <button id="eventLogDetailsClose" type="button" class="btn secondary">Close</button>
      </div>
      <pre id="eventLogDetailsPre">Loading...</pre>
    </div>
  `;
  document.body.appendChild(overlay);

  const styleId = 'eventLogDetailsOverlayStyle';
  if (!document.getElementById(styleId)) {
    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = `
      .event-log-details-overlay {
        position: fixed;
        inset: 0;
        z-index: 12000;
        background: rgba(2, 6, 23, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0.9rem;
      }
      .event-log-details-overlay.hidden {
        display: none;
      }
      .event-log-details-modal {
        width: min(980px, 100%);
        max-height: 92vh;
        background: #0f172a;
        color: #e2e8f0;
        border: 1px solid #334155;
        border-radius: 8px;
        display: flex;
        flex-direction: column;
      }
      .event-log-details-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.8rem;
        padding: 0.8rem 0.9rem;
        border-bottom: 1px solid #334155;
      }
      #eventLogDetailsTitle {
        margin: 0;
        font-size: 0.96rem;
        color: #bfdbfe;
      }
      #eventLogDetailsPre {
        margin: 0;
        padding: 0.9rem;
        white-space: pre-wrap;
        word-break: break-word;
        overflow: auto;
        font-family: Consolas, 'Courier New', monospace;
        max-height: calc(92vh - 72px);
      }
    `;
    document.head.appendChild(styleEl);
  }

  const closeBtn = document.getElementById('eventLogDetailsClose');
  closeBtn.addEventListener('click', () => {
    overlay.classList.add('hidden');
  });
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      overlay.classList.add('hidden');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.classList.contains('hidden')) {
      overlay.classList.add('hidden');
    }
  });

  return {
    overlay,
    title: document.getElementById('eventLogDetailsTitle'),
    content: document.getElementById('eventLogDetailsPre')
  };
}

async function openEventLogDetailsTab(entry) {
  const modal = getOrCreateEventLogDetailsModalElements();
  modal.title.textContent = 'Calendar Event Log Details';
  modal.content.textContent = 'Loading...';
  modal.overlay.classList.remove('hidden');

  let detailsEntry = entry;
  let conflictEvents = [];
  try {
    const details = await fetchEventLogDetails(entry && entry.id);
    if (details.entry) {
      detailsEntry = details.entry;
    }
    conflictEvents = details.conflictEvents;
  } catch (err) {
    setEventLogMessage(err.message || 'Failed to load event details.', true);
  }

  modal.content.textContent = buildEventLogDetailsText(detailsEntry, conflictEvents);
}

async function loadEventLog() {
  const tbody = document.getElementById('eventLogTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="5">Loading event log...</td></tr>';
  setEventLogMessage('', false);

  try {
    const res = await fetch('/api/event-log');
    if (res.status === 401) {
      window.location.href = '/';
      return;
    }
    if (res.status === 403) {
      tbody.innerHTML = '<tr><td colspan="5">Access restricted.</td></tr>';
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to load event log.');
    }

    const entries = Array.isArray(data.entries) ? data.entries : [];
    if (!entries.length) {
      tbody.innerHTML = '<tr><td colspan="5">No calendar events logged yet.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    entries.forEach((entry) => {
      const tr = document.createElement('tr');
      if (entry.entry_type === 'conflict') {
        tr.classList.add('conflict-row');
      }

      const timeCell = document.createElement('td');
      timeCell.textContent = formatEventLogTime(entry.created_at);

      const typeCell = document.createElement('td');
      typeCell.textContent = formatEventLogType(entry.entry_type);

      const listingCell = document.createElement('td');
      listingCell.textContent = entry.listing_name || ('Listing #' + entry.listing_id) || '—';

      const channelCell = document.createElement('td');
      channelCell.textContent = entry.channel_label || entry.channel_id || '—';

      const detailsCell = document.createElement('td');
      const infoBtn = document.createElement('button');
      infoBtn.type = 'button';
      infoBtn.className = 'event-log-info-btn';
      infoBtn.textContent = 'i';
      infoBtn.title = 'Open event details';
      infoBtn.setAttribute('aria-label', 'Open event details');
      infoBtn.addEventListener('click', function() {
        openEventLogDetailsTab(entry);
      });
      detailsCell.appendChild(infoBtn);

      tr.appendChild(timeCell);
      tr.appendChild(typeCell);
      tr.appendChild(listingCell);
      tr.appendChild(channelCell);
      tr.appendChild(detailsCell);
      tbody.appendChild(tr);
    });

    setEventLogMessage('', false);
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5">Failed to load event log.</td></tr>';
    setEventLogMessage(err.message || 'Failed to load event log.', true);
  }
}

const _eventLogClearBtn = document.getElementById('eventLogClearBtn');
if (_eventLogClearBtn) _eventLogClearBtn.addEventListener('click', async () => {
  const confirmed = window.confirm('Clear all Calendar Event Log entries for this account? This cannot be undone.');
  if (!confirmed) {
    return;
  }

  _eventLogClearBtn.disabled = true;
  setEventLogMessage('Clearing event log...', false);
  try {
    const res = await fetch('/api/event-log', {
      method: 'DELETE'
    });

    if (res.status === 401) {
      window.location.href = '/';
      return;
    }
    if (res.status === 403) {
      setEventLogMessage('Access restricted.', true);
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setEventLogMessage(data.error || 'Failed to clear event log.', true);
      return;
    }

    setEventLogMessage('Event log cleared (' + String(Number(data.deletedCount || 0)) + ' entries removed).', false);
    await loadEventLog();
  } catch {
    setEventLogMessage('Failed to clear event log.', true);
  } finally {
    _eventLogClearBtn.disabled = false;
  }
});
