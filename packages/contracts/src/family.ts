// Family/child contracts shared by the web app (server actions) and docs. Server is always authoritative.
// Column limits mirror supabase/migrations/20260929000200_identity.sql.
import { z } from "zod";

export const FAMILY_NAME_MAX = 100;
export const CHILD_NAME_MAX = 100;
export const AVATAR_URL_MAX = 2048;
export const DOB_MIN = "1900-01-01";

export const idSchema = z.string().uuid("Invalid id");

const nameOf = (label: string, max: number) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} is too long (max ${max} characters)`);

export const familyNameSchema = nameOf("Family name", FAMILY_NAME_MAX);
export const childNameSchema = nameOf("Name", CHILD_NAME_MAX);

const emptyToNull = (v: unknown): unknown => (typeof v === "string" && v.trim() === "" ? null : v);

/** True for a real calendar date written as YYYY-MM-DD (rejects 2020-02-31, 2020-13-01, ...). */
export function isRealIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Latest accepted date of birth: tomorrow (UTC), so a parent ahead of UTC can still enter "today". */
function latestDob(now: Date): string {
  return new Date(now.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Optional date of birth. Empty string → null (clears). Personal data: never put it in URLs or logs. */
export const dateOfBirthSchema = z.preprocess(
  emptyToNull,
  z
    .string()
    .refine(isRealIsoDate, "Enter a valid date")
    .refine((s) => s >= DOB_MIN, "Enter a valid date")
    .refine((s) => s <= latestDob(new Date()), "Date of birth can't be in the future")
    .nullable(),
);

/** Optional avatar URL: https only, no embedded credentials. (The CSP currently blocks remote images; see docs/SECURITY.md.) */
export const avatarUrlSchema = z.preprocess(
  emptyToNull,
  z
    .string()
    .max(AVATAR_URL_MAX, "URL is too long")
    .refine((s) => {
      try {
        const u = new URL(s);
        return u.protocol === "https:" && !u.username && !u.password && u.hostname.length > 0;
      } catch {
        return false;
      }
    }, "Enter an https:// URL")
    .nullable(),
);

export const createFamilySchema = z.object({ name: familyNameSchema });
export const renameFamilySchema = z.object({ name: familyNameSchema });
/** `confirm` proves the request came from the confirmation dialog. */
export const deleteFamilySchema = z.object({ confirm: z.literal("delete") });

export const createChildSchema = z.object({
  name: childNameSchema,
  dateOfBirth: dateOfBirthSchema.default(null),
  avatarUrl: avatarUrlSchema.optional(), // undefined = not provided
});

/** Omitted `avatarUrl` leaves the stored value untouched; empty string clears it. `dateOfBirth` is always applied (form always sends it). */
export const updateChildSchema = z.object({
  id: idSchema,
  name: childNameSchema,
  dateOfBirth: dateOfBirthSchema.default(null),
  avatarUrl: avatarUrlSchema.optional(),
});

export const deleteChildSchema = z.object({ id: idSchema, confirm: z.literal("delete") });

export type CreateChildInput = z.infer<typeof createChildSchema>;
export type UpdateChildInput = z.infer<typeof updateChildSchema>;
