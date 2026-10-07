import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/devices/auto-refresh";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { StatCard } from "@/components/shell/stat-card";
import { Button } from "@/components/ui/button";
import { loadAppRuleCounts } from "@/lib/apps/queries";
import { summarizeDevices } from "@/lib/devices/status";
import { loadAllDevices, loadTodayScreenTime } from "@/lib/devices/queries";
import { summarizeToday, todayHint, todayValue } from "@/lib/devices/screen-time";
import { loadFamilyOverview } from "@/lib/family/queries";
import { loadRestrictionsInput } from "@/lib/rules/queries";
import { restrictionsHint, restrictionsValue, summarizeRestrictions } from "@/lib/rules/rules";
import { loadScheduleCounts } from "@/lib/schedules/queries";

export const metadata: Metadata = { title: "Dashboard" };

// Real: children count (Phase 7), devices online/offline + lowest battery (Phase 12c), today's screen time (Phase 16c-2), active restrictions (Phase 17b, app rules 18b, schedules 19b). Other cards stay placeholders until their phases.
export default async function DashboardPage() {
  const { children } = await loadFamilyOverview();
  const devices = await loadAllDevices();
  const now = new Date();
  const sum = summarizeDevices(devices, now);
  const today = summarizeToday(await loadTodayScreenTime(devices), now);
  const restrictions = summarizeRestrictions({ ...(await loadRestrictionsInput(devices)), appRuleCounts: await loadAppRuleCounts(devices), scheduleCounts: await loadScheduleCounts(devices) });
  const reporting = sum.online + sum.offline > 0;
  const waitingNote = sum.waiting > 0 ? ` ${sum.waiting} waiting for first check-in.` : "";
  return (
    <>
      <PageHeader title="Dashboard" description="A snapshot of your family's devices." />
      <AutoRefresh />
      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Children" icon="children" hint="Children you've added." value={String(children.length)} />
        <StatCard
          label="Devices online / offline"
          icon="devices"
          hint={`Based on each device's last check-in.${waitingNote}`}
          value={sum.active > 0 ? `${sum.online} / ${sum.offline}` : undefined}
        />
        <StatCard label="Today's screen time" icon="clock" hint={todayHint(today)} value={todayValue(today)} />
        <StatCard label="Battery" icon="battery" hint="Lowest level among devices." value={sum.lowestBattery !== null && reporting ? `${sum.lowestBattery}%` : undefined} />
        <StatCard label="Last location" icon="map-pin" hint="Only shown when you turn it on for a device." />
        <StatCard label="Active restrictions" icon="lock" hint={restrictionsHint(restrictions)} value={restrictionsValue(restrictions)} />
        <StatCard label="Alerts" icon="alert" hint="Needs your attention." />
      </section>
      {children.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon="children"
            title="Start with your first child"
            description="Add a child, then enrol their device. Their status shows up here once it checks in."
            action={<Button asChild variant="outline"><Link href="/children">Go to children</Link></Button>}
          />
        </div>
      ) : null}
    </>
  );
}
