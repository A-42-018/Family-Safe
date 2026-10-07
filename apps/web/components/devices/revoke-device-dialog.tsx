import { DeleteDialog } from "@/components/family/delete-dialog";
import { revokeDeviceAction } from "@/lib/enrollment/actions";

export function RevokeDeviceDialog({ deviceId, deviceName }: { deviceId: string; deviceName: string }) {
  return (
    <DeleteDialog
      dialogId={`revoke-${deviceId}`}
      action={revokeDeviceAction}
      hidden={{ id: deviceId }}
      confirmValue="revoke"
      pendingLabel="Revoking…"
      triggerLabel="Revoke access"
      confirmLabel="Revoke access"
      title={`Revoke access for ${deviceName}?`}
      description={
        <>
          <p>This device will stop syncing rules and reporting data, and its sign-in is cancelled. Its existing history stays in your dashboard.</p>
          <p>To use the phone with FamilySafe again, add it as a new device.</p>
        </>
      }
    />
  );
}
