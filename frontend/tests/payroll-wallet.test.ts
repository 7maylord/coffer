import assert from "node:assert/strict";
import test from "node:test";
import { payrollPayoutWalletRequest } from "../src/lib/payroll-wallet.ts";
import type { PayrollPayoutTransaction } from "../src/lib/coffer-api.ts";

const native: PayrollPayoutTransaction = {
  network: "testnet",
  signerAccountId: "owner.testnet",
  receiverId: "employee.testnet",
  actions: [{ type: "Transfer", amountAtomic: "1000" }],
};

test("converts an exact verified native payout for wallet signing", () => {
  assert.deepEqual(payrollPayoutWalletRequest(native, ["owner.testnet"]), {
    network: "testnet",
    signerId: "owner.testnet",
    receiverId: "employee.testnet",
    actions: [{ type: "Transfer", params: { deposit: "1000" } }],
  });
});

test("rejects an unverified signer or altered token call", () => {
  assert.throws(() => payrollPayoutWalletRequest(native, ["other.testnet"]));
  assert.throws(() =>
    payrollPayoutWalletRequest(
      {
        ...native,
        receiverId: "token.testnet",
        actions: [
          {
            type: "FunctionCall",
            methodName: "ft_transfer",
            args: { receiver_id: "employee.testnet", amount: "1000" },
            gas: "30000000000000",
            deposit: "1",
          },
          { type: "Transfer", amountAtomic: "1" },
        ],
      },
      ["owner.testnet"],
    ),
  );
});
