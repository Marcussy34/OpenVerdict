import { redirect } from "next/navigation";

export default async function ObservePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/claims/${encodeURIComponent(id)}`);
}
