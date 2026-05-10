import plantumlEncoder from "plantuml-encoder";
import { describe, expect, test } from "vitest";
import { buildPlantUmlSvgUrl, defaultPlantUmlServerUrl, isPlantUmlLanguage, normalizePlantUmlServerUrl } from "./plantuml.js";

describe("plantuml helpers", () => {
  test("normalizes the PlantUML server URL", () => {
    expect(normalizePlantUmlServerUrl("https://example.test/plantuml///")).toBe("https://example.test/plantuml");
    expect(normalizePlantUmlServerUrl("  ")).toBe(defaultPlantUmlServerUrl);
  });

  test("detects plantuml fenced code language classes", () => {
    expect(isPlantUmlLanguage("language-plantuml")).toBe(true);
    expect(isPlantUmlLanguage("hljs language-plantuml")).toBe(true);
    expect(isPlantUmlLanguage("language-ts")).toBe(false);
    expect(isPlantUmlLanguage()).toBe(false);
  });

  test("builds an SVG URL with encoded PlantUML source", () => {
    const source = "@startuml\nAlice -> Bob: hello\n@enduml";
    const url = buildPlantUmlSvgUrl(source, "https://www.plantuml.com/plantuml/");
    const encoded = url.split("/").at(-1);

    expect(url).toMatch(/^https:\/\/www\.plantuml\.com\/plantuml\/svg\//);
    expect(encoded).toBeTruthy();
    expect(plantumlEncoder.decode(encoded ?? "")).toBe(source);
  });
});
