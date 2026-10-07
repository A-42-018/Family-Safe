import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { setPreferenceAction } from "@/lib/notifications/actions";
import type { PreferenceRow } from "@/lib/notifications/preferences";

/** Which notifications you get (Phase 29c). One plain form per row, no client JavaScript. */
export function PreferencesCard({ rows }: { rows: readonly PreferenceRow[] | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2" className="text-lg">Notifications</CardTitle>
        <CardDescription>Choose which alerts you get. Emergency alerts and security notices are always on.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows === null ? (
          <p className="text-sm text-muted-foreground" data-testid="preferences-unreadable">Your notification choices could not be read right now. Please try again later.</p>
        ) : (
        <ul className="divide-y text-sm" aria-label="Notification types" data-testid="preferences-card">
          {rows.map((r) => (
            <li key={r.type} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-medium">{r.title}</p>
                <p className="text-muted-foreground">{r.description}</p>
              </div>
              {r.alwaysOn ? (
                <span className="text-xs font-medium text-muted-foreground">Always on</span>
              ) : (
                <form action={setPreferenceAction} className="flex items-center gap-3">
                  <input type="hidden" name="type" value={r.type} />
                  <input type="hidden" name="enabled" value={r.enabled ? "false" : "true"} />
                  <span className="text-xs text-muted-foreground" role="status">
                    {r.enabled ? "On" : "Off"}
                  </span>
                  <Button type="submit" variant="outline" size="sm" aria-label={`${r.enabled ? "Turn off" : "Turn on"}: ${r.title}`}>
                    {r.enabled ? "Turn off" : "Turn on"}
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
        )}
      </CardContent>
    </Card>
  );
}
