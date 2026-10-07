import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppsCard } from "@/components/devices/apps-card";
import { AutoRefresh } from "@/components/devices/auto-refresh";
import { BreadcrumbLabel } from "@/components/shell/breadcrumb-labels";
import { loadAppRules } from "@/lib/apps/queries";
import { parseAppsQuery, type AppsInput } from "@/lib/devices/apps";
import { loadDevice, loadDeviceApps } from "@/lib/devices/queries";
import { deviceState } from "@/lib/devices/status";
import { isUuid } from "@/lib/ids";

export const metadata: Metadata = { title: "Device apps" };

// Without a report nothing is claimed (an empty stored list is not an observation).
const NOT_REPORTED: AppsInput = { apps: [], syncedAt: null };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function DeviceApplicationsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const device = await loadDevice(id);
  if (!device) notFound(); // missing or not yours: indistinguishable (RLS)
  const apps = (await loadDeviceApps(device.id)) ?? NOT_REPORTED;
  const rules = await loadAppRules(device.id);
  const query = parseAppsQuery(await searchParams);
  const now = new Date();
  return (
    <div className="space-y-4">
      <BreadcrumbLabel id={device.id} name={device.name} />
      <AutoRefresh />
      {deviceState(device, now) === "revoked" ? (
        <p className="text-sm text-muted-foreground">Access for this device was revoked. The list below is the last one it reported.</p>
      ) : null}
      <AppsCard apps={apps} query={query} restrictions={{ deviceId: device.id, rules, editable: device.enrollmentStatus === "ENROLLED" }} now={now} />
    </div>
  );
}
