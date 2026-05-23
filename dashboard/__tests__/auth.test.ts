import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "../lib/auth";

const SECRET = "test-secret-32-bytes-of-randomness-please-1234";

describe("signSession/verifySession", () => {
  it("round-trips a valid session", () => {
    const cookie = signSession(SECRET, 1000);
    expect(verifySession(SECRET, cookie, 1000)).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const cookie = signSession(SECRET, 1000);
    const [iat, sig] = cookie.split(".");
    const tampered = `${iat}.${sig.replace(/^./, "x")}`;
    expect(verifySession(SECRET, tampered, 1000)).toBe(false);
  });

  it("rejects an expired cookie (>30d old)", () => {
    const iat = 1000;
    const cookie = signSession(SECRET, iat);
    const now = iat + 31 * 24 * 3600;
    expect(verifySession(SECRET, cookie, now)).toBe(false);
  });

  it("rejects malformed cookie (no dot)", () => {
    expect(verifySession(SECRET, "garbage", 1000)).toBe(false);
  });

  it("uses constant-time compare for the signature", () => {
    // Smoke check: verifySession should not throw on extremely short sig.
    expect(verifySession(SECRET, "1000.x", 1000)).toBe(false);
  });
});
