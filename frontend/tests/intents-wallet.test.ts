import assert from "node:assert/strict";
import test from "node:test";
import {
  intentsDepositWalletRequest,
  intentsTransactionMatchesSwap,
  type IntentsDepositTransactionShape,
} from "../src/lib/intents-wallet.ts";

const transaction: IntentsDepositTransactionShape = {
  network: "testnet",
  signerAccountId: "owner.testnet",
  receiverId: "usdc.tidepool-sandbox.testnet",
  actions: [
    {
      type: "FunctionCall",
      methodName: "ft_transfer_call",
      args: {
        receiver_id: "verifier.tidepool-sandbox.testnet",
        amount: "1000000",
        msg: "deposit.tidepool-sandbox.testnet",
      },
      gas: "100000000000000",
      deposit: "1",
    },
  ],
};

test("builds only the exact verified-wallet Tidepool deposit call", () => {
  assert.deepEqual(
    intentsDepositWalletRequest(transaction, ["owner.testnet"]),
    {
      network: "testnet",
      signerId: "owner.testnet",
      receiverId: "usdc.tidepool-sandbox.testnet",
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "ft_transfer_call",
            args: transaction.actions[0].args,
            gas: "100000000000000",
            deposit: "1",
          },
        },
      ],
    },
  );
  assert.throws(() =>
    intentsDepositWalletRequest(transaction, ["other.testnet"]),
  );
  assert.throws(() =>
    intentsDepositWalletRequest(
      {
        ...transaction,
        actions: [
          {
            ...transaction.actions[0],
            args: {
              ...transaction.actions[0].args,
              receiver_id: "attacker.testnet",
            },
          },
        ],
      },
      ["owner.testnet"],
    ),
  );
});

test("requires the signed transaction to match the displayed swap", () => {
  const swap = {
    originTokenContract: transaction.receiverId,
    amountInAtomic: "1000000",
    recipient: "owner.testnet",
    refundTo: "owner.testnet",
    depositType: "INTENTS" as const,
    depositAddress: transaction.actions[0].args.msg,
    transaction,
  };
  assert.equal(intentsTransactionMatchesSwap(swap), true);
  assert.equal(
    intentsTransactionMatchesSwap({ ...swap, amountInAtomic: "999999" }),
    false,
  );
  assert.equal(
    intentsTransactionMatchesSwap({
      ...swap,
      depositAddress: "attacker.testnet",
    }),
    false,
  );
});
