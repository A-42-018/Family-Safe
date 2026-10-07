const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route params for `[id]` segments are database UUIDs; anything else is a 404 before it reaches a query or the UI. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
