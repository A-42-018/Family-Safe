import type { Metadata } from "next";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";

export const metadata: Metadata = { title: "Audit log" };

export default function AuditLogsPage() {
  return (
    <>
      <PageHeader title="Audit log" description="A record of sign-ins and changes made to your family's settings." />
      <EmptyState icon="audit" title="No activity to show" description="Sign-ins and changes will be recorded here." />
    </>
  );
}
