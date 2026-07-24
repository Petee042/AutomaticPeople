'use strict';

/**
 * Workflow Test Template
 * Workflow: Auth smoke (login status and auth-required behavior)
 * Preconditions: Server reachable at TEST_BASE_URL; test account optional for this smoke path
 * Destructive: No
 * Run: npm run test:workflow:auth -- --dry-run
 */

const { createWorkflowHarness, parseOptions, toBool } = require('../helpers/workflow-test-harness');

const TEST_META = {
  id: 'workflow-01-auth-smoke',
  title: 'Workflow 01 - Auth smoke checks',
  owner: 'AutomaticPeople',
  destructive: false
};

async function run(argv) {
  const options = parseOptions(argv);
  const harness = createWorkflowHarness(TEST_META, options);

  const allowUnauthenticated = toBool(process.env.TEST_ALLOW_UNAUTHENTICATED, true);

  const smokeStep = harness.step('Smoke endpoint responds');
  if (options.dryRun) {
    smokeStep.skip('Dry run enabled; endpoint request not executed.');
  } else {
    const response = await harness.request('/api/health');
    const acceptedStatuses = new Set([200, 404]);
    if (!acceptedStatuses.has(response.status)) {
      smokeStep.fail('Unexpected status from health probe.', {
        status: response.status,
        url: response.url
      });
    } else {
      smokeStep.pass('Server responded to probe endpoint.', {
        status: response.status,
        url: response.url
      });
    }
  }

  const authStep = harness.step('Protected endpoint behavior is controlled');
  if (options.dryRun) {
    authStep.skip('Dry run enabled; protected endpoint request not executed.');
  } else {
    const meResponse = await harness.request('/api/me');
    const validStatuses = allowUnauthenticated ? new Set([200, 401]) : new Set([200]);
    if (!validStatuses.has(meResponse.status)) {
      authStep.fail('Unexpected /api/me response status.', {
        status: meResponse.status,
        allowed: Array.from(validStatuses.values())
      });
    } else {
      authStep.pass('Protected endpoint returned expected status.', {
        status: meResponse.status
      });
    }
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
      console.error('[ERROR] workflow-01-auth-smoke failed:', err && err.message ? err.message : err);
      process.exit(1);
    });
}

module.exports = {
  id: TEST_META.id,
  title: TEST_META.title,
  run
};
