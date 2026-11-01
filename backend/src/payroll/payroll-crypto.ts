import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';

type Sealed = { ciphertext: Buffer; nonce: Buffer };

@Injectable()
export class PayrollEnvelopeEncryption {
  private readonly keyEncryptionKey: Buffer;
  readonly keyVersion: string;

  constructor(@Inject(APP_ENVIRONMENT) environment: AppEnvironment) {
    this.keyVersion = environment.ENCRYPTION_KEY_VERSION;
    this.keyEncryptionKey = environment.ENCRYPTION_KEY_BASE64
      ? decodeKey(environment.ENCRYPTION_KEY_BASE64)
      : randomBytes(32);
  }

  createDataKey(organizationId: string, reference: string) {
    const dataKey = randomBytes(32);
    const wrapped = seal(
      this.keyEncryptionKey,
      dataKey,
      `coffer:payroll-key:v1:${organizationId}:${reference}`,
    );
    return {
      dataKey,
      wrappedDataKey: wrapped.ciphertext,
      dataKeyNonce: wrapped.nonce,
      encryptionKeyVersion: this.keyVersion,
    };
  }

  unwrapDataKey(input: {
    organizationId: string;
    reference: string;
    wrappedDataKey: Buffer;
    dataKeyNonce: Buffer;
    encryptionKeyVersion: string;
  }): Buffer {
    if (input.encryptionKeyVersion !== this.keyVersion) {
      throw new Error('Encryption key version unavailable');
    }
    return open(
      this.keyEncryptionKey,
      input.wrappedDataKey,
      input.dataKeyNonce,
      `coffer:payroll-key:v1:${input.organizationId}:${input.reference}`,
    );
  }

  encrypt(dataKey: Buffer, plaintext: string, context: string): Sealed {
    return seal(dataKey, Buffer.from(plaintext, 'utf8'), context);
  }

  decrypt(dataKey: Buffer, value: Sealed, context: string): string {
    return open(dataKey, value.ciphertext, value.nonce, context).toString(
      'utf8',
    );
  }

  commitment(dataKey: Buffer, value: string): string {
    return createHmac('sha256', dataKey).update(value).digest('hex');
  }
}

function seal(key: Buffer, plaintext: Buffer, aad: string): Sealed {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: Buffer.concat([body, cipher.getAuthTag()]),
    nonce,
  };
}

function open(
  key: Buffer,
  ciphertext: Buffer,
  nonce: Buffer,
  aad: string,
): Buffer {
  if (nonce.length !== 12 || ciphertext.length < 16) {
    throw new Error('Encrypted payroll value is malformed');
  }
  const body = ciphertext.subarray(0, -16);
  const tag = ciphertext.subarray(-16);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

function decodeKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new Error('ENCRYPTION_KEY_BASE64 must encode exactly 32 bytes');
  }
  return key;
}
