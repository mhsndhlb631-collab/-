import { describe, expect, it } from "vitest";
import { peopleRequest } from "../../src/application/people-service";

describe("people management request", () => {
  it("allows a student profile without forcing a login account", () => {
    expect(
      peopleRequest.safeParse({
        mode: "STUDENT_WITHOUT_ACCOUNT",
        display_name: "طالب تجريبي",
        contact_phone: null,
      }).success,
    ).toBe(true);
  });

  it("requires role and login name when an account is requested", () => {
    expect(
      peopleRequest.safeParse({
        mode: "ACCOUNT",
        display_name: "مربي تجريبي",
        contact_phone: null,
      }).success,
    ).toBe(false);
    expect(
      peopleRequest.safeParse({
        mode: "ACCOUNT",
        role: "MENTOR",
        display_name: "مربي تجريبي",
        contact_phone: null,
        login_name: "mentor_01",
      }).success,
    ).toBe(true);
  });

  it("rejects unsupported account roles and malformed contact data", () => {
    expect(
      peopleRequest.safeParse({
        mode: "ACCOUNT",
        role: "RESPONSIBLE",
        display_name: "مسؤول آخر",
        contact_phone: null,
        login_name: "responsible_02",
      }).success,
    ).toBe(false);
    expect(
      peopleRequest.safeParse({
        mode: "STUDENT_WITHOUT_ACCOUNT",
        display_name: "طالب",
        contact_phone: "12",
      }).success,
    ).toBe(false);
  });
});
