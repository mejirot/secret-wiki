import { describe, expect, test } from "vitest";
import { extractHeadingToc, headingSlug, plainHeadingText } from "./headingToc.js";

describe("heading toc helpers", () => {
  test("extracts Japanese h1 through h3 headings", () => {
    const toc = extractHeadingToc(
      [
        "# 日本語の見出し",
        "",
        "本文は目次に含めない",
        "## 手順1. 準備する(必須)",
        "### 詳細",
        "#### 対象外"
      ].join("\n")
    );

    expect(toc.map(({ depth, text }) => ({ depth, text }))).toEqual([
      { depth: 1, text: "日本語の見出し" },
      { depth: 2, text: "手順1. 準備する(必須)" },
      { depth: 3, text: "詳細" }
    ]);
    expect(toc.map((heading) => heading.id)).toEqual(["日本語の見出し", "手順1-準備する必須", "詳細"]);
  });

  test("adds stable suffixes for duplicate headings", () => {
    const toc = extractHeadingToc(["# Setup", "## Setup", "### Setup"].join("\n"));

    expect(toc.map((heading) => heading.id)).toEqual(["setup", "setup-2", "setup-3"]);
  });

  test("keeps source line numbers for rendered heading ids", () => {
    const toc = extractHeadingToc(["Intro", "", "# First", "Text", "## Second"].join("\n"));

    expect(toc.map(({ text, line }) => ({ text, line }))).toEqual([
      { text: "First", line: 3 },
      { text: "Second", line: 5 }
    ]);
  });

  test("ignores headings inside fenced code blocks", () => {
    const toc = extractHeadingToc(
      [
        "# Real",
        "```md",
        "# Not real",
        "```",
        "~~~",
        "## Also not real",
        "~~~",
        "## Real child"
      ].join("\n")
    );

    expect(toc.map((heading) => heading.text)).toEqual(["Real", "Real child"]);
  });

  test("does not treat inline code-like backtick runs as fenced code blocks", () => {
    const toc = extractHeadingToc(["# Install", "```cmd```", "## Next step"].join("\n"));

    expect(toc.map((heading) => heading.text)).toEqual(["Install", "Next step"]);
  });

  test("normalizes inline markdown from heading text", () => {
    expect(plainHeadingText("`Code` and [Link](https://example.com) ###")).toBe("Code and Link");
    expect(headingSlug("A_B  C!")).toBe("a-b-c");
  });
});
