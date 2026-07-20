'use strict';

const fs = require('fs');
const path = require('path');

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const text = String(value).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes' || text === 'y' || text === 'on';
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeFilePart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'unknown';
}

function ensureOutputDir() {
  const outputDir = path.resolve(__dirname, '..', 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}

function parseOptions(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const options = {
    dryRun: false,
    baseUrl: process.env.TEST_BASE_URL || 'http://localhost:3000',
    timeoutMs: Number(process.env.TEST_TIMEOUT_MS || 20000),
    keepArtifacts: toBool(process.env.TEST_KEEP_ARTIFACTS, true)
  };

  for (let idx = 0; idx < args.length; idx += 1) {
    const token = String(args[idx] || '').trim();
    if (!token) continue;

    if (token === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (token === '--live') {
      options.dryRun = false;
      continue;
    }
    if (token === '--base-url') {
      const value = String(args[idx + 1] || '').trim();
      if (value) {
        options.baseUrl = value;
        idx += 1;
      }
      continue;
    }
    if (token === '--timeout-ms') {
      const value = Number(args[idx + 1]);
      if (Number.isFinite(value) && value > 0) {
        options.timeoutMs = value;
        idx += 1;
      }
      continue;
    }
  }

  return options;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...(init || {}),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function createWorkflowHarness(meta, optionsInput) {
  const options = Object.assign(
    {
      dryRun: false,
      baseUrl: 'http://localhost:3000',
      timeoutMs: 20000,
      keepArtifacts: true
    },
    optionsInput || {}
  );

  const context = {
    meta: {
      id: String(meta && meta.id || 'workflow-test').trim(),
      title: String(meta && meta.title || 'Workflow test').trim(),
      owner: String(meta && meta.owner || 'unknown').trim(),
      destructive: Boolean(meta && meta.destructive)
    },
    options,
    steps: [],
    startedAt: nowIso()
  };

  function step(name, extra) {
    const row = {
      name: String(name || '').trim() || 'Unnamed step',
      status: 'pending',
      startedAt: nowIso(),
      details: extra || null
    };
    context.steps.push(row);

    return {
      pass(message, details) {
        row.status = 'pass';
        row.message = message || '';
        row.details = details || row.details || null;
        row.finishedAt = nowIso();
      },
      fail(message, details) {
        row.status = 'fail';
        row.message = message || '';
        row.details = details || row.details || null;
        row.finishedAt = nowIso();
      },
      skip(message, details) {
        row.status = 'skip';
        row.message = message || '';
        row.details = details || row.details || null;
        row.finishedAt = nowIso();
      }
    };
  }

  function assert(condition, message) {
    if (!condition) {
      throw new Error(message || 'Assertion failed.');
    }
  }

  async function request(pathName, init) {
    const endpoint = new URL(pathName, context.options.baseUrl).toString();
    const res = await fetchWithTimeout(endpoint, init, context.options.timeoutMs);

    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch {
      bodyText = '';
    }

    let bodyJson = null;
    try {
      bodyJson = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      bodyJson = null;
    }

    return {
      ok: res.ok,
      status: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      bodyText,
      bodyJson,
      url: endpoint
    };
  }

  function summarize() {
    const passCount = context.steps.filter((s) => s.status === 'pass').length;
    const failCount = context.steps.filter((s) => s.status === 'fail').length;
    const skipCount = context.steps.filter((s) => s.status === 'skip').length;
    const pendingCount = context.steps.filter((s) => s.status === 'pending').length;
    const success = failCount === 0 && pendingCount === 0;

    return {
      success,
      passCount,
      failCount,
      skipCount,
      pendingCount,
      totalSteps: context.steps.length
    };
  }

  function printConsoleSummary() {
    const summary = summarize();
    const prefix = summary.success ? '[PASS]' : '[FAIL]';
    console.log(prefix + ' ' + context.meta.id + ' - ' + context.meta.title);
    for (const s of context.steps) {
      console.log('  - ' + s.status.toUpperCase() + ': ' + s.name + (s.message ? ' :: ' + s.message : ''));
    }
    console.log(
      '  steps=' + summary.totalSteps +
      ' pass=' + summary.passCount +
      ' fail=' + summary.failCount +
      ' skip=' + summary.skipCount +
      ' pending=' + summary.pendingCount
    );
  }

  function writeArtifactFile() {
    const outputDir = ensureOutputDir();
    const stamp = nowIso().replace(/[:.]/g, '-');
    const fileName = sanitizeFilePart(context.meta.id) + '--' + stamp + '.json';
    const outPath = path.join(outputDir, fileName);
    const payload = {
      meta: context.meta,
      options: context.options,
      startedAt: context.startedAt,
      finishedAt: nowIso(),
      summary: summarize(),
      steps: context.steps
    };
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    return outPath;
  }

  return {
    meta: context.meta,
    options: context.options,
    step,
    assert,
    request,
    summarize,
    printConsoleSummary,
    writeArtifactFile
  };
}

module.exports = {
  createWorkflowHarness,
  parseOptions,
  toBool
};
