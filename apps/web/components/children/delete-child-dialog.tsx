import { deleteChildAction } from "@/lib/family/actions";
import { DeleteDialog } from "@/components/family/delete-dialog";

export function DeleteChildDialog({ childId, childName }: { childId: string; childName: string }) {
  return (
    <DeleteDialog
      dialogId="delete-child"
      action={deleteChildAction}
      hidden={{ id: childId }}
      triggerLabel="Delete child"
      confirmLabel="Delete permanently"
      title={`Delete ${childName}?`}
      description={
        <>
          <p>This permanently removes {childName}&apos;s profile and <strong>every device enrolled for them</strong>, along with all data those devices have reported (usage, location, activity) and their rules.</p>
          <p>This can&apos;t be undone.</p>
        </>
      }
    />
  );
}
