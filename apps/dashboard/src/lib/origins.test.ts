import { describe, it, expect } from "vitest";
import { normalizeOrigin, parseOrigins } from "./origins";

describe("normalizeOrigin", () => {
  it("strips a path so it matches what a browser sends in Origin", () => {
    // This is the bug that silently blocked all comments: a stored full URL.
    expect(normalizeOrigin("https://site.tld/page.html")).toBe("https://site.tld");
  });

  it("strips query and hash", () => {
    expect(normalizeOrigin("https://site.tld/p?a=1#x")).toBe("https://site.tld");
  });

  it("prepends https:// when the scheme is omitted", () => {
    expect(normalizeOrigin("example.com")).toBe("https://example.com");
    expect(normalizeOrigin("example.com/path")).toBe("https://example.com");
  });

  it("preserves an explicit http scheme", () => {
    expect(normalizeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("keeps a non-default port", () => {
    expect(normalizeOrigin("https://example.com:8443/x")).toBe("https://example.com:8443");
  });

  it("drops the default port", () => {
    expect(normalizeOrigin("https://example.com:443")).toBe("https://example.com");
  });

  it("lowercases the host", () => {
    expect(normalizeOrigin("HTTPS://Example.COM")).toBe("https://example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeOrigin("  https://example.com  ")).toBe("https://example.com");
  });

  it("passes the * wildcard through untouched", () => {
    expect(normalizeOrigin("*")).toBe("*");
  });

  it("returns null for empty / whitespace-only input", () => {
    expect(normalizeOrigin("")).toBeNull();
    expect(normalizeOrigin("   ")).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(normalizeOrigin("http://")).toBeNull();
    expect(normalizeOrigin(":::")).toBeNull();
  });
});

describe("parseOrigins", () => {
  it("splits on newlines and commas", () => {
    expect(parseOrigins("a.com\nb.com, c.com")).toEqual([
      "https://a.com",
      "https://b.com",
      "https://c.com",
    ]);
  });

  it("normalizes and dedupes entries that collapse to the same origin", () => {
    expect(parseOrigins("https://x.com/a\nhttps://x.com/b\nx.com")).toEqual(["https://x.com"]);
  });

  it("drops unparseable and empty entries", () => {
    expect(parseOrigins("good.com\n\n:::,\n  ")).toEqual(["https://good.com"]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseOrigins("")).toEqual([]);
  });

  it("keeps the wildcard alongside real origins", () => {
    expect(parseOrigins("*\nexample.com")).toEqual(["*", "https://example.com"]);
  });
});
