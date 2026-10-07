// Theme preference lives in a server-set cookie so it needs no inline script (CSP stays nonce-only).
// "system" adds no class: globals.css follows prefers-color-scheme. "light"/"dark" force the palette.
export const THEME_COOKIE = "fs-theme";
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export function parseTheme(raw: string | null | undefined): Theme {
  return (THEMES as readonly string[]).includes(raw ?? "") ? (raw as Theme) : "system";
}

export function themeClass(theme: Theme): string {
  return theme === "system" ? "" : theme;
}
