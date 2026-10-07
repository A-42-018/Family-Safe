import { notFound } from "next/navigation";
import { DeviceTabs } from "@/components/shell/device-tabs";
import { PageHeader } from "@/components/shell/page-header";
import { isUuid } from "@/lib/ids";

export default async function DeviceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return (
    <>
      <PageHeader title="Device" description="Status, rules and activity for this device." />
      <DeviceTabs id={id} />
      <div className="pt-6">{children}</div>
    </>
  );
}
