/**
 * Derive assembly-constituency outlines from the block polygons.
 *
 * An MLA looks at the map and asks "where does my seat end?". Nothing on it
 * answered that: blocks were drawn, constituencies were not, and a seat is two
 * or three blocks that the eye has no way to group.
 *
 * There is no AC polygon file to download — but an AC *is* its blocks, and
 * constituency_block_mapping says which. Unioning each group dissolves the
 * internal block seams and leaves one outline per seat.
 *
 * Run:  node scripts/build-ac-boundaries.mjs
 * Out:  public/purulia-ac.geojson
 *
 * Regenerate whenever the block polygons or the AC mapping change. This is a
 * build step rather than runtime work: the geometry only changes when a
 * delimitation does, and unioning 20 polygons on every page load would be waste.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import union from '@turf/union';
import { featureCollection } from '@turf/helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

// Same canonical key as src/lib/block-name.ts — the three tables spell these
// differently and a mismatch silently drops a block out of its seat.
const BLOCK_ALIASES = { bundwan: 'bandwan', bagmundi: 'baghmundi', jaipur: 'joypur' };
const norm = (s) => {
  const v = String(s || '').toLowerCase().replace(/[\s-]/g, '');
  return BLOCK_ALIASES[v] || v;
};

// From constituency_block_mapping. Kept here rather than fetched so the script
// runs without credentials; verified against the table before committing.
const AC_BLOCKS = {
  Baghmundi:    ['Baghmundi', 'Jhalda I'],
  Balarampur:   ['Arsha', 'Balarampur'],
  Bandwan:      ['Bandwan', 'Barabazar', 'Manbazar II'],
  Joypur:       ['Jhalda II', 'Joypur'],
  Kashipur:     ['Kashipur'],
  Manbazar:     ['Hura', 'Manbazar I', 'Puncha'],
  Para:         ['Para', 'Raghunathpur II'],
  Purulia:      ['Purulia I', 'Purulia II'],
  Raghunathpur: ['Neturia', 'Raghunathpur I', 'Santuri'],
};

const blocks = JSON.parse(
  fs.readFileSync(path.join(root, 'public/purulia-blocks.geojson'), 'utf8')
);
const byBlock = new Map();
for (const f of blocks.features) byBlock.set(norm(f.properties?.block), f);

/** Rough centroid of the largest ring — good enough to hang a label on. */
function labelPoint(geom) {
  const rings = geom.type === 'Polygon' ? [geom.coordinates[0]]
    : geom.coordinates.map((p) => p[0]);
  let best = null, bestLen = -1;
  for (const r of rings) if (r.length > bestLen) { bestLen = r.length; best = r; }
  let x = 0, y = 0;
  for (const [lng, lat] of best) { x += lng; y += lat; }
  return [x / best.length, y / best.length];
}

const features = [];
const problems = [];

for (const [ac, names] of Object.entries(AC_BLOCKS)) {
  const parts = [];
  for (const n of names) {
    const f = byBlock.get(norm(n));
    if (!f) { problems.push(`${ac}: no polygon for block "${n}"`); continue; }
    parts.push(f);
  }
  if (!parts.length) continue;

  // turf v7 unions a whole FeatureCollection in one call. A single-block seat
  // (Kashipur) has nothing to dissolve, so it passes through untouched.
  let merged = parts[0];
  if (parts.length > 1) {
    merged = union(featureCollection(parts));
    // A failed union would silently drop a block from the seat, so stop loudly.
    if (!merged) { problems.push(`${ac}: union returned nothing`); continue; }
  }

  features.push({
    type: 'Feature',
    properties: { ac, blocks: names, labelAt: labelPoint(merged.geometry) },
    geometry: merged.geometry,
  });
}

if (problems.length) {
  console.error('PROBLEMS:');
  for (const p of problems) console.error('  -', p);
  process.exit(1);
}

const out = { type: 'FeatureCollection', features };
const dest = path.join(root, 'public/purulia-ac.geojson');
fs.writeFileSync(dest, JSON.stringify(out));

console.log(`wrote ${features.length} constituency outlines -> public/purulia-ac.geojson`);
for (const f of features) {
  console.log(`  ${f.properties.ac.padEnd(14)} ${f.properties.blocks.join(', ')}`);
}
