import { PublicInvoicePayment } from "@/components/invoices/public-invoice-payment";
import { AuthProviders } from "@/components/auth/auth-provider";

export const metadata = { title: "Pay invoice" };

export default async function Page({
  params,
}: {
  params: Promise<{ publicToken: string }>;
}) {
  const { publicToken } = await params;
  return (
    <AuthProviders>
      <PublicInvoicePayment publicToken={publicToken} />
    </AuthProviders>
  );
}
