import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChildForm } from "@/components/children/child-form";
import { PageHeader } from "@/components/shell/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { loadFamilyOverview } from "@/lib/family/queries";

export const metadata: Metadata = { title: "Add child" };

export default async function NewChildPage() {
  const { family } = await loadFamilyOverview();
  if (!family) redirect("/children"); // first-run: create the family first
  return (
    <>
      <PageHeader title="Add child" description="You can enrol their device afterwards." />
      <Card className="max-w-lg"><CardContent className="p-6"><ChildForm cancelHref="/children" /></CardContent></Card>
    </>
  );
}
