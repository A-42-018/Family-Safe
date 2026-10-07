import { notFound, redirect } from "next/navigation";
import { isUuid } from "@/lib/ids";

export default async function DeviceIndex({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  redirect(`/devices/${id}/overview`);
}
