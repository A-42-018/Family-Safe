import type { Metadata } from "next";
import { AuditList } from "@/components/audit/audit-list";
import { PageHeader } from "@/components/shell/page-header";
import { parseAuditFilters } from "@/lib/audit/audit";
import { loadAuditPage } from "@/lib/audit/queries";
import { loadAllDevices } from "@/lib/devices/queries";

export const metadata: Metadata = { title: "Audit log" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AuditLogsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = parseAuditFilters(await searchParams);
  const [page, devices] = await Promise.all([loadAuditPage(filters), loadAllDevices()]);
  return (
    <>
      <PageHeader title="Audit log" description="A record of sign-ins and changes made to your family's settings." />
      <AuditList page={page} filters={filters} devices={devices.map((d) => ({ id: d.id, name: d.name }))} />
    </>
  );
}
