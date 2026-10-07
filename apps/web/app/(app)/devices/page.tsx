import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/devices/auto-refresh";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { batteryText, deviceState, networkText } from "@/lib/devices/status";
import { loadAllDevices } from "@/lib/devices/queries";
import { deviceListSummary, deviceStatusBadge, formatLastSeen } from "@/lib/enrollment/format";

export const metadata: Metadata = { title: "Devices" };

export default async function DevicesPage() {
  const devices = await loadAllDevices();
  const now = new Date();
  return (
    <>
      <PageHeader title="Devices" description={devices.length ? deviceListSummary(devices) : "Enrolled devices and their current status."} />
      {devices.length === 0 ? (
        <EmptyState icon="devices" title="No devices yet" description="Open a child's page and choose Add device to pair their phone." />
      ) : (
        <>
          <AutoRefresh />
          <ul className="divide-y rounded-lg border" aria-label="All devices">
            {devices.map((d) => {
              const badge = deviceStatusBadge(d, now);
              const state = deviceState(d, now);
              const reported = state === "online" || state === "offline";
              return (
                <li key={d.id}>
                  <Link href={`/devices/${d.id}/overview`} className="flex flex-col gap-1 p-4 hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{d.name}</span>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {d.childName} · Last seen: {formatLastSeen(d.lastSeenAt, now)}
                      {reported ? ` · Battery ${batteryText(d)} · ${networkText(d.networkType)}` : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}
