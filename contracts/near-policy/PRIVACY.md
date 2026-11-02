# On-chain privacy inventory

## Public state and transaction data

- controller and eligible approver NEAR account IDs;
- organization, policy, proposal ID, and complete instruction commitments;
- configuration/proposal versions, expiry, approval state, and timestamps;
- transaction sender, attached deposit, gas, method, and serialized arguments.

## Forbidden state, arguments, and events

- legal/customer/employee names and internal plaintext database identifiers;
- invoice descriptions or documents;
- raw recipient addresses or account mappings when a commitment suffices;
- salaries, payroll lines, tax details, or raw payment amounts;
- free-form AI output, prompts, provider payloads, access tokens, or keys.

Commitments do not make low-entropy data secret. The backend must use
domain-separated, nonce-bearing commitments and keep the source data encrypted
and access controlled. On-chain approval timing and approver accounts remain
public and must be disclosed in the product.

The raw asset, amount, recipient commitment, nonce, and idempotency commitment
are inputs to the off-chain `coffer:proposal:v1` digest. They are not individual
contract method arguments or state fields; only the resulting instruction
digest is submitted.
