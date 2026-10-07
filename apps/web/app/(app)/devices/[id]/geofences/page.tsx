import type { Metadata } from "next";
import { EmptyState } from "@/components/shell/empty-state";

export const metadata: Metadata = { title: "Device geofences" };

export default function DeviceGeofencesPage() {
  return <EmptyState icon="map-pin" title="Device geofences" description="Places you set up, and when the device arrives or leaves them, will appear here." />;
}
