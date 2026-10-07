import type { Metadata } from "next";
import Link from "next/link";
import { ChildCard } from "@/components/children/child-card";
import { CreateFamilyForm, DeleteFamilyDialog, RenameFamilyForm } from "@/components/family/family-forms";
import { EmptyState } from "@/components/shell/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadFamilyOverview } from "@/lib/family/queries";

export const metadata: Metadata = { title: "Children" };

export default async function ChildrenPage() {
  const { family, children } = await loadFamilyOverview();

  if (!family) {
    return (
      <>
        <PageHeader title="Children" description="Set up your family, then add each child." />
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle as="h2" className="text-lg">Create your family</CardTitle>
            <CardDescription>Children and their devices live inside your family. Only you can see it.</CardDescription>
          </CardHeader>
          <CardContent><CreateFamilyForm /></CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Children"
        description="Each child and the devices enrolled for them."
        actions={<Button asChild><Link href="/children/new">Add child</Link></Button>}
      />
      {children.length === 0 ? (
        <EmptyState
          icon="children"
          title="No children yet"
          description="Add a child, then enrol their device from their page."
          action={<Button asChild><Link href="/children/new">Add child</Link></Button>}
        />
      ) : (
        <ul aria-label="Children" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {children.map((c) => <li key={c.id}><ChildCard child={c} /></li>)}
        </ul>
      )}

      <section aria-labelledby="family-heading" className="mt-10 max-w-lg space-y-4">
        <h2 id="family-heading" className="text-lg font-semibold">Family</h2>
        <RenameFamilyForm name={family.name} />
        <div className="rounded-lg border border-destructive/40 p-4">
          <h3 className="text-sm font-medium">Delete family</h3>
          <p className="mb-3 mt-1 text-sm text-muted-foreground">Removes every child, device and all reported data.</p>
          <DeleteFamilyDialog familyName={family.name} />
        </div>
      </section>
    </>
  );
}
