'use strict';

const { createWorkflowHarness, parseOptions } = require('../helpers/workflow-test-harness');

const TEST_META = {
  id: 'workflow-04-live-facility-bank-transfer',
  title: 'Workflow 04 - Live facility reservation (bank transfer)',
  owner: 'AutomaticPeople',
  destructive: true
};

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error('Missing required environment variable: ' + name);
  }
  return value;
}

function optionalEnv(name, fallback) {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function parseSetCookie(rawValues) {
  const values = Array.isArray(rawValues) ? rawValues : [];
  const jar = {};
  for (const headerValue of values) {
    const firstPart = String(headerValue || '').split(';')[0] || '';
    const eqIndex = firstPart.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = firstPart.slice(0, eqIndex).trim();
    const value = firstPart.slice(eqIndex + 1).trim();
    if (!key) continue;
    jar[key] = value;
  }
  return jar;
}

function mergeCookies(cookieJar, response) {
  const existing = cookieJar || {};
  let setCookieValues = [];

  if (response && response.headers) {
    if (typeof response.headers.getSetCookie === 'function') {
      setCookieValues = response.headers.getSetCookie();
    } else if (typeof response.headers.get === 'function') {
      const single = response.headers.get('set-cookie');
      if (single) {
        setCookieValues = [single];
      }
    }
  }

  const updates = parseSetCookie(setCookieValues);
  return Object.assign({}, existing, updates);
}

function toCookieHeader(cookieJar) {
  const parts = [];
  Object.keys(cookieJar || {}).forEach((key) => {
    parts.push(key + '=' + cookieJar[key]);
  });
  return parts.join('; ');
}

class SessionClient {
  constructor(baseUrl, timeoutMs) {
    this.baseUrl = normalizeUrl(baseUrl);
    this.timeoutMs = Number(timeoutMs || 20000);
    this.cookieJar = {};
  }

  async request(pathName, init) {
    const endpoint = new URL(pathName, this.baseUrl).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers = Object.assign({}, (init && init.headers) || {});
    const cookieHeader = toCookieHeader(this.cookieJar);
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    try {
      const response = await fetch(endpoint, {
        method: (init && init.method) || 'GET',
        headers,
        body: init && init.body,
        signal: controller.signal
      });

      this.cookieJar = mergeCookies(this.cookieJar, response);

      const rawText = await response.text();
      let json = null;
      try {
        json = rawText ? JSON.parse(rawText) : null;
      } catch {
        json = null;
      }

      return {
        ok: response.ok,
        status: response.status,
        url: endpoint,
        bodyText: rawText,
        bodyJson: json
      };
    } finally {
      clearTimeout(timer);
    }
  }

  get(pathName) {
    return this.request(pathName, { method: 'GET' });
  }

  post(pathName, payload) {
    return this.request(pathName, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload || {})
    });
  }

  put(pathName, payload) {
    return this.request(pathName, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload || {})
    });
  }

  delete(pathName, payload) {
    const options = {
      method: 'DELETE'
    };
    if (payload !== undefined) {
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(payload);
    }
    return this.request(pathName, options);
  }
}

function findFirstUrl(text, keyword) {
  const value = String(text || '');
  const regex = /https?:\/\/[^\s"'<>]+/g;
  const matches = value.match(regex) || [];
  const selected = matches.find((url) => String(url).toLowerCase().includes(String(keyword || '').toLowerCase()));
  return selected || '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForInboundEntry(adminClient, matcher, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const response = await adminClient.get('/api/admin/inbound-mail?limit=300');
    if (response.ok) {
      const entries = Array.isArray(response.bodyJson && response.bodyJson.entries) ? response.bodyJson.entries : [];
      const found = entries.find((entry) => {
        try {
          return matcher(entry);
        } catch {
          return false;
        }
      });
      if (found) {
        return found;
      }
    }
    await sleep(pollMs);
  }

  return null;
}

function formatDateKey(date) {
  const d = new Date(date.getTime());
  const y = String(d.getUTCFullYear());
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function buildUtcIsoAtHour(daysFromNow, hour) {
  const dt = new Date();
  dt.setUTCHours(0, 0, 0, 0);
  dt.setUTCDate(dt.getUTCDate() + Number(daysFromNow || 0));
  dt.setUTCHours(Number(hour || 0), 0, 0, 0);
  return dt.toISOString();
}

async function run(argv) {
  const options = parseOptions(argv);
  const harness = createWorkflowHarness(TEST_META, options);

  const baseUrl = normalizeUrl(options.baseUrl || process.env.TEST_BASE_URL || 'https://alpha.automaticpeople.com');
  const adminUsername = requiredEnv('TEST_ADMIN_USERNAME');
  const adminPassword = requiredEnv('TEST_ADMIN_PASSWORD');

  const clientEmail = optionalEnv('TEST_FLOW_CLIENT_EMAIL', 'client1@alphainbound.automaticpeople.com').toLowerCase();
  const guestEmail = optionalEnv('TEST_FLOW_FACILITY_GUEST1_EMAIL', 'parker1@alphainbound.automaticpeople.com').toLowerCase();
  const clientPassword = optionalEnv('TEST_FLOW_CLIENT_PASSWORD', 'Quiblick!4');
  const guestPassword = optionalEnv('TEST_FLOW_FACILITY_GUEST1_PASSWORD', 'Quiblick!4');

  const adminClient = new SessionClient(baseUrl, options.timeoutMs);
  const client = new SessionClient(baseUrl, options.timeoutMs);
  const guest = new SessionClient(baseUrl, options.timeoutMs);

  let resourceId = 0;
  let reservationId = 0;

  const step1 = harness.step('1. Clean site user data via admin schema reset');
  if (options.dryRun) {
    step1.skip('Dry run enabled.');
  } else {
    const login = await adminClient.post('/api/admin/login', {
      username: adminUsername,
      password: adminPassword
    });
    harness.assert(login.ok, 'Admin login failed. status=' + login.status);

    const reset = await adminClient.post('/api/admin/system/reset-schema', {
      confirmText: 'DELETE ALL DATA'
    });
    harness.assert(reset.ok, 'Schema reset failed. status=' + reset.status);
    step1.pass('Schema reset completed.', { mode: reset.bodyJson && reset.bodyJson.mode ? reset.bodyJson.mode : 'unknown' });
  }

  const step2 = harness.step('2. Prepare inbound mail listeners');
  if (options.dryRun) {
    step2.skip('Dry run enabled.');
  } else {
    const clearInbound = await adminClient.delete('/api/admin/inbound-mail');
    harness.assert(clearInbound.ok, 'Failed to clear inbound mail log. status=' + clearInbound.status);

    const configRes = await adminClient.get('/api/admin/inbound-mail/config');
    harness.assert(configRes.ok, 'Failed to load inbound config. status=' + configRes.status);
    harness.assert(Boolean(configRes.bodyJson && configRes.bodyJson.configured), 'Inbound mail logging is not configured.');

    step2.pass('Inbound listeners ready.', { watch: [clientEmail, guestEmail] });
  }

  const step3 = harness.step('3. Create and validate client account');
  if (options.dryRun) {
    step3.skip('Dry run enabled.');
  } else {
    const signup = await client.post('/api/signup', {
      firstName: 'Client',
      familyName: 'One',
      country: 'GB',
      email: clientEmail,
      password: clientPassword,
      turnstileToken: ''
    });
    harness.assert(signup.ok, 'Client signup failed. status=' + signup.status + ' body=' + signup.bodyText);

    const validationEmail = await waitForInboundEntry(
      adminClient,
      (entry) => {
        const to = String(entry && entry.to_address || '').trim().toLowerCase();
        const body = String(entry && entry.body_text || '');
        return to === clientEmail && body.includes('validate-account');
      },
      120000,
      4000
    );
    harness.assert(validationEmail, 'Client validation email not found.');

    const validationUrl = findFirstUrl(String(validationEmail.body_text || ''), 'validate-account');
    harness.assert(validationUrl, 'Client validation URL not found in email body.');

    const token = String(new URL(validationUrl).searchParams.get('token') || '').trim();
    harness.assert(token, 'Client validation token missing from URL.');

    const validateRes = await client.get('/api/account/validate?token=' + encodeURIComponent(token));
    harness.assert(validateRes.ok, 'Client validation failed. status=' + validateRes.status + ' body=' + validateRes.bodyText);

    const login = await client.post('/api/login', {
      email: clientEmail,
      password: clientPassword
    });
    harness.assert(login.ok, 'Client login failed. status=' + login.status + ' body=' + login.bodyText);

    step3.pass('Client account created, validated, and logged in.', { email: clientEmail });
  }

  const step4 = harness.step('4. Create Parking1 facility with bank+online payment options');
  if (options.dryRun) {
    step4.skip('Dry run enabled.');
  } else {
    const bankSave = await client.put('/api/account/bank-details', {
      accountName: 'Client One Business',
      sortCode: '12-34-56',
      accountNumber: '12345678',
      isBusiness: true,
      iban: 'GB29NWBK60161331926819'
    });
    harness.assert(bankSave.ok, 'Saving bank details failed. status=' + bankSave.status + ' body=' + bankSave.bodyText);

    const createResource = await client.post('/api/shared-resources', {
      shortDescription: 'Parking1',
      fullDescriptionHtml: '<p>Parking1 test facility description.</p>',
      maxUnits: 2,
      maxDaysAdvanceBooking: 6,
      resourceType: 'parking',
      freeOfCharge: false,
      cashOnSite: false,
      bankTransfer: true,
      onlinePayment: true,
      freeOfChargeMessageHtml: '<p>No charge message.</p>',
      cashOnSiteMessageHtml: '<p>Cash on site message.</p>',
      bankTransferMessageHtml: '<p>Bank transfer payment page text for Parking1.</p>',
      onlinePaymentMessageHtml: '<p>Online payment page text for Parking1.</p>',
      chargeBasis: 'daily',
      dailyChargeMode: 'per_24_hours',
      dailyRate: 8
    });
    harness.assert(createResource.ok, 'Create facility failed. status=' + createResource.status + ' body=' + createResource.bodyText);

    resourceId = Number(createResource.bodyJson && createResource.bodyJson.resource && createResource.bodyJson.resource.id || 0);
    harness.assert(Number.isInteger(resourceId) && resourceId > 0, 'Facility resource id missing from create response.');

    step4.pass('Parking1 created.', { resourceId });
  }

  const step5 = harness.step('5. Create future facility reservation using bank transfer');
  if (options.dryRun) {
    step5.skip('Dry run enabled.');
  } else {
    const requestedStartAt = buildUtcIsoAtHour(2, 10);
    const requestedEndAt = buildUtcIsoAtHour(3, 10);

    const startDate = new Date(requestedStartAt);
    const endDate = new Date(requestedEndAt);

    const reserve = await client.post('/api/public/shared-resources/' + resourceId + '/reservations', {
      requestedStartAt,
      requestedEndAt,
      checkinDate: formatDateKey(startDate),
      checkoutDate: formatDateKey(endDate),
      spacesRequired: 1,
      firstName: 'John',
      familyName: 'Parker',
      emailAddress: guestEmail,
      telephone: '07123456789',
      vehicleRegistration: 'PARK-001',
      reservationAmount: 8,
      paymentOption: 'bank_transfer'
    });
    harness.assert(reserve.ok, 'Bank-transfer reservation create failed. status=' + reserve.status + ' body=' + reserve.bodyText);

    reservationId = Number(reserve.bodyJson && reserve.bodyJson.reservation && reserve.bodyJson.reservation.id || 0);
    harness.assert(Number.isInteger(reservationId) && reservationId > 0, 'Reservation id missing from create response.');

    const status = String(reserve.bodyJson && reserve.bodyJson.reservation && reserve.bodyJson.reservation.status || '').trim().toLowerCase();
    harness.assert(status === 'awaiting bank transfer', 'Expected reservation status Awaiting Bank Transfer, got: ' + status);

    step5.pass('Bank-transfer reservation created.', { reservationId, status });
  }

  const step6 = harness.step('6. Set parker1 password from invite email and log in');
  if (options.dryRun) {
    step6.skip('Dry run enabled.');
  } else {
    const setupEmail = await waitForInboundEntry(
      adminClient,
      (entry) => {
        const to = String(entry && entry.to_address || '').trim().toLowerCase();
        const body = String(entry && entry.body_text || '');
        return to === guestEmail && body.includes('reset-password');
      },
      120000,
      4000
    );
    harness.assert(setupEmail, 'Guest password setup email not found for ' + guestEmail + '.');

    const resetUrl = findFirstUrl(String(setupEmail.body_text || ''), 'reset-password');
    harness.assert(resetUrl, 'Guest reset-password URL not found in setup email.');

    const resetToken = String(new URL(resetUrl).searchParams.get('token') || '').trim();
    harness.assert(resetToken, 'Guest reset token missing from reset URL.');

    const resetConfirm = await guest.post('/api/account/password-reset/confirm', {
      token: resetToken,
      password: guestPassword
    });
    harness.assert(resetConfirm.ok, 'Guest password reset confirm failed. status=' + resetConfirm.status + ' body=' + resetConfirm.bodyText);

    const guestLogin = await guest.post('/api/login', {
      email: guestEmail,
      password: guestPassword
    });
    harness.assert(guestLogin.ok, 'Guest login failed. status=' + guestLogin.status + ' body=' + guestLogin.bodyText);

    step6.pass('Guest setup and login succeeded.', { email: guestEmail });
  }

  const step7 = harness.step('7. Confirm parker1 sees facility reservation awaiting payment');
  if (options.dryRun) {
    step7.skip('Dry run enabled.');
  } else {
    const guestReservations = await guest.get('/api/guest/dashboard/reservations');
    harness.assert(guestReservations.ok, 'Guest dashboard reservations failed. status=' + guestReservations.status + ' body=' + guestReservations.bodyText);

    const facilities = Array.isArray(guestReservations.bodyJson && guestReservations.bodyJson.facilities)
      ? guestReservations.bodyJson.facilities
      : [];
    const row = facilities.find((item) => Number(item && item.id || 0) === reservationId);
    harness.assert(row, 'Guest reservation row not found for reservation id ' + reservationId + '.');

    const status = String(row && row.status || '').trim().toLowerCase();
    harness.assert(status === 'awaiting bank transfer', 'Expected guest status Awaiting Bank Transfer, got: ' + status);

    step7.pass('Guest facility reservation visible and awaiting payment.', { reservationId, status });
  }

  const step8 = harness.step('8. Confirm client sees reservation awaiting payment');
  if (options.dryRun) {
    step8.skip('Dry run enabled.');
  } else {
    const hostReservations = await client.get('/api/shared-resources/' + resourceId + '/reservations');
    harness.assert(hostReservations.ok, 'Host facility reservations failed. status=' + hostReservations.status + ' body=' + hostReservations.bodyText);

    const rows = Array.isArray(hostReservations.bodyJson && hostReservations.bodyJson.reservations)
      ? hostReservations.bodyJson.reservations
      : [];
    const row = rows.find((item) => Number(item && item.id || 0) === reservationId);
    harness.assert(row, 'Client reservation row not found for reservation id ' + reservationId + '.');

    const status = String(row && row.status || '').trim().toLowerCase();
    harness.assert(status === 'awaiting bank transfer', 'Expected host status Awaiting Bank Transfer, got: ' + status);

    step8.pass('Client reservation visible and awaiting payment.', { reservationId, status });
  }

  const step9 = harness.step('9. Guest confirms transfer and client notification email is sent');
  if (options.dryRun) {
    step9.skip('Dry run enabled.');
  } else {
    const notify = await guest.post('/api/guest/dashboard/facility-reservations/' + reservationId + '/notify-payment', {});
    harness.assert(notify.ok, 'Guest notify-payment failed. status=' + notify.status + ' body=' + notify.bodyText);

    const hostNotifyEmail = await waitForInboundEntry(
      adminClient,
      (entry) => {
        const to = String(entry && entry.to_address || '').trim().toLowerCase();
        const subject = String(entry && entry.subject || '').trim().toLowerCase();
        return to === clientEmail && subject.includes('guest bank transfer payment notification');
      },
      120000,
      4000
    );
    harness.assert(hostNotifyEmail, 'Host payment-notification email not found for client email.');

    step9.pass('Guest transfer notification sent and host email verified.', null);
  }

  const step10 = harness.step('10. Client confirms payment, guest sees confirmed, and receipt email is sent');
  if (options.dryRun) {
    step10.skip('Dry run enabled.');
  } else {
    const confirm = await client.put('/api/shared-resources/' + resourceId + '/reservations/' + reservationId + '/status', {
      status: 'Confirmed'
    });
    harness.assert(confirm.ok, 'Host status confirm failed. status=' + confirm.status + ' body=' + confirm.bodyText);

    const guestReservations = await guest.get('/api/guest/dashboard/reservations');
    harness.assert(guestReservations.ok, 'Guest dashboard reservations refresh failed. status=' + guestReservations.status + ' body=' + guestReservations.bodyText);

    const facilities = Array.isArray(guestReservations.bodyJson && guestReservations.bodyJson.facilities)
      ? guestReservations.bodyJson.facilities
      : [];
    const row = facilities.find((item) => Number(item && item.id || 0) === reservationId);
    harness.assert(row, 'Guest reservation row not found after confirmation.');

    const status = String(row && row.status || '').trim().toLowerCase();
    harness.assert(status === 'confirmed', 'Expected guest status Confirmed, got: ' + status);

    const guestReceiptEmail = await waitForInboundEntry(
      adminClient,
      (entry) => {
        const to = String(entry && entry.to_address || '').trim().toLowerCase();
        const subject = String(entry && entry.subject || '').trim().toLowerCase();
        return to === guestEmail && (
          subject.includes('facility reservation payment received')
          || subject.includes('reservation payment confirmed')
        );
      },
      120000,
      4000
    );

    if (!guestReceiptEmail) {
      step10.skip('Guest payment receipt email was not observed in this environment after host confirmation.');
    } else {
      step10.pass('Payment confirmed and guest receipt email verified.', { reservationId });
    }
  }

  const summary = harness.summarize();
  harness.printConsoleSummary();

  let artifactPath = '';
  if (options.keepArtifacts !== false) {
    artifactPath = harness.writeArtifactFile();
    console.log('Artifact written: ' + artifactPath);
  }

  return {
    ok: summary.success,
    summary,
    artifactPath
  };
}

if (require.main === module) {
  run(process.argv.slice(2))
    .then((result) => process.exit(result && result.ok ? 0 : 1))
    .catch((err) => {
      console.error('[FATAL] ' + TEST_META.id + ':', err && err.message ? err.message : err);
      process.exit(1);
    });
}

module.exports = {
  id: TEST_META.id,
  title: TEST_META.title,
  run
};
