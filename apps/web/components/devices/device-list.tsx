import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { batteryText, deviceState, isLowBattery, networkText } from "@/lib/devices/status";
import { deviceStatusBadge, deviceSubtitle, formatLastSeen } from "@/lib/enrollment/format";
import type { DeviceRow } from "@/lib/enrollment/queries";
import { RevokeDeviceDialog } from "./revoke-device-dialog";

export function DeviceList({ devices, now = new Date() }: { devices: DeviceRow[]; now?: Date }) {
  return (
    <ul className="divide-y rounded-lg border" aria-label="Enrolled devices">
      {devices.map((d) => {
        const badge = deviceStatusBadge(d, now);
        const state = deviceState(d, now);
        const revoked = state === "revoked";
        const reported = state === "online" || state === "offline";
        return (
          <li key={d.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-medium">{d.name}</h3>
                <Badge variant={badge.variant}>{badge.label}</Badge>
                {reported && isLowBattery(d) ? <Badge variant="outline">Low battery</Badge> : null}
              </div>
              <p className="text-sm text-muted-foreground">{deviceSubtitle(d)}</p>
              <p className="text-xs text-muted-foreground">
                Last seen: {formatLastSeen(d.lastSeenAt, now)}
                {reported ? ` · Battery ${batteryText(d)} · ${networkText(d.networkType)}` : ""}
              </p>
            </div>
            {revoked ? null : (
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild variant="outline" size="sm"><Link href={`/devices/${d.id}/overview`}>View</Link></Button>
                <RevokeDeviceDialog deviceId={d.id} deviceName={d.name} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
