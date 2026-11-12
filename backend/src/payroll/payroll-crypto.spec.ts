import { parseEnvironment } from '../config/env.js';
import { PayrollEnvelopeEncryption } from './payroll-crypto.js';

const key = Buffer.alloc(32, 7).toString('base64');

describe('PayrollEnvelopeEncryption', () => {
  it('T-PRV-03 round trips envelope encryption with a bound key version', () => {
    const encryption = new PayrollEnvelopeEncryption(
      parseEnvironment({
        ENCRYPTION_KEY_BASE64: key,
        ENCRYPTION_KEY_VERSION: 'test-key-v1',
      }),
    );
    const created = encryption.createDataKey('org-1', 'batch-1');
    const encrypted = encryption.encrypt(
      created.dataKey,
      'sensitive salary',
      'field-context',
    );
    const unwrapped = encryption.unwrapDataKey({
      organizationId: 'org-1',
      reference: 'batch-1',
      wrappedDataKey: created.wrappedDataKey,
      dataKeyNonce: created.dataKeyNonce,
      encryptionKeyVersion: 'test-key-v1',
    });
    expect(encryption.decrypt(unwrapped, encrypted, 'field-context')).toBe(
      'sensitive salary',
    );
    expect(created.wrappedDataKey.toString()).not.toContain('sensitive');
    expect(encryption.persistent).toBe(true);
  });

  it('marks an ephemeral process key as unsuitable for persistent payroll', () => {
    const encryption = new PayrollEnvelopeEncryption(parseEnvironment({}));

    expect(encryption.persistent).toBe(false);
  });

  it('rejects key-version, context, and ciphertext tampering', () => {
    const encryption = new PayrollEnvelopeEncryption(
      parseEnvironment({ ENCRYPTION_KEY_BASE64: key }),
    );
    const created = encryption.createDataKey('org-1', 'batch-1');
    expect(() =>
      encryption.unwrapDataKey({
        organizationId: 'org-1',
        reference: 'batch-1',
        wrappedDataKey: created.wrappedDataKey,
        dataKeyNonce: created.dataKeyNonce,
        encryptionKeyVersion: 'another-key',
      }),
    ).toThrow('version');
    const encrypted = encryption.encrypt(created.dataKey, '100', 'gross');
    expect(() =>
      encryption.decrypt(created.dataKey, encrypted, 'net'),
    ).toThrow();
  });
});
