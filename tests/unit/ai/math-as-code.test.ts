/**
 * R15: TeX math in assistant answers is shown as readable source (monospace), not rendered by KaTeX.
 */
import { describe, expect, it } from "vitest";
import { mathToCode } from "@/lib/ai/math-as-code";

describe("mathToCode", () => {
  it("inline math becomes an inline code span (so _ and * are not emphasis)", () => {
    expect(mathToCode("Energy $E_n = h\\nu$ here")).toBe("Energy `E_n = h\\nu` here");
    expect(mathToCode("$a*b*c$")).toBe("`a*b*c`");
  });

  it("display math becomes a math code block", () => {
    expect(mathToCode("Before\n$$\nE = mc^2\n$$\nafter")).toBe("Before\n\n```math\nE = mc^2\n```\n\nafter");
    expect(mathToCode("$$x_1 + x_2$$")).toBe("\n```math\nx_1 + x_2\n```\n");
  });

  it("prices and escaped dollars stay text (Pandoc's rules)", () => {
    expect(mathToCode("It costs $5 and $10 today")).toBe("It costs $5 and $10 today");
    expect(mathToCode("between $ 5 $ and")).toBe("between $ 5 $ and");
    expect(mathToCode("a literal \\$x$ sign")).toBe("a literal \\$x$ sign");
  });

  it("leaves existing code alone: fenced blocks and inline code spans", () => {
    const fenced = "```bash\necho $HOME $PATH\n```\nthen $x$";
    expect(mathToCode(fenced)).toBe("```bash\necho $HOME $PATH\n```\nthen `x`");
    expect(mathToCode("run `echo $a$` and $b$")).toBe("run `echo $a$` and `b`");
    expect(mathToCode("~~~\n$$not math$$\n~~~")).toBe("~~~\n$$not math$$\n~~~");
  });

  it("a formula containing backticks gets a longer fence", () => {
    expect(mathToCode("$a`b$")).toBe("``a`b``");
  });

  it("plain text is unchanged", () => {
    const text = "**Benzene** is `C6H6`:\n\n- aromatic\n- planar";
    expect(mathToCode(text)).toBe(text);
  });
});
