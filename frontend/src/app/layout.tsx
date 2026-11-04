import "@/app/globals.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "Coffer — Money, with intention.",
    template: "%s · Coffer",
  },
  description:
    "A considered workspace for your treasury, invoices, agents, and people. Explore the Coffer interactive demo.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
