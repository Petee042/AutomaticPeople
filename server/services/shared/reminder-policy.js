'use strict';

const { WORKFLOW_TYPES, normalizeWorkflowType } = require('./workflow-types');

function normalizePaymentMethod(value) {
  const key = String(value || '').trim().toLowerCase();
  if (!key) return '';
  if (key === 'bank transfer' || key === 'bank_transfer') return 'bank_transfer';
  if (key === 'cash on site' || key === 'cash_on_site') return 'cash_on_site';
  if (key === 'online payment' || key === 'online_payment') return 'online_payment';
  if (key === 'no charge' || key === 'no_charge') return 'no_charge';
  return key;
}

function getDateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toISOString().slice(0, 10);
}

function buildIsoAtEightUtc(dateKey) {
  if (!dateKey) return '';
  return dateKey + 'T08:00:00.000Z';
}

function getReminderPolicy(input) {
  const workflowType = normalizeWorkflowType(input && input.workflowType);
  const paymentMethod = normalizePaymentMethod(input && input.paymentMethod);
  const reservationStartDate = getDateKey(input && input.reservationStartDate);

  if (!workflowType || !paymentMethod) {
    return { enabled: false, reason: 'invalid_workflow_or_payment_method' };
  }

  if (paymentMethod === 'bank_transfer') {
    return {
      enabled: true,
      mode: 'recurring_every_8_hours',
      intervalHours: 8,
      triggerPhase: 'awaiting_payment',
      firstRunAt: '',
      stopAfterFirstSend: false,
      noPreStartReminders: false
    };
  }

  if (
    paymentMethod === 'cash_on_site'
    && (workflowType === WORKFLOW_TYPES.WORKFLOW_2_PRIVATE_RESERVATION_OPS
      || workflowType === WORKFLOW_TYPES.WORKFLOW_3_FACILITY_BOOKING_OPS)
  ) {
    return {
      enabled: true,
      mode: 'single_at_start_day_0800',
      intervalHours: 0,
      triggerPhase: 'awaiting_payment',
      firstRunAt: buildIsoAtEightUtc(reservationStartDate),
      stopAfterFirstSend: true,
      noPreStartReminders: true
    };
  }

  return { enabled: false, reason: 'reminder_policy_not_applicable' };
}

module.exports = {
  normalizePaymentMethod,
  getReminderPolicy
};
