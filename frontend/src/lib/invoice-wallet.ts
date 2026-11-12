import type { SignAndSendTransactionParams } from "@hot-labs/near-connect";
import type { PublicInvoice, PublicNearPayment } from "@/lib/coffer-api";

export function invoicePaymentWalletRequest(
  invoice: PublicInvoice,
  prepared: PublicNearPayment,
  verifiedAccountIds: string[],
): SignAndSendTransactionParams {
  const transaction = prepared.transaction;
  const action = transaction.actions[0];
  const exactNative =
    invoice.currency === "near:testnet:native" &&
    action?.type === "Transfer" &&
    transaction.receiverId === invoice.payeeDestination &&
    action.amountAtomic === invoice.outstandingAmountAtomic;
  const tokenContract = invoice.currency.startsWith("near:testnet:nep141:")
    ? invoice.currency.slice("near:testnet:nep141:".length)
    : "";
  const exactToken =
    Boolean(tokenContract) &&
    action?.type === "FunctionCall" &&
    action.methodName === "ft_transfer" &&
    transaction.receiverId === tokenContract &&
    action.args.receiver_id === invoice.payeeDestination &&
    action.args.amount === invoice.outstandingAmountAtomic &&
    action.gas === "30000000000000" &&
    action.deposit === "1";
  if (
    prepared.payment.provider !== "near-testnet" ||
    prepared.payment.status !== "AWAITING_DEPOSIT" ||
    transaction.network !== "testnet" ||
    !verifiedAccountIds.includes(transaction.signerAccountId) ||
    transaction.actions.length !== 1 ||
    (!exactNative && !exactToken)
  ) {
    throw new Error("Coffer rejected an unsafe invoice payment request.");
  }
  return {
    network: "testnet",
    signerId: transaction.signerAccountId,
    receiverId: transaction.receiverId,
    actions: [
      action.type === "Transfer"
        ? { type: "Transfer", params: { deposit: action.amountAtomic } }
        : {
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
