'use strict';

const params = new URLSearchParams(window.location.search);
const landingPageIdParam = Number(params.get('id'));
const isCreateMode = String(params.get('new') || '').trim() === '1' || !(Number.isInteger(landingPageIdParam) && landingPageIdParam > 0);
let landingPageId = Number.isInteger(landingPageIdParam) && landingPageIdParam > 0 ? landingPageIdParam : null;
let canManageLandingPages = false;
let currentPublicSlug = '';
let currentFacilities = [];

function setLandingPageMessage(text, isError) {
  const el = document.getElementById('landingPageMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function goBackToConfig() {
  window.location.href = '/dashboard.html?tab=panel-config';
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function getDescriptionHtml() {
  return String(document.getElementById('landingDescriptionEditor').innerHTML || '').trim();
}

function getNotesHtml() {
  return String(document.getElementById('landingNotesEditor').innerHTML || '').trim();
}

function buildPublicUrl(slug) {
  const cleanSlug = String(slug || '').trim();
  if (!cleanSlug) {
    return '';
  }
  return window.location.origin + '/resource-booking.html?facilityLandingPage=' + encodeURIComponent(cleanSlug);
}

function refreshPublicUrlDisplay() {
  const input = document.getElementById('landingPagePublicUrl');
  const copyBtn = document.getElementById('copyLandingPagePublicUrlBtn');
  const previewSlug = currentPublicSlug || slugify(document.getElementById('landingPageName').value || '');
  const url = buildPublicUrl(previewSlug);
  input.value = url;
  copyBtn.disabled = !url;
}

function applyEditorCommand(command, targetId) {
  const editor = document.getElementById(targetId);
  if (!editor) {
    return;
  }
  editor.focus();
  document.execCommand(command, false, null);
  editor.focus();
}

function renderFacilitySelection(selectedFacilityId) {
  const select = document.getElementById('landingPageFacility');
  if (!select) {
    return;
  }

  const target = Number(selectedFacilityId || 0);
  select.innerHTML = '<option value="">Select one facility</option>';

  if (!currentFacilities.length) {
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = 'No facilities available';
    select.appendChild(emptyOption);
    return;
  }

  currentFacilities.forEach((facility) => {
    const option = document.createElement('option');
    option.value = String(facility.id);
    const name = String(facility.short_description || ('Facility #' + facility.id));
    option.textContent = name;
    if (Number(facility.id) === target) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

function setPaymentMethodSelection(nextMethod) {
  const bank = document.getElementById('landingPaymentBankTransfer');
  const online = document.getElementById('landingPaymentOnline');
  if (!bank || !online) {
    return;
  }
  bank.checked = nextMethod === 'bank_transfer';
  online.checked = nextMethod === 'online';
}

function getSelectedPaymentMethod() {
  const bank = document.getElementById('landingPaymentBankTransfer');
  const online = document.getElementById('landingPaymentOnline');
  const bankChecked = bank && bank.checked;
  const onlineChecked = online && online.checked;
  if (bankChecked === onlineChecked) {
    return null;
  }
  return bankChecked ? 'bank_transfer' : 'online';
}

function getPayload() {
  const name = String(document.getElementById('landingPageName').value || '').trim();
  const descriptionHtml = getDescriptionHtml();
  const notesHtml = getNotesHtml();
  const isActive = !!document.getElementById('landingPageIsActive').checked;
  const sharedResourceId = Number(document.getElementById('landingPageFacility').value || 0);

  if (!name) {
    return { error: 'Page Title is required.' };
  }

  const publicSlug = currentPublicSlug || slugify(name);
  if (!publicSlug) {
    return { error: 'Public URL could not be generated.' };
  }

  if (!Number.isInteger(sharedResourceId) || sharedResourceId <= 0) {
    return { error: 'Select one facility.' };
  }

  const paymentMethod = getSelectedPaymentMethod();
  if (!paymentMethod) {
    return { error: 'Check exactly one payment method: Bank Transfer or Online.' };
  }

  return {
    payload: {
      name,
      publicSlug,
      descriptionHtml,
      notesHtml,
      sharedResourceId,
      paymentMethod,
      isActive
    }
  };
}

async function loadFacilities() {
  const response = await fetch('/api/shared-resources');
  if (response.status === 401) {
    window.location.href = '/';
    return;
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load facilities.');
  }

  currentFacilities = Array.isArray(data.resources) ? data.resources : [];
  renderFacilitySelection(null);
}

async function loadLandingPage() {
  const response = await fetch('/api/facility-enquiry-landing-pages/' + encodeURIComponent(landingPageId));
  if (response.status === 401) {
    window.location.href = '/';
    return;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load landing page.');
  }

  const landingPage = data.landingPage || {};
  document.getElementById('landingPageTitle').textContent = 'Landing Page: ' + (landingPage.name || ('#' + landingPage.id));
  document.getElementById('landingPageName').value = landingPage.name || '';
  currentPublicSlug = String(landingPage.public_slug || '');
  document.getElementById('landingDescriptionEditor').innerHTML = landingPage.description_html || '';
  document.getElementById('landingNotesEditor').innerHTML = landingPage.notes_html || '';
  renderFacilitySelection(landingPage.shared_resource_id);
  setPaymentMethodSelection(landingPage.payment_method || 'bank_transfer');
  document.getElementById('landingPageIsActive').checked = landingPage.is_active !== false;
  refreshPublicUrlDisplay();
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
    canManageLandingPages = activeRole === 'Client' || activeRole === 'Manager';

    await loadFacilities();

    if (isCreateMode) {
      document.getElementById('landingPageTitle').textContent = 'Create Facility Enquiry Landing Page';
      document.getElementById('deleteLandingPageBtn').classList.add('hidden');
      setPaymentMethodSelection('bank_transfer');
      refreshPublicUrlDisplay();
      return;
    }

    await loadLandingPage();

    if (!canManageLandingPages) {
      document.getElementById('saveLandingPageBtn').disabled = true;
      document.getElementById('deleteLandingPageBtn').disabled = true;
      setLandingPageMessage('Read-only access: your role cannot edit landing pages.', false);

      const form = document.getElementById('landingPageForm');
      if (form) {
        Array.from(form.querySelectorAll('input, select, textarea, button, [contenteditable="true"]')).forEach((el) => {
          if (el.id === 'landingPagePublicUrl' || el.id === 'copyLandingPagePublicUrlBtn') {
            return;
          }
          if (el.id === 'landingDescriptionEditor' || el.id === 'landingNotesEditor') {
            el.contentEditable = 'false';
            return;
          }
          el.disabled = true;
        });
      }
    }

    refreshPublicUrlDisplay();
  } catch (err) {
    setLandingPageMessage(err.message || 'Failed to load landing page.', true);
  }
})();

document.getElementById('landingPageName').addEventListener('input', () => {
  if (!currentPublicSlug) {
    refreshPublicUrlDisplay();
  }
});

Array.from(document.querySelectorAll('.landing-editor-btn')).forEach((btn) => {
  btn.addEventListener('click', () => {
    applyEditorCommand(btn.getAttribute('data-command'), btn.getAttribute('data-target'));
  });
});

document.getElementById('landingPaymentBankTransfer').addEventListener('change', () => {
  if (document.getElementById('landingPaymentBankTransfer').checked) {
    document.getElementById('landingPaymentOnline').checked = false;
  }
});

document.getElementById('landingPaymentOnline').addEventListener('change', () => {
  if (document.getElementById('landingPaymentOnline').checked) {
    document.getElementById('landingPaymentBankTransfer').checked = false;
  }
});

document.getElementById('copyLandingPagePublicUrlBtn').addEventListener('click', async () => {
  const url = String(document.getElementById('landingPagePublicUrl').value || '').trim();
  if (!url) {
    return;
  }
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(url);
    } else {
      const temp = document.createElement('textarea');
      temp.value = url;
      temp.setAttribute('readonly', 'readonly');
      temp.style.position = 'fixed';
      temp.style.opacity = '0';
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
    }
    setLandingPageMessage('Public URL copied.', false);
  } catch {
    setLandingPageMessage('Could not copy public URL.', true);
  }
});

document.getElementById('landingPageForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!canManageLandingPages) {
    setLandingPageMessage('Your role cannot save landing pages.', true);
    return;
  }

  let body;
  try {
    body = getPayload();
  } catch (err) {
    setLandingPageMessage(err.message || 'Landing page details are invalid.', true);
    return;
  }

  if (body.error) {
    setLandingPageMessage(body.error, true);
    return;
  }

  const button = document.getElementById('saveLandingPageBtn');
  button.disabled = true;

  try {
    const endpoint = isCreateMode
      ? '/api/facility-enquiry-landing-pages'
      : ('/api/facility-enquiry-landing-pages/' + encodeURIComponent(landingPageId));
    const method = isCreateMode ? 'POST' : 'PUT';

    const response = await fetch(endpoint, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body.payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to save landing page.');
    }

    const saved = data.landingPage || {};
    setLandingPageMessage('Landing page saved.', false);

    if (saved.public_slug) {
      currentPublicSlug = String(saved.public_slug || '');
      refreshPublicUrlDisplay();
    }

    goBackToConfig();
    return;
  } catch (err) {
    setLandingPageMessage(err.message || 'Failed to save landing page.', true);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('deleteLandingPageBtn').addEventListener('click', async () => {
  if (isCreateMode) {
    return;
  }

  if (!canManageLandingPages) {
    setLandingPageMessage('Your role cannot delete landing pages.', true);
    return;
  }

  if (!window.confirm('Delete this landing page?')) {
    return;
  }

  const button = document.getElementById('deleteLandingPageBtn');
  button.disabled = true;

  try {
    const response = await fetch('/api/facility-enquiry-landing-pages/' + encodeURIComponent(landingPageId), {
      method: 'DELETE'
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete landing page.');
    }

    goBackToConfig();
  } catch (err) {
    setLandingPageMessage(err.message || 'Failed to delete landing page.', true);
    button.disabled = false;
  }
});

document.getElementById('backBtn').addEventListener('click', goBackToConfig);
document.getElementById('cancelLandingPageBtn').addEventListener('click', goBackToConfig);
