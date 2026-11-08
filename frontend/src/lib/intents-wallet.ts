import type { SignAndSendTransactionParams } from "@hot-labs/near-connect";

const TIDEPOOL_VERIFIER_ACCOUNT_ID = "verifier.tidepool-sandbox.testnet";

type IntentsDepositAction =
  | {
      type: "FunctionCall";
      methodName: "ft_transfer";
      args: { receiver_id: string; amount: string };
      gas: "30000000000000";
      deposit: "1";
    }
  | {
      type: "FunctionCall";
      methodName: "ft_transfer_call";
      args: { receiver_id: string; amount: string; msg: string };
      gas: "100000000000000";
      deposit: "1";
    };

export type IntentsDepositTransactionShape = {
  network: "testnet";
  signerAccountId: string;
  receiverId: string;
  actions: IntentsDepositAction[];
};

export function intentsTransactionMatchesSwap(value: {
  originTokenContract: string;
  amountInAtomic: string;
  recipient: string;
  refundTo: string;
  depositType: "ORIGIN_CHAIN" | "INTENTS";
  depositAddress: string;
  transaction: IntentsDepositTransactionShape;
}): boolean {
  const action = value.transaction.actions[0];
  return (
    value.transaction.actions.length === 1 &&
    action !== undefined &&
    value.recipient === value.refundTo &&
    value.transaction.signerAccountId === value.refundTo &&
    value.transaction.receiverId === value.originTokenContract &&
    action.args.amount === value.amountInAtomic &&
    (value.depositType === "INTENTS"
      ? action.methodName === "ft_transfer_call" &&
        action.gas === "100000000000000" &&
        action.args.receiver_id === TIDEPOOL_VERIFIER_ACCOUNT_ID &&
        action.args.msg === value.depositAddress
      : action.methodName === "ft_transfer" &&
        action.gas === "30000000000000" &&
        action.args.receiver_id === value.depositAddress)
  );
}

export function intentsDepositWalletRequest(
  transaction: IntentsDepositTransactionShape,
  verifiedAccountIds: string[],
): SignAndSendTransactionParams {
  const action = transaction.actions[0];
  const exactAction =
    action?.methodName === "ft_transfer"
      ? action.gas === "30000000000000" && !("msg" in action.args)
      : action?.methodName === "ft_transfer_call" &&
        action.gas === "100000000000000" &&
        action.args.receiver_id === TIDEPOOL_VERIFIER_ACCOUNT_ID &&
        "msg" in action.args;
  if (
    transaction.network !== "testnet" ||
    !verifiedAccountIds.includes(transaction.signerAccountId) ||
    transaction.actions.length !== 1 ||
    !action ||
    action.type !== "FunctionCall" ||
    !exactAction ||
    action.deposit !== "1"
  ) {
    throw new Error("Coffer rejected an unsafe testnet deposit request.");
  }
  return {
    network: "testnet",
    signerId: transaction.signerAccountId,
    receiverId: transaction.receiverId,
    actions: [
      {
        type: "FunctionCall",
        params: {
          methodName: action.methodName,
          args: action.args,
          gas: action.gas,
          deposit: action.deposit,
        },
      },
    ],
  };
}
