import { describe, expect, it } from "vitest";
import { parseTheme, themeClass } from "./theme";

describe("theme", () => {
  it.each([["light", "light"], ["dark", "dark"], ["system", "system"]])("parses %s", (i, o) => expect(parseTheme(i)).toBe(o));
  it.each([undefined, null, "", "DARK", "blue", "dark; Path=/", "__proto__", "toString"])("falls back to system for %j", (i) => expect(parseTheme(i)).toBe("system"));
  it("maps to html classes (system adds none so CSS follows the OS)", () => {
    expect(themeClass("system")).toBe("");
    expect(themeClass("light")).toBe("light");
    expect(themeClass("dark")).toBe("dark");
  });
});
