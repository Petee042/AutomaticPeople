# Initial Tests - Repeatable Live Execution Flows

These flows are intended to run first.

After these complete, you can manually onboard Stripe for Client1, then run the facility reservation tests in `FacilityReservationTests.md`.

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
6. As Client1, enter host account bank details from Account page:
  - account name: current logged-in user name
  - sort code: `20-20-21`
  - account number: `12345678`
  - IBAN: `GB33BUKB20201555555555`
7. As Client1, add Staff1 (Sonya Clean) from Config team flow and verify password setup email is received.
8. Set Staff1 password from link and verify Staff1 login succeeds and account is validated.
9. As Client1, add Guest1 (Joe Tidy) from Config guest flow and verify guest relationship creation and setup/reset email emission.
10. Validate Guest1 login and guest-only visibility via emitted setup/reset URL.

### Notes on Evidence

- Email evidence source: `GET /api/admin/inbound-mail`
- Validation and reset links are extracted from inbound email body text
- Role/navigation evidence source:
  - `GET /api/me` for active role
  - `GET /api/guest/dashboard/reservations` for empty guest data

### Expected Current Risk

Guest creation in Config must emit a setup/reset email URL so guest login can be validated in step 10.

## Flow: Guest Login From Private Reservation Provisioning (Live)

### Purpose

Validate a full guest login journey using a provisioning path that creates a guest site user, then confirms guest dashboard access.

### Workflow Summary

1. Reset schema and clear inbound mail.
2. Create and validate client account.
3. Enter client1 host account bank details:
  - account name: current logged-in user name
  - sort code: `20-20-21`
  - account number: `12345678`
  - IBAN: `GB33BUKB20201555555555`
4. Create staff account from client config page and validate staff account.
5. Create property and listing.
6. Create a no-charge private reservation for Guest1 (provisions guest site user).
7. Request guest password reset email and extract reset link.
8. Set guest password and login.
9. Verify `GET /api/guest/dashboard/reservations` is accessible and populated.
