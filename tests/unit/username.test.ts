import { describe, expect, it } from "vitest";
import { normalizeUsername } from "../../src/domain/username";

describe("username contract", () => {
  it.each([
    ["  Ahmed_123  ", "ahmed_123"],
    ["طالب١٢٣", "طالب123"],
    ["طالب۱۲۳", "طالب123"],
    ["  أحمد_١۲3\n", "أحمد_123"],
    ["ا\u0654حمد", "أحمد"],
    ["a".repeat(32), "a".repeat(32)],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeUsername(input)).toBe(expected);
    expect(normalizeUsername(expected)).toBe(expected);
  });
  it.each([
    "ab",
    "a".repeat(33),
    "a b",
    "أحـمد",
    "مُحمد",
    "abc\u200b",
    "\ufeffabc",
    "ab\u202ec",
    "abc😀",
    "abc@",
    "ＡＢＣ",
    "abc\u0000",
    "علی",
    "abc\u064b",
    "",
    null,
    123,
    {},
  ])("rejects invalid username %s", (input) =>
    expect(() => normalizeUsername(input)).toThrow(),
  );
  it("preserves distinct Arabic spelling", () => {
    expect(normalizeUsername("فاطمة")).not.toBe(normalizeUsername("فاطمه"));
    expect(normalizeUsername("على")).not.toBe(normalizeUsername("علي"));
    expect(normalizeUsername("أحمد")).not.toBe(normalizeUsername("احمد"));
  });
});
