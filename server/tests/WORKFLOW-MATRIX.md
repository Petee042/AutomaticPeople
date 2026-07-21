# Workflow Test Matrix

| Workflow | Script ID | Script File | Environment | Seed/Data Requirement | Destructive | Last Verified |
|---|---|---|---|---|---|---|
| Existing client precheck | `workflow-00-live-existing-client-precheck` | `tests/workflows/workflow-00-live-existing-client-precheck.test.js` | alpha (recommended) | existing client email/password | No | 2026-07-20 |
| Auth smoke | `workflow-01-auth-smoke` | `tests/workflows/workflow-01-auth-smoke.test.js` | local/alpha/staging | none for dry run | No | 2026-07-20 |
| Live onboarding (client/staff/guest) | `workflow-02-live-onboarding-client-staff-guest` | `tests/workflows/workflow-02-live-onboarding-client-staff-guest.test.js` | alpha (recommended) | admin creds + turnstile token + inbound mail configured | Yes | 2026-07-20 |
| Guest login via private reservation | `workflow-03-live-guest-login-from-private-reservation` | `tests/workflows/workflow-03-live-guest-login-from-private-reservation.test.js` | alpha (recommended) | admin creds + inbound mail configured | Yes | 2026-07-21 |

## Update Rule

Whenever a new workflow test is added, update this table in the same commit.
