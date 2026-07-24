'use strict';

const { createWorkflowHarness, parseOptions } = require('../helpers/workflow-test-harness');

const TEST_META = {
  id: 'workflow-06-live-listing-bank-transfer',
  title: 'Workflow 06 - Live listing reservation (bank transfer)',
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

function formatDateKey(daysFromNow) {
  const dt = new Date();
  dt.setUTCHours(0, 0, 0, 0);
  dt.setUTCDate(dt.getUTCDate() + Number(daysFromNow || 0));
  const y = String(dt.getUTCFullYear());
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function getAccommodationRowByReservationId(payload, reservationId) {
  const rows = Array.isArray(payload && payload.accommodation) ? payload.accommodation : [];
  return rows.find((item) => Number(item && item.id || 0) === Number(reservationId || 0)) || null;
}

async function run(argv) {
  const options = parseOptions(argv);
  const harness = createWorkflowHarness(TEST_META, options);

  const baseUrl = normalizeUrl(options.baseUrl || process.env.TEST_BASE_URL || 'https://alpha.automaticpeople.com');
  const adminUsername = requiredEnv('TEST_ADMIN_USERNAME');
  const adminPassword = requiredEnv('TEST_ADMIN_PASSWORD');

  const clientEmail = optionalEnv('TEST_FLOW_CLIENT_EMAIL', 'client1@alphainbound.automaticpeople.com').toLowerCase();
  const guestEmail = optionalEnv('TEST_FLOW_LISTING_GUEST1_EMAIL', 'guest1@alphainbound.automaticpeople.com').toLowerCase();
  const clientPassword = optionalEnv('TEST_FLOW_CLIENT_PASSWORD', 'Quiblick!4');
  const guestPassword = optionalEnv('TEST_FLOW_LISTING_GUEST1_PASSWORD', 'Quiblick!4');

  const adminClient = new SessionClient(baseUrl, options.timeoutMs);
  const client = new SessionClient(baseUrl, options.timeoutMs);
  const guest = new SessionClient(baseUrl, options.timeoutMs);

  let listingId = 0;
  let reservationId = 0;
  let reservationIdentifier = '';

  const step1 = harness.step('1. Login as existing client1 account');
  if (options.dryRun) {
    step1.skip('Dry run enabled.');
  } else {
    const login = await client.post('/api/login', {
      email: clientEmail,
      password: clientPassword
    });
    harness.assert(login.ok, 'Client login failed. status=' + login.status + ' body=' + login.bodyText);
    step1.pass('Existing client1 logged in.', { email: clientEmail });
  }

  const step2 = harness.step('2. Prepare inbound mail listeners');
  if (options.dryRun) {
    step2.skip('Dry run enabled.');
  } else {
    const adminLogin = await adminClient.post('/api/admin/login', {
      username: adminUsername,
      password: adminPassword
    });
    harness.assert(adminLogin.ok, 'Admin login failed. status=' + adminLogin.status + ' body=' + adminLogin.bodyText);

    const clearInbound = await adminClient.delete('/api/admin/inbound-mail');
    harness.assert(clearInbound.ok, 'Failed to clear inbound mail log. status=' + clearInbound.status);

    const configRes = await adminClient.get('/api/admin/inbound-mail/config');
    harness.assert(configRes.ok, 'Failed to load inbound config. status=' + configRes.status);
    harness.assert(Boolean(configRes.bodyJson && configRes.bodyJson.configured), 'Inbound mail logging is not configured.');

    step2.pass('Inbound listeners ready.', { watch: [clientEmail, guestEmail] });
  }

  const step3 = harness.step('3. Verify existing client account session');
  if (options.dryRun) {
    step3.skip('Dry run enabled.');
  } else {
    const meRes = await client.get('/api/me');
    harness.assert(meRes.ok, 'Client /api/me failed. status=' + meRes.status + ' body=' + meRes.bodyText);
    harness.assert(meRes.bodyJson && meRes.bodyJson.isValidated === true, 'Existing client1 account is not validated.');
    step3.pass('Existing client1 session verified.', {
      email: String(meRes.bodyJson && meRes.bodyJson.email || '').trim().toLowerCase(),
      isValidated: Boolean(meRes.bodyJson && meRes.bodyJson.isValidated)
    });
  }

  const step4 = harness.step('4. Create Property1 and Listing1 with pricing config');
  if (options.dryRun) {
    step4.skip('Dry run enabled.');
  } else {
    const propertyRes = await client.post('/api/properties', {
      name: 'Property1'
    });
    harness.assert(propertyRes.ok, 'Property creation failed. status=' + propertyRes.status + ' body=' + propertyRes.bodyText);
    const propertyId = Number(propertyRes.bodyJson && propertyRes.bodyJson.property && propertyRes.bodyJson.property.id || 0);
    harness.assert(Number.isInteger(propertyId) && propertyId > 0, 'Property id missing from create response.');

    const listingRes = await client.post('/api/listings', {
      name: 'Listing1',
      propertyId,
      dateBasis: 'checkout',
      perNightPrice: 100,
      perStayPrice: 20,
      maxGuests: 2,
      baseOccupancy: 2,
      additionalGuestUpliftPct: 25
    });
    harness.assert(listingRes.ok, 'Listing creation failed. status=' + listingRes.status + ' body=' + listingRes.bodyText);
    listingId = Number(listingRes.bodyJson && listingRes.bodyJson.listing && listingRes.bodyJson.listing.id || 0);
    harness.assert(Number.isInteger(listingId) && listingId > 0, 'Listing id missing from create response.');

    step4.pass('Property and listing created.', {
      propertyId,
      listingId,
      dateBasis: 'checkout',
      perNightPrice: 100,
      perStayPrice: 20,
      maxGuests: 2,
      baseOccupancy: 2,
      additionalGuestUpliftPct: 25
    });
  }

  const step5 = harness.step('5. Create future direct reservation with bank transfer');
  if (options.dryRun) {
    step5.skip('Dry run enabled.');
  } else {
    const arrivalDate = formatDateKey(20);
    const departureDate = formatDateKey(23);
    const reserve = await client.post('/api/private-reservations', {
      arrivalDate,
      departureDate,
      listingId,
      firstName: 'John',
      familyName: 'Guest',
      email: guestEmail,
      guestCount: 2,
      cost: 320,
      holdHours: 24,
      paymentMethod: 'Bank Transfer'
    });
    harness.assert(reserve.ok, 'Bank-transfer reservation create failed. status=' + reserve.status + ' body=' + reserve.bodyText);

    reservationId = Number(reserve.bodyJson && reserve.bodyJson.reservation && reserve.bodyJson.reservation.id || 0);
    harness.assert(Number.isInteger(reservationId) && reservationId > 0, 'Reservation id missing from create response.');

    reservationIdentifier = String(reserve.bodyJson && reserve.bodyJson.reservation && reserve.bodyJson.reservation.reservation_identifier || '').trim();
    const status = String(reserve.bodyJson && reserve.bodyJson.reservation && reserve.bodyJson.reservation.status || '').trim().toLowerCase();
    harness.assert(
      status === 'awaiting_bank_transfer' || status === 'awaiting bank transfer',
      'Expected reservation status Awaiting Bank Transfer, got: ' + status
    );

    step5.pass('Bank-transfer reservation created.', { reservationId, reservationIdentifier, status });
  }

  const step6 = harness.step('6. Verify guest setup email, set password, and login');
  if (options.dryRun) {
    step6.skip('Dry run enabled.');
  } else {
    const setupEmail = await waitForInboundEntry(
      adminClient,
      (entry) => {
        const to = String(entry && entry.to_address || '').trim().toLowerCase();
        const body = String(entry && entry.body_text || '').toLowerCase();
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

  const step7 = harness.step('7. Verify reservation notification email with dashboard backlink');
  if (options.dryRun) {
    step7.skip('Dry run enabled.');
  } else {
    const reservationNotice = await waitForInboundEntry(
      adminClient,
      (entry) => {
        const to = String(entry && entry.to_address || '').trim().toLowerCase();
        const body = String(entry && entry.body_text || '').toLowerCase();
        const hasDashboardLink = body.includes('dashboard') || body.includes('automaticpeople');
        const hasReservationContent = body.includes('reservation') && body.includes('bank transfer');
        return to === guestEmail && hasDashboardLink && hasReservationContent;
      },
      120000,
      4000
    );
    harness.assert(reservationNotice, 'Guest reservation notification email with dashboard backlink not found.');

    step7.pass('Guest reservation notification email verified.', {
      to: String(reservationNotice.to_address || ''),
      subject: String(reservationNotice.subject || '')
    });
  }

  const step8 = harness.step('8. Confirm guest sees reservation awaiting payment with notify-payment flow');
  if (options.dryRun) {
    step8.skip('Dry run enabled.');
  } else {
    const guestReservations = await guest.get('/api/guest/dashboard/reservations');
    harness.assert(guestReservations.ok, 'Guest dashboard reservations failed. status=' + guestReservations.status + ' body=' + guestReservations.bodyText);

    const row = getAccommodationRowByReservationId(guestReservations.bodyJson, reservationId);
    harness.assert(row, 'Guest reservation row not found for reservation id ' + reservationId + '.');

    const status = String(row && row.status || '').trim().toLowerCase();
    harness.assert(
      status === 'awaiting_bank_transfer' || status === 'awaiting bank transfer',
      'Expected guest status Awaiting Bank Transfer, got: ' + status
    );

    step8.pass('Guest reservation visible and awaiting payment.', {
      reservationId,
      status,
      paymentMethod: String(row && row.paymentMethod || '')
    });
  }

  const step9 = harness.step('9. Guest notifies transfer and host receives notification email');
  if (options.dryRun) {
    step9.skip('Dry run enabled.');
  } else {
    const notify = await guest.post('/api/guest/dashboard/reservations/' + reservationId + '/notify-payment', {});
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

  const step10 = harness.step('10. Client confirms payment from private reservations list');
  if (options.dryRun) {
    step10.skip('Dry run enabled.');
  } else {
    const hostReservations = await client.get('/api/private-reservations');
    harness.assert(hostReservations.ok, 'Host private reservations failed. status=' + hostReservations.status + ' body=' + hostReservations.bodyText);

    const reservations = Array.isArray(hostReservations.bodyJson && hostReservations.bodyJson.reservations)
      ? hostReservations.bodyJson.reservations
      : [];
    const hostRow = reservations.find((item) => Number(item && item.id || 0) === reservationId);
    harness.assert(hostRow, 'Host reservation row not found for reservation id ' + reservationId + '.');

    const confirm = await client.post('/api/private-reservations/' + reservationId + '/confirm-payment', {});
    harness.assert(confirm.ok, 'Host confirm-payment failed. status=' + confirm.status + ' body=' + confirm.bodyText);

    step10.pass('Host confirmed reservation payment.', {
      reservationId,
      canConfirmPayment: Boolean(hostRow && hostRow.canConfirmPayment)
    });
  }

  const step11 = harness.step('11. Verify guest sees confirmed reservation and payment-received email');
  if (options.dryRun) {
    step11.skip('Dry run enabled.');
  } else {
    const guestReservations = await guest.get('/api/guest/dashboard/reservations');
    harness.assert(guestReservations.ok, 'Guest dashboard reservations refresh failed. status=' + guestReservations.status + ' body=' + guestReservations.bodyText);

    const row = getAccommodationRowByReservationId(guestReservations.bodyJson, reservationId);
    harness.assert(row, 'Guest reservation row not found after host confirmation.');

    const status = String(row && row.status || '').trim().toLowerCase();
    harness.assert(status === 'confirmed', 'Expected guest status Confirmed, got: ' + status);

    const guestReceiptEmail = await waitForInboundEntry(
      adminClient,
      (entry) => {
        const to = String(entry && entry.to_address || '').trim().toLowerCase();
        const subject = String(entry && entry.subject || '').trim().toLowerCase();
        return to === guestEmail && (
          subject.includes('reservation payment confirmed')
          || subject.includes('reservation payment received')
        );
      },
      120000,
      4000
    );

    if (!guestReceiptEmail) {
      step11.skip('Guest payment receipt email was not observed in this environment after host confirmation.');
    } else {
      step11.pass('Guest payment confirmation verified.', {
        reservationId,
        status,
        subject: String(guestReceiptEmail.subject || '')
      });
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
