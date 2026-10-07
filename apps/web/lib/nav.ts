// Typed navigation + breadcrumb rules for the parent dashboard shell. Pure (no React/Next imports) so it is unit-tested.
import { isUuid } from "@/lib/ids";

export type IconName =
  | "dashboard" | "children" | "devices" | "bell" | "audit" | "settings" | "menu" | "close" | "sun" | "moon" | "monitor"
  | "chevron-right" | "battery" | "clock" | "map-pin" | "lock" | "alert" | "shield" | "logout" | "user" | "check";

export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/children", label: "Children", icon: "children" },
  { href: "/devices", label: "Devices", icon: "devices" },
  { href: "/notifications", label: "Notifications", icon: "bell" },
  { href: "/audit-logs", label: "Audit log", icon: "audit" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export const DEVICE_TABS = [
  { slug: "overview", label: "Overview" },
  { slug: "usage", label: "Usage" },
  { slug: "applications", label: "Apps" },
  { slug: "location", label: "Location" },
  { slug: "geofences", label: "Geofences" },
  { slug: "permissions", label: "Permissions" },
  { slug: "rules", label: "Rules" },
  { slug: "schedules", label: "Schedules" },
  { slug: "activity", label: "Activity" },
] as const;

export type DeviceTabSlug = (typeof DEVICE_TABS)[number]["slug"];

const trimSlash = (p: string): string => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);

/** A nav item is active on its own path and on any nested path (`/devices` covers `/devices/:id/usage`). */
export function isActive(pathname: string, href: string): boolean {
  const p = trimSlash(pathname);
  return p === href || p.startsWith(href + "/");
}

export function deviceTabHref(deviceId: string, slug: DeviceTabSlug): string {
  return `/devices/${deviceId}/${slug}`;
}

export interface Crumb {
  readonly label: string;
  /** `null` for the current page (rendered as text with aria-current). */
  readonly href: string | null;
}

const SEGMENT_LABELS: Readonly<Record<string, string>> = {
  dashboard: "Dashboard",
  children: "Children",
  devices: "Devices",
  notifications: "Notifications",
  "audit-logs": "Audit log",
  settings: "Settings",
  security: "Security",
  new: "Add child",
  edit: "Edit",
  overview: "Overview",
  usage: "Usage",
  applications: "Apps",
  location: "Location",
  geofences: "Geofences",
  permissions: "Permissions",
  rules: "Rules",
  schedules: "Schedules",
  activity: "Activity",
};

function humanize(segment: string): string {
  const s = segment.replace(/[-_]+/g, " ").trim().slice(0, 40);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Page";
}

/**
 * Builds breadcrumbs from a pathname. `labels` maps an entity id to a display name (Phase 7 passes child/device names);
 * without it, ids render as "Child"/"Device" so raw identifiers are never shown.
 */
export function buildBreadcrumbs(pathname: string, labels: Readonly<Record<string, string>> = {}): Crumb[] {
  const path = pathname.split(/[?#]/, 1)[0] ?? "";
  const segments = path.split("/").filter(Boolean);
  const crumbs: { label: string; href: string }[] = [];
  if (segments[0] !== "dashboard") crumbs.push({ label: "Dashboard", href: "/dashboard" });

  let href = "";
  segments.forEach((seg, i) => {
    href += "/" + seg;
    const parent = segments[i - 1];
    let label: string;
    if (i === 1 && isUuid(seg) && (parent === "children" || parent === "devices")) {
      label = labels[seg] ?? (parent === "children" ? "Child" : "Device");
    } else {
      label = SEGMENT_LABELS[seg] ?? humanize(seg);
    }
    crumbs.push({ label, href });
  });

  if (crumbs.length === 0) return [{ label: "Dashboard", href: null }];
  return crumbs.map((c, i) => ({ label: c.label, href: i === crumbs.length - 1 ? null : c.href }));
}
