import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ScheduleForm } from "@/components/devices/schedule-form";
import { SchedulesCard } from "@/components/devices/schedules-card";
import { TimezoneForm } from "@/components/devices/timezone-form";
import { BreadcrumbLabel } from "@/components/shell/breadcrumb-labels";
import { EmptyState } from "@/components/shell/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { loadDevice } from "@/lib/devices/queries";
import { isUuid } from "@/lib/ids";
import { loadSchedules, loadTimezone } from "@/lib/schedules/queries";
import { atScheduleCap, SCHEDULE_CAP_NOTE, toScheduleFormValues } from "@/lib/schedules/schedules";

export const metadata: Metadata = { title: "Device schedules" };

type Search = { edit?: string | string[] };

export default async function DeviceSchedulesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const device = await loadDevice(id);
  if (!device) notFound(); // missing or not yours: indistinguishable (RLS)
  const [schedules, timezone] = await Promise.all([loadSchedules(device.id), loadTimezone(device.id)]);
  if (timezone === undefined) {
    return (
      <>
        <BreadcrumbLabel id={device.id} name={device.name} />
        <EmptyState icon="clock" title="Schedules not available" description="This device's schedules could not be read. Try again in a moment." />
      </>
    );
  }
  const editable = device.enrollmentStatus === "ENROLLED";
  const wanted = (await searchParams).edit;
  const editing = editable && typeof wanted === "string" ? (schedules.find((s) => s.id === wanted) ?? null) : null;
  const full = atScheduleCap(schedules);
  return (
    <div className="space-y-4">
      <BreadcrumbLabel id={device.id} name={device.name} />
      <SchedulesCard deviceId={device.id} schedules={schedules} timezone={timezone} editable={editable} editingId={editing?.id ?? null} />
      {editable ? (
        <>
          <Card>
            <CardContent className="space-y-4 p-5">
              <h2 className="text-lg font-semibold">Time zone</h2>
              <p className="text-sm text-muted-foreground">Schedule times are read in this time zone, not the one of this browser.</p>
              {/* key: remount with the stored value when it changes (another tab or a save) */}
              <TimezoneForm key={timezone ?? "device"} deviceId={device.id} current={timezone} />
            </CardContent>
          </Card>
          {editing || !full ? (
            <Card>
              <CardContent className="space-y-4 p-5">
                <h2 className="text-lg font-semibold">{editing ? "Edit schedule" : "Add a schedule"}</h2>
                {/* key: a different schedule (or back to "add") starts from its own stored values */}
                <ScheduleForm
                  key={editing?.id ?? "new"}
                  deviceId={device.id}
                  scheduleId={editing?.id ?? null}
                  initial={toScheduleFormValues(editing ?? undefined)}
                  existing={schedules}
                  cancelHref={editing ? `/devices/${device.id}/schedules` : undefined}
                />
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-muted-foreground">{SCHEDULE_CAP_NOTE}</p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {device.enrollmentStatus === "REVOKED" ? "Access for this device was revoked." : "This device has not finished enrolling."} Its schedules can&apos;t be changed.
        </p>
      )}
    </div>
  );
}
