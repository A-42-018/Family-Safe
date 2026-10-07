import { describe, expect, it } from "vitest";
import { nextMenuIndex } from "./menu-keys";

describe("nextMenuIndex", () => {
  it("moves down and wraps", () => {
    expect(nextMenuIndex(0, 4, "ArrowDown")).toBe(1);
    expect(nextMenuIndex(3, 4, "ArrowDown")).toBe(0);
    expect(nextMenuIndex(-1, 4, "ArrowDown")).toBe(0);
  });
  it("moves up and wraps", () => {
    expect(nextMenuIndex(2, 4, "ArrowUp")).toBe(1);
    expect(nextMenuIndex(0, 4, "ArrowUp")).toBe(3);
    expect(nextMenuIndex(-1, 4, "ArrowUp")).toBe(3);
  });
  it("supports Home/End", () => {
    expect(nextMenuIndex(2, 5, "Home")).toBe(0);
    expect(nextMenuIndex(2, 5, "End")).toBe(4);
  });
  it("ignores other keys and empty menus", () => {
    expect(nextMenuIndex(0, 3, "a")).toBeNull();
    expect(nextMenuIndex(0, 3, "Enter")).toBeNull();
    expect(nextMenuIndex(0, 0, "ArrowDown")).toBeNull();
  });
});
