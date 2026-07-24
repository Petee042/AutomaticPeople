'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const parsed = {
    passthrough: [],
    guest1: '',
    guest2: '',
    suffix: ''
  };

  for (let idx = 0; idx < args.length; idx += 1) {
    const token = String(args[idx] || '').trim();
    if (!token) continue;

    if (token === '--guest1-email') {
      parsed.guest1 = String(args[idx + 1] || '').trim().toLowerCase();
      idx += 1;
      continue;
    }
    if (token === '--guest2-email') {
      parsed.guest2 = String(args[idx + 1] || '').trim().toLowerCase();
      idx += 1;
      continue;
    }
    if (token === '--name-suffix') {
      parsed.suffix = String(args[idx + 1] || '').trim();
      idx += 1;
      continue;
    }

    parsed.passthrough.push(token);
  }

  return parsed;
}

function buildRunSuffix() {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const stamp = yy + mm + dd;
  const rand = Math.random().toString(36).slice(2, 7);
  return stamp + rand;
}

function runWorkflow(id, args, env) {
  const scriptPath = path.resolve(__dirname, 'run-workflows.js');
  const commandArgs = [scriptPath, '--only', id].concat(args || []);
  const result = spawnSync(process.execPath, commandArgs, {
    stdio: 'inherit',
    env: Object.assign({}, process.env, env || {})
  });

  if (result.error) {
    throw result.error;
  }

  const code = Number(result.status || 0);
  return Number.isInteger(code) ? code : 1;
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const suffix = parsed.suffix || buildRunSuffix();
  const guest1 = parsed.guest1 || ('listingbt+' + suffix + '@alphainbound.automaticpeople.com');
  const guest2 = parsed.guest2 || ('listingop+' + suffix + '@alphainbound.automaticpeople.com');

  const runEnv = {
    TEST_FLOW_LISTING_NAME_SUFFIX: suffix,
    TEST_FLOW_LISTING_GUEST1_EMAIL: guest1,
    TEST_FLOW_LISTING_GUEST2_EMAIL: guest2,
    TEST_FLOW_LISTING_GUEST1_PASSWORD: String(process.env.TEST_FLOW_LISTING_GUEST1_PASSWORD || process.env.TEST_FLOW_GUEST_PASSWORD || 'Quiblick!4'),
    TEST_FLOW_LISTING_GUEST2_PASSWORD: String(process.env.TEST_FLOW_LISTING_GUEST2_PASSWORD || process.env.TEST_FLOW_GUEST_PASSWORD || 'Quiblick!4')
  };

  console.log('Running listing workflow set with:');
  console.log('- TEST_FLOW_LISTING_NAME_SUFFIX=' + runEnv.TEST_FLOW_LISTING_NAME_SUFFIX);
  console.log('- TEST_FLOW_LISTING_GUEST1_EMAIL=' + runEnv.TEST_FLOW_LISTING_GUEST1_EMAIL);
  console.log('- TEST_FLOW_LISTING_GUEST2_EMAIL=' + runEnv.TEST_FLOW_LISTING_GUEST2_EMAIL);

  const bankCode = runWorkflow('workflow-06-live-listing-bank-transfer', parsed.passthrough, runEnv);
  if (bankCode !== 0) {
    process.exit(bankCode);
  }

  const onlineCode = runWorkflow('workflow-07-live-listing-online-payment', parsed.passthrough, runEnv);
  process.exit(onlineCode);
}

main();
