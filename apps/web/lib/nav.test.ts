import { describe, expect, it } from "vitest";
import { decideRedirect, type SessionState } from "@/lib/auth/routes";
import { buildBreadcrumbs, DEVICE_TABS, deviceTabHref, isActive, NAV_ITEMS } from "./nav";

const ID = "2b1f6c1e-5a44-4c3e-9d0a-1f2e3d4c5b6a";
const anon: SessionState = { user: null, aal: { current: null, next: null } };
const authed: SessionState = { user: { id: "u1", emailConfirmed: true }, aal: { current: "aal1", next: "aal1" } };

describe("NAV_ITEMS", () => {
  it("covers the top-level pages of prompt §35 exactly once", () => {
    expect(NAV_ITEMS.map((n) => n.href)).toEqual(["/dashboard", "/children", "/devices", "/notifications", "/audit-logs", "/settings"]);
    expect(new Set(NAV_ITEMS.map((n) => n.label)).size).toBe(NAV_ITEMS.length);
  });
});

describe("DEVICE_TABS", () => {
  it("matches the device sub-pages of prompt §35 in order", () => {
    expect(DEVICE_TABS.map((t) => t.slug)).toEqual(["overview", "usage", "applications", "location", "geofences", "permissions", "rules", "schedules", "activity"]);
  });
  it("builds hrefs", () => expect(deviceTabHref(ID, "usage")).toBe(`/devices/${ID}/usage`));
});

describe("isActive", () => {
  it.each<[string, string, boolean]>([
    ["/dashboard", "/dashboard", true],
    ["/dashboard/", "/dashboard", true],
    ["/devices", "/devices", true],
    [`/devices/${ID}/usage`, "/devices", true],
    ["/settings/security", "/settings", true],
    ["/devicesfoo", "/devices", false],
    ["/children", "/devices", false],
    ["/", "/dashboard", false],
    ["/settings", "/settings/security", false],
  ])("%s vs %s → %s", (path, href, expected) => expect(isActive(path, href)).toBe(expected));

  it("marks exactly one nav item active per section", () => {
    for (const p of ["/dashboard", "/children", `/children/${ID}`, "/devices", `/devices/${ID}/location`, "/notifications", "/audit-logs", "/settings", "/settings/security"]) {
      expect(NAV_ITEMS.filter((n) => isActive(p, n.href))).toHaveLength(1);
    }
  });
});

describe("buildBreadcrumbs", () => {
  const labels = (p: string, l?: Record<string, string>) => buildBreadcrumbs(p, l).map((c) => c.label);

  it("root and dashboard show a single current crumb", () => {
    expect(buildBreadcrumbs("/dashboard")).toEqual([{ label: "Dashboard", href: null }]);
    expect(buildBreadcrumbs("/")).toEqual([{ label: "Dashboard", href: null }]);
  });
  it("top-level pages link back to the dashboard", () => {
    expect(buildBreadcrumbs("/children")).toEqual([{ label: "Dashboard", href: "/dashboard" }, { label: "Children", href: null }]);
    expect(labels("/audit-logs")).toEqual(["Dashboard", "Audit log"]);
  });
  it("device tabs nest under Device without exposing the id", () => {
    expect(labels(`/devices/${ID}/location`)).toEqual(["Dashboard", "Devices", "Device", "Location"]);
    expect(buildBreadcrumbs(`/devices/${ID}/applications`).at(-1)).toEqual({ label: "Apps", href: null });
    expect(buildBreadcrumbs(`/devices/${ID}/usage`)[2]).toEqual({ label: "Device", href: `/devices/${ID}` });
  });
  it("child detail", () => expect(labels(`/children/${ID}`)).toEqual(["Dashboard", "Children", "Child"]));
  it("uses entity names when supplied", () => {
    expect(labels(`/devices/${ID}/rules`, { [ID]: "Maya's phone" })).toEqual(["Dashboard", "Devices", "Maya's phone", "Rules"]);
  });
  it("nested settings", () => expect(labels("/settings/security")).toEqual(["Dashboard", "Settings", "Security"]));
  it("ignores query/hash and trailing slashes", () => expect(labels("/devices/?x=1#y")).toEqual(["Dashboard", "Devices"]));
  it("never echoes unknown segments verbatim beyond a short humanised label", () => {
    const [, c] = buildBreadcrumbs("/" + "a".repeat(200));
    expect(c?.label.length).toBeLessThanOrEqual(40);
    expect(labels("/some-new_page")).toEqual(["Dashboard", "Some new page"]);
  });
  it("exactly one current crumb (last)", () => {
    for (const p of ["/dashboard", "/children", `/devices/${ID}/schedules`, "/settings/security"]) {
      const c = buildBreadcrumbs(p);
      expect(c.filter((x) => x.href === null)).toHaveLength(1);
      expect(c.at(-1)?.href).toBeNull();
    }
  });
});

describe("every prompt §35 route is behind authentication", () => {
  const routes = [
    "/dashboard", "/children", `/children/${ID}`, "/devices", `/devices/${ID}`,
    ...DEVICE_TABS.map((t) => `/devices/${ID}/${t.slug}`),
    "/notifications", "/audit-logs", "/settings", "/settings/security",
    "/children/new", `/children/${ID}/edit`,
  ];
  it.each(routes)("%s: guest → /login?next=…, signed-in → render", (r) => {
    expect(decideRedirect(r, "", anon)).toBe(`/login?next=${encodeURIComponent(r)}`);
    expect(decideRedirect(r, "", authed)).toBeNull();
  });
});

describe("Phase 7 breadcrumbs", () => {
  it("child pages use the child's name, then Edit / Add child", () => {
    expect(buildBreadcrumbs(`/children/${ID}`, { [ID]: "Sam" }).map((c) => c.label)).toEqual(["Dashboard", "Children", "Sam"]);
    expect(buildBreadcrumbs(`/children/${ID}/edit`, { [ID]: "Sam" }).map((c) => c.label)).toEqual(["Dashboard", "Children", "Sam", "Edit"]);
    expect(buildBreadcrumbs("/children/new").map((c) => c.label)).toEqual(["Dashboard", "Children", "Add child"]);
  });
  it("falls back to 'Child' without a label and never shows the raw id", () => {
    expect(buildBreadcrumbs(`/children/${ID}/edit`).map((c) => c.label)).toEqual(["Dashboard", "Children", "Child", "Edit"]);
  });
});
