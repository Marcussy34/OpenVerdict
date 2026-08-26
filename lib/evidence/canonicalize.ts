import { Parser } from "htmlparser2";

export const HTML_CANONICALIZER_VERSION = "htmlparser2@12" as const;

const DROPPED_ELEMENTS = new Set([
  "script",
  "style",
  "noscript",
  "iframe",
  "object",
  "embed",
  "svg",
]);

const BLOCK_ELEMENTS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "body",
  "br",
  "caption",
  "dd",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "html",
  "legend",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "ul",
]);

export class EvidenceCanonicalizationError extends Error {
  override readonly name = "EvidenceCanonicalizationError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/**
 * Extract inert, normalized text. The parser never evaluates markup or script.
 * Attributes are intentionally ignored, so event handlers cannot survive.
 */
export function canonicalizeHtml(
  bytes: Uint8Array,
): { text: string; parserVersion: string } {
  let html: string;
  try {
    html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new EvidenceCanonicalizationError("HTML is not valid UTF-8", {
      cause: error,
    });
  }

  const chunks: string[] = [];
  let suppressedDepth = 0;
  let parserError: Error | undefined;

  const parser = new Parser(
    {
      onopentag(name) {
        if (suppressedDepth > 0 || DROPPED_ELEMENTS.has(name)) {
          suppressedDepth += 1;
          return;
        }
        if (BLOCK_ELEMENTS.has(name)) chunks.push("\n");
      },
      ontext(text) {
        if (suppressedDepth === 0) chunks.push(text);
      },
      onclosetag(name) {
        if (suppressedDepth > 0) {
          suppressedDepth -= 1;
          return;
        }
        if (BLOCK_ELEMENTS.has(name)) chunks.push("\n");
      },
      onerror(error) {
        parserError = error;
      },
    },
    {
      decodeEntities: true,
      lowerCaseAttributeNames: true,
      lowerCaseTags: true,
      recognizeSelfClosing: true,
      xmlMode: false,
    },
  );

  try {
    parser.end(html);
  } catch (error) {
    throw new EvidenceCanonicalizationError("HTML parsing failed", {
      cause: error,
    });
  }
  if (parserError !== undefined) {
    throw new EvidenceCanonicalizationError("HTML parsing failed", {
      cause: parserError,
    });
  }

  return {
    text: normalizeExtractedText(chunks.join("")),
    parserVersion: HTML_CANONICALIZER_VERSION,
  };
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n+/g, "\n")
    .trim();
}
