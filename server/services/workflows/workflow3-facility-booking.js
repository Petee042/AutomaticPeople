'use strict';

const { WORKFLOW_TYPES } = require('../shared/workflow-types');
const { getReminderPolicy } = require('../shared/reminder-policy');

function getWorkflowName() {
  return WORKFLOW_TYPES.WORKFLOW_3_FACILITY_BOOKING_OPS;
}

function getFlowPages() {
  return [
    'facility-booking-step-1',
    'facility-booking-step-2',
    'facility-booking-confirmation'
  ];
}

function getPaymentReminderPolicy(paymentMethod, reservationStartDate) {
  return getReminderPolicy({
    workflowType: getWorkflowName(),
    paymentMethod,
    reservationStartDate
  });
}

module.exports = {
  getWorkflowName,
  getFlowPages,
  getPaymentReminderPolicy
};
