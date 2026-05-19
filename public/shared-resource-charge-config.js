'use strict';

const params = new URLSearchParams(window.location.search);
const resourceIdParam = Number(params.get('id'));
const isCreateMode = String(params.get('new') || '').trim() === '1' || !(Number.isInteger(resourceIdParam) && resourceIdParam > 0);
const resourceId = Number.isInteger(resourceIdParam) && resourceIdParam > 0 ? resourceIdParam : null;
const SHARED_RESOURCE_DRAFT_KEY = 'sharedResourceDraftState';

let currentDraft = null;
let initialChargeFormState = '';
let suppressBeforeunload = false;

function setChargeConfigMessage(text, isError) {
  const el = document.getElementById('chargeConfigMessage');
  if (!el) {
    return;
  }
  el.textContent = text || '';
  el.className = text ? ('message ' + (isError ? 'error' : 'success')) : 'message';
}

function goBackToSharedResource() {
  suppressBeforeunload = true;
  window.location.href = isCreateMode
    ? '/shared-resource.html?new=1'
    : ('/shared-resource.html?id=' + encodeURIComponent(resourceId));
}

function createDefaultHourlyRates() {
  return Array.from({ length: 24 }, () => '');
}

function ensureHourlyRatesLength(values) {
  const next = Array.isArray(values) ? values.slice(0, 24) : [];
  while (next.length < 24) {
    next.push('');
  }
  return next.map((value) => (value === null || value === undefined ? '' : String(value)));
}

function getChargeFormState() {
  return JSON.stringify({
    chargeBasis: document.querySelector('input[name="chargeBasis"]:checked') ? document.querySelector('input[name="chargeBasis"]:checked').value : '',
    dailyChargeMode: document.querySelector('input[name="dailyChargeMode"]:checked') ? document.querySelector('input[name="dailyChargeMode"]:checked').value : '',
    dailyRate: String(document.getElementById('dailyRate').value || ''),
    hourlyChargeMode: document.querySelector('input[name="hourlyChargeMode"]:checked') ? document.querySelector('input[name="hourlyChargeMode"]:checked').value : '',
    hourlyRate: String(document.getElementById('singleHourlyRate').value || ''),
    hourlyRates: Array.from(document.querySelectorAll('#hourlyRateGrid input')).map((input) => String(input.value || ''))
  });
}

function hasUnsavedChanges() {
  return getChargeFormState() !== initialChargeFormState;
}

function confirmDiscardChanges() {
  if (!hasUnsavedChanges()) {
    return true;
  }
  return window.confirm('You have unsaved changes. Cancel changes and continue?');
}

function getDraftPayload() {
  if (!currentDraft || typeof currentDraft !== 'object') {
    return {
      resourceId,
      isCreateMode,
      chargeConfig: null
    };
  }
  return currentDraft;
}

function setDraftPayload(nextDraft) {
  currentDraft = nextDraft;
  try {
    sessionStorage.setItem(SHARED_RESOURCE_DRAFT_KEY, JSON.stringify(nextDraft));
  } catch {
    // ignore
  }
}

function readDraftPayload() {
  try {
    const raw = sessionStorage.getItem(SHARED_RESOURCE_DRAFT_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    if (Boolean(parsed.isCreateMode) !== Boolean(isCreateMode)) {
      return null;
    }
    if (!isCreateMode && Number(parsed.resourceId) !== Number(resourceId)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function buildChargeConfigDraft() {
  const chargeBasis = document.querySelector('input[name="chargeBasis"]:checked');
  const dailyChargeMode = document.querySelector('input[name="dailyChargeMode"]:checked');
  const hourlyChargeMode = document.querySelector('input[name="hourlyChargeMode"]:checked');

  return {
    chargeBasis: chargeBasis ? chargeBasis.value : null,
    dailyChargeMode: dailyChargeMode ? dailyChargeMode.value : null,
    dailyRate: String(document.getElementById('dailyRate').value || '').trim(),
    hourlyChargeMode: hourlyChargeMode ? hourlyChargeMode.value : null,
    hourlyRate: String(document.getElementById('singleHourlyRate').value || '').trim(),
    hourlyRates: Array.from(document.querySelectorAll('#hourlyRateGrid input')).map((input) => String(input.value || '').trim())
  };
}

function validateChargeConfigDraft(draft) {
  const freeOfCharge = Boolean(currentDraft && currentDraft.freeOfCharge);
  if (freeOfCharge) {
    return {
      chargeBasis: null,
      dailyChargeMode: null,
      dailyRate: '',
      hourlyChargeMode: null,
      hourlyRate: '',
      hourlyRates: createDefaultHourlyRates()
    };
  }

  if (!draft.chargeBasis) {
    return { error: 'Select a charge basis.' };
  }

  if (draft.chargeBasis === 'daily') {
    if (!draft.dailyChargeMode) {
      return { error: 'Select either Per 24 hours or Per Calendar Day.' };
    }
    const dailyRateValue = draft.dailyRate === '' ? null : Number(draft.dailyRate);
    if (dailyRateValue === null || !Number.isFinite(dailyRateValue) || dailyRateValue < 0) {
      return { error: 'Enter a valid daily rate.' };
    }
    return {
      chargeBasis: 'daily',
      dailyChargeMode: draft.dailyChargeMode,
      dailyRate: dailyRateValue.toFixed(2),
      hourlyChargeMode: null,
      hourlyRate: '',
      hourlyRates: createDefaultHourlyRates()
    };
  }

  if (!draft.hourlyChargeMode) {
    return { error: 'Select how hourly charging should work.' };
  }

  if (draft.hourlyChargeMode === 'single_rate') {
    const value = draft.hourlyRate === '' ? null : Number(draft.hourlyRate);
    if (value === null || !Number.isFinite(value) || value < 0) {
      return { error: 'Enter a valid hourly rate.' };
    }
    return {
      chargeBasis: 'hourly',
      dailyChargeMode: null,
      dailyRate: '',
      hourlyChargeMode: 'single_rate',
      hourlyRate: value.toFixed(2),
      hourlyRates: createDefaultHourlyRates()
    };
  }

  const hourlyRates = ensureHourlyRatesLength(draft.hourlyRates);
  const invalid = hourlyRates.some((value) => {
    if (value === '') {
      return true;
    }
    const numeric = Number(value);
    return !Number.isFinite(numeric) || numeric < 0;
  });
  if (invalid) {
    return { error: 'Enter a valid hourly rate for each of the 24 hours.' };
  }

  return {
    chargeBasis: 'hourly',
    dailyChargeMode: null,
    dailyRate: '',
    hourlyChargeMode: 'per_hour_of_day',
    hourlyRate: '',
    hourlyRates: hourlyRates.map((value) => Number(value).toFixed(2))
  };
}

function syncChargeUiVisibility() {
  const chargeBasis = document.querySelector('input[name="chargeBasis"]:checked');
  const basisValue = chargeBasis ? chargeBasis.value : null;
  const dailyWrap = document.getElementById('dailyChargeOptions');
  const hourlyWrap = document.getElementById('hourlyChargeOptions');
  const singleWrap = document.getElementById('singleHourlyRateWrap');
  const hourlyGrid = document.getElementById('hourlyRateGrid');
  const dailyModeInputs = Array.from(document.querySelectorAll('input[name="dailyChargeMode"]'));
  const hourlyModeInputs = Array.from(document.querySelectorAll('input[name="hourlyChargeMode"]'));
  const dailyRateInput = document.getElementById('dailyRate');
  const singleHourlyRate = document.getElementById('singleHourlyRate');
  const hourlyGridInputs = Array.from(document.querySelectorAll('#hourlyRateGrid input'));
  const hourlyChargeMode = document.querySelector('input[name="hourlyChargeMode"]:checked');

  const freeOfCharge = Boolean(currentDraft && currentDraft.freeOfCharge);
  const disabled = freeOfCharge;

  dailyWrap.classList.remove('hidden');
  hourlyWrap.classList.remove('hidden');
  dailyModeInputs.forEach((input) => {
    input.disabled = disabled;
  });
  hourlyModeInputs.forEach((input) => {
    input.disabled = disabled;
  });
  dailyRateInput.disabled = disabled;
  singleHourlyRate.disabled = disabled || !hourlyChargeMode || hourlyChargeMode.value !== 'single_rate';
  hourlyGridInputs.forEach((input) => {
    input.disabled = disabled || !hourlyChargeMode || hourlyChargeMode.value !== 'per_hour_of_day';
  });

  dailyWrap.classList.toggle('resource-dialog-fieldset-disabled', basisValue === 'hourly' || disabled);
  hourlyWrap.classList.toggle('resource-dialog-fieldset-disabled', basisValue === 'daily' || disabled);
  singleWrap.classList.toggle('hidden', !hourlyChargeMode || hourlyChargeMode.value !== 'single_rate');
  hourlyGrid.classList.toggle('hidden', !hourlyChargeMode || hourlyChargeMode.value !== 'per_hour_of_day');
}

function renderHourlyRateGrid(hourlyRates) {
  const container = document.getElementById('hourlyRateGrid');
  container.innerHTML = '';

  ensureHourlyRatesLength(hourlyRates).forEach((value, index) => {
    const row = document.createElement('div');
    row.className = 'resource-hourly-row';

    const label = document.createElement('label');
    label.setAttribute('for', 'hourlyRate_' + index);
    label.textContent = String(index).padStart(2, '0') + ':00';

    const input = document.createElement('input');
    input.id = 'hourlyRate_' + index;
    input.type = 'number';
    input.min = '0';
    input.step = '0.01';
    input.inputMode = 'decimal';
    input.value = value;

    row.appendChild(label);
    row.appendChild(input);
    container.appendChild(row);
  });
}

function populateFormFromChargeConfig(chargeConfig) {
  document.getElementById('chargeBasisDaily').checked = chargeConfig.chargeBasis === 'daily';
  document.getElementById('chargeBasisHourly').checked = chargeConfig.chargeBasis === 'hourly';
  document.getElementById('dailyChargePer24Hours').checked = chargeConfig.dailyChargeMode === 'per_24_hours';
  document.getElementById('dailyChargePerCalendarDay').checked = chargeConfig.dailyChargeMode === 'per_calendar_day';
  document.getElementById('dailyRate').value = chargeConfig.dailyRate || '';
  document.getElementById('hourlyChargeSingleRate').checked = chargeConfig.hourlyChargeMode === 'single_rate';
  document.getElementById('hourlyChargePerHourOfDay').checked = chargeConfig.hourlyChargeMode === 'per_hour_of_day';
  document.getElementById('singleHourlyRate').value = chargeConfig.hourlyRate || '';
  renderHourlyRateGrid(chargeConfig.hourlyRates || []);
  syncChargeUiVisibility();
}

function collectCurrentChargeConfig() {
  return buildChargeConfigDraft();
}

function applyDraftToUi(draft) {
  currentDraft = draft || {
    resourceId,
    isCreateMode,
    freeOfCharge: false,
    chargeConfig: {
      chargeBasis: null,
      dailyChargeMode: null,
      dailyRate: '',
      hourlyChargeMode: null,
      hourlyRate: '',
      hourlyRates: createDefaultHourlyRates()
    }
  };

  const chargeConfig = currentDraft.chargeConfig || {
    chargeBasis: null,
    dailyChargeMode: null,
    dailyRate: '',
    hourlyChargeMode: null,
    hourlyRate: '',
    hourlyRates: createDefaultHourlyRates()
  };

  document.getElementById('chargeConfigTitle').textContent = currentDraft.freeOfCharge
    ? 'Configure Charges'
    : 'Configure Charges';
  document.getElementById('chargeConfigHelp').textContent = currentDraft.freeOfCharge
    ? 'Charge logic is currently ignored because Free Of Charge is enabled on the facility form.'
    : 'Choose how the facility should calculate charge logic.';

  populateFormFromChargeConfig({
    chargeBasis: chargeConfig.chargeBasis,
    dailyChargeMode: chargeConfig.dailyChargeMode,
    dailyRate: chargeConfig.dailyRate,
    hourlyChargeMode: chargeConfig.hourlyChargeMode,
    hourlyRate: chargeConfig.hourlyRate,
    hourlyRates: ensureHourlyRatesLength(chargeConfig.hourlyRates || [])
  });

  initialChargeFormState = getChargeFormState();
}

function persistCurrentChargeConfigAndReturn(chargeConfig) {
  const draft = currentDraft && typeof currentDraft === 'object' ? currentDraft : getDraftPayload();
  draft.chargeConfig = chargeConfig;
  currentDraft = draft;
  setDraftPayload(draft);
  suppressBeforeunload = true;
  goBackToSharedResource();
}

async function loadChargeConfigContext() {
  const draft = readDraftPayload();
  if (draft) {
    applyDraftToUi(draft);
    return;
  }

  if (isCreateMode) {
    applyDraftToUi({
      resourceId,
      isCreateMode,
      freeOfCharge: false,
      chargeConfig: {
        chargeBasis: null,
        dailyChargeMode: null,
        dailyRate: '',
        hourlyChargeMode: null,
        hourlyRate: '',
        hourlyRates: createDefaultHourlyRates()
      }
    });
    return;
  }

  const meRes = await fetch('/api/me');
  if (!meRes.ok) {
    window.location.href = '/';
    return;
  }

  const res = await fetch('/api/shared-resources/' + resourceId);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load facility charge settings.');
  }

  const resource = data.resource || {};
  applyDraftToUi({
    resourceId,
    isCreateMode,
    freeOfCharge: resource.free_of_charge === true,
    chargeConfig: {
      chargeBasis: resource.charge_basis || null,
      dailyChargeMode: resource.daily_charge_mode || null,
      dailyRate: resource.daily_rate === null || resource.daily_rate === undefined ? '' : String(resource.daily_rate),
      hourlyChargeMode: resource.hourly_charge_mode || null,
      hourlyRate: resource.hourly_rate === null || resource.hourly_rate === undefined ? '' : String(resource.hourly_rate),
      hourlyRates: ensureHourlyRatesLength(resource.hourly_rates || [])
    }
  });
}

(async () => {
  try {
    await loadChargeConfigContext();
  } catch (err) {
    setChargeConfigMessage(err.message || 'Unable to load charge configuration.', true);
  }
})();

document.querySelectorAll('input[name="chargeBasis"]').forEach((input) => {
  input.addEventListener('change', () => {
    syncChargeUiVisibility();
  });
});

document.querySelectorAll('input[name="dailyChargeMode"]').forEach((input) => {
  input.addEventListener('change', () => {
    syncChargeUiVisibility();
  });
});

document.querySelectorAll('input[name="hourlyChargeMode"]').forEach((input) => {
  input.addEventListener('change', () => {
    syncChargeUiVisibility();
  });
});

document.getElementById('dailyRate').addEventListener('input', () => {
  // state read on save
});

document.getElementById('singleHourlyRate').addEventListener('input', () => {
  // state read on save
});

document.getElementById('saveChargeConfigBtn').addEventListener('click', () => {
  const currentDraftPayload = getDraftPayload();
  const draft = collectCurrentChargeConfig();
  const validated = validateChargeConfigDraft(draft);
  if (validated.error) {
    setChargeConfigMessage(validated.error, true);
    return;
  }

  currentDraftPayload.chargeConfig = validated;
  currentDraft = currentDraftPayload;
  setChargeConfigMessage('Charge logic saved.', false);
  persistCurrentChargeConfigAndReturn(validated);
});

document.getElementById('cancelChargeConfigBtn').addEventListener('click', () => {
  if (!confirmDiscardChanges()) {
    return;
  }
  goBackToSharedResource();
});

document.getElementById('backBtn').addEventListener('click', () => {
  if (!confirmDiscardChanges()) {
    return;
  }
  goBackToSharedResource();
});

window.addEventListener('beforeunload', (event) => {
  if (suppressBeforeunload) {
    return;
  }
  if (!hasUnsavedChanges()) {
    return;
  }
  event.preventDefault();
  event.returnValue = '';
});
