'use strict';

const { WORKFLOW_TYPES } = require('../shared/workflow-types');
const { getReminderPolicy } = require('../shared/reminder-policy');

function getWorkflowName() {
  return WORKFLOW_TYPES.WORKFLOW_2_PRIVATE_RESERVATION_OPS;
}

function getFlowPages() {
  return [
    'private-reservation-step-1',
    'private-reservation-step-2',
    'private-reservation-confirmation'
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
