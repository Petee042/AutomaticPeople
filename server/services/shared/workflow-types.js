'use strict';

const WORKFLOW_TYPES = Object.freeze({
  WORKFLOW_1_ACCOUNT: 'workflow1_account_creation',
  WORKFLOW_2_PRIVATE_RESERVATION_OPS: 'workflow2_private_reservation_ops',
  WORKFLOW_3_FACILITY_BOOKING_OPS: 'workflow3_facility_booking_ops',
  WORKFLOW_4_RESERVATION_ENQUIRY_PUBLIC: 'workflow4_reservation_enquiry_public',
  WORKFLOW_5_FACILITY_ENQUIRY_PUBLIC: 'workflow5_facility_enquiry_public'
});

function normalizeWorkflowType(value) {
  const key = String(value || '').trim().toLowerCase();
  const all = Object.values(WORKFLOW_TYPES);
  return all.includes(key) ? key : '';
}

module.exports = {
  WORKFLOW_TYPES,
  normalizeWorkflowType
};
