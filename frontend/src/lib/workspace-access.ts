import type { OrganizationRole } from "@/lib/coffer-api";
import type { PageId } from "@/lib/demo";

const allowedPages: Record<OrganizationRole, ReadonlySet<PageId>> = {
  OWNER: new Set([
    "overview",
    "treasury",
    "invoices",
    "approvals",
    "cfo",
    "agents",
    "payroll",
    "activity",
    "settings",
  ]),
  FINANCE_ADMIN: new Set([
    "overview",
    "treasury",
    "invoices",
    "approvals",
    "cfo",
    "agents",
    "payroll",
    "activity",
  ]),
  APPROVER: new Set([
    "overview",
    "treasury",
    "invoices",
    "approvals",
    "cfo",
    "agents",
  ]),
  AGENT_OPERATOR: new Set(["approvals", "agents"]),
  EMPLOYEE: new Set(["payroll"]),
  AUDITOR: new Set([
    "overview",
    "treasury",
    "invoices",
    "approvals",
    "agents",
    "payroll",
    "activity",
  ]),
  VIEWER: new Set([
    "overview",
    "treasury",
    "invoices",
    "approvals",
    "cfo",
    "agents",
  ]),
};

export function canAccessPage(role: OrganizationRole, page: PageId): boolean {
  return allowedPages[role].has(page);
}

export function canWriteInvoices(role: OrganizationRole): boolean {
  return role === "OWNER" || role === "FINANCE_ADMIN";
}

export function canCreateTreasuryProposal(role: OrganizationRole): boolean {
  return role === "OWNER" || role === "FINANCE_ADMIN";
}

export function canApproveTreasuryProposal(role: OrganizationRole): boolean {
  return role === "OWNER" || role === "APPROVER";
}

export function canManageTreasuryPolicy(role: OrganizationRole): boolean {
  return role === "OWNER";
}

export function canReserveTreasuryProposal(role: OrganizationRole): boolean {
  return role === "OWNER" || role === "FINANCE_ADMIN" || role === "APPROVER";
}

export function canCreateCfoProposal(role: OrganizationRole): boolean {
  return role === "OWNER" || role === "FINANCE_ADMIN";
}

export function canDecideCfoProposal(role: OrganizationRole): boolean {
  return role === "OWNER" || role === "FINANCE_ADMIN" || role === "APPROVER";
}

export function canManageAgents(role: OrganizationRole): boolean {
  return role === "OWNER";
}

export function canPurchaseForAgent(role: OrganizationRole): boolean {
  return (
    role === "OWNER" || role === "FINANCE_ADMIN" || role === "AGENT_OPERATOR"
  );
}

export function canApproveAgentPurchase(role: OrganizationRole): boolean {
  return role === "OWNER" || role === "APPROVER";
}

export function canManagePayroll(role: OrganizationRole): boolean {
  return role === "OWNER" || role === "FINANCE_ADMIN";
}

export function canReadOperations(role: OrganizationRole): boolean {
  return role === "OWNER" || role === "FINANCE_ADMIN" || role === "AUDITOR";
}

export function canReconcileOperations(role: OrganizationRole): boolean {
  return role === "OWNER" || role === "FINANCE_ADMIN";
}
