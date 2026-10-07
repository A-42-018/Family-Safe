import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { arePermissionsStale, hasVerifiedPermissions, permissionRows, PERMISSIONS_STALE_HOURS, permissionsUpdatedText, revokedNotice, type PermissionsInput } from "@/lib/devices/permissions";
import { formatLastSeen } from "@/lib/enrollment/format";

type Props = { permissions: PermissionsInput; now?: Date };

/** "Permissions" card (Phase 14c). Presentational: every value and sentence comes from `lib/devices/permissions`. */
export function PermissionsCard({ permissions, now = new Date() }: Props) {
  const verified = hasVerifiedPermissions(permissions);
  const rows = permissionRows(permissions);
  const notice = revokedNotice(permissions);
  return (
    <Card>
      <CardContent className="space-y-4 p-5" data-testid="permissions-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Permissions</h2>
          <p className="text-xs text-muted-foreground">{permissionsUpdatedText(permissions, now, formatLastSeen)}</p>
        </div>
        {!verified ? (
          <p className="text-sm text-muted-foreground">The app reports this every few hours and when it is opened. It has not reported yet.</p>
        ) : null}
        {verified && arePermissionsStale(permissions, now) ? (
          <p className="text-sm text-muted-foreground">No update for over {PERMISSIONS_STALE_HOURS} hours. Values below are the last ones reported.</p>
        ) : null}
        {notice ? (
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-testid="permissions-revoked-notice">
            <Badge variant="outline">Turned off</Badge>
            <span>{notice}</span>
          </p>
        ) : null}
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">{r.label}</p>
                <p className="text-xs text-muted-foreground">{r.purpose}</p>
                <p className="text-xs text-muted-foreground">{r.stateText}</p>
              </div>
              <Badge variant={r.variant} className="shrink-0 self-start">
                {r.stateLabel}
              </Badge>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          This is what the device reported about Android&apos;s permission settings. It can be out of date and is not proof of what the device does. Only on/off states are shared, never the contents of contacts, messages or calls.
        </p>
      </CardContent>
    </Card>
  );
}
