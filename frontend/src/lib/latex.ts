import type { BodyFormat } from "../types";

export interface LatexBodyNormalizationResult {
  body: string;
  matchedExpressions: number;
  changedExpressions: number;
}

interface TextNormalizationResult {
  text: string;
  matchedExpressions: number;
  changedExpressions: number;
}

interface TextSegment {
  text: string;
  isCode: boolean;
}

interface DelimitedMathMatch {
  index: number;
  fullMatch: string;
  innerText: string;
  openDelimiter: string;
  closeDelimiter: string;
}

const latexAccentCommands = new Set([
  "\\acute",
  "\\bar",
  "\\breve",
  "\\check",
  "\\ddot",
  "\\dot",
  "\\grave",
  "\\hat",
  "\\overline",
  "\\tilde",
  "\\vec",
  "\\widehat",
  "\\widetilde",
]);

const latexScriptFontShorthandLabels = new Map<string, string>([
  ["\\cal", "cal"],
  ["\\bf", "bf"],
  ["\\it", "it"],
  ["\\rm", "rm"],
  ["\\sf", "sf"],
  ["\\tt", "tt"],
]);

const blockMathPattern = /(\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])/;
const inlineMathPattern = /(\\\((.+?)\\\)|\$([^$\n]+?)\$)/;

export function normalizeLatexInBody(body: string, bodyFormat: BodyFormat): LatexBodyNormalizationResult {
  return bodyFormat === "html" ? normalizeHtmlLatex(body) : normalizeMarkdownLatex(body);
}

function normalizeMarkdownLatex(body: string): LatexBodyNormalizationResult {
  const normalizedBody = normalizeLineEndings(body);
  const codeFenceSegments = splitMarkdownCodeFenceSegments(normalizedBody);
  let matchedExpressions = 0;
  let changedExpressions = 0;

  const nextBody = codeFenceSegments
    .map((segment) => {
      if (segment.isCode) {
        return segment.text;
      }

      const inlineCodeSegments = splitInlineCodeSegments(segment.text);
      return inlineCodeSegments
        .map((inlineSegment) => {
          if (inlineSegment.isCode) {
            return inlineSegment.text;
          }

          const normalizedSegment = normalizeDelimitedMathText(inlineSegment.text);
          matchedExpressions += normalizedSegment.matchedExpressions;
          changedExpressions += normalizedSegment.changedExpressions;
          return normalizedSegment.text;
        })
        .join("");
    })
    .join("");

  return {
    body: nextBody,
    matchedExpressions,
    changedExpressions,
  };
}

function normalizeHtmlLatex(body: string): LatexBodyNormalizationResult {
  let matchedExpressions = 0;
  let changedExpressions = 0;

  const nextBody = body.replace(/<[^>]+>/g, (tag) => {
    if (!/data-math-expression\s*=/.test(tag)) {
      return tag;
    }

    const formatMatch = tag.match(/data-math-format\s*=\s*(["'])(.*?)\1/i);
    if (formatMatch && formatMatch[2].trim().toLowerCase() === "mathml") {
      return tag;
    }

    return tag.replace(/(data-math-expression\s*=\s*)(["'])([\s\S]*?)\2/i, (_match, prefix, quote, rawValue) => {
      matchedExpressions += 1;
      const decodedValue = decodeHtmlAttribute(rawValue);
      const normalizedValue = normalizeLatexExpression(decodedValue);
      if (normalizedValue !== decodedValue) {
        changedExpressions += 1;
      }

      return `${prefix}${quote}${escapeHtmlAttribute(normalizedValue, quote)}${quote}`;
    });
  });

  return {
    body: nextBody,
    matchedExpressions,
    changedExpressions,
  };
}

function splitMarkdownCodeFenceSegments(markdown: string): TextSegment[] {
  const lines = markdown.match(/.*(?:\n|$)/g) ?? [markdown];
  const segments: TextSegment[] = [];
  let current = "";
  let inFence = false;
  let fenceDelimiter = "";

  lines.forEach((line) => {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);

    if (!inFence && fenceMatch) {
      if (current) {
        segments.push({ text: current, isCode: false });
      }

      current = line;
      inFence = true;
      fenceDelimiter = fenceMatch[1];
      return;
    }

    if (inFence) {
      current += line;

      if (
        fenceMatch &&
        fenceMatch[1][0] === fenceDelimiter[0] &&
        fenceMatch[1].length >= fenceDelimiter.length
      ) {
        segments.push({ text: current, isCode: true });
        current = "";
        inFence = false;
        fenceDelimiter = "";
      }

      return;
    }

    current += line;
  });

  if (current) {
    segments.push({ text: current, isCode: inFence });
  }

  return segments;
}

function splitInlineCodeSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let index = 0;

  while (index < text.length) {
    const startIndex = text.indexOf("`", index);
    if (startIndex === -1) {
      segments.push({ text: text.slice(index), isCode: false });
      break;
    }

    let delimiterEnd = startIndex;
    while (delimiterEnd < text.length && text[delimiterEnd] === "`") {
      delimiterEnd += 1;
    }

    const delimiter = text.slice(startIndex, delimiterEnd);
    const endIndex = text.indexOf(delimiter, delimiterEnd);
    if (endIndex === -1) {
      segments.push({ text: text.slice(index), isCode: false });
      break;
    }

    if (startIndex > index) {
      segments.push({ text: text.slice(index, startIndex), isCode: false });
    }

    segments.push({ text: text.slice(startIndex, endIndex + delimiter.length), isCode: true });
    index = endIndex + delimiter.length;
  }

  return segments;
}

function normalizeDelimitedMathText(text: string): TextNormalizationResult {
  let remaining = text;
  let matchedExpressions = 0;
  let changedExpressions = 0;
  const pieces: string[] = [];

  while (remaining.length > 0) {
    const nextMatch = findNextDelimitedMathMatch(remaining);
    if (!nextMatch) {
      pieces.push(remaining);
      break;
    }

    if (nextMatch.index > 0) {
      pieces.push(remaining.slice(0, nextMatch.index));
    }

    matchedExpressions += 1;
    const rebuiltMatch = rebuildDelimitedMathMatch(nextMatch);
    if (rebuiltMatch !== nextMatch.fullMatch) {
      changedExpressions += 1;
    }

    pieces.push(rebuiltMatch);
    remaining = remaining.slice(nextMatch.index + nextMatch.fullMatch.length);
  }

  return {
    text: pieces.join(""),
    matchedExpressions,
    changedExpressions,
  };
}

function findNextDelimitedMathMatch(source: string): DelimitedMathMatch | null {
  const blockMatch = blockMathPattern.exec(source);
  const inlineMatch = inlineMathPattern.exec(source);

  if (!blockMatch && !inlineMatch) {
    return null;
  }

  if (!inlineMatch || (blockMatch && blockMatch.index <= inlineMatch.index)) {
    return buildDelimitedMathMatch(blockMatch, "$$", "$$", "\\[", "\\]");
  }

  return buildDelimitedMathMatch(inlineMatch, "\\(", "\\)", "$", "$");
}

function buildDelimitedMathMatch(
  match: RegExpExecArray | null,
  primaryOpenDelimiter: string,
  primaryCloseDelimiter: string,
  fallbackOpenDelimiter: string,
  fallbackCloseDelimiter: string,
): DelimitedMathMatch | null {
  if (!match) {
    return null;
  }

  const usesPrimaryCapture = match[2] !== undefined;
  const innerText = match[2] ?? match[3] ?? "";
  return {
    index: match.index,
    fullMatch: match[0],
    innerText,
    openDelimiter: usesPrimaryCapture ? primaryOpenDelimiter : fallbackOpenDelimiter,
    closeDelimiter: usesPrimaryCapture ? primaryCloseDelimiter : fallbackCloseDelimiter,
  };
}

function rebuildDelimitedMathMatch(match: DelimitedMathMatch): string {
  const leadingWhitespace = match.innerText.match(/^\s*/)?.[0] ?? "";
  const trailingWhitespace = match.innerText.match(/\s*$/)?.[0] ?? "";
  const expression = match.innerText.trim();
  if (expression.length === 0) {
    return match.fullMatch;
  }

  const normalizedExpression = normalizeLatexExpression(expression);
  return `${match.openDelimiter}${leadingWhitespace}${normalizedExpression}${trailingWhitespace}${match.closeDelimiter}`;
}

function normalizeLatexExpression(expression: string): string {
  const normalizedExpression = expression.replace(/\r/g, "").trim();
  if (normalizedExpression.length === 0) {
    return "";
  }

  return normalizeLatexScriptShorthand(normalizeLatexAccentShorthand(normalizedExpression));
}

function normalizeLatexAccentShorthand(expression: string): string {
  let result = "";

  for (let index = 0; index < expression.length; ) {
    if (expression[index] !== "\\") {
      result += expression[index];
      index += 1;
      continue;
    }

    const [command, nextIndex] = consumeLatexControlSequence(expression, index);
    if (!latexAccentCommands.has(command)) {
      result += command;
      index = nextIndex;
      continue;
    }

    result += command;
    const whitespaceStart = nextIndex;
    let tokenStart = nextIndex;
    while (tokenStart < expression.length && isLatexWhitespace(expression[tokenStart])) {
      tokenStart += 1;
    }

    if (tokenStart >= expression.length || expression[tokenStart] === "{") {
      result += expression.slice(whitespaceStart, tokenStart);
      index = tokenStart;
      continue;
    }

    const [token, endIndex] = consumeLatexToken(expression, tokenStart);
    if (!token) {
      result += expression.slice(whitespaceStart, tokenStart);
      index = tokenStart;
      continue;
    }

    result += `{${token}}`;
    index = endIndex;
  }

  return result;
}

function normalizeLatexScriptShorthand(expression: string): string {
  let result = "";

  for (let index = 0; index < expression.length; ) {
    const currentCharacter = expression[index];
    if (currentCharacter !== "^" && currentCharacter !== "_") {
      result += currentCharacter;
      index += 1;
      continue;
    }

    result += currentCharacter;
    index += 1;
    while (index < expression.length && isLatexWhitespace(expression[index])) {
      index += 1;
    }

    if (index >= expression.length) {
      break;
    }

    if (expression[index] === "{") {
      continue;
    }

    const [token, endIndex] = consumeLatexToken(expression, index);
    if (!token) {
      continue;
    }

    result += normalizeLatexScriptToken(token);
    index = endIndex;
  }

  return result;
}

function consumeLatexControlSequence(expression: string, startIndex: number): [string, number] {
  if (startIndex >= expression.length || expression[startIndex] !== "\\") {
    return ["", startIndex];
  }

  let endIndex = startIndex + 1;
  while (endIndex < expression.length) {
    const currentCharacter = expression[endIndex];
    if (isAsciiLetter(currentCharacter)) {
      endIndex += 1;
      continue;
    }

    break;
  }

  if (endIndex === startIndex + 1 && endIndex < expression.length) {
    endIndex += 1;
  }

  return [expression.slice(startIndex, endIndex), endIndex];
}

function consumeLatexToken(expression: string, startIndex: number): [string, number] {
  if (startIndex >= expression.length) {
    return ["", startIndex];
  }

  if (expression[startIndex] === "\\") {
    return consumeLatexControlSequence(expression, startIndex);
  }

  let endIndex = startIndex;
  while (endIndex < expression.length) {
    if (isLatexTokenBoundary(expression[endIndex])) {
      if (endIndex === startIndex) {
        endIndex += 1;
      }

      return [expression.slice(startIndex, endIndex), endIndex];
    }

    endIndex += 1;
  }

  return [expression.slice(startIndex, endIndex), endIndex];
}

function normalizeLatexScriptToken(token: string): string {
  if (token.length === 0) {
    return "";
  }

  const fontShorthandLabel = latexScriptFontShorthandLabels.get(token);
  if (fontShorthandLabel) {
    return `{\\mathrm{${fontShorthandLabel}}}`;
  }

  if (isLatexWordToken(token)) {
    return `{\\mathrm{${token}}}`;
  }

  if (isLatexSimpleScriptToken(token)) {
    return `{${token}}`;
  }

  return token;
}

function isLatexWordToken(token: string): boolean {
  return /^\p{L}{2,}$/u.test(token);
}

function isLatexSimpleScriptToken(token: string): boolean {
  if (!/^[\p{L}\p{N},]+$/u.test(token)) {
    return false;
  }

  return token.includes(",") || Array.from(token).length > 1;
}

function isLatexWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\n" || character === "\r";
}

function isAsciiLetter(character: string): boolean {
  return (character >= "a" && character <= "z") || (character >= "A" && character <= "Z");
}

function isLatexTokenBoundary(character: string): boolean {
  return " \t\n\r{}[]()+-*/=<>|&;:!?.^_".includes(character);
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function decodeHtmlAttribute(value: string): string {
  if (!/[&<>]/.test(value)) {
    return value;
  }

  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function escapeHtmlAttribute(value: string, quote: string): string {
  const escapedValue = value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return quote === "'" ? escapedValue.replace(/'/g, "&#39;") : escapedValue.replace(/"/g, "&quot;");
}