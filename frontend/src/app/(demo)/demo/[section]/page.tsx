import { notFound } from "next/navigation";
import { pages } from "@/lib/demo";
import { WorkspacePage } from "@/components/coffer/pages";

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
    title: `${pages.find((page) => page.id === section)?.label ?? "Not found"} demo`,
  };
}

export default async function DemoPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const page = pages.find((candidate) => candidate.id === section);
  if (!page) notFound();
  return <WorkspacePage page={page.id} />;
}
