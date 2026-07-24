'use strict';

/**
 * Live Precheck
 * Verifies existing-client credentials before running helper-mode onboarding workflow.
 */

const { createWorkflowHarness, parseOptions } = require('../helpers/workflow-test-harness');

const TEST_META = {
  id: 'workflow-00-live-existing-client-precheck',
  title: 'Workflow 00 - Existing client precheck',
  owner: 'AutomaticPeople',
  destructive: false
};

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error('Missing required environment variable: ' + name);
  }
  return value;
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
  return Object.keys(cookieJar || {}).map((key) => key + '=' + cookieJar[key]).join('; ');
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
}

async function run(argv) {
  const options = parseOptions(argv);
  const harness = createWorkflowHarness(TEST_META, options);

  const baseUrl = normalizeUrl(options.baseUrl || process.env.TEST_BASE_URL || 'https://automaticpeople-alpha.onrender.com');
  const existingClientEmail = options.dryRun
    ? String(process.env.TEST_FLOW_EXISTING_CLIENT_EMAIL || '').trim().toLowerCase()
    : requiredEnv('TEST_FLOW_EXISTING_CLIENT_EMAIL').toLowerCase();
  const existingClientPassword = options.dryRun
    ? String(process.env.TEST_FLOW_EXISTING_CLIENT_PASSWORD || '').trim()
    : requiredEnv('TEST_FLOW_EXISTING_CLIENT_PASSWORD');

  const client = new SessionClient(baseUrl, options.timeoutMs);

  const step1 = harness.step('Health endpoint is reachable');
  if (options.dryRun) {
    step1.skip('Dry run enabled.');
  } else {
    const health = await client.get('/health');
    if (!health.ok) {
      step1.fail('Health endpoint failed.', { status: health.status });
      harness.printConsoleSummary();
      const artifactPathEarly = options.keepArtifacts ? harness.writeArtifactFile() : null;
      return { ok: false, summary: harness.summarize(), artifactPath: artifactPathEarly };
    }
    step1.pass('Target host is reachable.', { status: health.status });
  }

  const step2 = harness.step('Existing client credentials can login');
  if (options.dryRun) {
    step2.skip('Dry run enabled.');
  } else {
    const login = await client.post('/api/login', {
      email: existingClientEmail,
      password: existingClientPassword
    });

    if (!login.ok) {
      step2.fail('Existing client login failed.', { status: login.status, body: login.bodyJson || login.bodyText });
      harness.printConsoleSummary();
      const artifactPathEarly = options.keepArtifacts ? harness.writeArtifactFile() : null;
      return { ok: false, summary: harness.summarize(), artifactPath: artifactPathEarly };
    }

    step2.pass('Existing client login succeeded.', null);
  }

  const step3 = harness.step('Existing client has valid /api/me context');
  if (options.dryRun) {
    step3.skip('Dry run enabled.');
  } else {
    const me = await client.get('/api/me');
    if (!me.ok) {
      step3.fail('Existing client /api/me failed.', { status: me.status, body: me.bodyJson || me.bodyText });
      harness.printConsoleSummary();
      const artifactPathEarly = options.keepArtifacts ? harness.writeArtifactFile() : null;
      return { ok: false, summary: harness.summarize(), artifactPath: artifactPathEarly };
    }

    const activeRole = String(me.bodyJson && me.bodyJson.accessContext && me.bodyJson.accessContext.activeRole || '').trim();
    if (!activeRole) {
      step3.fail('No active role in access context.', me.bodyJson || null);
      harness.printConsoleSummary();
      const artifactPathEarly = options.keepArtifacts ? harness.writeArtifactFile() : null;
      return { ok: false, summary: harness.summarize(), artifactPath: artifactPathEarly };
    }

    step3.pass('Existing client context is valid.', {
      email: String(me.bodyJson && me.bodyJson.email || ''),
      activeRole
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
      console.error('[ERROR] workflow-00-live-existing-client-precheck failed:', err && err.message ? err.message : err);
      process.exit(1);
    });
}

module.exports = {
  id: TEST_META.id,
  title: TEST_META.title,
  run
};
