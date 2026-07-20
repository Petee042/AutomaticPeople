# Workflow Test Matrix

| Workflow | Script ID | Script File | Environment | Seed/Data Requirement | Destructive | Last Verified |
|---|---|---|---|---|---|---|
| Auth smoke | `workflow-01-auth-smoke` | `tests/workflows/workflow-01-auth-smoke.test.js` | local/alpha/staging | none for dry run | No | 2026-07-20 |
| Live onboarding (client/staff/guest) | `workflow-02-live-onboarding-client-staff-guest` | `tests/workflows/workflow-02-live-onboarding-client-staff-guest.test.js` | alpha (recommended) | admin creds + turnstile token + inbound mail configured | Yes | 2026-07-20 |

## Update Rule

Whenever a new workflow test is added, update this table in the same commit.
