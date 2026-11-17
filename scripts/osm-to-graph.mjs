#!/usr/bin/env node
// One-time converter: Overpass JSON -> static road-graph JSON.
//
// Usage:
//   node scripts/osm-to-graph.mjs data/osm/name.raw.json data/maps/name.json \
//     --id=name --name="Display name" --place="City, State" \
//     --source="Overpass API extract, YYYY-MM-DD" \
//     --bounds=south,west,north,east
//
// The input is fetched by a human once (see data/osm/*.query.overpassql) and
// committed. The app only ever reads the converted file.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertOverpass } from './lib/osm-graph.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error('Usage: node scripts/osm-to-graph.mjs <overpass.json> <out.json> [options]');
  process.exit(1);
}

const args = process.argv.slice(2);
const positional = args.filter((argument) => !argument.startsWith('--'));
if (positional.length < 2) {
  usage('Need an input and an output path.');
}

const flags = new Map();
for (const argument of args.filter((argument) => argument.startsWith('--'))) {
  const [key, ...rest] = argument.slice(2).split('=');
  flags.set(key, rest.join('='));
}

const inputPath = resolve(root, positional[0]);
const outputPath = resolve(root, positional[1]);

let bounds;
if (flags.has('bounds')) {
  const values = flags.get('bounds').split(',').map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    usage('--bounds needs south,west,north,east');
  }
  bounds = {
    south: values[0],
    west: values[1],
    north: values[2],
    east: values[3],
  };
}

const raw = JSON.parse(await readFile(inputPath, 'utf8'));

const document = convertOverpass(raw, {
  id: flags.get('id'),
  name: flags.get('name'),
  place: flags.get('place'),
  source: flags.get('source') ?? `Overpass API extract, ${new Date().toISOString().slice(0, 10)}`,
  bbox: bounds,
});

document.generated = new Date().toISOString().slice(0, 10);

await mkdir(dirname(outputPath), { recursive: true });
const json = JSON.stringify(document);
await writeFile(outputPath, `${json}\n`);

const bytes = Buffer.byteLength(json);
console.log(`Wrote ${relative(root, outputPath)} (${(bytes / 1024).toFixed(1)} KiB)`);
console.log(
  `  ${document.stats.roadNodes} nodes · ${document.stats.roadEdges} edges · ` +
  `${document.stats.buildings} buildings · ${document.stats.areas} areas · ` +
  `${document.signals.length} signals · ${document.stops.length} stop signs`,
);
