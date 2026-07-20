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
   - `npm run test:workflow:auth -- --dry-run`
   - `npm run test:workflow:all -- --base-url http://localhost:3000`

## Environment Variables

- `TEST_BASE_URL`: target host (default `http://localhost:3000`)
- `TEST_TIMEOUT_MS`: request timeout for test HTTP calls
- `TEST_KEEP_ARTIFACTS`: `true|false` to write JSON output files
- `TEST_ALLOW_UNAUTHENTICATED`: if `true`, smoke auth test accepts `401` for `/api/me`

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
