# Workflow API Contracts (Phase 1 Baseline)

This document captures per-workflow API ownership before route extraction.

## Workflow 1 - User Account Creation

Owned outcomes:
- set password path
- email validation path

Current server touchpoints (baseline):
- account validation and password reset endpoints in `server/app.js`

## Workflow 2 - Private Reservation (Ops)

Owned outcomes:
- private reservation creation
- guest linkage
- payment status and confirmation handling

Current server touchpoints (baseline):
- `/api/private-reservations` family in `server/app.js`

## Workflow 3 - Facility Booking (Ops)

Owned outcomes:
- facility reservation creation and updates
- payment method handling for facility reservations

Current server touchpoints (baseline):
- `/api/shared-resources/:resourceId/reservations` family in `server/app.js`

## Workflow 4 - Reservation Enquiry (Public)

Owned outcomes:
- landing page availability search
- bank transfer submit
- online payment prepare/finalize

Current server touchpoints (baseline):
- `/api/public/reservation-enquiry-landing-pages/:slug/*` in `server/app.js`

## Workflow 5 - Facility Enquiry (Public)

Owned outcomes:
- facility enquiry availability and submit
- online payment path and post-payment handoff

Current server touchpoints (baseline):
- `/api/public/shared-resources/:resourceId/*` in `server/app.js`

## Cross-Workflow Rule

A workflow endpoint must not call another workflow orchestration module directly.
Only shared utility modules may be used across workflows.
