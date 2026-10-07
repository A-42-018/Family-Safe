import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/devices/auto-refresh";
import { DeviceInfoCard } from "@/components/devices/device-info-card";
import { BreadcrumbLabel } from "@/components/shell/breadcrumb-labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { batteryText, deviceState, isLowBattery, networkText } from "@/lib/devices/status";
import { loadDevice } from "@/lib/devices/queries";
import { deviceStatusBadge, deviceSubtitle, formatLastSeen } from "@/lib/enrollment/format";
import { isUuid } from "@/lib/ids";

export const metadata: Metadata = { title: "Device overview" };

export default async function DeviceOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const device = await loadDevice(id);
  if (!device) notFound(); // missing or not yours: indistinguishable (RLS)
  const now = new Date();
  const state = deviceState(device, now);
  const badge = deviceStatusBadge(device, now);
  const reported = state === "online" || state === "offline";
  const rows: [string, string][] = [
    ["Last seen", formatLastSeen(device.lastSeenAt, now)],
    ["Battery", reported ? batteryText(device) : "Unknown"],
    ["Network", reported ? networkText(device.networkType) : "Unknown"],
    ["App version", device.appVersion ?? "Unknown"],
    ["Android version", device.androidVersion ?? "Unknown"],
    ["Child", device.childName],
  ];
  return (
    <div className="space-y-4">
      <BreadcrumbLabel id={device.id} name={device.name} />
      <AutoRefresh />
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{device.name}</h2>
            <Badge variant={badge.variant}>{badge.label}</Badge>
            {reported && isLowBattery(device) ? <Badge variant="outline">Low battery</Badge> : null}
          </div>
          <p className="text-sm text-muted-foreground">{deviceSubtitle(device)}</p>
          {state === "waiting" ? (
            <p className="text-sm text-muted-foreground">The app has not checked in yet. It reports every 15 minutes while it has a connection.</p>
          ) : null}
          {state === "offline" ? (
            <p className="text-sm text-muted-foreground">No check-in for over 45 minutes. Values below are the last ones reported.</p>
          ) : null}
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="text-sm font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <DeviceInfoCard device={device} now={now} />
    </div>
  );
}
