import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  MockVendorAdapter,
  ServiceOfferView,
  VendorOffer,
} from './automation.types.js';

export const MOCK_VENDOR_ID = 'mock-document-classifier';
export const MOCK_SERVICE_CODE = 'document-classification';
export const MOCK_VENDOR_RECIPIENT_COMMITMENT = createHash('sha256')
  .update('coffer:mock-vendor-destination:v1')
  .digest('hex');

@Injectable()
export class SeededMockVendorAdapter implements MockVendorAdapter {
  async requestOffer(input: {
    requestDigest: string;
    documentCount: number;
    classificationProfile: 'standard' | 'financial';
    now: Date;
  }): Promise<VendorOffer> {
    return {
      vendorId: MOCK_VENDOR_ID,
      externalOfferId: randomUUID(),
      serviceCode: MOCK_SERVICE_CODE,
      requestDigest: input.requestDigest,
      assetId: 'mock:base:usdc',
      chainId: 'mock:base',
      priceAtomic: (BigInt(input.documentCount) * 100_000n).toString(),
      recipientCommitment: MOCK_VENDOR_RECIPIENT_COMMITMENT,
      expiresAt: new Date(input.now.getTime() + 10 * 60_000).toISOString(),
      controlledTerms: {
        documentCount: input.documentCount,
        classificationProfile: input.classificationProfile,
        deliverable: 'classification-labels',
      },
    };
  }

  async fulfill(offer: ServiceOfferView) {
    return {
      mockPaymentReference: `mock-service:${offer.offerDigest}`,
      deliverable: {
        serviceCode: MOCK_SERVICE_CODE as 'document-classification',
        processedDocuments: offer.controlledTerms.documentCount,
        labels:
          offer.controlledTerms.classificationProfile === 'financial'
            ? ['invoice', 'receipt', 'other']
            : ['document', 'other'],
      },
    };
  }
}
