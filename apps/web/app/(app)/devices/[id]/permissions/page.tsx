import { PERMISSION_KEYS } from "@familysafe/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/devices/auto-refresh";
import { PermissionsCard } from "@/components/devices/permissions-card";
import { BreadcrumbLabel } from "@/components/shell/breadcrumb-labels";
import type { PermissionsInput } from "@/lib/devices/permissions";
import { loadDevice, loadDevicePermissions } from "@/lib/devices/queries";
import { deviceState } from "@/lib/devices/status";
import { isUuid } from "@/lib/ids";

export const metadata: Metadata = { title: "Device permissions" };

// The stored defaults are placeholders: without a row, nothing is claimed.
const NOT_REPORTED: PermissionsInput = {
  states: Object.fromEntries(PERMISSION_KEYS.map((k) => [k, null])) as PermissionsInput["states"],
  lastVerifiedAt: null,
};

export default async function DevicePermissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const device = await loadDevice(id);
  if (!device) notFound(); // missing or not yours: indistinguishable (RLS)
  const permissions = (await loadDevicePermissions(device.id)) ?? NOT_REPORTED;
  const now = new Date();
  return (
    <div className="space-y-4">
      <BreadcrumbLabel id={device.id} name={device.name} />
      <AutoRefresh />
      {deviceState(device, now) === "revoked" ? (
        <p className="text-sm text-muted-foreground">Access for this device was revoked. Values below are the last ones it reported.</p>
      ) : null}
      <PermissionsCard permissions={permissions} now={now} />
    </div>
  );
}
