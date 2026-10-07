import type { Metadata } from "next";
import { EmptyState } from "@/components/shell/empty-state";

export const metadata: Metadata = { title: "Device location" };

export default function DeviceLocationPage() {
  return <EmptyState icon="map-pin" title="Device location" description="Location is shown only when you turn it on for this device and the phone allows it." />;
}
