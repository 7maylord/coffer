import { notFound } from "next/navigation";
import { pages } from "@/lib/demo";
import { WorkspacePage } from "@/components/coffer/pages";
import { AuthenticatedInvoices } from "@/components/invoices/authenticated-invoices";
import {
  AuthenticatedApprovals,
  AuthenticatedTreasury,
} from "@/components/treasury/authenticated-treasury";
import {
  AuthenticatedAgents,
  AuthenticatedCfo,
} from "@/components/automation/authenticated-automation";
import { AuthenticatedPayroll } from "@/components/payroll/authenticated-payroll";
import { AuthenticatedOperations } from "@/components/operations/authenticated-operations";
export function generateStaticParams() {
  return pages.map((page) => ({ section: page.id }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  return {
    title: pages.find((page) => page.id === section)?.label ?? "Not found",
  };
}
export default async function Page({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const page = pages.find((page) => page.id === section);
  if (!page) notFound();
  if (page.id === "invoices") return <AuthenticatedInvoices />;
  if (page.id === "treasury") return <AuthenticatedTreasury />;
  if (page.id === "approvals") return <AuthenticatedApprovals />;
  if (page.id === "cfo") return <AuthenticatedCfo />;
  if (page.id === "agents") return <AuthenticatedAgents />;
  if (page.id === "payroll") return <AuthenticatedPayroll />;
  if (page.id === "activity") return <AuthenticatedOperations />;
  return <WorkspacePage page={page.id} />;
}
