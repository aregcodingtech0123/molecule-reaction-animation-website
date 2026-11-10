import crypto from "node:crypto";

/**
 * A deliberately NARROW SQL comment stripper for the fixed corpus staged in database/staged/phase-2c-v7/.
 *
 * IT IS NOT A GENERAL-PURPOSE POSTGRESQL SQL PARSER, and must not be described or reused as one. It exists for one
 * purpose: to show that two copies of a frozen SQL file have the same executable text once their comments are removed,
 * so that a provenance-header edit can be told apart from a change to the SQL.
 *
 * Protected regions are kept EXACTLY as written (after CRLF -> LF), whitespace and comment-like text included:
 *  - single-quoted string literals (with the doubled-quote escape), including multi-line ones,
 *  - double-quoted identifiers,
 *  - dollar-quoted bodies ($$ ... $$ and $tag$ ... $tag$). Comments INSIDE a body are part of the frozen body: they are
 *    stored in the function's source text.
 *
 * Everything else is unprotected SQL text, and only there does the stripper do anything:
 *  - `--` line comments and nested block comments are removed.
 *  - Whitespace is normalised: spaces and tabs at the end of a line are dropped, and lines that hold nothing but spaces
 *    and tabs (a comment line leaves one behind) are dropped. A line that ends inside a protected region, or that
 *    contains one, is never touched. The text has no final newline. Leading indentation and the spaces between tokens
 *    are kept.
 *  - Only the space and the tab count as whitespace here. Anything else is content.
 *
 * Where a dollar-quote opens is decided from the SOURCE text, never from the output: a `$` opens a quote unless the
 * source character just before it can be part of an identifier (then it is part of an identifier, as in PostgreSQL). A
 * comment between an identifier and the opener, such as ident/ * c * /$$ ... $$, would glue the two together once the
 * comment is removed, so it is refused rather than guessed at.
 *
 * Assumptions, stated rather than checked: standard_conforming_strings is on (a backslash in a string is an ordinary
 * character), and the text is UTF-8.
 *
 * Anything outside those rules is refused with UnsupportedSqlError instead of being guessed at: escape strings (E'...'),
 * Unicode-escape strings (U&'...'), a comment directly between an identifier and a dollar-quote opener, and any
 * unterminated string, identifier, comment or dollar quote. If the corpus ever needs more, the right response is to stop
 * and decide, not to extend this file silently.
 */
export class UnsupportedSqlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedSqlError";
  }
}

const IDENT_CHAR = /[A-Za-z0-9_$\u0080-\uffff]/;
const DOLLAR_TAG = /^\$([A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/;

export const normaliseLineEndings = (text: string): string => text.replace(/\r\n/g, "\n");

export function stripSqlComments(sql: string): string {
  const src = normaliseLineEndings(sql);
  const n = src.length;

  let result = "";
  let lineHasContent = false; // the current line holds a non-blank character or a protected region
  let pendingNewline = false; // a newline is owed before the next thing that is written
  let pendingBlanks = ""; // spaces and tabs not yet written: they are dropped if the line ends first
  let lastWritten = ""; // the last character of the output

  const settle = () => {
    if (pendingNewline) {
      result += "\n";
      pendingNewline = false;
    }
    result += pendingBlanks;
    pendingBlanks = "";
  };
  const writeProtected = (text: string) => {
    settle();
    result += text;
    lineHasContent = true;
    lastWritten = text.charAt(text.length - 1);
  };
  const writeUnprotected = (ch: string) => {
    if (ch === "\n") {
      if (lineHasContent) pendingNewline = true;
      pendingBlanks = "";
      lineHasContent = false;
      return;
    }
    if (ch === " " || ch === "\t") {
      pendingBlanks += ch;
      return;
    }
    settle();
    result += ch;
    lineHasContent = true;
    lastWritten = ch;
  };

  let i = 0;
  while (i < n) {
    const c = src.charAt(i);
    const next = src.charAt(i + 1);

    if (c === "-" && next === "-") {
      while (i < n && src.charAt(i) !== "\n") i++;
      continue;
    }

    if (c === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (src.charAt(i) === "/" && src.charAt(i + 1) === "*") {
          depth++;
          i += 2;
        } else if (src.charAt(i) === "*" && src.charAt(i + 1) === "/") {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      if (depth > 0) throw new UnsupportedSqlError("unterminated block comment");
      continue;
    }

    if (c === "'") {
      // The prefix has to touch the quote in the source: a comment between them makes it a plain string after an identifier.
      const p1 = src.charAt(i - 1);
      const p2 = src.charAt(i - 2);
      const p3 = src.charAt(i - 3);
      if ((p1 === "e" || p1 === "E") && !IDENT_CHAR.test(p2)) throw new UnsupportedSqlError("escape strings (E'...') are not supported");
      if (p1 === "&" && (p2 === "u" || p2 === "U") && !IDENT_CHAR.test(p3)) {
        throw new UnsupportedSqlError("Unicode-escape strings (U&'...') are not supported");
      }
      let j = i + 1;
      for (;;) {
        if (j >= n) throw new UnsupportedSqlError("unterminated string literal");
        if (src.charAt(j) === "'") {
          if (src.charAt(j + 1) === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      writeProtected(src.slice(i, j + 1));
      i = j + 1;
      continue;
    }

    if (c === '"') {
      let j = i + 1;
      for (;;) {
        if (j >= n) throw new UnsupportedSqlError("unterminated quoted identifier");
        if (src.charAt(j) === '"') {
          if (src.charAt(j + 1) === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      writeProtected(src.slice(i, j + 1));
      i = j + 1;
      continue;
    }

    if (c === "$" && !IDENT_CHAR.test(src.charAt(i - 1))) {
      const open = DOLLAR_TAG.exec(src.slice(i, i + 80));
      if (open) {
        const tag = open[0];
        // Nothing is owed between the last thing written and the opener: removing a comment would have glued them together.
        if (!pendingNewline && pendingBlanks === "" && IDENT_CHAR.test(lastWritten)) {
          throw new UnsupportedSqlError("a comment between an identifier and a dollar-quote opener is not supported");
        }
        const close = src.indexOf(tag, i + tag.length);
        if (close < 0) throw new UnsupportedSqlError(`unterminated dollar quote ${tag}`);
        writeProtected(src.slice(i, close + tag.length));
        i = close + tag.length;
        continue;
      }
    }

    writeUnprotected(c);
    i++;
  }

  return result;
}

export const sha256Hex = (data: string | Uint8Array): string => crypto.createHash("sha256").update(data).digest("hex");

/** SHA-256 of the file text with CRLF normalised to LF: what a CRLF checkout (core.autocrlf=true) and an LF one share. */
export const normalisedSha256 = (fileBytes: Uint8Array | string): string => {
  const text = typeof fileBytes === "string" ? fileBytes : Buffer.from(fileBytes).toString("utf8");
  return sha256Hex(normaliseLineEndings(text));
};

/** SHA-256 of the comment-stripped, normalised text. */
export const strippedSha256 = (fileBytes: Uint8Array | string): string => {
  const text = typeof fileBytes === "string" ? fileBytes : Buffer.from(fileBytes).toString("utf8");
  return sha256Hex(stripSqlComments(text));
};
