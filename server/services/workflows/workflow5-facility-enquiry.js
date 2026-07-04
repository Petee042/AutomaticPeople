'use strict';

const { WORKFLOW_TYPES } = require('../shared/workflow-types');

function getWorkflowName() {
  return WORKFLOW_TYPES.WORKFLOW_5_FACILITY_ENQUIRY_PUBLIC;
}

function getFlowPages() {
  return [
    'facility-enquiry-step-1',
    'facility-enquiry-step-2',
    'facility-enquiry-login-handoff'
  ];
}

module.exports = {
  getWorkflowName,
  getFlowPages
};
