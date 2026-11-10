import type { SignAndSendTransactionParams } from "@hot-labs/near-connect";
import type { PayrollPayoutTransaction } from "@/lib/coffer-api";

export function payrollPayoutWalletRequest(
  transaction: PayrollPayoutTransaction,
  verifiedAccountIds: string[],
): SignAndSendTransactionParams {
  const action = transaction.actions[0];
  if (
    transaction.network !== "testnet" ||
    !verifiedAccountIds.includes(transaction.signerAccountId) ||
    transaction.actions.length !== 1 ||
    !action
  ) {
    throw new Error("Coffer rejected an unsafe payroll payout request.");
  }
  const walletAction =
    action.type === "Transfer"
      ? { type: "Transfer" as const, params: { deposit: action.amountAtomic } }
      : action.methodName === "ft_transfer" &&
          action.gas === "30000000000000" &&
          action.deposit === "1"
        ? {
            type: "FunctionCall" as const,
            params: {
              methodName: action.methodName,
              args: action.args,
              gas: action.gas,
              deposit: action.deposit,
            },
          }
        : null;
  if (!walletAction) {
    throw new Error("Coffer rejected an unsafe payroll payout request.");
  }
  return {
    network: "testnet",
    signerId: transaction.signerAccountId,
    receiverId: transaction.receiverId,
    actions: [walletAction],
  };
}
