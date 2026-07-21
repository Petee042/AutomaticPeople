# Tests - Repeatable Live Execution Flows

## Flow: Client1 -> Staff1 -> Guest1 Onboarding (Live)

### Purpose

Validate an end-to-end onboarding workflow using live APIs and real email delivery/inbound logging.

### Fixed Test Identities

- Client email: `client1@alphainbound.automaticpeople.com`
- Staff email: `staff1@alphainbound.automaticpeople.com`
- Guest email: `guest1@alphainbound.automaticpeople.com`

### Preconditions

- Target environment reachable (default: `https://automaticpeople-alpha.onrender.com`)
- Admin credentials are available via environment variables
- Turnstile token is available via environment variable
- Inbound mail logging is configured and accessible from admin API

### Environment Variables

- `TEST_BASE_URL`
- `TEST_ADMIN_USERNAME`
- `TEST_ADMIN_PASSWORD`
- `TEST_TURNSTILE_TOKEN`
- Optional: `TEST_FLOW_CLIENT_PASSWORD` (default `Quiblick!4`)
- Optional: `TEST_FLOW_STAFF_PASSWORD` (default `Quiblick!5`)
- Optional: `TEST_FLOW_GUEST_PASSWORD` (default `Quiblick!6`)

### Workflow Steps (mapped from descriptive flow)

1. Clean the site of all site user data.
2. Set up listeners for test email addresses by clearing inbound log and polling for:
   - `client1@alphainbound.automaticpeople.com`
   - `staff1@alphainbound.automaticpeople.com`
   - `guest1@alphainbound.automaticpeople.com`
3. Create account for Client1 (Andy Butler, `07812582241`, password `Quiblick!4`).
4. Verify email is received for Client1 with validation link.
5. Validate account via link, then login with new credentials.
6. As Client1, add Staff1 (Sonya Clean) from Config team flow and verify password setup email is received.
7. Set Staff1 password from link and verify Staff1 login succeeds and account is validated.
8. As Client1, add Guest1 (Joe Tidy) from Config guest flow and verify guest relationship creation (invite/setup email may be absent).
9. If a guest setup path is emitted, validate Guest1 login and guest-only visibility; otherwise mark this step as skipped.

### Notes on Evidence

- Email evidence source: `GET /api/admin/inbound-mail`
- Validation and reset links are extracted from inbound email body text
- Role/navigation evidence source:
  - `GET /api/me` for active role
  - `GET /api/guest/dashboard/reservations` for empty guest data

### Expected Current Risk

If guest creation in Config does not currently emit a password setup email, step 9 is skipped and this is recorded in artifact details.

## Flow: Guest Login From Private Reservation Provisioning (Live)

### Purpose

Validate a full guest login journey using a provisioning path that creates a guest site user, then confirms guest dashboard access.

### Workflow Summary

1. Reset schema and clear inbound mail.
2. Create and validate client account.
3. Create property and listing.
4. Create staff account from client config page and validate staff account.
5. Create a no-charge private reservation for Guest1 (provisions guest site user).
6. Request guest password reset email and extract reset link.
7. Set guest password and login.
8. Verify `GET /api/guest/dashboard/reservations` is accessible and populated.

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
5. Return to Client1 account; verify the reservation is visible in facility reservations with status awaiting payment.
6. Return to parker1 account; select payment confirmation option for the facility reservation.
7. Verify an email is sent to Client1 notifying payment has been made.
8. Return to Client1 account; mark payment confirmed against the facility reservation.
9. Return to parker1 account; verify facility reservation shows payment confirmed.
10. Verify parker1 email contains message stating payment has been received for the facility reservation.

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
5. Follow Pay Now link to Stripe payment flow and pay using Stripe sandbox credentials.
6. Verify Client1 email includes payment-made notification.
7. Return to Client1 account; verify facility reservation status is paid/confirmed.
8. Return to parker2 account; verify facility reservation shows payment confirmed.
9. Verify parker2 email contains message confirming payment has been received for the facility reservation.
