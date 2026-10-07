import { Card, CardContent } from "@/components/ui/card";
import { bedtimeText, ENFORCEMENT_NOTE, schoolModeText, versionText, weekPlan, type RulesRow } from "@/lib/rules/rules";

/**
 * Read-only summary of the stored screen-time rules (Phase 17b). Presentational: every sentence comes from `lib/rules/rules`.
 * The editable form lives next to it; the legacy bedtime and school-mode values are shown here, and windows are edited on the Schedules tab (Phase 19b).
 */
export function RulesCard({ rules, now = new Date() }: { rules: RulesRow; now?: Date }) {
  const plan = weekPlan(rules);
  return (
    <Card>
      <CardContent className="space-y-5 p-5" data-testid="rules-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Current limits</h2>
          <p className="text-xs text-muted-foreground">{versionText(rules, now)}</p>
        </div>
        <ul className="divide-y text-sm" aria-label="Limit for each day of the week">
          {plan.map((d) => (
            <li key={d.iso} className="flex items-center justify-between gap-3 py-2">
              <span>{d.label}</span>
              <span className="tabular-nums">
                {d.text}
                {d.source === "default" && d.text !== "No limit" ? <span className="text-muted-foreground"> (default)</span> : null}
              </span>
            </li>
          ))}
        </ul>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Bedtime</dt>
            <dd>{bedtimeText(rules)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">School mode</dt>
            <dd>{schoolModeText(rules)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">These are older settings and can&apos;t be changed. Set bedtime and school-time windows on the Schedules tab.</p>
        <p className="text-xs text-muted-foreground">{ENFORCEMENT_NOTE}</p>
      </CardContent>
    </Card>
  );
}
