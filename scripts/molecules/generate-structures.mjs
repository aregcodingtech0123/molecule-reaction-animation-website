/**
 * Regenerates the 3D models of seven molecules from PubChem's computed 3D conformers (SEO-19, owner decision after
 * Part 2). Run by hand, never in CI or at build time:
 *
 *   node scripts/molecules/generate-structures.mjs
 *
 * Source: PubChem (NCBI), https://pubchem.ncbi.nlm.nih.gov, PUG REST `compound/cid/<CID>/SDF?record_type=3d` — the
 * computed conformer PubChem publishes for each compound. NCBI's policy page states that "NCBI itself places no
 * restrictions on the use or distribution of the data contained therein"; PubChem asks to be cited as the source
 * (the molecule pages do). Requests are spaced 0.6 s apart.
 *
 * The output (src/lib/molecules/structures/*.ts) holds the coordinates as PubChem returns them, only translated so the
 * centroid is at the origin (and, for the base pair, the two bases are rotated into one plane and placed side by side:
 * PubChem has no record for the pair, so their relative position is schematic).
 * Heme b is not here: PubChem has no 3D conformer for any iron complex (all heme CIDs return 404).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = path.join(root, "src/lib/molecules/structures");
const retrieved = new Date().toISOString().slice(0, 10);

/** file name -> [CIDs] (several CIDs = one model made of several compounds) and the export prefix. */
const TARGETS = [
  { file: "glucose", prefix: "GLUCOSE", name: "D-glucose", cids: [5793] },
  { file: "caffeine", prefix: "CAFFEINE", name: "caffeine", cids: [2519] },
  { file: "dna-fragment", prefix: "DNA_FRAGMENT", name: "adenine + thymine (schematic pair)", cids: [190, 1135] },
  { file: "protein-fragment", prefix: "PROTEIN_FRAGMENT", name: "N-glycylalanine", cids: [98153] },
  { file: "capsaicin", prefix: "CAPSAICIN", name: "capsaicin", cids: [1548943] },
  { file: "dopamine", prefix: "DOPAMINE", name: "dopamine", cids: [681] },
  { file: "adrenaline", prefix: "ADRENALINE", name: "epinephrine (adrenaline)", cids: [5816] },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchSdf(cid) {
  await sleep(600);
  const res = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/SDF?record_type=3d`);
  if (!res.ok) throw new Error(`CID ${cid}: HTTP ${res.status}`);
  return res.text();
}

export function parseSdf(sdf) {
  const lines = sdf.split(/\r?\n/);
  const atomCount = parseInt(lines[3].substring(0, 3), 10);
  const bondCount = parseInt(lines[3].substring(3, 6), 10);
  const atoms = [];
  for (let i = 0; i < atomCount; i++) {
    const l = lines[4 + i];
    atoms.push({
      element: l.substring(31, 34).trim(),
      p: [parseFloat(l.substring(0, 10)), parseFloat(l.substring(10, 20)), parseFloat(l.substring(20, 30))],
    });
  }
  const bonds = [];
  for (let i = 0; i < bondCount; i++) {
    const l = lines[4 + atomCount + i];
    const order = parseInt(l.substring(6, 9), 10);
    if (![1, 2, 3].includes(order)) throw new Error(`unsupported bond order ${order}`);
    bonds.push({ a: parseInt(l.substring(0, 3), 10) - 1, b: parseInt(l.substring(3, 6), 10) - 1, order });
  }
  return { atoms, bonds };
}

const mean = (pts) => [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k], 0) / pts.length);

/** Eigenvectors of a symmetric 3x3 matrix by Jacobi rotations; columns sorted by descending eigenvalue. */
function eigen3(m) {
  const a = m.map((r) => [...r]);
  let v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) off += Math.abs(a[p][q]);
    if (off < 1e-12) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-15) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return order.map((i) => [v[0][i], v[1][i], v[2][i]]);
}

/** Rotate a set of points so that its principal axes are x (longest), y, z (shortest), centroid at the origin. */
function toPrincipalFrame(pts) {
  const c = mean(pts);
  const q = pts.map((p) => p.map((x, k) => x - c[k]));
  const cov = [0, 1, 2].map((i) => [0, 1, 2].map((j) => q.reduce((s, p) => s + p[i] * p[j], 0)));
  const axes = eigen3(cov);
  return q.map((p) => axes.map((ax) => ax[0] * p[0] + ax[1] * p[1] + ax[2] * p[2]));
}

function buildModel(parts, schematicPair) {
  const atoms = [];
  const bonds = [];
  let positionsByPart = parts.map((part) => part.atoms.map((a) => a.p));
  if (schematicPair) {
    // Each base into its own principal frame (flat in the xy plane), then side by side with a 2.6 A gap along x.
    positionsByPart = positionsByPart.map(toPrincipalFrame);
    const [left, right] = positionsByPart;
    const leftMax = Math.max(...left.map((p) => p[0]));
    const rightMin = Math.min(...right.map((p) => p[0]));
    const shift = leftMax + 2.6 - rightMin;
    positionsByPart = [left, right.map((p) => [p[0] + shift, p[1], p[2]])];
  }
  const all = positionsByPart.flat();
  const c = mean(all);
  let serial = 0;
  parts.forEach((part, pi) => {
    const base = serial;
    part.atoms.forEach((a, i) => {
      serial++;
      atoms.push({ id: `${a.element}${serial}`, element: a.element, position: positionsByPart[pi][i].map((x, k) => +(x - c[k]).toFixed(4)) });
    });
    for (const b of part.bonds) bonds.push({ from: atoms[base + b.a].id, to: atoms[base + b.b].id, order: b.order });
  });
  return { atoms, bonds };
}

function render({ prefix, name, cids }, { atoms, bonds }) {
  const cidList = cids.map((c) => `CID ${c} (https://pubchem.ncbi.nlm.nih.gov/compound/${c})`).join(" + ");
  return `import type { AtomData, BondData } from "../types";

/**
 * GENERATED by scripts/molecules/generate-structures.mjs on ${retrieved} - do not edit by hand.
 * ${name}: computed 3D conformer from PubChem (NCBI), ${cidList}.
 * Coordinates in angstrom as PubChem returns them, centred on the centroid${cids.length > 1 ? "; the two bases are placed side by side in one plane (their relative position is schematic, PubChem has no record for the pair)" : ""}.
 * All atoms including hydrogens; ${atoms.length} atoms, ${bonds.length} bonds.
 */
export const ${prefix}_ATOMS: AtomData[] = [
${atoms.map((a) => `  { id: "${a.id}", element: "${a.element}", position: [${a.position.join(", ")}] },`).join("\n")}
];

export const ${prefix}_BONDS: BondData[] = [
${bonds.map((b, i) => `  { id: "b${i + 1}", from: "${b.from}", to: "${b.to}", order: ${b.order} },`).join("\n")}
];
`;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("generate-structures.mjs")) {
  for (const target of TARGETS) {
    const parts = [];
    for (const cid of target.cids) parts.push(parseSdf(await fetchSdf(cid)));
    const model = buildModel(parts, target.cids.length > 1);
    fs.writeFileSync(path.join(outDir, `${target.file}.ts`), render(target, model));
    console.log(`${target.file}: ${model.atoms.length} atoms, ${model.bonds.length} bonds`);
  }
}
