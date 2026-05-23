import { describe, it, expect } from "vitest";
import { sanitizePostgrestLike } from "../lib/queries";

describe("sanitizePostgrestLike", () => {
  it("drops commas (PostgREST list separator)", () => {
    expect(sanitizePostgrestLike("foo,bar")).toBe("foo bar");
  });

  it("escapes percent signs (ILIKE wildcard)", () => {
    expect(sanitizePostgrestLike("50%")).toBe("50\\%");
  });

  it("escapes underscores (ILIKE single-char wildcard)", () => {
    expect(sanitizePostgrestLike("a_b")).toBe("a\\_b");
  });

  it("drops parentheses (PostgREST grouping)", () => {
    expect(sanitizePostgrestLike("(foo)")).toBe("foo");
  });

  it("returns empty string for empty input", () => {
    expect(sanitizePostgrestLike("")).toBe("");
  });

  it("returns empty string for whitespace-only", () => {
    expect(sanitizePostgrestLike("   ")).toBe("");
  });

  it("preserves plain alphanumeric input", () => {
    expect(sanitizePostgrestLike("hello world")).toBe("hello world");
  });

  it("escapes a literal backslash so the ILIKE escape sequence is intact", () => {
    // input \  --> output \\  (one literal backslash for the user, doubled
    // so PostgREST sees a single literal backslash, not an escape lead-in).
    expect(sanitizePostgrestLike("a\\b")).toBe("a\\\\b");
  });

  it("strips colon, asterisk, and double-quote", () => {
    expect(sanitizePostgrestLike('foo:bar*baz"qux')).toBe("foo bar baz qux");
  });

  it("combines multiple problematic characters cleanly", () => {
    // `(`, `)`, `,` each become a single space; adjacent removals leave runs.
    expect(sanitizePostgrestLike("name(test),50%_a")).toBe("name test  50\\%\\_a");
  });
});
