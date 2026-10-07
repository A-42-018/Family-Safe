import type { Metadata } from "next";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <>
      <PageHeader title="Notifications" description="Alerts about your family's devices." />
      <EmptyState icon="bell" title="You're all caught up" description="Alerts such as low battery or a device going offline will appear here." />
    </>
  );
}
