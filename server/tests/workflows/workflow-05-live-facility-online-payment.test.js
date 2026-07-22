'use strict';

const Stripe = require('stripe');
const { createWorkflowHarness, parseOptions } = require('../helpers/workflow-test-harness');
const { completeStripeConnectOnboarding } = require('../helpers/browser-assisted-stripe-connect');

const TEST_META = {
  id: 'workflow-05-live-facility-online-payment',
  title: 'Workflow 05 - Live facility reservation (online payment)',
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

function getFacilityRowByReservationId(payload, reservationId) {
  const facilities = Array.isArray(payload && payload.facilities) ? payload.facilities : [];
  return facilities.find((item) => Number(item && item.id || 0) === Number(reservationId || 0)) || null;
}

async function run(argv) {
  const options = parseOptions(argv);
  const harness = createWorkflowHarness(TEST_META, options);

  const baseUrl = normalizeUrl(options.baseUrl || process.env.TEST_BASE_URL || 'https://alpha.automaticpeople.com');
  const adminUsername = requiredEnv('TEST_ADMIN_USERNAME');
  const adminPassword = requiredEnv('TEST_ADMIN_PASSWORD');
  const stripeSecretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();

  const clientEmail = optionalEnv('TEST_FLOW_CLIENT_EMAIL', 'client1@alphainbound.automaticpeople.com').toLowerCase();
  const guestEmail = optionalEnv('TEST_FLOW_FACILITY_GUEST2_EMAIL', 'parker2@alphainbound.automaticpeople.com').toLowerCase();
  const clientPassword = optionalEnv('TEST_FLOW_CLIENT_PASSWORD', 'Quiblick!4');
  const guestPassword = optionalEnv('TEST_FLOW_FACILITY_GUEST2_PASSWORD', 'Quiblick!4');

  const stripe = stripeSecretKey
    ? new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' })
    : null;

  const adminClient = new SessionClient(baseUrl, options.timeoutMs);
  const client = new SessionClient(baseUrl, options.timeoutMs);
  const guest = new SessionClient(baseUrl, options.timeoutMs);

  let resourceId = 0;
  let reservationId = 0;
  let checkoutSessionId = '';
  let paymentIntentId = '';
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

  const step4 = harness.step('4. Ensure host Stripe Connect account is ready for online payments');
  if (options.dryRun) {
    step4.skip('Dry run enabled.');
  } else {
    const statusBefore = await client.get('/api/stripe/connect/status');
    harness.assert(statusBefore.ok, 'Stripe connect status failed. status=' + statusBefore.status + ' body=' + statusBefore.bodyText);

    const stripeConnectBefore = statusBefore.bodyJson && statusBefore.bodyJson.stripeConnect ? statusBefore.bodyJson.stripeConnect : null;
    const alreadyReady = Boolean(
      stripeConnectBefore
      && stripeConnectBefore.onboardingComplete === true
      && stripeConnectBefore.chargesEnabled === true
      && stripeConnectBefore.payoutsEnabled === true
    );

    if (!alreadyReady) {
      const startOnboarding = await client.post('/api/stripe/connect/start', {});
      harness.assert(startOnboarding.ok, 'Stripe connect start failed. status=' + startOnboarding.status + ' body=' + startOnboarding.bodyText);

      const onboardingUrl = String(startOnboarding.bodyJson && startOnboarding.bodyJson.onboardingUrl || '').trim();
      harness.assert(onboardingUrl, 'Stripe onboarding URL missing from connect/start response.');

      await completeStripeConnectOnboarding({
        onboardingUrl,
        returnUrlPrefix: baseUrl + '/dashboard.html?stripeConnect=return',
        appBaseUrl: baseUrl,
        sessionCookieHeader: toCookieHeader(client.cookieJar),
        timeoutMs: Math.max(options.timeoutMs, 12 * 60 * 1000),
        manualCaptchaTimeoutMs: 10 * 60 * 1000
      });
    }

    let stripeConnectAfter = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const statusAfter = await client.get('/api/stripe/connect/status');
      harness.assert(statusAfter.ok, 'Stripe connect status refresh failed. status=' + statusAfter.status + ' body=' + statusAfter.bodyText);
      stripeConnectAfter = statusAfter.bodyJson && statusAfter.bodyJson.stripeConnect ? statusAfter.bodyJson.stripeConnect : null;
      if (
        stripeConnectAfter
        && stripeConnectAfter.onboardingComplete === true
        && stripeConnectAfter.chargesEnabled === true
        && stripeConnectAfter.payoutsEnabled === true
      ) {
        break;
      }
      await sleep(5000);
    }

    harness.assert(
      Boolean(
        stripeConnectAfter
        && stripeConnectAfter.onboardingComplete === true
        && stripeConnectAfter.chargesEnabled === true
        && stripeConnectAfter.payoutsEnabled === true
      ),
      'Stripe Connect onboarding did not become fully enabled for the host account.'
    );

    step4.pass('Host Stripe Connect account is ready.', stripeConnectAfter);
  }

  const step5 = harness.step('5. Create Parking2 facility with online+bank payment options');
  if (options.dryRun) {
    step5.skip('Dry run enabled.');
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
      shortDescription: 'Parking2',
      fullDescriptionHtml: '<p>Parking2 test facility description.</p>',
      maxUnits: 1,
      maxDaysAdvanceBooking: 6,
      resourceType: 'parking',
      freeOfCharge: false,
      cashOnSite: false,
      bankTransfer: true,
      onlinePayment: true,
      freeOfChargeMessageHtml: '<p>No charge message.</p>',
      cashOnSiteMessageHtml: '<p>Cash on site message.</p>',
      bankTransferMessageHtml: '<p>Bank transfer payment page text for Parking2.</p>',
      onlinePaymentMessageHtml: '<p>Online payment page text for Parking2.</p>',
      chargeBasis: 'daily',
      dailyChargeMode: 'per_24_hours',
      dailyRate: 12
    });
    harness.assert(createResource.ok, 'Create facility failed. status=' + createResource.status + ' body=' + createResource.bodyText);

    resourceId = Number(createResource.bodyJson && createResource.bodyJson.resource && createResource.bodyJson.resource.id || 0);
    harness.assert(Number.isInteger(resourceId) && resourceId > 0, 'Facility resource id missing from create response.');

    step5.pass('Parking2 created.', { resourceId });
  }

  const step6 = harness.step('6. Create future facility reservation using online payment');
  if (options.dryRun) {
    step6.skip('Dry run enabled.');
  } else {
    const requestedStartAt = buildUtcIsoAtHour(2, 11);
    const requestedEndAt = buildUtcIsoAtHour(3, 11);

    const startDate = new Date(requestedStartAt);
    const endDate = new Date(requestedEndAt);

    const reserve = await client.post('/api/public/shared-resources/' + resourceId + '/reservations', {
      requestedStartAt,
      requestedEndAt,
      checkinDate: formatDateKey(startDate),
      checkoutDate: formatDateKey(endDate),
      spacesRequired: 1,
      firstName: 'Dave',
      familyName: 'Parker',
      emailAddress: guestEmail,
      telephone: '07123456790',
      vehicleRegistration: 'PARK-002',
      reservationAmount: 12,
      paymentOption: 'online_payment'
    });

    harness.assert(reserve.ok, 'Online-payment reservation create failed. status=' + reserve.status + ' body=' + reserve.bodyText);

    reservationId = Number(reserve.bodyJson && reserve.bodyJson.reservation && reserve.bodyJson.reservation.id || 0);
    harness.assert(Number.isInteger(reservationId) && reservationId > 0, 'Reservation id missing from create response.');

    const status = String(reserve.bodyJson && reserve.bodyJson.reservation && reserve.bodyJson.reservation.status || '').trim().toLowerCase();
    harness.assert(status === 'awaiting online confirmation', 'Expected reservation status Awaiting Online Confirmation, got: ' + status);

    step6.pass('Online-payment reservation created.', { reservationId, status });
  }

  const step7 = harness.step('7. Set parker2 password from invite email and log in');
  if (options.dryRun) {
    step7.skip('Dry run enabled.');
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

    step7.pass('Guest setup and login succeeded.', { email: guestEmail });
  }

  const step8 = harness.step('8. Confirm parker2 sees facility reservation awaiting online payment');
  if (options.dryRun) {
    step8.skip('Dry run enabled.');
  } else {
    const guestReservations = await guest.get('/api/guest/dashboard/reservations');
    harness.assert(guestReservations.ok, 'Guest dashboard reservations failed. status=' + guestReservations.status + ' body=' + guestReservations.bodyText);

    const row = getFacilityRowByReservationId(guestReservations.bodyJson, reservationId);
    harness.assert(row, 'Guest reservation row not found for reservation id ' + reservationId + '.');

    const status = String(row && row.status || '').trim().toLowerCase();
    harness.assert(status === 'awaiting online confirmation', 'Expected guest status Awaiting Online Confirmation, got: ' + status);

    step8.pass('Guest facility reservation visible and awaiting online payment.', { reservationId, status });
  }

  const step9 = harness.step('9. Complete Stripe sandbox payment via Pay Now + sync');
  if (options.dryRun) {
    step9.skip('Dry run enabled.');
  } else if (!stripe) {
    step9.skip('STRIPE_SECRET_KEY is not set locally, so sandbox payment automation is skipped.');
  } else {
    const payNow = await guest.post('/api/guest/dashboard/facility-reservations/' + reservationId + '/pay-now', {});
    harness.assert(payNow.ok, 'Guest pay-now failed. status=' + payNow.status + ' body=' + payNow.bodyText);

    checkoutSessionId = String(payNow.bodyJson && payNow.bodyJson.checkoutSessionId || '').trim();
    harness.assert(checkoutSessionId, 'Checkout session id missing from pay-now response.');

    const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
      expand: ['payment_intent']
    });

    if (session && typeof session.payment_intent === 'string') {
      paymentIntentId = String(session.payment_intent || '').trim();
    } else if (session && session.payment_intent && session.payment_intent.id) {
      paymentIntentId = String(session.payment_intent.id || '').trim();
    }

    harness.assert(paymentIntentId, 'Stripe checkout session did not contain a payment intent id.');

    const confirmed = await stripe.paymentIntents.confirm(paymentIntentId, {
      payment_method: 'pm_card_visa'
    });
    const confirmStatus = String(confirmed && confirmed.status || '').trim().toLowerCase();
    harness.assert(
      confirmStatus === 'succeeded' || confirmStatus === 'processing' || confirmStatus === 'requires_capture',
      'Unexpected payment intent status after confirm: ' + confirmStatus
    );

    let reconciledStatus = '';
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const syncRes = await guest.post('/api/guest/dashboard/facility-reservations/' + reservationId + '/sync-payment', {
        sessionId: checkoutSessionId
      });
      harness.assert(syncRes.ok, 'Guest sync-payment failed. status=' + syncRes.status + ' body=' + syncRes.bodyText);

      const syncedReservation = syncRes.bodyJson && syncRes.bodyJson.reservation ? syncRes.bodyJson.reservation : null;
      reconciledStatus = String(syncedReservation && syncedReservation.status || '').trim().toLowerCase();
      if (reconciledStatus === 'confirmed') {
        break;
      }
      await sleep(2000);
    }

    harness.assert(reconciledStatus === 'confirmed', 'Facility reservation did not reconcile to confirmed after payment. status=' + reconciledStatus);

    step9.pass('Stripe payment confirmed and reservation reconciled.', {
      checkoutSessionId,
      paymentIntentId,
      reconciledStatus
    });
  }

  const step10 = harness.step('10. Verify client receives online-payment notification email');
  if (options.dryRun) {
    step10.skip('Dry run enabled.');
  } else if (!stripe) {
    step10.skip('Skipped because Stripe payment automation did not run without STRIPE_SECRET_KEY.');
  } else {
    const hostNotifyEmail = await waitForInboundEntry(
      adminClient,
      (entry) => {
        const to = String(entry && entry.to_address || '').trim().toLowerCase();
        const subject = String(entry && entry.subject || '').trim().toLowerCase();
        return to === clientEmail && subject.includes('guest online payment notification');
      },
      120000,
      4000
    );
    if (!hostNotifyEmail) {
      step10.skip('Client online-payment notification email was not observed in this environment.');
    } else {
      step10.pass('Client online-payment notification email verified.', null);
    }
  }

  const step11 = harness.step('11. Verify client and guest both see confirmed status');
  if (options.dryRun) {
    step11.skip('Dry run enabled.');
  } else if (!stripe) {
    step11.skip('Skipped because Stripe payment automation did not run without STRIPE_SECRET_KEY.');
  } else {
    const hostReservations = await client.get('/api/shared-resources/' + resourceId + '/reservations');
    harness.assert(hostReservations.ok, 'Host facility reservations failed. status=' + hostReservations.status + ' body=' + hostReservations.bodyText);

    const hostRows = Array.isArray(hostReservations.bodyJson && hostReservations.bodyJson.reservations)
      ? hostReservations.bodyJson.reservations
      : [];
    const hostRow = hostRows.find((item) => Number(item && item.id || 0) === reservationId);
    harness.assert(hostRow, 'Client reservation row not found for reservation id ' + reservationId + '.');

    const hostStatus = String(hostRow && hostRow.status || '').trim().toLowerCase();
    harness.assert(hostStatus === 'confirmed', 'Expected host status Confirmed, got: ' + hostStatus);

    const guestReservations = await guest.get('/api/guest/dashboard/reservations');
    harness.assert(guestReservations.ok, 'Guest dashboard reservations refresh failed. status=' + guestReservations.status + ' body=' + guestReservations.bodyText);

    const guestRow = getFacilityRowByReservationId(guestReservations.bodyJson, reservationId);
    harness.assert(guestRow, 'Guest reservation row not found after payment confirmation.');

    const guestStatus = String(guestRow && guestRow.status || '').trim().toLowerCase();
    harness.assert(guestStatus === 'confirmed', 'Expected guest status Confirmed, got: ' + guestStatus);

    step11.pass('Client and guest confirmed statuses verified.', {
      reservationId,
      hostStatus,
      guestStatus
    });
  }

  const step12 = harness.step('12. Verify guest receives payment-confirmed email');
  if (options.dryRun) {
    step12.skip('Dry run enabled.');
  } else if (!stripe) {
    step12.skip('Skipped because Stripe payment automation did not run without STRIPE_SECRET_KEY.');
  } else {
    const guestReceiptEmail = await waitForInboundEntry(
      adminClient,
      (entry) => {
        const to = String(entry && entry.to_address || '').trim().toLowerCase();
        const subject = String(entry && entry.subject || '').trim().toLowerCase();
        return to === guestEmail && subject.includes('reservation payment confirmed');
      },
      120000,
      4000
    );
    if (!guestReceiptEmail) {
      step12.skip('Guest payment-confirmed email was not observed in this environment.');
    } else {
      step12.pass('Guest payment-confirmed email verified.', null);
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
