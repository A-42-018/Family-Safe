import type { Metadata } from "next";
import { EmptyState } from "@/components/shell/empty-state";

export const metadata: Metadata = { title: "Device activity" };

export default function DeviceActivityPage() {
  return <EmptyState icon="bell" title="Device activity" description="Recent events from this device will appear here." />;
}
