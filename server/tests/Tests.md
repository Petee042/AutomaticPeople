# Tests - Repeatable Live Execution Flows

This file is now split into two execution sets:

1. `InitialTests.md`
2. `FacilityReservationTests.md`

## Execution Order

1. Run `InitialTests.md` first.
2. Manually sign in as Client1 and complete Stripe host onboarding.
3. Run `FacilityReservationTests.md` after Stripe onboarding is complete.

## Split Files

- `InitialTests.md`: onboarding and private-reservation provisioning baseline flows.
- `FacilityReservationTests.md`: facility reservation flows (bank transfer and online payment), assuming initial baseline has already run.
