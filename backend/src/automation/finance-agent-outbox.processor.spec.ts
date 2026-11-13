import { describe, expect, it } from 'vitest';
import {
  financeAgentPolicyState,
  isSeededProcurementAgent,
} from './finance-agent-outbox.processor.js';

describe('Finance Agent policy outcomes', () => {
  it.each([
    ['ALLOW', 'POLICY_ALLOWED'],
    ['REQUIRES_APPROVAL', 'POLICY_APPROVAL_REQUIRED'],
    ['DENY', 'POLICY_DENIED'],
  ] as const)('maps %s without widening authority', (outcome, state) => {
    expect(financeAgentPolicyState(outcome)).toBe(state);
  });
});

describe('Finance Agent procurement selection', () => {
  it('accepts only the exact seeded service and vendor registration', () => {
    expect(
      isSeededProcurementAgent({
        allowedActions: ['purchase:document-classification'],
        vendorAllowlist: ['mock-document-classifier'],
      }),
    ).toBe(true);
    expect(
      isSeededProcurementAgent({
        allowedActions: [
          'purchase:document-classification',
          'purchase:anything',
        ],
        vendorAllowlist: ['mock-document-classifier'],
      }),
    ).toBe(false);
    expect(
      isSeededProcurementAgent({
        allowedActions: ['purchase:document-classification'],
        vendorAllowlist: ['unregistered-vendor'],
      }),
    ).toBe(false);
  });
});
