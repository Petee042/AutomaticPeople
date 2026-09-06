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
- Guest email: `guest1@alphainbound.automaticpeople.com`
- Guest name: John Guest
- Guest password: `Quiblick!4`

### Workflow Summary

1. Log in as existing Client1 account.
2. Under Config, create a Property titled `Property1` with:
Under Config Create Listing titled 'Listing1'
3.  Under Config create a Listing Titled 'Listing1' with date basis - checkout, Per Night Pricing - £100, Per Stay Price £20, Maximum number of guests - 2, Base ocupancy 2, Percentage Price Uplift per Additional Gues 25%.  Other fields can be left empty.
4. Create a future Direct Reservation for `Listing1` using bank transfer for payment for John Guest (`guest1@alphainbound.automaticpeople.com`).
5. Verify invitation/setup email is sent to guest1; set password `Quiblick!4`; log in as guest1.
6. Verify reservation notification email is sent to guest1 with reservation details; with back link to site to log in to notify host when transfer has been made.
7. Confirm guest1 account shows the Reservation in page for bank transfer payment with a status of awaiting payment and an action button of notify payment.
8. Return to Client1 account; verify the reservation is visible in facility reservations with status awaiting payment and select payment confirmation option..
9. Verify an email is sent to Guest1 notifying payment has been made.
10. Return to guest1 account; verify reservation shows payment confirmed.
11. Verify guest1 email contains message stating payment has been received for the facility reservation.

## Flow: Client Initiated Facility Reservation (Online Payment)

### Purpose

Validate full client to guest online-payment facility reservation flow through Stripe sandbox and post-payment state/email updates.

### Fixed Test Identities

- Client email: `client1@alphainbound.automaticpeople.com`
- Guest email: `guest2@alphainbound.automaticpeople.com`
- Guest name: Dave Parker
- Guest password: `Quiblick!4`

### Workflow Summary

1. Log in as existing Client1 account.
2. Verify existing Client1 Stripe Connect account is fully enabled (no Stripe setup action in this flow).
3. Create a future Direct Reservation for `Listing1` using online payment for Dave Guest (`guest2@alphainbound.automaticpeople.com`).
4. Verify invitation/setup email is sent to guest2; set password `Quiblick!4`; log in as guest2.
5. Verify Reservation notification email with reservation details is sent to guest2 containing a back link to the site to complete payment.
6. Follow back link to login and Confirm guest2 account shows reservation awaiting payment.  Follow Pay Now link to Stripe payment flow and complete the browser-assisted Stripe sandbox checkout. If prompted, choose to save credit card details, set country to `UK` or `United Kingdom`, use telephone 07812582241, and use postcode `EX11SX`.
7. Verify Client1 email recieves payment-made bu guest 2 notification.
8. Verify guest2 recieves an email notification containing payment confirmation for the reservation.
9. Return to Client1 account; verify reservation status is paid/confirmed.
10. Return to parker2 account; verify reservation shows payment confirmed.

### Default Execution

The default facility online-payment workflow now runs the Puppeteer-assisted Stripe checkout path.

- `npm run test:workflow:facility-online-payment -- --live --base-url https://alpha.automaticpeople.com`
- `npm run test:workflow:facility-set -- --live --base-url https://alpha.automaticpeople.com`
