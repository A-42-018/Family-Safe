import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { formatLastSeen } from "@/lib/enrollment/format";
import {
  barPercent,
  buildSeries,
  chartScaleMax,
  dayAriaLabel,
  dayLabel,
  hasReportedUsage,
  isUsageStale,
  launchesText,
  minutesText,
  summaryText,
  topApps,
  unlocksText,
  USAGE_DAY_NOTE,
  USAGE_SCOPE_NOTE,
  USAGE_SERIES_DAYS,
  USAGE_STALE_HOURS,
  usageUpdatedText,
  weekSummary,
  shortDayText,
  type UsageInput,
} from "@/lib/devices/usage";

type Props = { usage: UsageInput; now?: Date };

/**
 * "Screen time" card (Phase 16c-1). Presentational and read-only: every number and sentence comes from `lib/devices/usage`.
 * The chart is plain CSS bars inside links (`?day=`), so it needs no client JS and no charting library; the text in each
 * link carries the same information as the bar.
 */
export function UsageCard({ usage, now = new Date() }: Props) {
  const reported = hasReportedUsage(usage);
  const series = buildSeries(usage.days, now);
  const lastDay = series[series.length - 1]!.day;
  const scaleMax = chartScaleMax(series);
  const summary = weekSummary(series);
  const selected = series.find((d) => d.day === usage.selectedDay) ?? series[series.length - 1]!;
  const top = topApps(usage.apps, usage.labels, selected.screenMinutes);
  return (
    <Card>
      <CardContent className="space-y-5 p-5" data-testid="usage-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Screen time</h2>
          <p className="text-xs text-muted-foreground">{usageUpdatedText(usage, now, formatLastSeen)}</p>
        </div>
        {!reported ? (
          <p className="text-sm text-muted-foreground">The app reports screen time a few times a day once the child switches on Usage Access on the device. It has not reported yet.</p>
        ) : (
          <>
            {isUsageStale(usage, now) ? (
              <p className="text-sm text-muted-foreground">No update for over {USAGE_STALE_HOURS} hours. The numbers below are the last ones reported.</p>
            ) : null}
            <section aria-labelledby="usage-week-heading" className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id="usage-week-heading" className="text-sm font-medium">
                  Last {USAGE_SERIES_DAYS} days
                </h3>
                <p className="text-xs text-muted-foreground" data-testid="usage-summary">
                  {summaryText(summary)}
                </p>
              </div>
              <ol className="grid grid-cols-7 gap-1 sm:gap-2" data-testid="usage-chart">
                {series.map((d) => {
                  const isSelected = d.day === selected.day;
                  return (
                    <li key={d.day} className="min-w-0">
                      <Link
                        href={`?day=${d.day}`}
                        scroll={false}
                        aria-label={dayAriaLabel(d, lastDay)}
                        aria-current={isSelected ? "date" : undefined}
                        className={`flex flex-col items-center gap-1 rounded-md p-1 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isSelected ? "bg-muted" : "hover:bg-muted/50"}`}
                      >
                        <span className="flex h-28 w-full items-end justify-center" aria-hidden="true">
                          <span
                            className={`w-full max-w-8 rounded-t ${d.screenMinutes === null ? "border border-dashed border-muted-foreground/40" : "bg-primary"}`}
                            style={{ height: d.screenMinutes === null ? "4%" : `${barPercent(d.screenMinutes, scaleMax)}%`, minHeight: "2px" }}
                          />
                        </span>
                        <span className="w-full truncate text-[11px] font-medium" aria-hidden="true">
                          {dayLabel(d.day, lastDay)}
                        </span>
                        <span className="w-full truncate text-[11px] tabular-nums text-muted-foreground" aria-hidden="true">
                          {d.screenMinutes === null ? "–" : minutesText(d.screenMinutes)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
              <p className="text-xs text-muted-foreground">{USAGE_DAY_NOTE}</p>
            </section>

            <section aria-labelledby="usage-day-heading" className="space-y-3" data-testid="usage-day">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 id="usage-day-heading" className="text-sm font-medium">
                  {dayLabel(selected.day, lastDay)} · {shortDayText(selected.day)}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {selected.screenMinutes === null ? "Nothing reported for this day" : `${minutesText(selected.screenMinutes)} on screen · ${unlocksText(selected.unlocks)}`}
                </p>
              </div>
              {top.rows.length > 0 ? (
                <ul className="divide-y" data-testid="usage-apps">
                  {top.rows.map((a) => (
                    <li key={a.packageName} className="space-y-1 py-2 first:pt-0 last:pb-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="min-w-0 break-words text-sm font-medium">{a.name}</p>
                        <p className="shrink-0 text-sm tabular-nums">{minutesText(a.minutes)}</p>
                      </div>
                      {a.sharePercent !== null ? (
                        <div className="h-1.5 w-full overflow-hidden rounded bg-muted" aria-hidden="true">
                          <div className="h-full bg-primary" style={{ width: `${a.sharePercent}%` }} />
                        </div>
                      ) : null}
                      <p className="break-all text-xs text-muted-foreground">
                        {a.name !== a.packageName ? `${a.packageName} · ` : ""}
                        {launchesText(a.launches)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="usage-no-apps">
                  No app usage reported for this day.
                </p>
              )}
              {top.omitted > 0 ? <p className="text-xs text-muted-foreground">{top.omitted} more {top.omitted === 1 ? "app" : "apps"} with usage not shown.</p> : null}
            </section>
          </>
        )}
        <p className="text-xs text-muted-foreground">{USAGE_SCOPE_NOTE}</p>
      </CardContent>
    </Card>
  );
}
