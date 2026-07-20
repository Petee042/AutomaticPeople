# Workflow Test Scaffold

This folder contains workflow-level test scripts that can be run on demand.

## Folder Layout

- `workflows/`: workflow tests (`*.test.js`)
- `helpers/`: shared harness/utilities
- `fixtures/`: static payloads and seed data snapshots
- `output/`: generated JSON artifacts per run
- `smoke/`: optional short health/sanity checks

## Quick Start

1. Install dependencies in `server/`.
2. Set environment values (see `.env.example`).
3. Run one of:
   - `npm run test:workflow:list`
   - `npm run test:workflow:precheck-existing-client -- --live --base-url https://automaticpeople-alpha.onrender.com`
   - `npm run test:workflow:auth -- --dry-run`
   - `npm run test:workflow:all -- --base-url http://localhost:3000`
   - `npm run test:workflow:live-onboarding -- --live --base-url https://automaticpeople-alpha.onrender.com`
   - `npm run test:workflow:live-onboarding:assist -- --live --base-url https://automaticpeople-alpha.onrender.com`

## Environment Variables

- `TEST_BASE_URL`: target host (default `http://localhost:3000`)
- `TEST_TIMEOUT_MS`: request timeout for test HTTP calls
- `TEST_KEEP_ARTIFACTS`: `true|false` to write JSON output files
- `TEST_ALLOW_UNAUTHENTICATED`: if `true`, smoke auth test accepts `401` for `/api/me`

Runner convenience:

- `tests/run-workflows.js` auto-loads `tests/.env.local` then `tests/.env` if present.
- Existing shell environment values still take precedence.

Live onboarding flow additionally requires:

- `TEST_ADMIN_USERNAME`
- `TEST_ADMIN_PASSWORD`
- `TEST_TURNSTILE_TOKEN`
- Optional: `TEST_FLOW_CLIENT_PASSWORD`, `TEST_FLOW_STAFF_PASSWORD`, `TEST_FLOW_GUEST_PASSWORD`

Browser-assisted Turnstile helper:

- If you do not have a fresh `TEST_TURNSTILE_TOKEN`, use `npm run test:workflow:live-onboarding:assist -- --live --base-url https://automaticpeople-alpha.onrender.com`
- This opens a visible browser with the sign-up page, waits for you to solve the Turnstile check manually, captures the response token, closes the helper browser, and then continues the workflow run.
- The helper captures the token for the current run only. It does not persist the token because Turnstile tokens are short-lived.

Turnstile helper mode for reruns:

- `TEST_TURNSTILE_HELPER_MODE=require-token` (default): normal signup path, requires `TEST_TURNSTILE_TOKEN`.
- `TEST_TURNSTILE_HELPER_MODE=existing-client`: skips signup/validation checks and logs in with existing client credentials.
- With `existing-client` mode set:
   - `TEST_FLOW_EXISTING_CLIENT_EMAIL` required
   - `TEST_FLOW_EXISTING_CLIENT_PASSWORD` required
   - `TEST_FLOW_SKIP_RESET=true` recommended (and automatically applied by script)

Recommended sequence for helper-mode reruns:

1. Run precheck: `npm run test:workflow:precheck-existing-client -- --live --base-url https://automaticpeople-alpha.onrender.com`
2. If precheck passes, run full flow: `npm run test:workflow:live-onboarding -- --live --base-url https://automaticpeople-alpha.onrender.com`

## Script Authoring Rules

Each test file should:

1. Export `id`, `title`, and `run(argv)`.
2. Use `createWorkflowHarness()` from `helpers/workflow-test-harness.js`.
3. Emit step-level pass/fail/skip messages.
4. Exit with a non-zero code on failures when run directly.
5. Avoid hardcoding secrets or production identifiers.

## Artifact Review

Each run writes JSON artifacts to `tests/output/` unless disabled. Review:

- `summary.success`
- `summary.failCount`
- each step's `status`, `message`, and `details`

These artifacts are designed so future automation can parse and summarize outcomes reliably.

## Descriptive Flow Source

The normalized repeatable flow definition is stored in `tests/Tests.md`.
