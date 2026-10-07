// Tiny assert helpers on node:assert (no JSR/network dependency).
import nodeAssert from "node:assert/strict";

export function assert(cond: unknown, msg?: string): asserts cond { nodeAssert.ok(cond, msg); }
export function assertEquals<T>(actual: T, expected: T): void { nodeAssert.deepStrictEqual(actual, expected); }
export function assertThrows<E extends Error>(fn: () => unknown, cls: new (...a: never[]) => E = Error as never): E {
  try { fn(); } catch (e) { nodeAssert.ok(e instanceof cls, `unexpected error type: ${(e as Error)?.name}`); return e as E; }
  throw new Error("expected function to throw");
}
export async function assertRejects<E extends Error>(fn: () => Promise<unknown>, cls: new (...a: never[]) => E = Error as never): Promise<E> {
  try { await fn(); } catch (e) { nodeAssert.ok(e instanceof cls, `unexpected error type: ${(e as Error)?.name}`); return e as E; }
  throw new Error("expected promise to reject");
}

/** Unsigned-looking JWT for tests where verification is mocked (the signature is never checked locally). */
export function fakeJwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}.c2ln`;
}
