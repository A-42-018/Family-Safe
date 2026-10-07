import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/children/child-card";
import { DeleteChildDialog } from "@/components/children/delete-child-dialog";
import { AddDeviceDialog } from "@/components/devices/add-device-dialog";
import { AutoRefresh } from "@/components/devices/auto-refresh";
import { DeviceList } from "@/components/devices/device-list";
import { BreadcrumbLabel } from "@/components/shell/breadcrumb-labels";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { loadDevicesForChild } from "@/lib/enrollment/queries";
import { ageFromDob, formatAge } from "@/lib/family/format";
import { loadChild } from "@/lib/family/queries";
import { isUuid } from "@/lib/ids";

export const metadata: Metadata = { title: "Child" };

export default async function ChildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const child = await loadChild(id);
  if (!child) notFound(); // missing or not yours: indistinguishable (RLS)
  const devices = await loadDevicesForChild(child.id);
  return (
    <>
      <BreadcrumbLabel id={child.id} name={child.name} />
      {devices.length > 0 ? <AutoRefresh /> : null}
      <PageHeader
        title={child.name}
        description={formatAge(ageFromDob(child.dateOfBirth))}
        actions={<Button asChild variant="outline"><Link href={`/children/${child.id}/edit`}>Edit</Link></Button>}
      />
      <div className="mb-6 flex items-center gap-4">
        <Avatar name={child.name} className="h-16 w-16 text-xl" />
      </div>
      <section aria-labelledby="devices-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="devices-heading" className="text-lg font-semibold">Devices</h2>
          <AddDeviceDialog childId={child.id} />
        </div>
        {devices.length === 0 ? (
          <EmptyState icon="devices" title="No devices yet" description="Add a device to pair the FamilySafe app on your child's Android phone." />
        ) : (
          <DeviceList devices={devices} />
        )}
      </section>
      <section aria-labelledby="danger-heading" className="mt-10 max-w-lg rounded-lg border border-destructive/40 p-4">
        <h2 id="danger-heading" className="text-sm font-medium">Delete {child.name}</h2>
        <p className="mb-3 mt-1 text-sm text-muted-foreground">Removes this child, their devices and all reported data.</p>
        <DeleteChildDialog childId={child.id} childName={child.name} />
      </section>
    </>
  );
}
