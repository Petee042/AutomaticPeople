# Workflow Separation Implementation Plan (Review Before Build)

## Goal

Separate the site into 5 independent workflows so feature changes in one workflow cannot break the others.

- Shared logic is allowed only for utility functions (pricing, availability, account creation helper, payment adapter, email transport).
- Workflow orchestration (page sequence, status transitions, emails, redirects, reminders) must remain workflow-specific.

## Scope

This plan covers:

1. Workflow architecture split in server handlers
2. Page and script ownership boundaries
3. Data model/state model alignment
4. Payment and reminder behavior by workflow
5. Test matrix and release gating

This plan does **not** implement changes yet.

## Workflow Definitions

## Workflow 1 - User Account Creation

Conditions:
- No password exists: send set-password link email
- Password exists: send email-validation link email

Pages:
- Page 1: Set password
- Page 2: Email validation confirmation

## Workflow 2 - New Private Reservation (Ops)

Pages:
- Page 1: Reservation details + payment method
- Page 2: Guest details
- Page 3: Confirmation -> return to Ops

Payment outcomes:
- No Charge: confirmed reservation
- Bank Transfer: awaiting payment + reminder cadence
- Cash On Site: awaiting payment + single reminder at 08:00 on reservation start date (no pre-start reminders)
- Online Payment: awaiting payment + pay action in guest list

## Workflow 3 - New Facility Booking (Ops)

Pages:
- Page 1: Facility details + payment method
- Page 2: Guest details
- Page 3: Confirmation -> return to Ops

Payment outcomes mirror Workflow 2 but for facility reservations.

Cash On Site reminder rule for Workflow 3:
- single reminder at 08:00 on reservation start date
- no reminder before reservation start date

## Workflow 4 - New Reservation Enquiry (Public Landing)

Pages:
- Page 1: Reservation details on landing page
- Page 2: Guest details
- Page 3: Login page or Workflow 1 password path

Payment outcomes:
- Bank Transfer
- Online Payment

## Workflow 5 - New Facility Enquiry (Public Landing)

Pages:
- Page 1: Facility details + payment method
- Page 2: Guest details
- Page 3: Login page or Workflow 1 password path

Payment outcomes:
- Bank Transfer
- Online Payment

Workflow 5 is independent and must not call Workflow 3/4 orchestration directly.

## Current Surface Map (High-Level)

Server (single-file orchestration hotspot):
- `server/app.js`

UI pages currently in use:
- `public/private-reservation.html`
- `public/private-reservation-complete.html`
- `public/dashboard-private-reservations.html`
- `public/dashboard-facility-reservations.html`
- `public/reservation-enquiry.html`
- `public/reservation-enquiry-payment.html`
- `public/reservation-enquiry-complete.html`
- `public/reservation-enquiry-landing-page.html`
- `public/shared-resource.html`
- `public/resource-booking.html`
- `public/public-pages/bank-transfer-reservation.html`
- `public/public-pages/cash-on-site-reservation.html`
- `public/public-pages/free-of-charge-reservation.html`
- `public/public-pages/online-payment-reservation.html`
- `public/public-pages/online-payment-confirmation.html`

## Target Architecture

## A. Shared Utility Layer (Allowed Cross-Workflow)

Create utility modules:
- `server/services/shared/availability.js`
- `server/services/shared/pricing.js`
- `server/services/shared/guest-account.js`
- `server/services/shared/payments.js`
- `server/services/shared/email.js`
- `server/services/shared/status.js`

Rules:
- Pure or narrowly scoped functions only
- No redirect decisions
- No workflow branching
- No direct page knowledge

## B. Workflow Orchestration Layer (No Cross-Workflow Calls)

Create workflow modules:
- `server/services/workflow1-account.js`
- `server/services/workflow2-private-reservation.js`
- `server/services/workflow3-facility-booking.js`
- `server/services/workflow4-reservation-enquiry.js`
- `server/services/workflow5-facility-enquiry.js`

Each module owns:
- input validation specific to workflow
- state transitions for that workflow
- email content and triggers for that workflow
- page progression and next-step outcomes for that workflow

## C. Route Layer Split

Move route groups from `server/app.js` into:
- `server/routes/workflow1.account.routes.js`
- `server/routes/workflow2.private.routes.js`
- `server/routes/workflow3.facility-booking.routes.js`
- `server/routes/workflow4.reservation-enquiry.routes.js`
- `server/routes/workflow5.facility-enquiry.routes.js`

`server/app.js` should become composition/bootstrap only.

## D. Page and Script Ownership

Create dedicated workflow folders for scripts/pages where needed:
- `public/workflows/wf1-account/`
- `public/workflows/wf2-private-reservation/`
- `public/workflows/wf3-facility-booking/`
- `public/workflows/wf4-reservation-enquiry/`
- `public/workflows/wf5-facility-enquiry/`

Rules:
- No shared page instance between workflows
- Shared UI helper functions allowed in utility script files only
- Redirect targets must stay within workflow chain unless explicitly handing off to login/account workflow

## Data and Status Model Plan

Introduce/confirm explicit workflow type markers:
- `private_reservation_ops`
- `facility_booking_ops`
- `reservation_enquiry_public`
- `facility_enquiry_public`

Standardize payment status naming:
- `awaiting_payment`
- `payment_confirmed`
- `payment_failed`
- `cancelled`
- `expired`

Each workflow defines legal transitions in a local transition map.

## Reminder Scheduler Plan (8-Hour Cadence)

Create reminder queue model:
- workflow type
- reservation/facility reference
- payment method
- current status
- next run timestamp
- active flag

Scheduler behavior:
- Bank Transfer:
	- applies to awaiting payment states
	- reminder cadence every 8 hours
	- sends reminder to client and guest
	- stops automatically when status leaves awaiting payment
- Cash On Site (Workflow 2 and Workflow 3 only):
	- no reminder before reservation start date
	- exactly one reminder at 08:00 on reservation start date
	- sends reminder to client and guest
	- no recurring reminder after first send

## File-by-File Change Checklist

## Phase 1 - Stabilization and Contracts (No Behavior Change)

1. Add workflow contract docs
- Add API contract spec per workflow
- Add allowed transition table per workflow

2. Add shared utility wrappers around existing calls
- Keep same behavior, move implementation behind stable function names

3. Add tracing IDs per workflow request
- Log workflow type and route for easier debugging

## Phase 2 - Extract Workflow 2 (Private Reservation)

Server:
- Extract private reservation orchestration from `server/app.js` into `server/services/workflow2-private-reservation.js`
- Add `server/routes/workflow2.private.routes.js`

UI:
- Keep existing pages but isolate scripts under wf2 folder or dedicated wf2 script files

Tests:
- All 4 payment conditions
- Dashboard list visibility
- Guest list pay button for online awaiting payment

## Phase 3 - Extract Workflow 3 (Facility Booking)

Server:
- Extract facility booking orchestration into `server/services/workflow3-facility-booking.js`
- Add `server/routes/workflow3.facility-booking.routes.js`

UI:
- Ensure facility booking pages/scripts are not calling reservation enquiry orchestration

Tests:
- All 4 payment conditions
- Facility calendar/list updates only

## Phase 4 - Extract Workflow 4 (Reservation Enquiry)

Server:
- Extract public reservation enquiry orchestration into dedicated service and route files

UI:
- Keep landing-page path independent from ops workflows

Tests:
- Bank transfer and online payment paths
- Login handoff and password path handoff

## Phase 5 - Implement Workflow 5 (Facility Enquiry) as New Independent Stack

Server:
- New service + routes only for workflow 5
- Reuse shared utilities only

UI:
- Dedicated page sequence for workflow 5
- No direct reuse of workflow 3/4 orchestration scripts

Tests:
- Bank transfer and online payment
- Login/password path handoff
- Facility reservation list pay button visibility

## Phase 6 - Workflow 1 Harmonization

Server/UI:
- Ensure all workflows route account setup/validation to one consistent workflow 1 path
- Distinguish no-password vs password-exists email actions

Tests:
- set-password success redirect
- validation success redirect

## API Contract Review Checklist (Per Workflow)

For each endpoint, document:
- input schema
- output schema
- status transitions
- side effects (email, calendar/list, reminders)
- next page/URL behavior

Required gate: no endpoint may invoke another workflow service directly.

## UI Flow Review Checklist (Per Workflow)

For each page in sequence:
- entry criteria
- persisted draft/state keys
- next-page rules
- cancellation/return behavior
- error handling behavior

Required gate: page sequence must be self-contained.

## Regression Matrix

For every release candidate:
- Change in one workflow must pass smoke checks in all other workflows
- Reservation workflow changes must not alter facility workflow outputs
- Enquiry workflow changes must not alter ops workflow outputs
- Account workflow changes must not alter reservation/facility state transitions

## Proposed Test Coverage

Automated tests to add:
- contract tests for workflow endpoints
- transition tests per status map
- email trigger tests by payment method
- scheduler tests for reminder lifecycle
- browser flow tests for page-sequence integrity

## Rollout Strategy

1. Feature flags by workflow route group
2. Deploy in order: W2 -> W3 -> W4 -> W5 -> W1 harmonization
3. Monitor logs by workflow tag
4. Remove old mixed-path handlers only after parity confirmation

## Review Questions (Approval Gate)

1. Confirm final status labels expected in dashboard and guest views.
2. Confirm exact wording templates for all guest/client reminder emails.
3. Confirm Workflow 5 page URL naming convention.
4. Confirm whether Workflow 5 requires separate landing-page config entity or extension of existing config.
5. Confirm acceptable migration strategy for existing in-flight records.

## Definition Of Done

- All 5 workflows use separate orchestration modules and route groups
- Shared utilities contain no workflow branching
- Each workflow has an explicit page sequence and transition map
- Reminder scheduler behavior is isolated and verifiable
- Regression suite passes cross-workflow isolation checks
