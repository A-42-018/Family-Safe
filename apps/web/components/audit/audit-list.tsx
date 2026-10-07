import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ACTION_LABEL, AUDIT_ACTIONS, auditQuery, auditSummary, describeAudit, isFiltering, type AuditFilters } from "@/lib/audit/audit";
import type { AuditPage } from "@/lib/audit/queries";
import { formatLastSeen } from "@/lib/enrollment/format";

type Props = { page: AuditPage; filters: AuditFilters; devices: readonly { id: string; name: string }[]; now?: Date };

const SELECT_CLASS = "h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The audit log (Phase 30b): a GET form for filters and a newest-first list. Presentational; every sentence comes from `lib/audit`. */
export function AuditList({ page, filters, devices, now = new Date() }: Props) {
  const lines = page.rows.map(describeAudit);
  const filtering = isFiltering(filters);
  return (
    <Card>
      <CardContent className="space-y-4 p-5" data-testid="audit-card">
        <form method="get" role="search" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <label className="space-y-1 text-xs text-muted-foreground">
            Action
            <select name="action" defaultValue={filters.action ?? ""} className={`${SELECT_CLASS} w-full`}>
              <option value="">All actions</option>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABEL[a]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Device
            <select name="device" defaultValue={filters.device ?? ""} className={`${SELECT_CLASS} w-full`}>
              <option value="">All devices</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            From (UTC date)
            <Input type="date" name="from" defaultValue={filters.from ?? ""} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            To (UTC date)
            <Input type="date" name="to" defaultValue={filters.to ?? ""} />
          </label>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="outline">
              Filter
            </Button>
            {filtering || filters.before ? (
              <Link href="/audit-logs" className="text-sm text-muted-foreground underline underline-offset-4">
                Clear
              </Link>
            ) : null}
          </div>
        </form>
        <p className="text-xs text-muted-foreground" role="status" data-testid="audit-summary">
          {auditSummary(lines.length, filtering, page.next !== null)}
        </p>
        {lines.length === 0 ? null : (
          <ul className="divide-y text-sm" aria-label="Audit log, newest first">
            {lines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
                <div>
                  <p className="font-medium">{l.title}</p>
                  {l.detail ? <p className="text-muted-foreground">{l.detail}</p> : null}
                  {l.device ? <p className="text-xs text-muted-foreground">Device: {l.device}</p> : null}
                  {l.ip ? <p className="text-xs text-muted-foreground">From address {l.ip}</p> : null}
                </div>
                <time className="text-xs text-muted-foreground" dateTime={l.at} title={l.at}>
                  {formatLastSeen(l.at, now)}
                </time>
              </li>
            ))}
          </ul>
        )}
        {page.next ? (
          <Link className="text-sm font-medium underline underline-offset-4" href={`/audit-logs${auditQuery(filters, page.next)}`}>
            Older entries
          </Link>
        ) : null}
        <p className="text-xs text-muted-foreground">Entries are kept for 180 days. They name what was done and when, never the values that were set, and they cannot be changed or deleted from the dashboard.</p>
      </CardContent>
    </Card>
  );
}
