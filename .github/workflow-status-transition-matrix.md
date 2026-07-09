# Workflow Status Transition Matrix (Phase 1 Baseline)

Canonical payment lifecycle labels:
- awaiting_payment
- payment_confirmed
- payment_failed
- cancelled
- expired

## Allowed Transitions

- awaiting_payment -> payment_confirmed
- awaiting_payment -> payment_failed
- awaiting_payment -> cancelled
- awaiting_payment -> expired
- payment_failed -> awaiting_payment
- payment_failed -> cancelled
- payment_failed -> expired

No transitions allowed from payment_confirmed, cancelled, or expired.

## Reminder Policy Matrix

## Workflow 2 - Private Reservation (Ops)
- Bank Transfer: recurring reminder every 8 hours while awaiting payment
- Cash On Site: single reminder at 08:00 on reservation start date; no reminder before start date
- No Charge: no reminder
- Online Payment: no reminder

## Workflow 3 - Facility Booking (Ops)
- Bank Transfer: recurring reminder every 8 hours while awaiting payment
- Cash On Site: single reminder at 08:00 on reservation start date; no reminder before start date
- No Charge: no reminder
- Online Payment: no reminder

## Workflow 4 - Reservation Enquiry (Public)
- Bank Transfer: recurring reminder every 8 hours while awaiting payment
- Online Payment: no reminder

## Workflow 5 - Facility Enquiry (Public)
- Bank Transfer: recurring reminder every 8 hours while awaiting payment
- Online Payment: no reminder
