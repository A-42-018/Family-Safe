import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChildForm } from "@/components/children/child-form";
import { BreadcrumbLabel } from "@/components/shell/breadcrumb-labels";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { loadChild } from "@/lib/family/queries";
import { isUuid } from "@/lib/ids";

export const metadata: Metadata = { title: "Edit child" };

export default async function EditChildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const child = await loadChild(id);
  if (!child) notFound();
  return (
    <>
      <BreadcrumbLabel id={child.id} name={child.name} />
      <PageHeader title={`Edit ${child.name}`} />
      <Card className="max-w-lg">
        <CardContent className="p-6">
          <ChildForm child={{ id: child.id, name: child.name, dateOfBirth: child.dateOfBirth }} cancelHref={`/children/${child.id}`} />
        </CardContent>
      </Card>
    </>
  );
}
