'use strict';

function getWorkflowName() {
  return 'workflow1_account_creation';
}

function getFlowPages() {
  return [
    'set-password',
    'email-validation-confirmed'
  ];
}

module.exports = {
  getWorkflowName,
  getFlowPages
};
