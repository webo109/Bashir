import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_AGE_SECONDS = 30 * 24 * 3600;
export const COOKIE_NAME = "bashir-session";

export function signSession(secret: string, iat: number): string {
  const sig = createHmac("sha256", secret).update(String(iat)).digest("hex");
  return `${iat}.${sig}`;
}

export function verifySession(
  secret: string,
  cookie: string | undefined | null,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  if (!cookie || !cookie.includes(".")) return false;
  const [iatStr, sig] = cookie.split(".", 2);
  const iat = Number(iatStr);
  if (!Number.isFinite(iat)) return false;
  if (iat + MAX_AGE_SECONDS < nowSeconds) return false;

  const expected = createHmac("sha256", secret).update(String(iat)).digest("hex");
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export function newSession(secret: string): string {
  return signSession(secret, Math.floor(Date.now() / 1000));
}

export function constantTimePasswordCheck(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  if (A.length !== B.length) return false;
  return timingSafeEqual(A, B);
}
