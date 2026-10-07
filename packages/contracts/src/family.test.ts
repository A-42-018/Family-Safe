import { describe, expect, it } from "vitest";
import {
  avatarUrlSchema, createChildSchema, createFamilySchema, dateOfBirthSchema, deleteChildSchema, deleteFamilySchema,
  isRealIsoDate, renameFamilySchema, updateChildSchema,
} from "./family";

const ID = "6f1d1c1e-8a0b-4c6e-9d3a-1f2e3d4c5b6a";

describe("isRealIsoDate", () => {
  it.each(["2020-02-29", "2015-12-31", "1900-01-01"])("accepts %s", (s) => expect(isRealIsoDate(s)).toBe(true));
  it.each(["2021-02-29", "2020-13-01", "2020-00-10", "2020-1-1", "20200101", "", "2020-02-30", "abcd-ef-gh"])("rejects %s", (s) =>
    expect(isRealIsoDate(s)).toBe(false));
});

describe("family names", () => {
  it("trims and accepts", () => expect(createFamilySchema.parse({ name: "  The Lees " }).name).toBe("The Lees"));
  it("rejects empty / whitespace / too long", () => {
    expect(createFamilySchema.safeParse({ name: "   " }).success).toBe(false);
    expect(renameFamilySchema.safeParse({ name: "x".repeat(101) }).success).toBe(false);
    expect(renameFamilySchema.safeParse({ name: "x".repeat(100) }).success).toBe(true);
    expect(createFamilySchema.safeParse({}).success).toBe(false);
  });
  it("delete needs the explicit confirm token", () => {
    expect(deleteFamilySchema.safeParse({}).success).toBe(false);
    expect(deleteFamilySchema.safeParse({ confirm: "yes" }).success).toBe(false);
    expect(deleteFamilySchema.safeParse({ confirm: "delete" }).success).toBe(true);
  });
});

describe("dateOfBirth", () => {
  it("empty / whitespace → null", () => {
    expect(dateOfBirthSchema.parse("")).toBeNull();
    expect(dateOfBirthSchema.parse("   ")).toBeNull();
    expect(dateOfBirthSchema.parse(null)).toBeNull();
  });
  it("accepts a past date", () => expect(dateOfBirthSchema.parse("2015-06-01")).toBe("2015-06-01"));
  it("rejects impossible, pre-1900 and future dates", () => {
    expect(dateOfBirthSchema.safeParse("2015-02-31").success).toBe(false);
    expect(dateOfBirthSchema.safeParse("1899-12-31").success).toBe(false);
    expect(dateOfBirthSchema.safeParse("2999-01-01").success).toBe(false);
    expect(dateOfBirthSchema.safeParse("06/01/2015").success).toBe(false);
    expect(dateOfBirthSchema.safeParse(20150601).success).toBe(false);
  });
  it("accepts today", () => expect(dateOfBirthSchema.safeParse(new Date().toISOString().slice(0, 10)).success).toBe(true));
});

describe("avatarUrl", () => {
  it("empty → null", () => expect(avatarUrlSchema.parse("")).toBeNull());
  it("accepts https", () => expect(avatarUrlSchema.parse("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png"));
  it.each(["http://x.com/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "https://u:p@x.com/a.png", "not a url", "//x.com/a.png", "ftp://x.com/a"])(
    "rejects %s", (u) => expect(avatarUrlSchema.safeParse(u).success).toBe(false));
  it("rejects > 2048 chars", () => expect(avatarUrlSchema.safeParse("https://x.com/" + "a".repeat(2048)).success).toBe(false));
});

describe("child schemas", () => {
  it("create: name only → dob null, avatar undefined", () => {
    const r = createChildSchema.parse({ name: " Sam " });
    expect(r).toEqual({ name: "Sam", dateOfBirth: null });
  });
  it("create: with dob", () => expect(createChildSchema.parse({ name: "Sam", dateOfBirth: "2014-03-02" }).dateOfBirth).toBe("2014-03-02"));
  it("create: rejects bad name / dob", () => {
    expect(createChildSchema.safeParse({ name: "" }).success).toBe(false);
    expect(createChildSchema.safeParse({ name: "Sam", dateOfBirth: "nope" }).success).toBe(false);
  });
  it("create ignores unknown keys (no family_id / ownership injection)", () => {
    const r = createChildSchema.parse({ name: "Sam", family_id: ID, familyId: ID }) as Record<string, unknown>;
    expect(r.family_id).toBeUndefined();
    expect(r.familyId).toBeUndefined();
  });
  it("update: requires uuid id", () => {
    expect(updateChildSchema.safeParse({ id: "1", name: "Sam" }).success).toBe(false);
    expect(updateChildSchema.safeParse({ id: ID, name: "Sam" }).success).toBe(true);
  });
  it("update: omitted avatar stays undefined, empty avatar clears", () => {
    expect(updateChildSchema.parse({ id: ID, name: "Sam" }).avatarUrl).toBeUndefined();
    expect(updateChildSchema.parse({ id: ID, name: "Sam", avatarUrl: "" }).avatarUrl).toBeNull();
  });
  it("delete needs uuid + confirm", () => {
    expect(deleteChildSchema.safeParse({ id: ID }).success).toBe(false);
    expect(deleteChildSchema.safeParse({ id: "x", confirm: "delete" }).success).toBe(false);
    expect(deleteChildSchema.safeParse({ id: ID, confirm: "delete" }).success).toBe(true);
  });
});
