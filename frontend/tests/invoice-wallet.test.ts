import assert from "node:assert/strict";
import test from "node:test";
import { invoicePaymentWalletRequest } from "../src/lib/invoice-wallet.ts";

const invoice = {
  invoiceNumber: "INV-1",
  status: "ISSUED" as const,
  paymentState: "UNPAID" as const,
  currency: "near:testnet:native",
  totalAmountAtomic: "1000",
  verifiedReceivedAtomic: "0",
  outstandingAmountAtomic: "1000",
  payeeDestination: "merchant.testnet",
  lineItems: [{ description: "Service", amountAtomic: "1000" }],
  dueDate: "2027-01-01T00:00:00.000Z",
};
const prepared = {
  payment: {
    id: "11111111-1111-4111-8111-111111111111",
    quoteId: "22222222-2222-4222-8222-222222222222",
    provider: "near-testnet" as const,
    scenario: "success" as const,
    status: "AWAITING_DEPOSIT" as const,
    version: 1,
    settlementPostingCount: 0,
    refundPostingCount: 0,
    pollCount: 0,
    history: [],
  },
  transaction: {
    network: "testnet" as const,
    signerAccountId: "payer.testnet",
    receiverId: "merchant.testnet",
    actions: [{ type: "Transfer" as const, amountAtomic: "1000" }],
  },
};

test("builds only the exact verified invoice transfer", () => {
  assert.deepEqual(
    invoicePaymentWalletRequest(invoice, prepared, ["payer.testnet"]),
    {
      network: "testnet",
      signerId: "payer.testnet",
      receiverId: "merchant.testnet",
      actions: [{ type: "Transfer", params: { deposit: "1000" } }],
    },
  );
  assert.throws(() =>
    invoicePaymentWalletRequest(
      invoice,
      {
        ...prepared,
        transaction: {
          ...prepared.transaction,
          actions: [{ type: "Transfer", amountAtomic: "999" }],
        },
      },
      ["payer.testnet"],
    ),
  );
});
