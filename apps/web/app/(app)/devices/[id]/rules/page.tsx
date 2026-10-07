import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RulesCard } from "@/components/devices/rules-card";
import { RulesForm } from "@/components/devices/rules-form";
import { BreadcrumbLabel } from "@/components/shell/breadcrumb-labels";
import { EmptyState } from "@/components/shell/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { loadDevice } from "@/lib/devices/queries";
import { isUuid } from "@/lib/ids";
import { loadDeviceRules } from "@/lib/rules/queries";
import { toFormValues } from "@/lib/rules/rules";

export const metadata: Metadata = { title: "Device rules" };

export default async function DeviceRulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const device = await loadDevice(id);
  if (!device) notFound(); // missing or not yours: indistinguishable (RLS)
  const rules = await loadDeviceRules(device.id);
  if (!rules) {
    return (
      <>
        <BreadcrumbLabel id={device.id} name={device.name} />
        <EmptyState icon="settings" title="Rules not available" description="This device's rules could not be read. Try again in a moment." />
      </>
    );
  }
  const editable = device.enrollmentStatus === "ENROLLED";
  return (
    <div className="space-y-4">
      <BreadcrumbLabel id={device.id} name={device.name} />
      <RulesCard rules={rules} now={new Date()} />
      {editable ? (
        <Card>
          <CardContent className="space-y-4 p-5">
            <h2 className="text-lg font-semibold">Change screen-time limits</h2>
            {/* key: remount with the stored values when the version moves (another tab or a save) */}
            <RulesForm key={rules.configVersion} deviceId={device.id} initial={toFormValues(rules)} />
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          {device.enrollmentStatus === "REVOKED" ? "Access for this device was revoked." : "This device has not finished enrolling."} Its rules can&apos;t be changed.
        </p>
      )}
    </div>
  );
}
