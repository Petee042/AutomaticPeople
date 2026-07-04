'use strict';

const STATUS = Object.freeze({
  AWAITING_PAYMENT: 'awaiting_payment',
  PAYMENT_CONFIRMED: 'payment_confirmed',
  PAYMENT_FAILED: 'payment_failed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired'
});

const ALLOWED_TRANSITIONS = Object.freeze({
  awaiting_payment: new Set(['payment_confirmed', 'payment_failed', 'cancelled', 'expired']),
  payment_failed: new Set(['awaiting_payment', 'cancelled', 'expired']),
  payment_confirmed: new Set([]),
  cancelled: new Set([]),
  expired: new Set([])
});

function canTransition(fromStatus, toStatus) {
  const fromKey = String(fromStatus || '').trim().toLowerCase();
  const toKey = String(toStatus || '').trim().toLowerCase();
  if (!fromKey || !toKey) return false;
  const allowed = ALLOWED_TRANSITIONS[fromKey];
  if (!allowed) return false;
  return allowed.has(toKey);
}

module.exports = {
  STATUS,
  canTransition
};
