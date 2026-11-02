# Event schema

Policy events use NEP-297 JSON logs with `standard: "coffer"` and
`version: "1.0.0"`. Implemented event names are:

- `configuration_proposed`
- `configuration_approved`
- `configuration_applied`
- `configuration_cancelled`
- `proposal_created`
- `proposal_approved`
- `proposal_cancelled`
- `proposal_expired`

Event data may contain organization/proposal commitments, configuration and
proposal versions, policy digests, expiry, state, and public approver account
IDs. It must not contain customer names, database IDs, invoice text, raw
recipients, amounts, salary/payroll data, AI text, provider responses, keys, or
credentials. Unit tests inspect serialized logs for those forbidden fields;
Sandbox event verification remains C-05 work.
