# Workflow Test Matrix

| Workflow | Script ID | Script File | Environment | Seed/Data Requirement | Destructive | Last Verified |
|---|---|---|---|---|---|---|
| Existing client precheck | `workflow-00-live-existing-client-precheck` | `tests/workflows/workflow-00-live-existing-client-precheck.test.js` | alpha (recommended) | existing client email/password | No | 2026-07-20 |
| Auth smoke | `workflow-01-auth-smoke` | `tests/workflows/workflow-01-auth-smoke.test.js` | local/alpha/staging | none for dry run | No | 2026-07-20 |
| Live onboarding (client/staff/guest) | `workflow-02-live-onboarding-client-staff-guest` | `tests/workflows/workflow-02-live-onboarding-client-staff-guest.test.js` | alpha (recommended) | admin creds + turnstile token + inbound mail configured | Yes | 2026-07-20 |
| Guest login via private reservation | `workflow-03-live-guest-login-from-private-reservation` | `tests/workflows/workflow-03-live-guest-login-from-private-reservation.test.js` | alpha (recommended) | admin creds + inbound mail configured | Yes | 2026-07-21 |
| Facility reservation (bank transfer) | `workflow-04-live-facility-bank-transfer` | `tests/workflows/workflow-04-live-facility-bank-transfer.test.js` | alpha (recommended) | admin creds + inbound mail configured | Yes | 2026-07-21 |
| Facility reservation (online payment) | `workflow-05-live-facility-online-payment` | `tests/workflows/workflow-05-live-facility-online-payment.test.js` | alpha (recommended) | admin creds + inbound mail configured + Stripe test secret | Yes | 2026-07-21 |
| Listing reservation (bank transfer) | `workflow-06-live-listing-bank-transfer` | `tests/workflows/workflow-06-live-listing-bank-transfer.test.js` | alpha (recommended) | run after InitialTests (02+03) + admin creds + inbound mail configured | Yes | 2026-07-24 |
| Listing reservation (online payment) | `workflow-07-live-listing-online-payment` | `tests/workflows/workflow-07-live-listing-online-payment.test.js` | alpha (recommended) | run after InitialTests (02+03) + host Stripe Connect already ready + admin creds + inbound mail configured | Yes | 2026-07-24 |

## Update Rule

Whenever a new workflow test is added, update this table in the same commit.
