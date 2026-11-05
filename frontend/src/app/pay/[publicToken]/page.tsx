import { PublicInvoicePayment } from "@/components/invoices/public-invoice-payment";

export const metadata = { title: "Pay invoice" };

export default async function Page({
  params,
}: {
  params: Promise<{ publicToken: string }>;
}) {
  const { publicToken } = await params;
  return <PublicInvoicePayment publicToken={publicToken} />;
}
