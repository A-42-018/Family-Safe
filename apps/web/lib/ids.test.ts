import { describe, expect, it } from "vitest";
import { isUuid } from "./ids";

describe("isUuid", () => {
  it.each(["2b1f6c1e-5a44-4c3e-9d0a-1f2e3d4c5b6a", "2B1F6C1E-5A44-4C3E-9D0A-1F2E3D4C5B6A"])("accepts %s", (v) => expect(isUuid(v)).toBe(true));
  it.each(["", "abc", "../etc/passwd", "2b1f6c1e-5a44-4c3e-9d0a-1f2e3d4c5b6", "2b1f6c1e-5a44-4c3e-9d0a-1f2e3d4c5b6a1", "<script>", "2b1f6c1e5a444c3e9d0a1f2e3d4c5b6a", "2b1f6c1e-5a44-4c3e-9d0a-1f2e3d4c5b6a\n"])(
    "rejects %j",
    (v) => expect(isUuid(v)).toBe(false),
  );
});
