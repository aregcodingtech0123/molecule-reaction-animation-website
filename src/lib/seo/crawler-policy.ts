/**
 * AI-crawler policy (SEO-01, owner decision D2): ONE place to change it.
 *
 * Current policy: **allow every crawler**. A token set to "allow" needs no robots.txt entry: the `User-agent: *`
 * group already allows it. Set a token to "disallow" and robots.txt gets a `User-agent: <token>` / `Disallow: /`
 * group for it; nothing else changes. robots.txt is advisory, not access control.
 *
 * Trade-offs worth knowing before changing a line:
 *  - `Google-Extended` is only a control token (no crawler of its own). Disallowing it stops Gemini from using
 *    the site for training and for grounding in Gemini Apps / Grounding with Google Search on Vertex AI. Google
 *    says it "does not impact a site's inclusion in Google Search nor is it used as a ranking signal". AI
 *    Overviews / AI Mode follow normal Googlebot rules, not this token.
 *  - Blocking a training token (`GPTBot`, `ClaudeBot`, `CCBot`) does not remove the site from that vendor's
 *    search product; each token is independent (`OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot`).
 *  - User-triggered fetchers (`ChatGPT-User`, `Perplexity-User`) are documented as possibly or generally ignoring
 *    robots.txt, so a "disallow" for them may have no effect.
 *
 * Every token and statement below was read from the vendor's own documentation on 2026-11-01 (`source`).
 */
export type CrawlerPolicy = "allow" | "disallow";

export interface AiCrawler {
  /** robots.txt `User-agent` token, exactly as the vendor documents it. */
  token: string;
  vendor: string;
  /** What the vendor says it is for. */
  purpose: string;
  policy: CrawlerPolicy;
  source: string;
}

export const AI_CRAWLERS: readonly AiCrawler[] = [
  {
    token: "GPTBot",
    vendor: "OpenAI",
    purpose: "crawls content that may be used in training OpenAI's generative AI foundation models",
    policy: "allow",
    source: "https://developers.openai.com/api/docs/bots",
  },
  {
    token: "OAI-SearchBot",
    vendor: "OpenAI",
    purpose: "surfaces websites in ChatGPT's search features",
    policy: "allow",
    source: "https://developers.openai.com/api/docs/bots",
  },
  {
    token: "ChatGPT-User",
    vendor: "OpenAI",
    purpose: "fetches pages for certain user actions in ChatGPT and Custom GPTs; robots.txt rules \"may not apply\"",
    policy: "allow",
    source: "https://developers.openai.com/api/docs/bots",
  },
  {
    token: "OAI-AdsBot",
    vendor: "OpenAI",
    purpose: "validates the safety of pages submitted as ads on ChatGPT; visits only pages submitted as ads",
    policy: "allow",
    source: "https://developers.openai.com/api/docs/bots",
  },
  {
    token: "ClaudeBot",
    vendor: "Anthropic",
    purpose: "collects web content that could contribute to model training",
    policy: "allow",
    source: "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
  },
  {
    token: "Claude-SearchBot",
    vendor: "Anthropic",
    purpose: "indexes content to improve the relevance and accuracy of Claude's search results",
    policy: "allow",
    source: "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
  },
  {
    token: "Claude-User",
    vendor: "Anthropic",
    purpose: "retrieves pages when a Claude user asks a question",
    policy: "allow",
    source: "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
  },
  {
    token: "Google-Extended",
    vendor: "Google",
    purpose: "control token (no separate user agent) for Gemini training and grounding; not a Google Search signal",
    policy: "allow",
    source: "https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers",
  },
  {
    token: "PerplexityBot",
    vendor: "Perplexity",
    purpose: "surfaces and links websites in Perplexity search; not used to crawl content for AI foundation models",
    policy: "allow",
    source: "https://docs.perplexity.ai/guides/bots",
  },
  {
    token: "Perplexity-User",
    vendor: "Perplexity",
    purpose: "supports user actions in Perplexity; \"generally ignores robots.txt rules\" because the user requested the fetch",
    policy: "allow",
    source: "https://docs.perplexity.ai/guides/bots",
  },
  {
    token: "CCBot",
    vendor: "Common Crawl",
    purpose: "builds Common Crawl's open web-crawl repository (widely reused by third parties, including for AI training)",
    policy: "allow",
    source: "https://commoncrawl.org/ccbot",
  },
];

/** Tokens robots.txt must name with `Disallow: /` (none while the policy is "allow all"). */
export function disallowedCrawlerTokens(crawlers: readonly AiCrawler[] = AI_CRAWLERS): string[] {
  return crawlers.filter((c) => c.policy === "disallow").map((c) => c.token);
}

/** Tokens that must be served metadata in the initial HTML (they do not run JavaScript); see next.config.ts. */
export const AI_CRAWLER_TOKENS: readonly string[] = AI_CRAWLERS.map((c) => c.token);
