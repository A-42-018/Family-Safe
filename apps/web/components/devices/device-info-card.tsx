import { Card, CardContent } from "@/components/ui/card";
import { apiLevelText, formatPatchDate, hasReportedInfo, infoUpdatedText, isInfoStale, patchHint, storageSummary } from "@/lib/devices/info";
import { formatLastSeen } from "@/lib/enrollment/format";
import type { DeviceRow } from "@/lib/enrollment/queries";

type Props = { device: Pick<DeviceRow, "androidVersion" | "sdkLevel" | "securityPatch" | "storageTotalMb" | "storageFreeMb" | "infoUpdatedAt">; now?: Date };

/** "Device information" card (Phase 13c). Presentational: every value comes from `lib/devices/info`. */
export function DeviceInfoCard({ device, now = new Date() }: Props) {
  const reported = hasReportedInfo(device);
  const storage = storageSummary(device);
  const patchDate = formatPatchDate(device.securityPatch);
  const hint = patchHint(device.securityPatch, now);
  const api = apiLevelText(device.sdkLevel);
  const os = [device.androidVersion ? `Android ${device.androidVersion}` : null, api].filter(Boolean).join(" · ");
  return (
    <Card>
      <CardContent className="space-y-4 p-5" data-testid="device-info-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Device information</h2>
          <p className="text-xs text-muted-foreground">{infoUpdatedText(device, now, formatLastSeen)}</p>
        </div>
        {!reported ? (
          <p className="text-sm text-muted-foreground">The app shares this once a day. It has not sent it yet.</p>
        ) : (
          <>
            {isInfoStale(device, now) ? (
              <p className="text-sm text-muted-foreground">No update for over 3 days. Values below are the last ones reported.</p>
            ) : null}
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">System</dt>
                <dd className="text-sm font-medium">{os || "Unknown"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Security patch</dt>
                <dd className="text-sm font-medium">{patchDate ?? "Unknown"}</dd>
              </div>
            </dl>
            {hint && hint.level !== "recent" ? <p className="text-sm text-muted-foreground">{hint.text}</p> : null}
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs text-muted-foreground">Storage (internal)</p>
                <p className="text-sm font-medium">{storage ? `${storage.usedText} of ${storage.totalText} used` : "Unknown"}</p>
              </div>
              {storage ? (
                <>
                  <div
                    role="progressbar"
                    aria-label="Internal storage used"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={storage.usedPercent}
                    aria-valuetext={`${storage.usedPercent}% used, ${storage.freeText} free`}
                    className="h-2 w-full overflow-hidden rounded-full bg-muted"
                  >
                    <div className="h-full rounded-full bg-primary" style={{ width: `${storage.usedPercent}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground">{storage.freeText} free</p>
                </>
              ) : null}
            </div>
          </>
        )}
        <p className="text-xs text-muted-foreground">Shared: Android version, security patch date, internal storage. Never shared: serial number, phone identifiers, apps, files.</p>
      </CardContent>
    </Card>
  );
}
