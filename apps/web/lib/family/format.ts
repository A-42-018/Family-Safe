// Pure display helpers for children. Date of birth is personal data: only an age is ever rendered in lists.

/** Whole years between an ISO date (YYYY-MM-DD) and `now`; null when missing/invalid/future. */
export function ageFromDob(dob: string | null | undefined, now: Date = new Date()): number | null {
  if (!dob) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)) age--;
  return age >= 0 && age <= 130 ? age : null;
}

export function formatAge(age: number | null): string {
  if (age === null) return "Age not set";
  if (age < 1) return "Under 1 year old";
  return age === 1 ? "1 year old" : `${age} years old`;
}

/** Up to two initials for the avatar circle; never empty. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

export function deviceCountLabel(n: number): string {
  return n === 0 ? "No devices yet" : n === 1 ? "1 device" : `${n} devices`;
}
