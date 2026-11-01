/**
 * Dead-man's switch for the daily jobs: one GET to a heartbeat monitor's ping URL (healthchecks.io-style - it alerts when NO ping
 * arrives within the expected period), sent only after the job succeeded, so a job that fails OR never runs is noticed.
 * The URL usually carries a secret: only its host is ever printed.
 */

/**
 * @param {string} tag      log prefix, e.g. "purge-signup-ips"
 * @param {string | undefined} raw  the ping URL (an environment value)
 * @returns {Promise<boolean>}  true when nothing was configured or the monitor answered 2xx
 */
export async function sendHeartbeat(tag, raw) {
  const value = raw?.trim();
  if (!value) return true;
  let url;
  try {
    url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
  } catch {
    console.error(`[${tag}] heartbeat URL is not an http(s) URL; the heartbeat was not sent.`);
    return false;
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) console.error(`[${tag}] heartbeat to ${url.host} answered HTTP ${res.status}.`);
    else console.log(`[${tag}] heartbeat sent to ${url.host}.`);
    return res.ok;
  } catch {
    console.error(`[${tag}] heartbeat to ${url.host} failed.`);
    return false;
  }
}
