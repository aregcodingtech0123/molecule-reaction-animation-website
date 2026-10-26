/**
 * What grew between two V8 heap snapshots of a server (preload: PERF_HEAP_SNAP=api|web, PERF_HEAP_SNAP_AT_MS):
 * self size and count per (node type, constructor / name), largest growth first.
 *   node scripts/perf/heap-diff.mjs <earlier.heapsnapshot> <later.heapsnapshot> [--top 25]
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";

function aggregate(file) {
  const snap = JSON.parse(fs.readFileSync(file, "utf8"));
  const fields = snap.snapshot.meta.node_fields;
  const types = snap.snapshot.meta.node_types[0];
  const [iType, iName, iSize] = ["type", "name", "self_size"].map((f) => fields.indexOf(f));
  const stride = fields.length;
  const groups = new Map();
  let total = 0;
  for (let i = 0; i < snap.nodes.length; i += stride) {
    const type = types[snap.nodes[i + iType]];
    const size = snap.nodes[i + iSize];
    // Strings and code by type only (their "names" are their contents); objects by constructor.
    const name = type === "object" || type === "closure" || type === "native" ? snap.strings[snap.nodes[i + iName]].slice(0, 80) : "";
    const key = `${type}${name ? ` ${name}` : ""}`;
    const g = groups.get(key) ?? { size: 0, count: 0 };
    g.size += size;
    g.count += 1;
    groups.set(key, g);
    total += size;
  }
  return { groups, total };
}

export function diff(a, b) {
  const keys = new Set([...a.groups.keys(), ...b.groups.keys()]);
  return [...keys]
    .map((k) => {
      const x = a.groups.get(k) ?? { size: 0, count: 0 };
      const y = b.groups.get(k) ?? { size: 0, count: 0 };
      return { key: k, sizeDelta: y.size - x.size, countDelta: y.count - x.count, size: y.size, count: y.count };
    })
    .sort((p, q) => q.sizeDelta - p.sizeDelta);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [, , before, after, ...rest] = process.argv;
  const top = Number(rest[rest.indexOf("--top") + 1]) || 25;
  const a = aggregate(before);
  const b = aggregate(after);
  const mib = (v) => (v / 2 ** 20).toFixed(2);
  console.log(`total self size ${mib(a.total)} → ${mib(b.total)} MiB`);
  for (const r of diff(a, b).slice(0, top)) {
    console.log(`${mib(r.sizeDelta).padStart(8)} MiB  ${String(r.countDelta).padStart(8)} objs   (now ${mib(r.size)} MiB, ${r.count})  ${r.key}`);
  }
}
