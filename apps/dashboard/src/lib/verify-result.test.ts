import { describe, it, expect } from "vitest";
import { interpretWriteResult } from "./verify-result";

describe("interpretWriteResult", () => {
  it("treats 200 as a successful write", () => {
    expect(interpretWriteResult({ status: 200, body: { status: "approved" } })).toEqual({
      writeOk: true,
      writeStatus: "ok",
    });
  });

  it("reports pending when moderation holds the comment", () => {
    expect(interpretWriteResult({ status: 200, body: { status: "pending" } })).toEqual({
      writeOk: true,
      writeStatus: "pending",
    });
  });

  it("defaults a 200 with no status to ok", () => {
    expect(interpretWriteResult({ status: 200, body: null })).toEqual({
      writeOk: true,
      writeStatus: "ok",
    });
  });

  it("treats 429 as success — it got past the origin check, just throttled", () => {
    expect(interpretWriteResult({ status: 429, body: { error: "rate_limited" } })).toEqual({
      writeOk: true,
      writeStatus: "rate_limited",
    });
  });

  it("surfaces origin_not_allowed as a write failure", () => {
    expect(interpretWriteResult({ status: 403, body: { error: "origin_not_allowed" } })).toEqual({
      writeOk: false,
      writeStatus: "origin_not_allowed",
    });
  });

  it("maps captcha_failed to captcha_required", () => {
    expect(interpretWriteResult({ status: 403, body: { error: "captcha_failed" } })).toEqual({
      writeOk: false,
      writeStatus: "captcha_required",
    });
  });

  it("surfaces unknown_site", () => {
    expect(interpretWriteResult({ status: 404, body: { error: "unknown_site" } })).toEqual({
      writeOk: false,
      writeStatus: "unknown_site",
    });
  });

  it("falls back to a generic error for unrecognized failures", () => {
    expect(interpretWriteResult({ status: 500, body: { error: "boom" } })).toEqual({
      writeOk: false,
      writeStatus: "error",
    });
    expect(interpretWriteResult({ status: 0, body: null })).toEqual({
      writeOk: false,
      writeStatus: "error",
    });
  });
});
