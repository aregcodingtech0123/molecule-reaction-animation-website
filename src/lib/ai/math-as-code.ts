/**
 * Shows TeX math in assistant answers as readable source text (owner decision R15): `$…$` becomes inline code and
 * `$$…$$` a "math" code block, so the markdown renderer prints it in monospace instead of interpreting it (`_` and
 * `*` inside formulas would otherwise turn into emphasis). Replaces remark-math + rehype-katex, whose output the
 * sanitiser stripped anyway (SEC-15). Pure text-to-markdown; the result still goes through react-markdown and
 * rehype-sanitize like any answer.
 *
 * Existing code is left alone: fenced blocks (``` / ~~~) and inline code spans are copied verbatim. Inline math
 * follows Pandoc's rule — no space right after the opening `$` or before the closing one, and the closing `$` not
 * followed by a digit — so "costs $5 and $10" stays text. `\$` is a literal dollar.
 */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export function mathToCode(markdown: string): string {
  const out: string[] = [];
  let text: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    if (text.length) out.push(convertText(text.join("\n")));
    text = [];
  };
  for (const line of markdown.split("\n")) {
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      out.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
      continue;
    }
    if (marker) {
      flush();
      fence = marker;
      out.push(line);
      continue;
    }
    text.push(line);
  }
  flush();
  return out.join("\n");
}

/** Text outside fenced blocks: display math first, then inline math outside inline code spans. */
function convertText(text: string): string {
  const withDisplay = text.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => {
    const body = tex.trim();
    const fence = body.includes("```") ? "~~~~" : "```";
    return `\n${fence}math\n${body}\n${fence}\n`;
  });
  // Split on inline code spans (kept verbatim) and the display blocks just created.
  return withDisplay
    .split(/(```math\n[\s\S]*?\n```|~~~~math\n[\s\S]*?\n~~~~|`+[^`]*?`+)/)
    .map((part, i) => (i % 2 === 1 ? part : convertInline(part)))
    .join("");
}

function convertInline(text: string): string {
  return text.replace(/(?<![\\$])\$(?![\s$])([^$\n]*?[^\s\\$])\$(?![\d$])/g, (_m, tex: string) => codeSpan(tex));
}

/** An inline code span that survives backticks inside the formula. */
function codeSpan(content: string): string {
  const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = "`".repeat(longest + 1);
  const pad = content.startsWith("`") || content.endsWith("`") ? " " : "";
  return `${ticks}${pad}${content}${pad}${ticks}`;
}
