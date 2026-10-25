/**
 * Bounded request-body reading for BFF routes (SEC-10). `request.arrayBuffer()` / `request.json()`
 * buffer whatever the client sends; these helpers refuse a declared Content-Length over the limit
 * without reading, and stop reading (cancel the stream) as soon as a streamed body passes it.
 */
export class BodyTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`Request body exceeds ${limitBytes} bytes.`);
    this.name = "BodyTooLargeError";
  }
}

/** Gateway (auth / billing / users): Express accepts at most 32 kB; anything far beyond is refused here. */
export const GATEWAY_MAX_BODY_BYTES = 64 * 1024;

/** /api/chat: 24 messages × 8,000 characters, up to 4 bytes per character in UTF-8, plus JSON. */
export const CHAT_MAX_BODY_BYTES = 1024 * 1024;

export async function readBodyWithLimit(request: Request, limitBytes: number): Promise<Uint8Array | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > limitBytes) throw new BodyTooLargeError(limitBytes);
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limitBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError(limitBytes);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
