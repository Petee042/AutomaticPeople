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
