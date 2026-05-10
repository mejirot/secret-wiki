import plantumlEncoder from "plantuml-encoder";

export const defaultPlantUmlServerUrl = "https://www.plantuml.com/plantuml";

export function normalizePlantUmlServerUrl(serverUrl = defaultPlantUmlServerUrl) {
  const normalized = serverUrl.trim().replace(/\/+$/, "");
  return normalized || defaultPlantUmlServerUrl;
}

export function isPlantUmlLanguage(className?: string) {
  return /\blanguage-plantuml\b/i.test(className ?? "");
}

export function buildPlantUmlSvgUrl(source: string, serverUrl = defaultPlantUmlServerUrl) {
  return `${normalizePlantUmlServerUrl(serverUrl)}/svg/${plantumlEncoder.encode(source)}`;
}
