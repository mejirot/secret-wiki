import { describe, expect, test } from "vitest";
import { extractHeadingToc, headingSlug, plainHeadingText } from "./headingToc.js";

describe("heading toc helpers", () => {
  test("extracts Japanese h1 through h3 headings", () => {
    const toc = extractHeadingToc(
      [
        "# CodexもグローバルでのMCPの設定は可能",
        "",
        "本文",
        "## やり方1. クラウド上で解決してもらう(非推奨)",
        "### 詳細",
        "#### 対象外"
      ].join("\n")
    );

    expect(toc).toEqual([
      {
        id: "codexもグローバルでのmcpの設定は可能",
        depth: 1,
        text: "CodexもグローバルでのMCPの設定は可能",
        line: 1
      },
      {
        id: "やり方1-クラウド上で解決してもらう非推奨",
        depth: 2,
        text: "やり方1. クラウド上で解決してもらう(非推奨)",
        line: 4
      },
      {
        id: "詳細",
        depth: 3,
        text: "詳細",
        line: 5
      }
    ]);
  });

  test("adds stable suffixes for duplicate headings", () => {
    const toc = extractHeadingToc(["# Setup", "## Setup", "### Setup"].join("\n"));

    expect(toc.map((heading) => heading.id)).toEqual(["setup", "setup-2", "setup-3"]);
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

  test("normalizes inline markdown from heading text", () => {
    expect(plainHeadingText("`Code` and [Link](https://example.com) ###")).toBe("Code and Link");
    expect(headingSlug("A_B  C!")).toBe("a-b-c");
  });
});
