import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/devices/auto-refresh";
import { UsageCard } from "@/components/devices/usage-card";
import { BreadcrumbLabel } from "@/components/shell/breadcrumb-labels";
import { loadDevice, loadDeviceUsage } from "@/lib/devices/queries";
import { deviceState } from "@/lib/devices/status";
import { buildSeries, parseUsageDay, selectDay, type UsageInput } from "@/lib/devices/usage";
import { isUuid } from "@/lib/ids";

export const metadata: Metadata = { title: "Device usage" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function DeviceUsagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const device = await loadDevice(id);
  if (!device) notFound(); // missing or not yours: indistinguishable (RLS)
  const requested = parseUsageDay(await searchParams);
  const now = new Date();
  // Without a report nothing is claimed (no row is an absence of data, not zero minutes).
  const notReported: UsageInput = { syncedAt: null, days: [], selectedDay: selectDay(buildSeries([], now), null), apps: [], labels: new Map() };
  const usage = (await loadDeviceUsage(device.id, requested)) ?? notReported;
  return (
    <div className="space-y-4">
      <BreadcrumbLabel id={device.id} name={device.name} />
      <AutoRefresh />
      {deviceState(device, now) === "revoked" ? (
        <p className="text-sm text-muted-foreground">Access for this device was revoked. The numbers below are the last ones it reported.</p>
      ) : null}
      <UsageCard usage={usage} now={now} />
    </div>
  );
}
