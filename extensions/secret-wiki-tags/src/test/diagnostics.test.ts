import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTagDiagnostics } from "../diagnostics";
import { parseTagConfig } from "../tagConfig";

const config = parseTagConfig(JSON.stringify({
  tags: ["wiki", "llm"],
  aliases: { LLM: "llm" }
})).config;

if (!config) {
  throw new Error("test config failed to load");
}

test("reports alias, unknown, and duplicate tags", () => {
  const diagnostics = analyzeTagDiagnostics([
    "---",
    "tags:",
    "  - wiki",
    "  - LLM",
    "  - missing",
    "  - wiki",
    "---"
  ].join("\n"), config);

  assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.kind), ["alias", "unknown", "duplicate"]);
  assert.equal(diagnostics[0]?.canonical, "llm");
  assert.equal(diagnostics[1]?.tag, "missing");
  assert.equal(diagnostics[2]?.canonical, "wiki");
});
