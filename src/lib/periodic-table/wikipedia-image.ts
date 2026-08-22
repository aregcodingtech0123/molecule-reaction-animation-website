export interface WikipediaImageResult {
  imageUrl: string;
  pageTitle: string;
  attribution: string;
}

function wikiTitleSlug(name: string): string {
  return encodeURIComponent(name.trim().replace(/\s+/g, "_"));
}

/**
 * Fetch a high-quality element image from the Wikipedia REST API.
 * Tries the plain element name first, then the "(element)" disambiguation page.
 */
export async function fetchWikipediaElementImage(
  elementName: string,
  signal?: AbortSignal,
): Promise<WikipediaImageResult | null> {
  const candidates = [elementName, `${elementName} (element)`];

  for (const title of candidates) {
    try {
      const response = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${wikiTitleSlug(title)}`,
        {
          signal,
          headers: { Accept: "application/json" },
          cache: "no-store",
        },
      );

      if (!response.ok) continue;

      const data = (await response.json()) as {
        title?: string;
        description?: string;
        content_urls?: { desktop?: { page?: string } };
        originalimage?: { source?: string };
        thumbnail?: { source?: string };
      };

      const imageUrl = data.originalimage?.source ?? data.thumbnail?.source;
      if (!imageUrl) continue;

      return {
        imageUrl,
        pageTitle: data.title ?? elementName,
        attribution: data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${wikiTitleSlug(title)}`,
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err;
      }
    }
  }

  return null;
}
