'use strict';

const path = require('path');
const { toBool } = require('./helpers/workflow-test-harness');

const TESTS = [
  {
    id: 'workflow-01-auth-smoke',
    title: 'Workflow 01 - Auth smoke checks',
    modulePath: './workflows/workflow-01-auth-smoke.test.js'
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
