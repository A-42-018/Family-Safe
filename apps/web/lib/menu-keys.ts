/** Roving-focus rules for role="menu" (WAI-ARIA menu pattern). Returns the index to focus, or null to ignore the key. */
export function nextMenuIndex(current: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown": return current < 0 ? 0 : (current + 1) % count;
    case "ArrowUp": return current <= 0 ? count - 1 : current - 1;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}
