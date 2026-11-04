export const pages = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "treasury", label: "Treasury", icon: "treasury" },
  { id: "invoices", label: "Invoices", icon: "invoice" },
  { id: "approvals", label: "Approvals", icon: "shield" },
  { id: "cfo", label: "AI CFO", icon: "spark" },
  { id: "agents", label: "Agents", icon: "agents" },
  { id: "payroll", label: "Payroll", icon: "people" },
  { id: "activity", label: "Activity", icon: "activity" },
  { id: "settings", label: "Settings", icon: "settings" },
] as const;
export type PageId = (typeof pages)[number]["id"];
export type Invoice = {
  id: string;
  client: string;
  initials: string;
  description: string;
  amount: string;
  due: string;
  status: "Paid" | "Awaiting payment" | "Draft" | "Overdue";
  color: string;
};
export type Approval = {
  id: string;
  title: string;
  category: string;
  amount: string;
  status: "Needs review" | "Reviewed" | "Rejected";
  signers: string[];
};
export type Agent = {
  id: string;
  name: string;
  role: string;
  active: boolean;
  spent: string;
  budget: string;
  runs: number;
  color: string;
};
export type Activity = {
  id: string;
  title: string;
  detail: string;
  category: "Invoices" | "Treasury" | "Agents" | "Payroll" | "Policy";
  time: string;
};
export type DemoState = {
  invoices: Invoice[];
  approvals: Approval[];
  agents: Agent[];
  activity: Activity[];
  workspace: string;
  reducedMotion: boolean;
};
export function initialDemo(): DemoState {
  return {
    workspace: "Forma Studio",
    reducedMotion: false,
    invoices: [
      {
        id: "INV-024",
        client: "Orbit Labs",
        initials: "O",
        description: "Brand strategy & identity",
        amount: "1250000",
        due: "2026-11-12",
        status: "Awaiting payment",
        color: "lilac",
      },
      {
        id: "INV-023",
        client: "Layers",
        initials: "L",
        description: "Product design retainer",
        amount: "840000",
        due: "2026-11-08",
        status: "Paid",
        color: "peach",
      },
      {
        id: "INV-022",
        client: "Pallet",
        initials: "P",
        description: "Website design & development",
        amount: "620000",
        due: "2026-10-27",
        status: "Overdue",
        color: "sage",
      },
      {
        id: "INV-021",
        client: "Good Things",
        initials: "G",
        description: "Creative direction",
        amount: "450000",
        due: "2026-11-18",
        status: "Draft",
        color: "yellow",
      },
      {
        id: "INV-020",
        client: "Linear Works",
        initials: "LW",
        description: "October design partnership",
        amount: "980000",
        due: "2026-10-24",
        status: "Paid",
        color: "blue",
      },
    ],
    approvals: [
      {
        id: "PROP-008",
        title: "November team allocation",
        category: "Payroll",
        amount: "1840000",
        status: "Needs review",
        signers: ["Demo co-owner"],
      },
      {
        id: "PROP-007",
        title: "Studio operations",
        category: "Treasury",
        amount: "320000",
        status: "Needs review",
        signers: [],
      },
      {
        id: "PROP-006",
        title: "Document classification",
        category: "Agent purchase",
        amount: "1200",
        status: "Needs review",
        signers: ["Demo co-owner"],
      },
    ],
    agents: [
      {
        id: "agent-01",
        name: "Scout",
        role: "Document classification",
        active: true,
        spent: "1200",
        budget: "5000",
        runs: 24,
        color: "sage",
      },
      {
        id: "agent-02",
        name: "Sage",
        role: "Allocation assistant",
        active: true,
        spent: "0",
        budget: "0",
        runs: 8,
        color: "lilac",
      },
      {
        id: "agent-03",
        name: "Relay",
        role: "Invoice reminder drafts",
        active: false,
        spent: "0",
        budget: "2500",
        runs: 0,
        color: "peach",
      },
    ],
    activity: [
      {
        id: "EV-104",
        title: "Invoice INV-023 reconciled",
        detail: "Layers · simulated settlement",
        category: "Invoices",
        time: "10:42",
      },
      {
        id: "EV-103",
        title: "November allocation proposed",
        detail: "Awaiting a second human review",
        category: "Treasury",
        time: "10:15",
      },
      {
        id: "EV-102",
        title: "Scout completed 24 classifications",
        detail: "Allowlisted mock service · within budget",
        category: "Agents",
        time: "09:48",
      },
      {
        id: "EV-101",
        title: "Over-limit request blocked",
        detail: "Per-purchase limit exceeded · policy v3",
        category: "Policy",
        time: "09:31",
      },
      {
        id: "EV-100",
        title: "Synthetic payroll prepared",
        detail: "6 demonstration records · no payouts",
        category: "Payroll",
        time: "09:02",
      },
    ],
  };
}
// Demo values are integer cents. No conversions between real assets occur here.
export function money(cents: string, decimals = true): string {
  if (!/^\d{1,18}$/.test(cents)) throw new Error("Invalid amount");
  const n = BigInt(cents);
  return `$${(n / 100n).toLocaleString("en-US")}${decimals ? `.${(n % 100n).toString().padStart(2, "0")}` : ""}`;
}
export function parseMoney(value: string): string {
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(value))
    throw new Error("Enter a positive amount with up to two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents <= 0n) throw new Error("The amount must be greater than zero.");
  return cents.toString();
}
export function splitAllocation(cents: string) {
  const total = BigInt(cents);
  const payroll = (total * 50n) / 100n;
  const operations = (total * 30n) / 100n;
  return [
    payroll.toString(),
    operations.toString(),
    (total - payroll - operations).toString(),
  ];
}
export function exportCsv(invoices: Invoice[]) {
  const cell = (value: string) =>
    `"${(/^[=+@\-\t\r]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`;
  const text = [
    "Invoice,Client,Amount (demo USD),Status,Due",
    ...invoices.map((i) =>
      [i.id, i.client, money(i.amount), i.status, i.due].map(cell).join(","),
    ),
  ].join("\r\n");
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "coffer-demo-invoices.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
