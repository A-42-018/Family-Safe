import Link from "next/link";
import { AppRuleControls } from "@/components/devices/app-rule-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  APP_RULES_NOTE,
  atRuleCap,
  canRestrict,
  mergeRestrictions,
  restrictionText,
  RULES_CAP_NOTE,
  ruleCounts,
  ruleSummaryText,
  type AppRuleRow,
  type RestrictionState,
} from "@/lib/apps/restrictions";
import {
  APPS_CAP,
  APPS_CAP_NOTE,
  APPS_SEARCH_MAX,
  APPS_STALE_DAYS,
  appCounts,
  appsUpdatedText,
  areAppsStale,
  filterApps,
  hasReportedApps,
  KIND_LABEL,
  resultsText,
  sortApps,
  type AppKind,
  type AppsInput,
  type AppsQuery,
} from "@/lib/devices/apps";
import { formatLastSeen } from "@/lib/enrollment/format";

/** Phase 18b: the stored app rules of the device. `editable` is false for revoked/pending devices (read-only list). */
export type AppRestrictions = { deviceId: string; rules: readonly AppRuleRow[]; editable: boolean };

type Props = { apps: AppsInput; query: AppsQuery; restrictions: AppRestrictions; now?: Date };

const KINDS: AppKind[] = ["all", "user", "system"];

const NONE: RestrictionState = { kind: "none" };

/**
 * "Apps" card (Phase 15c) with per-app restrictions (Phase 18b). Presentational: search/filter is a plain GET form, the only
 * write controls are the `AppRuleControls` forms (Server Action), and there is no data access here.
 */
export function AppsCard({ apps, query, restrictions, now = new Date() }: Props) {
  const reported = hasReportedApps(apps);
  const merged = mergeRestrictions(apps.apps, restrictions.rules);
  const counts = appCounts(apps.apps);
  const ruleCount = ruleCounts(restrictions.rules);
  const rows = sortApps(filterApps(merged.apps, query));
  const filtering = query.q !== "" || query.kind !== "all";
  return (
    <Card>
      <CardContent className="space-y-4 p-5" data-testid="apps-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Apps</h2>
          <p className="text-xs text-muted-foreground">{appsUpdatedText(apps, now, formatLastSeen)}</p>
        </div>
        {!reported ? (
          <p className="text-sm text-muted-foreground">The app reports its app list about once a day and after it changes. It has not reported yet.</p>
        ) : (
          <>
            {areAppsStale(apps, now) ? (
              <p className="text-sm text-muted-foreground">No update for over {APPS_STALE_DAYS} days. The list below is the last one reported.</p>
            ) : null}
            <form method="get" role="search" className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input type="search" name="q" defaultValue={query.q} maxLength={APPS_SEARCH_MAX} placeholder="Search by app name" aria-label="Search apps" className="sm:max-w-xs" />
              <select
                name="kind"
                defaultValue={query.kind}
                aria-label="Filter apps"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                    {k === "all" ? ` (${counts.total})` : k === "user" ? ` (${counts.user})` : ` (${counts.system})`}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="outline">
                Search
              </Button>
              {filtering ? (
                <Link href="?" className="text-sm text-muted-foreground underline underline-offset-4">
                  Clear
                </Link>
              ) : null}
            </form>
            <p className="text-xs text-muted-foreground" role="status" data-testid="apps-results">
              {resultsText(rows.length, counts.total)}
            </p>
            <p className="text-sm" data-testid="app-rules-summary">
              {ruleSummaryText(ruleCount)}
              {merged.unreported > 0 ? <span className="text-muted-foreground"> {merged.unreported} of them for apps the device no longer reports.</span> : null}
            </p>
            {restrictions.editable && atRuleCap(ruleCount) ? <p className="text-xs text-muted-foreground">{RULES_CAP_NOTE}</p> : null}
            {rows.length > 0 ? (
              <ul className="divide-y">
                {rows.map((a) => {
                  const state = merged.states.get(a.packageName) ?? NONE;
                  return (
                    <li key={a.packageName} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0 space-y-0.5">
                        <p className="break-words text-sm font-medium">{a.label}</p>
                        <p className="break-all text-xs text-muted-foreground">{a.packageName}</p>
                        {a.versionName ? <p className="break-words text-xs text-muted-foreground">Version {a.versionName}</p> : null}
                        <p className="text-xs">
                          {a.isSystem ? (
                            <Badge variant="secondary" className="mr-2">
                              System
                            </Badge>
                          ) : null}
                          <Badge variant={state.kind === "none" ? "outline" : "default"}>{restrictionText(state)}</Badge>
                        </p>
                      </div>
                      {restrictions.editable && canRestrict(a.packageName) && (state.kind !== "none" || !atRuleCap(ruleCount)) ? (
                        <div className="sm:max-w-sm">
                          <AppRuleControls deviceId={restrictions.deviceId} packageName={a.packageName} label={a.label} state={state} />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {counts.total >= APPS_CAP ? <p className="text-xs text-muted-foreground">{APPS_CAP_NOTE}</p> : null}
          </>
        )}
        <p className="text-xs text-muted-foreground">
          This is what the device reported: apps that have a launcher entry, with name, version and a system flag. It can be out of date. Icons, install times, usage and app data are never shared.
        </p>
        <p className="text-xs text-muted-foreground" data-testid="app-rules-note">
          {APP_RULES_NOTE}
        </p>
      </CardContent>
    </Card>
  );
}
