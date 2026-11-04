import { Workspace } from "@/components/coffer/workspace";

export default function DemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Workspace mode="demo">{children}</Workspace>;
}
