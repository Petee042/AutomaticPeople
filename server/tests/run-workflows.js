'use strict';

const fs = require('fs');
const path = require('path');
const { toBool } = require('./helpers/workflow-test-harness');

const TESTS = [
  {
    id: 'workflow-00-live-existing-client-precheck',
    title: 'Workflow 00 - Existing client precheck',
    modulePath: './workflows/workflow-00-live-existing-client-precheck.test.js'
  },
  {
    id: 'workflow-01-auth-smoke',
    title: 'Workflow 01 - Auth smoke checks',
    modulePath: './workflows/workflow-01-auth-smoke.test.js'
  },
  {
    id: 'workflow-02-live-onboarding-client-staff-guest',
    title: 'Workflow 02 - Live onboarding: client, staff, guest',
    modulePath: './workflows/workflow-02-live-onboarding-client-staff-guest.test.js'
  },
  {
    id: 'workflow-03-live-guest-login-from-private-reservation',
    title: 'Workflow 03 - Live guest login from private reservation provisioning',
    modulePath: './workflows/workflow-03-live-guest-login-from-private-reservation.test.js'
  },
  {
    id: 'workflow-04-live-facility-bank-transfer',
    title: 'Workflow 04 - Live facility reservation (bank transfer)',
    modulePath: './workflows/workflow-04-live-facility-bank-transfer.test.js'
  },
  {
    id: 'workflow-05-live-facility-online-payment',
    title: 'Workflow 05 - Live facility reservation (online payment)',
    modulePath: './workflows/workflow-05-live-facility-online-payment.test.js'
  }
];

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const options = {
    listOnly: false,
    runAll: false,
    onlyId: '',
    passthrough: []
  };

  for (let idx = 0; idx < args.length; idx += 1) {
    const token = String(args[idx] || '').trim();
    if (!token) continue;

    if (token === '--list') {
      options.listOnly = true;
      continue;
    }
    if (token === '--all') {
      options.runAll = true;
      continue;
    }
    if (token === '--only') {
      options.onlyId = String(args[idx + 1] || '').trim();
      idx += 1;
      continue;
    }

    options.passthrough.push(token);
  }

  return options;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function loadLocalTestEnv() {
  const envCandidates = [
    path.resolve(__dirname, '.env.local'),
    path.resolve(__dirname, '.env')
  ];

  for (const envPath of envCandidates) {
    loadEnvFile(envPath);
  }
}

function selectTests(options) {
  if (options.onlyId) {
    return TESTS.filter((t) => t.id === options.onlyId);
  }
  if (options.runAll || toBool(process.env.TEST_RUN_ALL, true)) {
    return TESTS.slice();
  }
  return TESTS.slice(0, 1);
}

async function execute() {
  loadLocalTestEnv();
  const options = parseArgs(process.argv.slice(2));

  if (options.listOnly) {
    console.log('Available workflow tests:');
    TESTS.forEach((test) => {
      console.log('- ' + test.id + ' :: ' + test.title);
    });
    return 0;
  }

  const selected = selectTests(options);
  if (!selected.length) {
    console.error('No workflow tests selected. Use --list to see available test ids.');
    return 1;
  }

  const startedAt = Date.now();
  let failureCount = 0;

  for (const test of selected) {
    const resolvedPath = path.resolve(__dirname, test.modulePath);
    const testModule = require(resolvedPath);
    if (!testModule || typeof testModule.run !== 'function') {
      console.error('[FAIL] ' + test.id + ': module does not export run(argv).');
      failureCount += 1;
      continue;
    }

    console.log('');
    console.log('=== Running ' + test.id + ' ===');
    try {
      const result = await testModule.run(options.passthrough);
      if (!result || result.ok !== true) {
        failureCount += 1;
      }
    } catch (err) {
      failureCount += 1;
      console.error('[ERROR] ' + test.id + ':', err && err.message ? err.message : err);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  console.log('');
  console.log('Workflow test run complete in ' + elapsedMs + 'ms. Failures=' + failureCount + '.');

  return failureCount === 0 ? 0 : 1;
}

execute()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[FATAL] run-workflows failed:', err && err.message ? err.message : err);
    process.exit(1);
  });
