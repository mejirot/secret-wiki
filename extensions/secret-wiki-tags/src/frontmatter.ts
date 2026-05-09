export interface TextPosition {
  readonly line: number;
  readonly character: number;
}

export interface TextRange {
  readonly start: TextPosition;
  readonly end: TextPosition;
}

export interface FrontmatterBlock {
  readonly startLine: number;
  readonly endLine: number;
  readonly lines: readonly string[];
}

export interface TagOccurrence {
  readonly value: string;
  readonly range: TextRange;
}

export function parseFrontmatter(text: string): FrontmatterBlock | undefined {
  const lines = splitLines(text);
  if (lines.length === 0 || stripBom(lines[0]).trim() !== "---") {
    return undefined;
  }

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      return {
        startLine: 0,
        endLine: index,
        lines: lines.slice(1, index)
      };
    }
  }

  return undefined;
}

export function extractTagOccurrences(text: string): TagOccurrence[] {
  const frontmatter = parseFrontmatter(text);
  if (!frontmatter) {
    return [];
  }

  const tagsLineIndex = frontmatter.lines.findIndex((line) => /^\s*tags\s*:/.test(line));
  if (tagsLineIndex < 0) {
    return [];
  }

  const line = frontmatter.lines[tagsLineIndex];
  const absoluteLine = frontmatter.startLine + 1 + tagsLineIndex;
  const tagKeyMatch = line.match(/^(\s*)tags\s*:\s*(.*)$/);
  if (!tagKeyMatch) {
    return [];
  }

  const afterColon = tagKeyMatch[2] ?? "";
  const afterColonStart = line.indexOf(":") + 1;
  if (afterColon.trimStart().startsWith("[")) {
    return parseInlineTags(line, absoluteLine, afterColonStart);
  }

  const scalar = stripYamlComment(afterColon).trim();
  if (scalar) {
    return parseScalarTags(line, absoluteLine, afterColonStart, afterColon);
  }

  return parseBlockListTags(frontmatter, tagsLineIndex, tagKeyMatch[1].length);
}

export function isInTagsValueContext(text: string, position: TextPosition): boolean {
  const frontmatter = parseFrontmatter(text);
  if (!frontmatter || position.line <= frontmatter.startLine || position.line >= frontmatter.endLine) {
    return false;
  }

  const relativeLine = position.line - frontmatter.startLine - 1;
  const tagsLineIndex = frontmatter.lines.findIndex((line) => /^\s*tags\s*:/.test(line));
  if (tagsLineIndex < 0) {
    return false;
  }

  const tagsLine = frontmatter.lines[tagsLineIndex];
  if (relativeLine === tagsLineIndex) {
    const colon = tagsLine.indexOf(":");
    return position.character > colon;
  }

  if (relativeLine < tagsLineIndex) {
    return false;
  }

  const keyIndent = (tagsLine.match(/^(\s*)/)?.[1] ?? "").length;
  for (let index = tagsLineIndex + 1; index < frontmatter.lines.length; index += 1) {
    const line = frontmatter.lines[index];
    if (line.trim() === "") {
      continue;
    }

    const indent = (line.match(/^(\s*)/)?.[1] ?? "").length;
    if (indent <= keyIndent && !line.trimStart().startsWith("-")) {
      return false;
    }

    if (index === relativeLine) {
      return /^\s*-\s*/.test(line);
    }
  }

  return false;
}

function parseBlockListTags(frontmatter: FrontmatterBlock, tagsLineIndex: number, keyIndent: number): TagOccurrence[] {
  const tags: TagOccurrence[] = [];
  for (let index = tagsLineIndex + 1; index < frontmatter.lines.length; index += 1) {
    const line = frontmatter.lines[index];
    if (line.trim() === "") {
      continue;
    }

    const indent = (line.match(/^(\s*)/)?.[1] ?? "").length;
    if (indent <= keyIndent && !line.trimStart().startsWith("-")) {
      break;
    }

    const itemMatch = line.match(/^(\s*)-\s*(.*)$/);
    if (!itemMatch) {
      break;
    }

    const rawValue = stripYamlComment(itemMatch[2] ?? "");
    const value = unquoteYamlScalar(rawValue.trim());
    if (!value) {
      continue;
    }

    const rawStart = line.indexOf(itemMatch[2] ?? "");
    const leadingWhitespace = (itemMatch[2] ?? "").search(/\S/);
    const valueStart = rawStart + Math.max(leadingWhitespace, 0);
    const quoteOffset = startsWithQuote(line[valueStart]) ? 1 : 0;
    tags.push({
      value,
      range: {
        start: { line: frontmatter.startLine + 1 + index, character: valueStart + quoteOffset },
        end: { line: frontmatter.startLine + 1 + index, character: valueStart + quoteOffset + value.length }
      }
    });
  }

  return tags;
}

function parseInlineTags(line: string, lineNumber: number, afterColonStart: number): TagOccurrence[] {
  const openBracket = line.indexOf("[", afterColonStart);
  const closeBracket = findClosingBracket(line, openBracket);
  if (openBracket < 0 || closeBracket < 0) {
    return [];
  }

  return parseCommaSeparated(line.slice(openBracket + 1, closeBracket), lineNumber, openBracket + 1);
}

function parseScalarTags(line: string, lineNumber: number, afterColonStart: number, afterColon: string): TagOccurrence[] {
  const uncommented = stripYamlComment(afterColon);
  return parseCommaSeparated(uncommented, lineNumber, afterColonStart);
}

function parseCommaSeparated(value: string, lineNumber: number, offset: number): TagOccurrence[] {
  const tags: TagOccurrence[] = [];
  let tokenStart = 0;
  let quote: string | undefined;

  for (let index = 0; index <= value.length; index += 1) {
    const char = value[index];
    if ((char === "\"" || char === "'") && value[index - 1] !== "\\") {
      quote = quote === char ? undefined : quote ?? char;
    }

    if ((char === "," && !quote) || index === value.length) {
      const raw = value.slice(tokenStart, index);
      const leading = raw.search(/\S/);
      const trimmed = raw.trim();
      if (trimmed) {
        const unquoted = unquoteYamlScalar(trimmed);
        const rawStart = offset + tokenStart + Math.max(leading, 0);
        const quoteOffset = startsWithQuote(value[tokenStart + Math.max(leading, 0)]) ? 1 : 0;
        tags.push({
          value: unquoted,
          range: {
            start: { line: lineNumber, character: rawStart + quoteOffset },
            end: { line: lineNumber, character: rawStart + quoteOffset + unquoted.length }
          }
        });
      }
      tokenStart = index + 1;
    }
  }

  return tags;
}

function findClosingBracket(line: string, openBracket: number): number {
  let quote: string | undefined;
  for (let index = openBracket + 1; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "\"" || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? undefined : quote ?? char;
    } else if (char === "]" && !quote) {
      return index;
    }
  }

  return -1;
}

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function stripBom(value: string): string {
  return value.replace(/^\uFEFF/, "");
}

function stripYamlComment(value: string): string {
  let quote: string | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === "\"" || char === "'") && value[index - 1] !== "\\") {
      quote = quote === char ? undefined : quote ?? char;
    }
    if (char === "#" && !quote && (index === 0 || /\s/.test(value[index - 1] ?? ""))) {
      return value.slice(0, index);
    }
  }

  return value;
}

function unquoteYamlScalar(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function startsWithQuote(value: string | undefined): boolean {
  return value === "\"" || value === "'";
}
