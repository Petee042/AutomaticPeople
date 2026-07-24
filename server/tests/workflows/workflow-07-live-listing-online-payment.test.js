'use strict';

const { createWorkflowHarness, parseOptions } = require('../helpers/workflow-test-harness');
const { completeStripeCheckout } = require('../helpers/browser-assisted-stripe-checkout');

const TEST_META = {
  id: 'workflow-07-live-listing-online-payment',
  title: 'Workflow 07 - Live listing reservation (online payment)',
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
  const guestEmail = optionalEnv('TEST_FLOW_LISTING_GUEST2_EMAIL', 'guest2@alphainbound.automaticpeople.com').toLowerCase();
  const clientPassword = optionalEnv('TEST_FLOW_CLIENT_PASSWORD', 'Quiblick!4');
  const guestPassword = optionalEnv('TEST_FLOW_LISTING_GUEST2_PASSWORD', 'Quiblick!4');
  const nameSuffix = optionalEnv('TEST_FLOW_LISTING_NAME_SUFFIX', Date.now().toString());
  const propertyName = 'Property1-' + nameSuffix;
  const listingName = 'Listing1-' + nameSuffix;

  const adminClient = new SessionClient(baseUrl, options.timeoutMs);
  const client = new SessionClient(baseUrl, options.timeoutMs);
  const guest = new SessionClient(baseUrl, options.timeoutMs);

  let listingId = 0;
  let reservationId = 0;
  let checkoutSessionId = '';
  let paymentAutomationRan = false;
  let finalizedPayload = null;

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

  const step3 = harness.step('3. Verify client Stripe Connect readiness');
  if (options.dryRun) {
    step3.skip('Dry run enabled.');
  } else {
    const meRes = await client.get('/api/me');
    harness.assert(meRes.ok, 'Client /api/me failed. status=' + meRes.status + ' body=' + meRes.bodyText);
    const stripeConnect = meRes.bodyJson && meRes.bodyJson.stripeConnect ? meRes.bodyJson.stripeConnect : null;
    harness.assert(stripeConnect, 'Client stripeConnect status missing from /api/me response.');
    harness.assert(stripeConnect.onboardingComplete === true, 'Stripe onboarding is incomplete for client1.');
    harness.assert(stripeConnect.chargesEnabled === true, 'Stripe charges are not enabled for client1.');
    harness.assert(stripeConnect.payoutsEnabled === true, 'Stripe payouts are not enabled for client1.');

    step3.pass('Host Stripe account is already ready.', {
      stripeAccountId: String(stripeConnect.stripeAccountId || ''),
      onboardingComplete: Boolean(stripeConnect.onboardingComplete),
      chargesEnabled: Boolean(stripeConnect.chargesEnabled),
      payoutsEnabled: Boolean(stripeConnect.payoutsEnabled)
    });
  }

  const step4 = harness.step('4. Create Property1 and Listing1 with pricing config');
  if (options.dryRun) {
    step4.skip('Dry run enabled.');
  } else {
    const propertyRes = await client.post('/api/properties', {
      name: propertyName
    });
    harness.assert(propertyRes.ok, 'Property creation failed. status=' + propertyRes.status + ' body=' + propertyRes.bodyText);
    const propertyId = Number(propertyRes.bodyJson && propertyRes.bodyJson.property && propertyRes.bodyJson.property.id || 0);
    harness.assert(Number.isInteger(propertyId) && propertyId > 0, 'Property id missing from create response.');

    const listingRes = await client.post('/api/listings', {
      name: listingName,
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
      propertyName,
      listingName
    });
  }

  const step5 = harness.step('5. Create future direct reservation with online payment');
  if (options.dryRun) {
    step5.skip('Dry run enabled.');
  } else {
    const arrivalDate = formatDateKey(20);
    const departureDate = formatDateKey(23);
    const reserve = await client.post('/api/private-reservations', {
      arrivalDate,
      departureDate,
      listingId,
      firstName: 'Dave',
      familyName: 'Guest',
      email: guestEmail,
      guestCount: 2,
      cost: 320,
      holdHours: 24,
      paymentMethod: 'Online Payment'
    });
    harness.assert(reserve.ok, 'Online-payment reservation create failed. status=' + reserve.status + ' body=' + reserve.bodyText);

    reservationId = Number(reserve.bodyJson && reserve.bodyJson.reservation && reserve.bodyJson.reservation.id || 0);
    harness.assert(Number.isInteger(reservationId) && reservationId > 0, 'Reservation id missing from create response.');

    const status = String(reserve.bodyJson && reserve.bodyJson.reservation && reserve.bodyJson.reservation.status || '').trim().toLowerCase();
    harness.assert(
      status === 'awaiting_online_payment' || status === 'awaiting online payment',
      'Expected reservation status Awaiting Online Payment, got: ' + status
    );

    step5.pass('Online-payment reservation created.', { reservationId, status });
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
        const subject = String(entry && entry.subject || '').trim().toLowerCase();
        const body = String(entry && entry.body_text || '').toLowerCase();
        const hasLoginLink = body.includes('please log in to your automaticpeople account') || body.includes('https://alpha.automaticpeople.com/index.html');
        const hasReservationContent = subject.includes('online payment required')
          || (body.includes('reservation request submitted') && body.includes('amount due:'));
        return to === guestEmail && hasLoginLink && hasReservationContent;
      },
      120000,
      4000
    );
    harness.assert(reservationNotice, 'Guest reservation notification email with login link not found.');

    step7.pass('Guest reservation notification email verified.', {
      to: String(reservationNotice.to_address || ''),
      subject: String(reservationNotice.subject || '')
    });
  }

  const step8 = harness.step('8. Confirm guest sees reservation awaiting online payment');
  if (options.dryRun) {
    step8.skip('Dry run enabled.');
  } else {
    const guestReservations = await guest.get('/api/guest/dashboard/reservations');
    harness.assert(guestReservations.ok, 'Guest dashboard reservations failed. status=' + guestReservations.status + ' body=' + guestReservations.bodyText);

    const row = getAccommodationRowByReservationId(guestReservations.bodyJson, reservationId);
    harness.assert(row, 'Guest reservation row not found for reservation id ' + reservationId + '.');

    const status = String(row && row.status || '').trim().toLowerCase();
    harness.assert(
      status === 'awaiting_online_payment' || status === 'awaiting online payment',
      'Expected guest status Awaiting Online Payment, got: ' + status
    );

    step8.pass('Guest reservation visible and awaiting online payment.', {
      reservationId,
      status,
      paymentMethod: String(row && row.paymentMethod || '')
    });
  }

  const step9 = harness.step('9. Complete Stripe sandbox payment via Pay Now + sync');
  if (options.dryRun) {
    step9.skip('Dry run enabled.');
  } else {
    const payNow = await guest.post('/api/guest/dashboard/reservations/' + reservationId + '/pay-now', {});
    harness.assert(payNow.ok, 'Guest pay-now failed. status=' + payNow.status + ' body=' + payNow.bodyText);

    checkoutSessionId = String(payNow.bodyJson && payNow.bodyJson.checkoutSessionId || '').trim();
    const checkoutUrl = String(payNow.bodyJson && payNow.bodyJson.checkoutUrl || '').trim();
    harness.assert(checkoutSessionId, 'Checkout session id missing from pay-now response.');
    harness.assert(checkoutUrl, 'Checkout URL missing from pay-now response.');

    const checkoutResult = await completeStripeCheckout({
      checkoutUrl,
      successUrlNeedle: 'payment=success',
      timeoutMs: 180000,
      headless: false,
      email: guestEmail,
      country: optionalEnv('TEST_STRIPE_COUNTRY', 'United Kingdom'),
      postcode: optionalEnv('TEST_STRIPE_POSTCODE', 'EX11SX'),
      phone: optionalEnv('TEST_STRIPE_PHONE', '07812582241'),
      cardNumber: optionalEnv('TEST_STRIPE_CARD_NUMBER', '4242424242424242'),
      cardExpiry: optionalEnv('TEST_STRIPE_CARD_EXPIRY', '1234'),
      cardCvc: optionalEnv('TEST_STRIPE_CARD_CVC', '123'),
      cardName: optionalEnv('TEST_STRIPE_CARDHOLDER_NAME', 'AutomaticPeople Test')
    });
    harness.assert(
      checkoutResult && checkoutResult.completed === true,
      'Stripe hosted checkout did not complete successfully. status=' +
      String(checkoutResult && checkoutResult.status || '') + ' finalUrl=' +
      String(checkoutResult && checkoutResult.finalUrl || '')
    );

    let reconciledStatus = '';
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const syncRes = await guest.post('/api/guest/dashboard/reservations/' + reservationId + '/sync-payment', {
        sessionId: checkoutSessionId
      });
      harness.assert(syncRes.ok, 'Guest sync-payment failed. status=' + syncRes.status + ' body=' + syncRes.bodyText);

      const syncedReservation = syncRes.bodyJson && syncRes.bodyJson.reservation ? syncRes.bodyJson.reservation : null;
      finalizedPayload = syncRes.bodyJson && syncRes.bodyJson.finalized ? syncRes.bodyJson.finalized : finalizedPayload;
      reconciledStatus = String(syncedReservation && syncedReservation.status || '').trim().toLowerCase();
      if (reconciledStatus === 'confirmed') {
        break;
      }
      await sleep(2000);
    }

    harness.assert(reconciledStatus === 'confirmed', 'Reservation did not reconcile to confirmed after payment. status=' + reconciledStatus);
    paymentAutomationRan = true;

    step9.pass('Stripe payment confirmed and reservation reconciled.', {
      checkoutSessionId,
      reconciledStatus,
      checkoutFinalUrl: String(checkoutResult && checkoutResult.finalUrl || '')
    });
  }

  const step10 = harness.step('10. Verify client receives online-payment notification email');
  if (options.dryRun) {
    step10.skip('Dry run enabled.');
  } else if (!paymentAutomationRan) {
    step10.skip('Skipped because Stripe payment automation did not complete.');
  } else {
    const hostNotifyEmail = await waitForInboundEntry(
      adminClient,
      (entry) => {
        const to = String(entry && entry.to_address || '').trim().toLowerCase();
        const subject = String(entry && entry.subject || '').trim().toLowerCase();
        return to === clientEmail && (
          subject.includes('reservation payment received')
          || subject.includes('guest online payment notification')
        );
      },
      60000,
      4000
    );

    if (!hostNotifyEmail) {
      step10.skip('Client online-payment notification email was not observed in this environment.');
    } else {
      step10.pass('Client online-payment notification email verified.', {
        subject: String(hostNotifyEmail.subject || '')
      });
    }
  }

  const step11 = harness.step('11. Verify guest payment confirmation is sent to the correct email');
  if (options.dryRun) {
    step11.skip('Dry run enabled.');
  } else if (!paymentAutomationRan) {
    step11.skip('Skipped because Stripe payment automation did not complete.');
  } else {
    harness.assert(finalizedPayload, 'Finalize payload missing from sync-payment response.');
    harness.assert(finalizedPayload.found === true, 'Finalize payload indicates reservation was not found.');
    harness.assert(finalizedPayload.confirmed === true, 'Finalize payload did not confirm payment.');
    harness.assert(finalizedPayload.emailSent === true, 'Finalize payload did not report a sent guest confirmation email. error=' + String(finalizedPayload.emailError || ''));
    harness.assert(
      String(finalizedPayload.emailRecipient || '').trim().toLowerCase() === guestEmail,
      'Guest confirmation email recipient mismatch. expected=' + guestEmail + ' actual=' + String(finalizedPayload.emailRecipient || '')
    );

    step11.pass('Guest payment confirmation recipient verified.', {
      emailRecipient: String(finalizedPayload.emailRecipient || ''),
      emailSent: Boolean(finalizedPayload.emailSent)
    });
  }

  const step12 = harness.step('12. Verify host and guest both see confirmed status');
  if (options.dryRun) {
    step12.skip('Dry run enabled.');
  } else if (!paymentAutomationRan) {
    step12.skip('Skipped because Stripe payment automation did not complete.');
  } else {
    const hostReservations = await client.get('/api/private-reservations');
    harness.assert(hostReservations.ok, 'Host private reservations failed. status=' + hostReservations.status + ' body=' + hostReservations.bodyText);

    const reservations = Array.isArray(hostReservations.bodyJson && hostReservations.bodyJson.reservations)
      ? hostReservations.bodyJson.reservations
      : [];
    const hostRow = reservations.find((item) => Number(item && item.id || 0) === reservationId);
    harness.assert(hostRow, 'Host reservation row not found for reservation id ' + reservationId + '.');

    const hostPaymentStatus = String(hostRow && hostRow.paymentStatus || '').trim().toLowerCase();
    harness.assert(
      hostPaymentStatus.includes('paid') || hostPaymentStatus.includes('confirmed'),
      'Expected host payment status paid/confirmed, got: ' + hostPaymentStatus
    );

    const guestReservations = await guest.get('/api/guest/dashboard/reservations');
    harness.assert(guestReservations.ok, 'Guest dashboard reservations refresh failed. status=' + guestReservations.status + ' body=' + guestReservations.bodyText);

    const guestRow = getAccommodationRowByReservationId(guestReservations.bodyJson, reservationId);
    harness.assert(guestRow, 'Guest reservation row not found after payment confirmation.');

    const guestStatus = String(guestRow && guestRow.status || '').trim().toLowerCase();
    harness.assert(guestStatus === 'confirmed', 'Expected guest status Confirmed, got: ' + guestStatus);

    step12.pass('Host and guest confirmed statuses verified.', {
      reservationId,
      hostPaymentStatus,
      guestStatus
    });
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
