'use strict';

/**
 * Stripe Integration Regression Test
 * Usage: node stripe-regression-test.js [baseUrl]
 *
 * With no baseUrl: verifies env vars and DB schema only.
 * With a baseUrl (e.g. http://localhost:3000): also exercises live API endpoints.
 *
 * Requires DATABASE_URL and (for live tests) a valid session cookie or API access.
 */

const { Pool } = require('pg');

const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const STRIPE_SECRET_KEY = String(process.env.STRIPE_SECRET_KEY || '').trim();
const STRIPE_PUBLISHABLE_KEY = String(process.env.STRIPE_PUBLISHABLE_KEY || '').trim();
const STRIPE_WEBHOOK_SECRET = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
const STRIPE_CONNECT_DEFAULT_COUNTRY = String(process.env.STRIPE_CONNECT_DEFAULT_COUNTRY || 'GB').trim();
const BASE_URL = (process.argv[2] || '').trim().replace(/\/$/, '');

let passed = 0;
let failed = 0;
const failures = [];

function pass(label) {
  passed += 1;
  console.log('  PASS  ' + label);
}

function fail(label, detail) {
  failed += 1;
  failures.push({ label, detail });
  console.log('  FAIL  ' + label + (detail ? (' — ' + detail) : ''));
}

// ── Section 1: Environment variables ─────────────────────────────────────────

console.log('\n[ 1 ] Environment variable checks');

if (STRIPE_SECRET_KEY) {
  if (STRIPE_SECRET_KEY.startsWith('sk_')) {
    pass('STRIPE_SECRET_KEY starts with sk_');
  } else {
    fail('STRIPE_SECRET_KEY format', 'Expected sk_test_ or sk_live_ prefix, got: ' + STRIPE_SECRET_KEY.slice(0, 8) + '...');
  }
  if (STRIPE_SECRET_KEY.startsWith('sk_test_')) {
    pass('STRIPE_SECRET_KEY is using test mode (sk_test_)');
  } else {
    console.log('  WARN  STRIPE_SECRET_KEY appears to be live mode (sk_live_) — test carefully');
  }
} else {
  fail('STRIPE_SECRET_KEY', 'Not set — Stripe will be disabled on the server');
}

if (STRIPE_PUBLISHABLE_KEY) {
  if (STRIPE_PUBLISHABLE_KEY.startsWith('pk_')) {
    pass('STRIPE_PUBLISHABLE_KEY starts with pk_');
  } else {
    fail('STRIPE_PUBLISHABLE_KEY format', 'Expected pk_test_ or pk_live_ prefix');
  }
} else {
  fail('STRIPE_PUBLISHABLE_KEY', 'Not set — client-side Stripe will not load');
}

if (STRIPE_WEBHOOK_SECRET) {
  if (STRIPE_WEBHOOK_SECRET.startsWith('whsec_')) {
    pass('STRIPE_WEBHOOK_SECRET starts with whsec_');
  } else {
    fail('STRIPE_WEBHOOK_SECRET format', 'Expected whsec_ prefix');
  }
} else {
  fail('STRIPE_WEBHOOK_SECRET', 'Not set — webhook signature verification will fail');
}

if (STRIPE_SECRET_KEY && STRIPE_PUBLISHABLE_KEY) {
  const secretIsTest = STRIPE_SECRET_KEY.startsWith('sk_test_');
  const pubIsTest = STRIPE_PUBLISHABLE_KEY.startsWith('pk_test_');
  if (secretIsTest === pubIsTest) {
    pass('STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY are both in the same mode (' + (secretIsTest ? 'test' : 'live') + ')');
  } else {
    fail('Stripe key mode mismatch', 'Secret key is ' + (secretIsTest ? 'test' : 'live') + ' but publishable key is ' + (pubIsTest ? 'test' : 'live'));
  }
}

if (STRIPE_CONNECT_DEFAULT_COUNTRY) {
  pass('STRIPE_CONNECT_DEFAULT_COUNTRY is set (' + STRIPE_CONNECT_DEFAULT_COUNTRY + ')');
} else {
  console.log('  WARN  STRIPE_CONNECT_DEFAULT_COUNTRY not set — will default to GB');
}

// ── Section 2: Database schema ────────────────────────────────────────────────

console.log('\n[ 2 ] Database schema checks');

async function runDbChecks() {
  if (!DATABASE_URL) {
    fail('DATABASE_URL', 'Not set — cannot run DB checks');
    return;
  }

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

  try {
    // users Stripe columns
    const userColsResult = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users'
        AND column_name IN ('stripe_account_id','stripe_onboarding_complete','stripe_charges_enabled','stripe_payouts_enabled')
    `);
    const userCols = userColsResult.rows.map((r) => r.column_name);
    ['stripe_account_id', 'stripe_onboarding_complete', 'stripe_charges_enabled', 'stripe_payouts_enabled'].forEach((col) => {
      if (userCols.includes(col)) {
        pass('users.' + col + ' exists');
      } else {
        fail('users.' + col, 'Column missing — run migration');
      }
    });

    // shared_resource_reservations Stripe columns
    const srrColsResult = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'shared_resource_reservations'
        AND column_name IN ('payment_intent_id','payment_provider','payment_status','payment_currency','payment_amount_minor','paid_at')
    `);
    const srrCols = srrColsResult.rows.map((r) => r.column_name);
    ['payment_intent_id', 'payment_provider', 'payment_status', 'payment_currency', 'payment_amount_minor', 'paid_at'].forEach((col) => {
      if (srrCols.includes(col)) {
        pass('shared_resource_reservations.' + col + ' exists');
      } else {
        fail('shared_resource_reservations.' + col, 'Column missing');
      }
    });

    // reservation_activity Stripe columns
    const raColsResult = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'reservation_activity'
        AND column_name IN ('payment_intent_id','payment_provider','payment_status','payment_currency','payment_amount_minor')
    `);
    const raCols = raColsResult.rows.map((r) => r.column_name);
    ['payment_intent_id', 'payment_provider', 'payment_status', 'payment_currency', 'payment_amount_minor'].forEach((col) => {
      if (raCols.includes(col)) {
        pass('reservation_activity.' + col + ' exists');
      } else {
        fail('reservation_activity.' + col, 'Column missing');
      }
    });

    // Unique index on shared_resource_reservations.payment_intent_id
    const srrIdxResult = await pool.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'shared_resource_reservations'
        AND indexname = 'idx_shared_resource_reservations_payment_intent_id'
    `);
    if (srrIdxResult.rows.length) {
      pass('idx_shared_resource_reservations_payment_intent_id exists');
    } else {
      fail('idx_shared_resource_reservations_payment_intent_id', 'Index missing');
    }

    // Reservation identifier registry
    const rirResult = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name = 'reservation_identifier_registry'
    `);
    if (rirResult.rows.length) {
      pass('reservation_identifier_registry table exists');
    } else {
      fail('reservation_identifier_registry', 'Table missing');
    }

  } catch (err) {
    fail('Database connection', err.message);
  } finally {
    await pool.end();
  }
}

// ── Section 3: Live API endpoint checks ──────────────────────────────────────

async function runLiveChecks() {
  if (!BASE_URL) {
    console.log('\n[ 3 ] Live API checks — skipped (no baseUrl argument provided)');
    console.log('      To run live checks: node stripe-regression-test.js http://localhost:3000');
    return;
  }

  console.log('\n[ 3 ] Live API checks against: ' + BASE_URL);

  // 3a — /health
  try {
    const res = await fetch(BASE_URL + '/health');
    if (res.ok) {
      pass('GET /health returns 200');
    } else {
      fail('GET /health', 'HTTP ' + res.status);
    }
  } catch (err) {
    fail('GET /health', err.message);
  }

  // 3b — /api/stripe/webhook with missing signature returns 400
  try {
    const res = await fetch(BASE_URL + '/api/stripe/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'payment_intent.succeeded' })
    });
    if (res.status === 400 || res.status === 503) {
      pass('POST /api/stripe/webhook with no signature returns 400/503 (not 500)');
    } else {
      fail('POST /api/stripe/webhook guard', 'Expected 400 or 503, got HTTP ' + res.status);
    }
  } catch (err) {
    fail('POST /api/stripe/webhook reachability', err.message);
  }

  // 3c — /api/stripe/connect/status without auth returns 401
  try {
    const res = await fetch(BASE_URL + '/api/stripe/connect/status');
    if (res.status === 401) {
      pass('GET /api/stripe/connect/status without auth returns 401');
    } else {
      fail('GET /api/stripe/connect/status auth guard', 'Expected 401, got HTTP ' + res.status);
    }
  } catch (err) {
    fail('GET /api/stripe/connect/status reachability', err.message);
  }

  // 3d — /api/stripe/connect/start without auth returns 401
  try {
    const res = await fetch(BASE_URL + '/api/stripe/connect/start', { method: 'POST' });
    if (res.status === 401) {
      pass('POST /api/stripe/connect/start without auth returns 401');
    } else {
      fail('POST /api/stripe/connect/start auth guard', 'Expected 401, got HTTP ' + res.status);
    }
  } catch (err) {
    fail('POST /api/stripe/connect/start reachability', err.message);
  }

  // 3e — Public online-payment/prepare without body returns 400 or 503 (not 500)
  const slugTest = 'test-stripe-regression';
  try {
    const res = await fetch(BASE_URL + '/api/public/reservation-enquiry-landing-pages/' + slugTest + '/online-payment/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (res.status === 400 || res.status === 503 || res.status === 404) {
      pass('POST /api/public/.../online-payment/prepare with empty body returns 400/404/503 (guard works)');
    } else {
      fail('POST /api/public/.../online-payment/prepare guard', 'Expected 400/404/503, got HTTP ' + res.status);
    }
  } catch (err) {
    fail('POST /api/public/.../online-payment/prepare reachability', err.message);
  }

  // 3f — Shared resource online payment prepare without body returns 400 or 503
  try {
    const res = await fetch(BASE_URL + '/api/public/shared-resources/999999/online-payment/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (res.status === 400 || res.status === 503 || res.status === 404) {
      pass('POST /api/public/shared-resources/:id/online-payment/prepare guard returns 400/404/503');
    } else {
      fail('POST /api/public/shared-resources/:id/online-payment/prepare guard', 'Expected 400/404/503, got HTTP ' + res.status);
    }
  } catch (err) {
    fail('POST /api/public/shared-resources/online-payment/prepare reachability', err.message);
  }

  // 3g — Public confirmation lookup with bogus identifier returns 404
  try {
    const res = await fetch(BASE_URL + '/api/public/reservations/by-identifier/BOGUS-REF-999');
    if (res.status === 404) {
      pass('GET /api/public/reservations/by-identifier/:id with bad ref returns 404');
    } else {
      fail('GET /api/public/reservations/by-identifier guard', 'Expected 404, got HTTP ' + res.status);
    }
  } catch (err) {
    fail('GET /api/public/reservations/by-identifier reachability', err.message);
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────

(async () => {
  await runDbChecks();
  await runLiveChecks();

  console.log('\n────────────────────────────────────');
  console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
  if (failures.length) {
    console.log('\nFailed checks:');
    failures.forEach((f) => console.log('  - ' + f.label + (f.detail ? ': ' + f.detail : '')));
  }
  console.log('────────────────────────────────────\n');
  process.exit(failed > 0 ? 1 : 0);
})();
