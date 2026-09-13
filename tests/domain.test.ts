import assert from "node:assert/strict";
import { test } from "node:test";

import { PublishRequestSchema } from "../lib/domain";

function accepts(provider: "x" | "linkedin", text: string): boolean {
  return PublishRequestSchema.safeParse({ destinations: [{ provider, text }] }).success;
}

test("X rejects posts whose emoji exceed the weighted limit", () => {
  assert.equal(accepts("x", "😀".repeat(141)), false);
  assert.equal(accepts("x", "😀".repeat(140)), true);
});

test("X counts a long URL as 23 characters", () => {
  assert.equal(accepts("x", `${"a".repeat(256)} https://example.com/${"b".repeat(100)}`), true);
});

test("X normalizes combining marks and rejects invalid text", () => {
  assert.equal(accepts("x", "e\u0301".repeat(280)), true);
  assert.equal(accepts("x", "bad\uFFFEtext"), false);
});

test("publishing validates every destination before delivery", () => {
  assert.equal(PublishRequestSchema.safeParse({ destinations: [] }).success, false);
  assert.equal(PublishRequestSchema.safeParse({ destinations: [{ provider: "x", text: "ok" }, { provider: "x", text: "again" }] }).success, false);
  assert.equal(PublishRequestSchema.safeParse({ destinations: [{ provider: "x", text: "ok" }, { provider: "linkedin", text: " " }] }).success, false);
  assert.equal(accepts("linkedin", "a".repeat(3000)), true);
  assert.equal(accepts("linkedin", "a".repeat(3001)), false);
});
