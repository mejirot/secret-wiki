import { describe, expect, test } from "vitest";
import { linkCardHref, parseLinkCardHref, renderLinkCardDirectives } from "./linkCards.js";

describe("link card helpers", () => {
  test("renders an http link card directive as an internal markdown link", () => {
    const rendered = renderLinkCardDirectives("::link-card[secret-wiki GitHub](https://github.com/mejirot/secret-wiki)");

    expect(rendered).toBe(`[secret-wiki GitHub](${linkCardHref("https://github.com/mejirot/secret-wiki")})`);
  });

  test("supports Japanese labels", () => {
    const rendered = renderLinkCardDirectives("::link-card[秘密Wiki](https://example.com/wiki)");

    expect(rendered).toBe(`[秘密Wiki](${linkCardHref("https://example.com/wiki")})`);
  });

  test("renders multiple standalone directives", () => {
    const rendered = renderLinkCardDirectives(
      [
        "::link-card[One](https://one.example/)",
        "",
        "::link-card[Two](https://two.example/path)"
      ].join("\n")
    );

    expect(rendered).toContain(`[One](${linkCardHref("https://one.example/")})`);
    expect(rendered).toContain(`[Two](${linkCardHref("https://two.example/path")})`);
  });

  test("leaves unsupported urls unchanged", () => {
    const source = "::link-card[Mail](mailto:hello@example.com)";

    expect(renderLinkCardDirectives(source)).toBe(source);
  });

  test("parses internal card hrefs into display data", () => {
    expect(parseLinkCardHref(linkCardHref("https://www.github.com/mejirot/secret-wiki"))).toEqual({
      label: "",
      url: "https://www.github.com/mejirot/secret-wiki",
      host: "github.com"
    });
  });
});
