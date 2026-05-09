import test from "node:test";
import assert from "node:assert/strict";
import { parseTagConfig } from "../tagConfig";

test("loads valid tag config", () => {
  const result = parseTagConfig(JSON.stringify({
    tags: ["wiki", "llm"],
    aliases: { LLM: "llm" }
  }));

  assert.equal(result.problems.length, 0);
  assert.deepEqual(result.config?.tags, ["wiki", "llm"]);
  assert.equal(result.config?.aliases.get("LLM"), "llm");
});

test("reports invalid JSON", () => {
  const result = parseTagConfig("{");

  assert.equal(result.config, undefined);
  assert.match(result.problems[0]?.message ?? "", /Invalid tag config JSON/);
});

test("reports duplicate tags and unknown alias targets", () => {
  const result = parseTagConfig(JSON.stringify({
    tags: ["wiki", "wiki"],
    aliases: { WIKI: "missing" }
  }));

  assert.equal(result.config, undefined);
  assert.match(result.problems.map((problem) => problem.message).join("\n"), /Duplicate canonical tag: wiki/);
  assert.match(result.problems.map((problem) => problem.message).join("\n"), /unknown canonical tag: missing/);
});
