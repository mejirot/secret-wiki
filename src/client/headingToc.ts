export type HeadingDepth = 1 | 2 | 3;

export type HeadingTocItem = {
  id: string;
  depth: HeadingDepth;
  text: string;
  line: number;
};

type FenceState = {
  marker: "`" | "~";
  length: number;
};

const fencePattern = /^(?: {0,3})(`{3,}|~{3,})/;
const closingFencePattern = /^(?: {0,3})(`{3,}|~{3,})[ \t]*$/;
const atxHeadingPattern = /^(?: {0,3})(#{1,6})(?:[ \t]+|$)(.*)$/;

function fenceStateFor(line: string): FenceState | undefined {
  const match = fencePattern.exec(line);
  if (!match) {
    return undefined;
  }

  const markerRun = match[1] ?? "";
  return {
    marker: markerRun[0] as "`" | "~",
    length: markerRun.length
  };
}

function closesFence(line: string, fence: FenceState) {
  const match = closingFencePattern.exec(line);
  if (!match) {
    return false;
  }

  const markerRun = match[1] ?? "";
  return markerRun[0] === fence.marker && markerRun.length >= fence.length;
}

export function plainHeadingText(value: string) {
  return value
    .trim()
    .replace(/[ \t]+#+[ \t]*$/, "")
    .replace(/\\([\\`*_[\]{}()#+.!-])/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, target: string, label?: string) => label ?? target)
    .replace(/`([^`]*)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function headingSlug(text: string) {
  const slug = text
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s_-]+/gu, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || "heading";
}

export function uniqueHeadingId(text: string, usedIds: Map<string, number>) {
  const baseId = headingSlug(text);
  const nextCount = (usedIds.get(baseId) ?? 0) + 1;
  usedIds.set(baseId, nextCount);
  return nextCount === 1 ? baseId : `${baseId}-${nextCount}`;
}

export function extractHeadingToc(markdown: string): HeadingTocItem[] {
  const headings: HeadingTocItem[] = [];
  const usedIds = new Map<string, number>();
  let activeFence: FenceState | undefined;

  markdown.split(/\r?\n/).forEach((line, index) => {
    if (activeFence) {
      if (closesFence(line, activeFence)) {
        activeFence = undefined;
      }
      return;
    }

    const fence = fenceStateFor(line);
    if (fence) {
      activeFence = fence;
      return;
    }

    const headingMatch = atxHeadingPattern.exec(line);
    if (!headingMatch) {
      return;
    }

    const depth = headingMatch[1]?.length ?? 0;
    if (depth < 1 || depth > 3) {
      return;
    }

    const text = plainHeadingText(headingMatch[2] ?? "");
    if (!text) {
      return;
    }

    headings.push({
      id: uniqueHeadingId(text, usedIds),
      depth: depth as HeadingDepth,
      text,
      line: index + 1
    });
  });

  return headings;
}
