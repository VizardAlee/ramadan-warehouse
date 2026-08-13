import { describe, expect, it } from "vitest";
import {
  isSupportedNigerianMobile,
  toFirebasePhoneNumber,
} from "../functions/src/utils/nigerian-phone";

describe("Nigerian user phone numbers", () => {
  it("accepts local 070 format and normalizes it for Firebase Auth", () => {
    expect(isSupportedNigerianMobile("07032545288")).toBe(true);
    expect(toFirebasePhoneNumber("07032545288")).toBe("+2347032545288");
  });

  it("preserves an already international Nigerian mobile number", () => {
    expect(isSupportedNigerianMobile("+2347032545288")).toBe(true);
    expect(toFirebasePhoneNumber("+2347032545288")).toBe("+2347032545288");
  });

  it("keeps an omitted phone number optional", () => {
    expect(toFirebasePhoneNumber(undefined)).toBeUndefined();
    expect(isSupportedNigerianMobile("7032545288")).toBe(false);
  });
});
