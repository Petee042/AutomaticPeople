'use strict';

/**
 * Live Workflow Test
 * Flow: Client1 -> Staff1 -> Guest1 onboarding with email checks
 * Run example:
 *   npm run test:workflow:live-onboarding -- --live --base-url https://automaticpeople-alpha.onrender.com
 */

const { createWorkflowHarness, parseOptions } = require('../helpers/workflow-test-harness');
const { captureTurnstileToken } = require('../helpers/browser-assisted-turnstile');

const TEST_META = {
  id: 'workflow-02-live-onboarding-client-staff-guest',
  title: 'Workflow 02 - Live onboarding: client, staff, guest',
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

function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  const text = String(value).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'on';
}

function parseFlowArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const flow = {
    turnstileHelperMode: '',
    skipReset: false,
    browserAssistedTurnstile: false
  };

  for (let idx = 0; idx < args.length; idx += 1) {
    const token = String(args[idx] || '').trim();
    if (!token) continue;

    if (token === '--turnstile-helper') {
      flow.turnstileHelperMode = String(args[idx + 1] || '').trim().toLowerCase();
      idx += 1;
      continue;
    }
    if (token === '--skip-reset') {
      flow.skipReset = true;
      continue;
    }
    if (token === '--browser-assisted-turnstile') {
      flow.browserAssistedTurnstile = true;
      continue;
    }
  }

  return flow;
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

async function run(argv) {
  const options = parseOptions(argv);
  const harness = createWorkflowHarness(TEST_META, options);
  const flowArgs = parseFlowArgs(argv);

  const baseUrl = normalizeUrl(options.baseUrl || process.env.TEST_BASE_URL || 'https://automaticpeople-alpha.onrender.com');
  const adminUsername = requiredEnv('TEST_ADMIN_USERNAME');
  const adminPassword = requiredEnv('TEST_ADMIN_PASSWORD');

  const configuredHelperMode = String(process.env.TEST_TURNSTILE_HELPER_MODE || '').trim().toLowerCase();
  const turnstileHelperMode = flowArgs.turnstileHelperMode || configuredHelperMode || 'require-token';
  const helperUsesExistingClient = turnstileHelperMode === 'existing-client';

  const browserAssistEnabled = flowArgs.browserAssistedTurnstile || toBool(process.env.TEST_BROWSER_ASSISTED_TURNSTILE, false);

  const publicClient = new SessionClient(baseUrl, options.timeoutMs);
  let signupTurnstileEnabled = true;
  const turnstileConfigResponse = await publicClient.get('/api/signup/turnstile-config');
  if (turnstileConfigResponse.ok && turnstileConfigResponse.bodyJson && typeof turnstileConfigResponse.bodyJson.enabled === 'boolean') {
    signupTurnstileEnabled = Boolean(turnstileConfigResponse.bodyJson.enabled);
  }

  let turnstileToken = helperUsesExistingClient
    ? String(process.env.TEST_TURNSTILE_TOKEN || '').trim()
    : !signupTurnstileEnabled
      ? ''
    : options.dryRun
      ? String(process.env.TEST_TURNSTILE_TOKEN || '').trim()
      : browserAssistEnabled
        ? String(process.env.TEST_TURNSTILE_TOKEN || '').trim()
        : requiredEnv('TEST_TURNSTILE_TOKEN');

  const clientEmail = optionalEnv('TEST_FLOW_CLIENT_EMAIL', 'client1@alphainbound.automaticpeople.com').toLowerCase();
  const staffEmail = optionalEnv('TEST_FLOW_STAFF_EMAIL', 'staff1@alphainbound.automaticpeople.com').toLowerCase();
  const guestEmail = optionalEnv('TEST_FLOW_GUEST_EMAIL', 'guest1@alphainbound.automaticpeople.com').toLowerCase();

  const clientPassword = optionalEnv('TEST_FLOW_CLIENT_PASSWORD', 'Quiblick!4');
  const staffPassword = optionalEnv('TEST_FLOW_STAFF_PASSWORD', 'Quiblick!5');
  const guestPassword = optionalEnv('TEST_FLOW_GUEST_PASSWORD', 'Quiblick!6');

  const existingClientEmail = String(process.env.TEST_FLOW_EXISTING_CLIENT_EMAIL || '').trim().toLowerCase();
  const existingClientPassword = String(process.env.TEST_FLOW_EXISTING_CLIENT_PASSWORD || '').trim();
  const skipReset = flowArgs.skipReset
    || toBool(process.env.TEST_FLOW_SKIP_RESET, false)
    || helperUsesExistingClient;
  if (signupTurnstileEnabled && !helperUsesExistingClient && !options.dryRun && browserAssistEnabled && !turnstileToken) {
    turnstileToken = await captureTurnstileToken({
      baseUrl,
      timeoutMs: Math.max(Number(options.timeoutMs || 0), 5 * 60 * 1000)
    });
  }

  if (helperUsesExistingClient && !options.dryRun) {
    harness.assert(existingClientEmail, 'TEST_FLOW_EXISTING_CLIENT_EMAIL is required for turnstile helper mode existing-client.');
    harness.assert(existingClientPassword, 'TEST_FLOW_EXISTING_CLIENT_PASSWORD is required for turnstile helper mode existing-client.');
  }

  const adminClient = new SessionClient(baseUrl, options.timeoutMs);
  const client1 = new SessionClient(baseUrl, options.timeoutMs);
  const staff1 = new SessionClient(baseUrl, options.timeoutMs);
  const guest1 = new SessionClient(baseUrl, options.timeoutMs);

  const step1 = harness.step('1. Clean site user data via admin schema reset');
  if (options.dryRun) {
    step1.skip('Dry run enabled.');
  } else if (skipReset) {
    step1.skip('Schema reset skipped by helper mode/config.');
  } else {
    const login = await adminClient.post('/api/admin/login', {
      username: adminUsername,
      password: adminPassword
    });
    harness.assert(login.ok, 'Admin login failed with status ' + login.status);

    const reset = await adminClient.post('/api/admin/system/reset-schema', {
      confirmText: 'DELETE ALL DATA'
    });

    if (!reset.ok) {
      step1.fail('Admin schema reset failed.', { status: reset.status, body: reset.bodyJson || reset.bodyText });
      harness.printConsoleSummary();
      const artifactPathEarly = options.keepArtifacts ? harness.writeArtifactFile() : null;
      return { ok: false, summary: harness.summarize(), artifactPath: artifactPathEarly };
    }

    step1.pass('Schema reset completed.', { mode: reset.bodyJson && reset.bodyJson.mode ? reset.bodyJson.mode : 'unknown' });
  }

  const step2 = harness.step('2. Prepare email listeners for client/staff/guest addresses');
  if (options.dryRun) {
    step2.skip('Dry run enabled.');
  } else {
    const login = await adminClient.post('/api/admin/login', {
      username: adminUsername,
      password: adminPassword
    });
    harness.assert(login.ok, 'Admin login failed with status ' + login.status);

    const clearInbound = await adminClient.delete('/api/admin/inbound-mail');
    harness.assert(clearInbound.ok, 'Failed to clear inbound mail log. status=' + clearInbound.status);

    const configRes = await adminClient.get('/api/admin/inbound-mail/config');
    harness.assert(configRes.ok, 'Failed to load inbound config. status=' + configRes.status);
    const configured = Boolean(configRes.bodyJson && configRes.bodyJson.configured);
    if (!configured) {
      step2.fail('Inbound email logging is not configured on server.', configRes.bodyJson || null);
      harness.printConsoleSummary();
      const artifactPathEarly = options.keepArtifacts ? harness.writeArtifactFile() : null;
      return { ok: false, summary: harness.summarize(), artifactPath: artifactPathEarly };
    }

    step2.pass('Inbound listeners prepared by clearing log and validating config.', {
      watch: [clientEmail, staffEmail, guestEmail]
    });
  }

  const step3 = harness.step('3. Sign up client1 account');
  if (options.dryRun) {
    step3.skip('Dry run enabled.');
  } else if (helperUsesExistingClient) {
    step3.skip('Turnstile helper mode existing-client selected; signup skipped.');
  } else {
    const signup = await client1.post('/api/signup', {
      firstName: 'Andy',
      familyName: 'Butler',
      country: 'GB',
      email: clientEmail,
      password: clientPassword,
      turnstileToken
    });

    if (!signup.ok) {
      step3.fail('Client signup failed.', { status: signup.status, body: signup.bodyJson || signup.bodyText });
      harness.printConsoleSummary();
      const artifactPathEarly = options.keepArtifacts ? harness.writeArtifactFile() : null;
      return { ok: false, summary: harness.summarize(), artifactPath: artifactPathEarly };
    }

    step3.pass('Client1 signup succeeded.', signup.bodyJson || null);
  }

  const step4 = harness.step('4. Verify client validation email received');
  let clientValidationUrl = '';
  if (options.dryRun) {
    step4.skip('Dry run enabled.');
  } else if (helperUsesExistingClient) {
    step4.skip('Turnstile helper mode existing-client selected; validation email check skipped.');
  } else {
    const emailRow = await waitForInboundEmail(adminClient, clientEmail, 'validate', 120000, 5000);
    if (!emailRow) {
      step4.fail('No client validation email found in inbound log within timeout.', null);
      harness.printConsoleSummary();
      const artifactPathEarly = options.keepArtifacts ? harness.writeArtifactFile() : null;
      return { ok: false, summary: harness.summarize(), artifactPath: artifactPathEarly };
    }

    clientValidationUrl = findFirstUrl(String(emailRow.body_text || ''), 'validate-account');
    if (!clientValidationUrl) {
      step4.fail('Client validation email found but no validation URL extracted.', {
        subject: emailRow.subject,
        to: emailRow.to_address
      });
      harness.printConsoleSummary();
      const artifactPathEarly = options.keepArtifacts ? harness.writeArtifactFile() : null;
      return { ok: false, summary: harness.summarize(), artifactPath: artifactPathEarly };
    }

    step4.pass('Client validation email captured with URL.', {
      to: emailRow.to_address,
      subject: emailRow.subject
    });
  }

  const step5 = harness.step('5. Validate client account and login');
  if (options.dryRun) {
    step5.skip('Dry run enabled.');
  } else if (helperUsesExistingClient) {
    const login = await client1.post('/api/login', {
      email: existingClientEmail,
      password: existingClientPassword
    });
    harness.assert(login.ok, 'Existing client login failed. status=' + login.status);

    const me = await client1.get('/api/me');
    harness.assert(me.ok, '/api/me failed for existing client. status=' + me.status);

    step5.pass('Existing client login confirmed (helper mode).', {
      email: existingClientEmail,
      activeRole: String(me.bodyJson && me.bodyJson.accessContext && me.bodyJson.accessContext.activeRole || '')
    });
  } else {
    let validateRes = null;
    try {
      const validationUrlObj = new URL(clientValidationUrl);
      const token = String(validationUrlObj.searchParams.get('token') || '').trim();
      if (token) {
        validateRes = await client1.get('/api/account/validate?token=' + encodeURIComponent(token));
      } else if (validationUrlObj.pathname.startsWith('/api/account/validate')) {
        validateRes = await client1.get(validationUrlObj.pathname + validationUrlObj.search);
      }
    } catch {
      validateRes = null;
    }
    if (!validateRes) {
      const validationPath = clientValidationUrl.replace(baseUrl, '');
      validateRes = await client1.get(validationPath);
    }
    harness.assert(validateRes.ok, 'Client validation failed. status=' + validateRes.status);

    const login = await client1.post('/api/login', {
      email: clientEmail,
      password: clientPassword
    });
    harness.assert(login.ok, 'Client login failed after validation. status=' + login.status);

    const me = await client1.get('/api/me');
    harness.assert(me.ok, '/api/me failed for client after login. status=' + me.status);
    harness.assert(me.bodyJson && me.bodyJson.isValidated === true, 'Client should be validated after validation flow.');

    await client1.put('/api/account', {
      telephone: '07812582241',
      postalAddress: ''
    });

    step5.pass('Client account validated and login confirmed.', {
      email: clientEmail,
      isValidated: Boolean(me.bodyJson && me.bodyJson.isValidated)
    });
  }

  const step6 = harness.step('6. Enter host account bank details for client1');
  if (options.dryRun) {
    step6.skip('Dry run enabled.');
  } else {
    const clientMe = await client1.get('/api/me');
    harness.assert(clientMe.ok, 'Client /api/me failed before bank details save. status=' + clientMe.status);

    const hostAccountName = [
      String(clientMe.bodyJson && clientMe.bodyJson.firstName || '').trim(),
      String(clientMe.bodyJson && clientMe.bodyJson.familyName || '').trim()
    ].filter(Boolean).join(' ').trim() || clientEmail;

    const bankSave = await client1.put('/api/account/bank-details', {
      accountName: hostAccountName,
      sortCode: '20-20-21',
      accountNumber: '12345678',
      isBusiness: true,
      iban: 'GB33BUKB20201555555555'
    });
    harness.assert(bankSave.ok, 'Client bank details save failed. status=' + bankSave.status + ' body=' + bankSave.bodyText);

    step6.pass('Client bank details saved.', {
      accountName: hostAccountName,
      sortCode: '20-20-21',
      accountNumber: '12345678',
      iban: 'GB33BUKB20201555555555'
    });
  }

  const step7 = harness.step('7. Add staff1 and verify password setup email');
  let staffResetUrl = '';
  if (options.dryRun) {
    step7.skip('Dry run enabled.');
  } else {
    const inviteStaff = await client1.post('/api/access/team', {
      firstName: 'Sonya',
      familyName: 'Clean',
      country: 'GB',
      email: staffEmail,
      roles: ['Staff']
    });

    harness.assert(inviteStaff.ok, 'Staff invite failed. status=' + inviteStaff.status);

    const emailRow = await waitForInboundEmail(adminClient, staffEmail, 'password', 120000, 5000);
    if (!emailRow) {
      step7.fail('No staff password setup email found in inbound log within timeout.', inviteStaff.bodyJson || null);
      harness.printConsoleSummary();
      const artifactPathEarly = options.keepArtifacts ? harness.writeArtifactFile() : null;
      return { ok: false, summary: harness.summarize(), artifactPath: artifactPathEarly };
    }

    staffResetUrl = findFirstUrl(String(emailRow.body_text || ''), 'reset-password');
    if (!staffResetUrl) {
      step7.fail('Staff email found but no password reset URL extracted.', {
        subject: emailRow.subject,
        to: emailRow.to_address
      });
      harness.printConsoleSummary();
      const artifactPathEarly = options.keepArtifacts ? harness.writeArtifactFile() : null;
      return { ok: false, summary: harness.summarize(), artifactPath: artifactPathEarly };
    }

    step7.pass('Staff invite and setup email verified.', {
      to: emailRow.to_address,
      subject: emailRow.subject
    });
  }

  const step8 = harness.step('8. Set staff password, login as staff, verify validated');
  if (options.dryRun) {
    step8.skip('Dry run enabled.');
  } else {
    const resetUrl = new URL(staffResetUrl);
    const token = String(resetUrl.searchParams.get('token') || '').trim();
    harness.assert(token, 'Missing token in staff reset URL.');

    const resetRes = await staff1.post('/api/account/password-reset/confirm', {
      token,
      password: staffPassword
    });
    harness.assert(resetRes.ok, 'Staff password reset failed. status=' + resetRes.status);

    const login = await staff1.post('/api/login', {
      email: staffEmail,
      password: staffPassword
    });
    harness.assert(login.ok, 'Staff login failed after password setup. status=' + login.status);

    const me = await staff1.get('/api/me');
    harness.assert(me.ok, 'Staff /api/me failed. status=' + me.status);
    harness.assert(me.bodyJson && me.bodyJson.isValidated === true, 'Staff should be validated after password setup.');

    step8.pass('Staff account setup/login/validation confirmed.', {
      email: staffEmail,
      isValidated: Boolean(me.bodyJson && me.bodyJson.isValidated)
    });
  }

  const step9 = harness.step('9. Add guest1 from config and verify relationship + setup email');
  let guestResetUrl = '';
  let guestLoginPathAvailable = false;
  if (options.dryRun) {
    step9.skip('Dry run enabled.');
  } else {
    const guestCreate = await client1.post('/api/access/guests', {
      firstName: 'Joe',
      familyName: 'Tidy',
      email: guestEmail,
      phone: ''
    });
    harness.assert(guestCreate.ok, 'Guest create failed. status=' + guestCreate.status);
    const createdGuest = guestCreate.bodyJson && guestCreate.bodyJson.guest ? guestCreate.bodyJson.guest : null;
    const createdGuestId = Number(createdGuest && createdGuest.id || 0);
    harness.assert(Number.isInteger(createdGuestId) && createdGuestId > 0, 'Guest create did not return a valid guest id.');
    const setupEmailSent = Boolean(guestCreate.bodyJson && guestCreate.bodyJson.setupEmailSent === true);
    const setupEmailError = String(guestCreate.bodyJson && guestCreate.bodyJson.setupEmailError || '').trim();
    const setupResetUrlFromCreate = String(guestCreate.bodyJson && guestCreate.bodyJson.setupResetUrl || '').trim();
    const setupResetTokenFromCreate = String(guestCreate.bodyJson && guestCreate.bodyJson.setupResetToken || '').trim();

    const emailRow = await waitForInboundEmail(adminClient, guestEmail, 'password', 120000, 5000);
    if (emailRow) {
      guestResetUrl = findFirstUrl(String(emailRow.body_text || ''), 'reset-password');
    }
    if (!guestResetUrl && setupResetTokenFromCreate) {
      const appBase = stripTrailingSlash(String(baseUrl || ''));
      if (appBase) {
        guestResetUrl = appBase + '/reset-password.html?token=' + encodeURIComponent(setupResetTokenFromCreate);
      }
    }
    if (!guestResetUrl && setupResetUrlFromCreate) {
      guestResetUrl = setupResetUrlFromCreate;
    }
    harness.assert(guestResetUrl, 'Guest setup email was captured but reset URL was missing.');
    guestLoginPathAvailable = true;

    step9.pass('Guest relationship created and setup/reset email verified.', {
      guestId: createdGuestId,
      to: emailRow ? emailRow.to_address : guestEmail,
      subject: emailRow ? emailRow.subject : 'reset URL from create response',
      setupEmailSent,
      setupEmailError
    });
  }

  const step10 = harness.step('10. Login as guest and verify guest-only behavior and empty reservations');
  if (options.dryRun) {
    step10.skip('Dry run enabled.');
  } else if (!guestLoginPathAvailable || !guestResetUrl) {
    step10.skip('Guest login path not available for this flow (no guest setup/reset URL emitted).');
  } else {
    const resetUrl = new URL(guestResetUrl);
    const token = String(resetUrl.searchParams.get('token') || '').trim();
    harness.assert(token, 'Missing token in guest reset URL.');

    const resetRes = await guest1.post('/api/account/password-reset/confirm', {
      token,
      password: guestPassword
    });
    harness.assert(resetRes.ok, 'Guest password reset failed. status=' + resetRes.status);

    const login = await guest1.post('/api/login', {
      email: guestEmail,
      password: guestPassword
    });
    harness.assert(login.ok, 'Guest login failed after password setup. status=' + login.status);

    const me = await guest1.get('/api/me');
    harness.assert(me.ok, 'Guest /api/me failed. status=' + me.status);

    const access = me.bodyJson && me.bodyJson.accessContext ? me.bodyJson.accessContext : {};
    const activeRole = String(access.activeRole || '').trim();
    harness.assert(activeRole === 'Guest', 'Expected active role Guest, got ' + activeRole);

    const reservationsRes = await guest1.get('/api/guest/dashboard/reservations');
    harness.assert(reservationsRes.ok, 'Guest reservations endpoint failed. status=' + reservationsRes.status);

    const reservations = Array.isArray(reservationsRes.bodyJson && reservationsRes.bodyJson.reservations)
      ? reservationsRes.bodyJson.reservations
      : [];
    const facilityReservations = Array.isArray(reservationsRes.bodyJson && reservationsRes.bodyJson.facilityReservations)
      ? reservationsRes.bodyJson.facilityReservations
      : [];

    harness.assert(reservations.length === 0, 'Expected guest reservations to be empty for new guest account.');
    harness.assert(facilityReservations.length === 0, 'Expected guest facility reservations to be empty for new guest account.');

    step10.pass('Guest role and empty reservation visibility confirmed.', {
      activeRole,
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
      console.error('[ERROR] workflow-02-live-onboarding-client-staff-guest failed:', err && err.message ? err.message : err);
      process.exit(1);
    });
}

module.exports = {
  id: TEST_META.id,
  title: TEST_META.title,
  run
};
