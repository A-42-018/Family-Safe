import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActivityCard } from "@/components/devices/activity-card";
import { AutoRefresh } from "@/components/devices/auto-refresh";
import { BreadcrumbLabel } from "@/components/shell/breadcrumb-labels";
import { parseLimit } from "@/lib/activity/activity";
import { loadDeviceActivity } from "@/lib/activity/queries";
import { loadDevice } from "@/lib/devices/queries";
import { isUuid } from "@/lib/ids";

export const metadata: Metadata = { title: "Device activity" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function DeviceActivityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const device = await loadDevice(id);
  if (!device) notFound(); // missing or not yours: indistinguishable (RLS)
  const limit = parseLimit(await searchParams);
  const activity = await loadDeviceActivity(device.id, limit);
  return (
    <div className="space-y-4">
      <BreadcrumbLabel id={device.id} name={device.name} />
      <AutoRefresh />
      <ActivityCard activity={activity} deviceId={device.id} limit={limit} />
    </div>
  );
}
