import assert from "node:assert/strict";
import { test } from "node:test";

import { applyDeliveryResults, createDraft, DraftSchema, StageDraftRequestSchema, stagedDraft } from "../lib/draft";
import { countPostCharacters, hasLink, linkedInPlainText, previewSegments, xComposerUrl } from "../lib/text";

test("new drafts contain no sample copy and retain the entire message", () => {
  assert.equal(createDraft().shared, "");
  const message = "😀".repeat(300);
  assert.equal(createDraft(message).x, message);
  assert.equal(createDraft(message).linkedin, message);
});

test("partial delivery leaves only the failed network selected for retry", () => {
  const draft = applyDeliveryResults(createDraft("Hello"), [
    { kind: "published", provider: "x", postUrl: "https://x.com/i/status/123" },
    { kind: "failed", provider: "linkedin", message: "Rejected", reconnect: false },
  ]);
  assert.deepEqual(draft.selection, { x: false, linkedin: true });
  assert.deepEqual(DraftSchema.parse(JSON.parse(JSON.stringify(draft))).selection, draft.selection);
  assert.equal(draft.shared, "Hello");
});

test("unconfirmed deliveries are deselected until the user checks their feed", () => {
  const draft = applyDeliveryResults(createDraft("Hello"), [
    { kind: "uncertain", provider: "x", message: "Check your feed" },
    { kind: "published", provider: "linkedin", postUrl: "https://www.linkedin.com/feed/update/urn:li:share:123" },
  ]);
  assert.deepEqual(draft.selection, { x: false, linkedin: false });
});

test("editor counts match the limits used to validate provider requests", () => {
  assert.equal(countPostCharacters("x", "😀".repeat(140)), 280);
  assert.equal(countPostCharacters("x", "👨‍👩‍👧‍👦"), 2);
  assert.equal(countPostCharacters("x", "https://example.com/a-long-link"), 23);
  assert.equal(countPostCharacters("linkedin", "😀"), 2);
});

test("LinkedIn sends punctuation as literal text", () => {
  assert.equal(linkedInPlainText("* shipped [v1] (today) #release @you"), "\\* shipped \\[v1\\] \\(today\\) \\#release \\@you");
  assert.equal(linkedInPlainText("https://example.com/path\nnext line"), "https://example.com/path\nnext line");
  assert.equal(linkedInPlainText("\\"), "\\\\");
});

test("previews mark what each network links", () => {
  const text = " 😀 thanks @you #ship https://example.com/a ";
  const entities = (provider: "x" | "linkedin") => previewSegments(provider, text).filter((segment) => segment.kind === "entity").map((segment) => segment.value);
  assert.deepEqual(entities("x"), ["@you", "#ship", "https://example.com/a"]);
  assert.deepEqual(entities("linkedin"), ["https://example.com/a"]);
  assert.equal(previewSegments("x", text).map((segment) => segment.value).join(""), text.trim());
  assert.deepEqual(previewSegments("linkedin", "  "), []);
});

test("staged drafts tailor only when the agent sends a separate X version", () => {
  const shared = stagedDraft(StageDraftRequestSchema.parse({ text: " One post " }));
  assert.deepEqual(shared, createDraft("One post"));
  const tailored = stagedDraft(StageDraftRequestSchema.parse({ text: "Long", x: "Short", providers: ["linkedin"] }));
  assert.deepEqual(tailored, { shared: "Long", x: "Short", linkedin: "Long", tailored: true, selection: { x: false, linkedin: true } });
  assert.equal(StageDraftRequestSchema.safeParse({ text: "Hi", providers: ["x", "x"] }).success, false);
});

test("X's composer link carries the exact post text", () => {
  const text = " Fixed it & shipped #release 🎉\nhttps://example.com/a?b=1 ";
  const url = new URL(xComposerUrl(text));
  assert.equal(url.origin + url.pathname, "https://x.com/intent/post");
  assert.equal(url.searchParams.get("text"), text.trim());
  assert.equal(hasLink(text), true);
  assert.equal(hasLink("no links here"), false);
});
