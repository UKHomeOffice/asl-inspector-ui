module.exports = {
  title: 'Change date granted',
  summary: `The expiry date will automatically update to reflect the project's duration.`,
  fields: {
    issueDate: {
      label: 'Current date granted'
    },
    newIssueDate: {
      label: 'New date granted',
      hint: 'For example, 15 11 2017'
    },
    expiryDate: {
      label: 'Current expiry date'
    },
    newExpiryDate: {
      label: 'New expiry date'
    },
    duration: {
      label: 'Project duration'
    }
  },
  errors: {
    newIssueDate: {
      required: 'Please enter a valid date',
      validDate: 'Please enter a valid date',
      dateIsBefore: 'Date granted cannot be in the future'
    }
  },
  buttons: {
    submit: 'Continue'
  }
};
