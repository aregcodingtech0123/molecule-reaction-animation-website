/**
 * Local TCP proxy between Express and PostgreSQL for DB-latency, pool and cold-start tests (PERF-13).
 * Binds 127.0.0.1 ONLY, forwards only to a loopback target (the project's test container), and is
 * started and stopped by the scenario that uses it.
 *
 *   latencyMs     delay added to every chunk in each direction (a round trip costs ≈ 2 × latencyMs)
 *   suspend(ms)   Neon scale-to-zero: drop every open connection now; new connections wait until `ms`
 *                 have passed (the resume), then connect
 *   down = true   refuse every new connection (and drop open ones) until set back to false
 *
 * Delays use a precise scheduler: Windows timers fire in ~15.6 ms steps, so `setTimeout(fn, 1)` made a
 * "1 ms" link cost ~31 ms per round trip. Due work is polled with setImmediate for the last stretch,
 * which burns CPU while latency is set — so scenarios run the proxy in its own process
 * (`startTcpProxyProcess`), never next to the load driver.
 */
import { fork } from "node:child_process";
import net from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/** Runs `fn` at `delayMs` from now with sub-millisecond precision (FIFO for equal due times). */
function preciseScheduler() {
  const queue = [];
  let spinning = false;
  const spin = () => {
    const now = performance.now();
    while (queue.length && queue[0].due <= now) queue.shift().fn();
    if (!queue.length) {
      spinning = false;
      return;
    }
    const wait = queue[0].due - now;
    if (wait > 20) setTimeout(spin, wait - 17);
    else setImmediate(spin);
  };
  return (fn, delayMs) => {
    queue.push({ due: performance.now() + delayMs, fn });
    if (!spinning) {
      spinning = true;
      setImmediate(spin);
    }
  };
}

export async function startTcpProxy({ targetHost, targetPort, listenPort = 0 }) {
  if (!LOOPBACK.has(targetHost)) throw new Error(`[tcp-proxy] refusing non-local target ${targetHost}`);
  const state = { latencyMs: 0, asleepUntil: 0, down: false };
  const stats = { accepted: 0, refused: 0, heldForWake: 0, dropped: 0 };
  const pairs = new Set();
  const later = preciseScheduler();

  const pipe = (from, to) => {
    from.on("data", (chunk) => {
      if (state.latencyMs > 0) later(() => to.writable && to.write(chunk), state.latencyMs);
      else if (to.writable) to.write(chunk);
    });
    from.on("end", () => later(() => to.end(), state.latencyMs));
  };

  const server = net.createServer((client) => {
    if (state.down) {
      stats.refused += 1;
      client.destroy();
      return;
    }
    stats.accepted += 1;
    const pair = { client, upstream: null };
    pairs.add(pair);
    // No Nagle on either leg (pg disables it on its own socket).
    client.setNoDelay(true);
    client.pause();
    client.on("error", () => client.destroy());
    client.on("close", () => {
      pairs.delete(pair);
      pair.upstream?.destroy();
    });
    const wait = Math.max(0, state.asleepUntil - Date.now());
    if (wait > 0) stats.heldForWake += 1;
    setTimeout(() => {
      if (client.destroyed) return;
      if (state.down) {
        stats.refused += 1;
        client.destroy();
        return;
      }
      const upstream = net.connect(targetPort, targetHost, () => client.resume());
      upstream.setNoDelay(true);
      pair.upstream = upstream;
      pipe(client, upstream);
      pipe(upstream, client);
      upstream.on("error", () => upstream.destroy());
      upstream.on("close", () => client.destroy());
    }, wait);
  });

  const dropAll = () => {
    for (const p of pairs) {
      stats.dropped += 1;
      p.client.destroy();
      p.upstream?.destroy();
    }
  };

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, "127.0.0.1", resolve);
  });
  return {
    port: server.address().port,
    stats,
    setLatency: (ms) => {
      state.latencyMs = ms;
    },
    suspend: (wakeMs) => {
      state.asleepUntil = Date.now() + wakeMs;
      dropAll();
    },
    setDown: (down) => {
      state.down = down;
      if (down) dropAll();
    },
    close: () =>
      new Promise((resolve) => {
        dropAll();
        server.close(() => resolve());
      }),
  };
}

/** Same interface, in a child process (its CPU use stays out of the load driver's process). */
export async function startTcpProxyProcess({ targetHost, targetPort }) {
  const child = fork(fileURLToPath(import.meta.url), ["--child"], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
  let seq = 0;
  const pending = new Map();
  child.on("message", (m) => {
    pending.get(m.id)?.(m.result);
    pending.delete(m.id);
  });
  const call = (op, ...args) =>
    new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      child.send({ id, op, args });
    });
  const { port } = await call("start", { targetHost, targetPort });
  return {
    port,
    stats: () => call("stats"),
    setLatency: (ms) => call("setLatency", ms),
    suspend: (ms) => call("suspend", ms),
    setDown: (down) => call("setDown", down),
    close: async () => {
      await call("close");
      child.kill();
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href && process.argv.includes("--child")) {
  let proxy;
  process.on("message", async ({ id, op, args }) => {
    let result;
    if (op === "start") {
      proxy = await startTcpProxy(args[0]);
      result = { port: proxy.port };
    } else if (op === "stats") result = { ...proxy.stats };
    else if (op === "close") await proxy.close();
    else proxy[op](...args);
    process.send({ id, result });
  });
}
