import { Providers } from "@/providers";
export default function LegacyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Providers>{children}</Providers>;
}
