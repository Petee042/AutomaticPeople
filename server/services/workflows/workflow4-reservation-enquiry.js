'use strict';

const { WORKFLOW_TYPES } = require('../shared/workflow-types');

function getWorkflowName() {
  return WORKFLOW_TYPES.WORKFLOW_4_RESERVATION_ENQUIRY_PUBLIC;
}

function getFlowPages() {
  return [
    'reservation-enquiry-step-1',
    'reservation-enquiry-step-2',
    'reservation-enquiry-login-handoff'
  ];
}

module.exports = {
  getWorkflowName,
  getFlowPages
};
