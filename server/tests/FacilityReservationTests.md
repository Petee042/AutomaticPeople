# Facility Reservation Tests - Repeatable Live Execution Flows

These flows are intended to run after `InitialTests.md`.

## Preconditions For This File

- `InitialTests.md` has already been executed successfully in the same target environment.
- You have manually signed in as Client1 and completed Stripe host onboarding before running these flows.
- Client1 should have online payment available before starting the online-payment facility flow.

## Flow: Client Initiated Facility Reservation (Bank Transfer)

### Purpose

Validate full client to guest bank-transfer facility reservation flow, including guest payment confirmation and host confirmation.

### Fixed Test Identities

- Client email: `client1@alphainbound.automaticpeople.com`
- Guest email: `parker1@alphainbound.automaticpeople.com`
- Guest name: John Parker
- Guest password: `Quiblick!4`

### Workflow Summary

1. Under Config, create a facility titled `Parking1` with:
  - charge `8.00` per 24 hours
  - maximum spaces `2`
  - payment options enabled: online payment and bank transfer
  - max advance booking `6` days
  - valid description text and payment page texts that can be validated later
2. Create a future facility reservation for `Parking1` using bank transfer for John Parker (`parker1@alphainbound.automaticpeople.com`).
3. Verify invitation/setup email is sent to parker1; set password `Quiblick!4`; log in as parker1.
4. Confirm parker1 account shows the facility reservation.
5. Return to Client1 account and enter host account bank details:
  - account name: current logged-in user name
  - sort code: `20-20-21`
  - account number: `12345678`
  - IBAN: `GB33BUKB20201555555555`
6. Return to Client1 account; verify the reservation is visible in facility reservations with status awaiting payment.
7. Return to parker1 account; select payment confirmation option for the facility reservation.
8. Verify an email is sent to Client1 notifying payment has been made.
9. Return to Client1 account; mark payment confirmed against the facility reservation.
10. Return to parker1 account; verify facility reservation shows payment confirmed.
11. Verify parker1 email contains message stating payment has been received for the facility reservation.

## Flow: Client Initiated Facility Reservation (Online Payment)

### Purpose

Validate full client to guest online-payment facility reservation flow through Stripe sandbox and post-payment state/email updates.

### Fixed Test Identities

- Client email: `client1@alphainbound.automaticpeople.com`
- Guest email: `parker2@alphainbound.automaticpeople.com`
- Guest name: Dave Parker
- Guest password: `Quiblick!4`

### Workflow Summary

1. Under Config, create a facility titled `Parking2` with:
  - charge `12.00` per 24 hours
  - maximum spaces `1`
  - payment options enabled: online payment and bank transfer
  - max advance booking `6` days
  - valid description text and payment page texts that can be validated later
2. Create a future facility reservation for `Parking2` using online payment for Dave Parker (`parker2@alphainbound.automaticpeople.com`).
3. Verify invitation/setup email is sent to parker2; set password `Quiblick!4`; log in as parker2.
4. Confirm parker2 account shows facility reservation awaiting payment.
5. Return to Client1 account and enter host account bank details:
  - account name: current logged-in user name
  - sort code: `20-20-21`
  - account number: `12345678`
  - IBAN: `GB33BUKB20201555555555`
6. Follow Pay Now link to Stripe payment flow and pay using Stripe sandbox credentials.
7. Verify Client1 email includes payment-made notification.
8. Return to Client1 account; verify facility reservation status is paid/confirmed.
9. Return to parker2 account; verify facility reservation shows payment confirmed.
10. Verify parker2 email contains message confirming payment has been received for the facility reservation.
