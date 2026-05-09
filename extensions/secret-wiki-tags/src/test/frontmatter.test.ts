import test from "node:test";
import assert from "node:assert/strict";
import { extractTagOccurrences, isInTagsValueContext } from "../frontmatter";

test("extracts block list tags from frontmatter only", () => {
  const tags = extractTagOccurrences([
    "---",
    "title: Test",
    "tags:",
    "  - wiki",
    "  - LLM",
    "---",
    "- not-a-tag"
  ].join("\n"));

  assert.deepEqual(tags.map((tag) => tag.value), ["wiki", "LLM"]);
  assert.deepEqual(tags[1]?.range.start, { line: 4, character: 4 });
});

test("extracts inline array tags", () => {
  const tags = extractTagOccurrences("---\ntags: [wiki, \"llm\", '日本語']\n---\n");

  assert.deepEqual(tags.map((tag) => tag.value), ["wiki", "llm", "日本語"]);
});

test("extracts scalar comma-separated tags", () => {
  const tags = extractTagOccurrences("---\ntags: wiki, guide\n---\n");

  assert.deepEqual(tags.map((tag) => tag.value), ["wiki", "guide"]);
});

test("returns no tags without frontmatter or tags key", () => {
  assert.deepEqual(extractTagOccurrences("# Title\n\nNo tags"), []);
  assert.deepEqual(extractTagOccurrences("---\ntitle: Test\n---\n"), []);
});

test("detects completion context inside tags values", () => {
  const text = "---\ntags:\n  - wi\nllm_access: true\n---\n";

  assert.equal(isInTagsValueContext(text, { line: 2, character: 6 }), true);
  assert.equal(isInTagsValueContext(text, { line: 3, character: 4 }), false);
});
