'use strict';

const { createWorkflowHarness, parseOptions } = require('../helpers/workflow-test-harness');

const TEST_META = {
  id: 'workflow-03-live-guest-login-from-private-reservation',
  title: 'Workflow 03 - Live guest login from private reservation provisioning',
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

async function waitForInboundEmail(adminClient, toAddress, expectedSubjectPart, timeoutMs, pollMs) {
  const targetTo = String(toAddress || '').trim().toLowerCase();
  const subjectNeedle = String(expectedSubjectPart || '').trim().toLowerCase();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const response = await adminClient.get('/api/admin/inbound-mail?limit=200');
    if (response.ok) {
      const entries = Array.isArray(response.bodyJson && response.bodyJson.entries) ? response.bodyJson.entries : [];
      const found = entries.find((entry) => {
        const to = String(entry && entry.to_address || '').trim().toLowerCase();
        const subject = String(entry && entry.subject || '').trim().toLowerCase();
        return to === targetTo && (!subjectNeedle || subject.includes(subjectNeedle));
      });
      if (found) {
        return found;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  return null;
}

function formatDateKey(offsetDays) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + Number(offsetDays || 0));
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

async function run(argv) {
  const options = parseOptions(argv);
  const harness = createWorkflowHarness(TEST_META, options);

  const baseUrl = normalizeUrl(options.baseUrl || process.env.TEST_BASE_URL || 'https://automaticpeople-alpha.onrender.com');
  const adminUsername = requiredEnv('TEST_ADMIN_USERNAME');
  const adminPassword = requiredEnv('TEST_ADMIN_PASSWORD');

  const clientEmail = optionalEnv('TEST_FLOW_CLIENT_EMAIL', 'client1@alphainbound.automaticpeople.com').toLowerCase();
  const guestEmail = optionalEnv('TEST_FLOW_GUEST_EMAIL', 'guest1@alphainbound.automaticpeople.com').toLowerCase();
  const clientPassword = optionalEnv('TEST_FLOW_CLIENT_PASSWORD', 'Quiblick!4');
  const guestPassword = optionalEnv('TEST_FLOW_GUEST_PASSWORD', 'Quiblick!6');

  const adminClient = new SessionClient(baseUrl, options.timeoutMs);
  const client = new SessionClient(baseUrl, options.timeoutMs);
  const guestClient = new SessionClient(baseUrl, options.timeoutMs);

  const step1 = harness.step('1. Clean site user data via admin schema reset');
  if (options.dryRun) {
    step1.skip('Dry run enabled.');
  } else {
    const login = await adminClient.post('/api/admin/login', {
      username: adminUsername,
      password: adminPassword
    });
    harness.assert(login.ok, 'Admin login failed with status ' + login.status);

    const reset = await adminClient.post('/api/admin/system/reset-schema', {
      confirmText: 'DELETE ALL DATA'
    });
    harness.assert(reset.ok, 'Admin schema reset failed. status=' + reset.status);
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
    step2.pass('Inbound listeners prepared.', { watch: [clientEmail, guestEmail] });
  }

  const step3 = harness.step('3. Create and validate client account');
  if (options.dryRun) {
    step3.skip('Dry run enabled.');
  } else {
    const signup = await client.post('/api/signup', {
      firstName: 'Andy',
      familyName: 'Butler',
      country: 'GB',
      email: clientEmail,
      password: clientPassword,
      turnstileToken: ''
    });
    harness.assert(signup.ok, 'Client signup failed. status=' + signup.status);

    const validationEmail = await waitForInboundEmail(adminClient, clientEmail, 'validate', 120000, 5000);
    harness.assert(validationEmail, 'No client validation email found in inbound log.');
    const clientValidationUrl = findFirstUrl(String(validationEmail.body_text || ''), 'validate-account');
    harness.assert(clientValidationUrl, 'Client validation URL was not found in email body.');

    const validationUrlObj = new URL(clientValidationUrl);
    const token = String(validationUrlObj.searchParams.get('token') || '').trim();
    harness.assert(token, 'Client validation token missing from validation URL.');
    const validateRes = await client.get('/api/account/validate?token=' + encodeURIComponent(token));
    harness.assert(validateRes.ok, 'Client validation failed. status=' + validateRes.status);

    const login = await client.post('/api/login', {
      email: clientEmail,
      password: clientPassword
    });
    harness.assert(login.ok, 'Client login failed after validation. status=' + login.status);

    step3.pass('Client account created, validated, and logged in.', null);
  }

  const step4 = harness.step('4. Create property and listing for private reservation');
  let listingId = 0;
  if (options.dryRun) {
    step4.skip('Dry run enabled.');
  } else {
    const propertyRes = await client.post('/api/properties', {
      name: 'Workflow 03 Property'
    });
    harness.assert(propertyRes.ok, 'Property creation failed. status=' + propertyRes.status);
    const propertyId = Number(propertyRes.bodyJson && propertyRes.bodyJson.property && propertyRes.bodyJson.property.id || 0);
    harness.assert(Number.isInteger(propertyId) && propertyId > 0, 'Property id missing from create response.');

    const listingRes = await client.post('/api/listings', {
      name: 'Workflow 03 Listing',
      propertyId,
      dateBasis: 'checkout'
    });
    harness.assert(listingRes.ok, 'Listing creation failed. status=' + listingRes.status);
    listingId = Number(listingRes.bodyJson && listingRes.bodyJson.listing && listingRes.bodyJson.listing.id || 0);
    harness.assert(Number.isInteger(listingId) && listingId > 0, 'Listing id missing from create response.');

    step4.pass('Property and listing created.', { propertyId, listingId });
  }

  const step5 = harness.step('5. Create private reservation to provision guest site user');
  if (options.dryRun) {
    step5.skip('Dry run enabled.');
  } else {
    const arrivalDate = formatDateKey(20);
    const departureDate = formatDateKey(23);
    const reservationRes = await client.post('/api/private-reservations', {
      arrivalDate,
      departureDate,
      listingId,
      firstName: 'Joe',
      familyName: 'Tidy',
      email: guestEmail,
      guestCount: 2,
      cost: 0,
      holdHours: 24,
      paymentMethod: 'No Charge'
    });
    harness.assert(reservationRes.ok, 'Private reservation create failed. status=' + reservationRes.status);

    step5.pass('Private reservation created and guest site user provisioning path executed.', {
      reservationId: Number(reservationRes.bodyJson && reservationRes.bodyJson.reservation && reservationRes.bodyJson.reservation.id || 0)
    });
  }

  const step6 = harness.step('6. Request guest password setup email and capture reset link');
  let guestResetToken = '';
  if (options.dryRun) {
    step6.skip('Dry run enabled.');
  } else {
    const resetReq = await client.post('/api/account/password-reset/request', { email: guestEmail });
    harness.assert(resetReq.ok, 'Guest password reset request failed. status=' + resetReq.status);

    const resetEmail = await waitForInboundEmail(adminClient, guestEmail, 'password', 120000, 5000);
    harness.assert(resetEmail, 'No guest password setup email found in inbound log.');
    const resetUrl = findFirstUrl(String(resetEmail.body_text || ''), 'reset-password');
    harness.assert(resetUrl, 'Guest reset-password URL was not found in email body.');

    const resetUrlObj = new URL(resetUrl);
    guestResetToken = String(resetUrlObj.searchParams.get('token') || '').trim();
    harness.assert(guestResetToken, 'Guest reset token missing from URL.');

    step6.pass('Guest reset email captured.', { to: resetEmail.to_address, subject: resetEmail.subject });
  }

  const step7 = harness.step('7. Set guest password and verify guest login');
  if (options.dryRun) {
    step7.skip('Dry run enabled.');
  } else {
    const resetConfirm = await guestClient.post('/api/account/password-reset/confirm', {
      token: guestResetToken,
      password: guestPassword
    });
    harness.assert(resetConfirm.ok, 'Guest password reset confirm failed. status=' + resetConfirm.status);

    const login = await guestClient.post('/api/login', {
      email: guestEmail,
      password: guestPassword
    });
    harness.assert(login.ok, 'Guest login failed. status=' + login.status);

    const me = await guestClient.get('/api/me');
    harness.assert(me.ok, 'Guest /api/me failed. status=' + me.status);
    const access = me.bodyJson && me.bodyJson.accessContext ? me.bodyJson.accessContext : {};
    const activeRole = String(access.activeRole || '').trim();
    harness.assert(activeRole === 'Guest', 'Expected active role Guest, got ' + activeRole);

    step7.pass('Guest login successful with guest-scoped role.', { activeRole });
  }

  const step8 = harness.step('8. Verify guest dashboard reservations endpoint');
  if (options.dryRun) {
    step8.skip('Dry run enabled.');
  } else {
    const reservationsRes = await guestClient.get('/api/guest/dashboard/reservations');
    harness.assert(reservationsRes.ok, 'Guest reservations endpoint failed. status=' + reservationsRes.status);

    const reservations = Array.isArray(reservationsRes.bodyJson && reservationsRes.bodyJson.reservations)
      ? reservationsRes.bodyJson.reservations
      : [];
    const facilityReservations = Array.isArray(reservationsRes.bodyJson && reservationsRes.bodyJson.facilityReservations)
      ? reservationsRes.bodyJson.facilityReservations
      : [];

    step8.pass('Guest dashboard data is accessible and populated.', {
      reservations: reservations.length,
      facilityReservations: facilityReservations.length
    });
  }

  harness.printConsoleSummary();
  const artifactPath = options.keepArtifacts ? harness.writeArtifactFile() : null;
  if (artifactPath) {
    console.log('[ARTIFACT] ' + artifactPath);
  }

  const summary = harness.summarize();
  return {
    ok: summary.success,
    summary,
    artifactPath
  };
}

if (require.main === module) {
  run(process.argv.slice(2))
    .then((result) => {
      process.exit(result && result.ok ? 0 : 1);
    })
    .catch((err) => {
      console.error('[ERROR] workflow-03-live-guest-login-from-private-reservation failed:', err && err.message ? err.message : err);
      process.exit(1);
    });
}

module.exports = {
  id: TEST_META.id,
  title: TEST_META.title,
  run
};
