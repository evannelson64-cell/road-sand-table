import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  convertOverpass,
  parseMaxspeed,
  parseMeters,
  ringArea,
  simplifyRing,
} from '../../src/map/osmGraph.js';
import { buildRoadNetwork, signalIsGreen } from '../../src/map/graph.js';
import { MapTraffic } from '../../src/map/traffic.js';

// Healdsburg stays in the repository as the small converter fixture: its raw
// Overpass response and converted document are both committed, so the
// conversion pipeline can be checked byte for byte.
const fixtureRaw = JSON.parse(
  readFileSync(new URL('../../data/osm/healdsburg-plaza.raw.json', import.meta.url), 'utf8'),
);
const fixtureDocument = JSON.parse(
  readFileSync(new URL('../../data/maps/healdsburg-plaza.json', import.meta.url), 'utf8'),
);

// Yorkville (Heartland) is the default extract the app ships with. Only the
// converted document is committed: the raw response is ~32 MB.
const document = JSON.parse(
  readFileSync(new URL('../../data/maps/yorkville-heartland.json', import.meta.url), 'utf8'),
);

const fixtureOptions = {
  id: 'healdsburg-plaza',
  name: 'Healdsburg Plaza',
  place: 'Healdsburg, California',
  source: 'Overpass API extract, 2026-11-17',
  bbox: { south: 38.6078, west: -122.873, north: 38.6134, east: -122.8665 },
};

function run(traffic, seconds, dt = 1 / 60) {
  const steps = Math.round(seconds / dt);
  for (let step = 0; step < steps; step += 1) {
    traffic.advance(dt);
  }
}

test('OSM unit parsing keeps metric, imperial and special values sane', () => {
  assert.equal(Math.round(parseMaxspeed('45 mph') * 100) / 100, 20.12);
  assert.equal(Math.round(parseMaxspeed('30') * 100) / 100, 8.33);
  assert.equal(parseMaxspeed('walk'), 5);
  assert.equal(parseMaxspeed('none'), null);
  assert.equal(parseMaxspeed('signals'), null);
  assert.equal(parseMaxspeed(undefined), null);
  assert.equal(parseMeters('7.5 m'), 7.5);
  assert.equal(parseMeters(''), null);
});

test('ring helpers measure and simplify without dropping the shape', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(ringArea(square), 100);
  assert.equal(ringArea(square.slice().reverse()), 100);

  const noisy = [[0, 0], [0.05, 0.02], [10, 0], [10, 10], [0, 10], [0.02, 0.04]];
  const simplified = simplifyRing(noisy, 0.25);
  assert.ok(simplified.length < noisy.length);
  assert.ok(simplified.length >= 4);
});

test('the committed fixture is exactly what the converter produces', () => {
  const converted = convertOverpass(fixtureRaw, fixtureOptions);

  assert.equal(converted.id, fixtureDocument.id);
  assert.equal(converted.attribution, '© OpenStreetMap contributors · ODbL 1.0');
  assert.deepEqual(converted.stats, fixtureDocument.stats);
  assert.deepEqual(converted.nodes, fixtureDocument.nodes);
  assert.deepEqual(converted.edges, fixtureDocument.edges);
  assert.deepEqual(converted.buildings, fixtureDocument.buildings);
  assert.deepEqual(converted.areas, fixtureDocument.areas);
  assert.deepEqual(converted.streams, fixtureDocument.streams);
  assert.deepEqual(converted.signals, fixtureDocument.signals);
  assert.deepEqual(converted.stops, fixtureDocument.stops);
  assert.deepEqual(converted.yields, fixtureDocument.yields);
});

test('the default map is the Heartland extract near Yorkville, Illinois', () => {
  assert.equal(document.id, 'yorkville-heartland');
  assert.equal(document.name, 'Heartland · Yorkville');
  assert.equal(document.place, 'Yorkville, Illinois');
  assert.equal(document.attribution, '© OpenStreetMap contributors · ODbL 1.0');
  assert.match(document.source, /Overpass/);
});

test('the default map is a usable, bounded street graph', () => {
  const { nodes, edges, size, buildings, areas, stats } = document;

  assert.ok(nodes.length > 100);
  assert.ok(edges.length > 200);
  assert.ok(size.width > 100 && size.depth > 100);
  assert.ok(buildings.length > 250);
  assert.ok(areas.length >= 10);
  assert.equal(stats.roadNodes, nodes.length);
  assert.equal(stats.roadEdges, edges.length);
  assert.equal(stats.buildings, buildings.length);
  assert.equal(stats.signals, document.signals.length);
  assert.equal(stats.stops, document.stops.length);

  // A 3-mile-radius extract is roughly 10 km across.
  assert.ok(size.width > 9000 && size.width < 11000);
  assert.ok(size.depth > 9000 && size.depth < 11000);

  for (const edge of edges) {
    assert.ok(nodes[edge.from], `edge ${edge.id} has a missing start node`);
    assert.ok(nodes[edge.to], `edge ${edge.id} has a missing end node`);
    assert.ok(edge.points.length >= 2);
    assert.ok(edge.width >= 4 && edge.width <= 20);
    assert.ok(edge.speed > 0 && edge.speed <= 20);
    assert.equal(typeof edge.drivable, 'boolean');
    const limitX = size.width / 2 + 60;
    const limitZ = size.depth / 2 + 60;
    for (const [x, z] of edge.points) {
      assert.ok(Math.abs(x) <= limitX, `edge ${edge.id} runs past the extract`);
      assert.ok(Math.abs(z) <= limitZ, `edge ${edge.id} runs past the extract`);
    }
  }

  for (const building of buildings) {
    assert.ok(building.points.length >= 3);
    assert.ok(building.height >= 2 && building.height <= 60);
  }

  const oneways = edges.filter((edge) => edge.oneway);
  assert.ok(oneways.length > 10, 'expected some one-way streets');
});

test('the runtime network builds directed lanes and approach controls', () => {
  const network = buildRoadNetwork(document);
  const drivable = network.lanes.filter((lane) => lane.drivable);
  const oneways = document.edges.filter((edge) => edge.oneway).length;

  assert.equal(network.nodes.length, document.nodes.length);
  for (const lane of network.lanes) {
    assert.ok(lane.length > 0);
    assert.ok(network.nodes[lane.fromNode]);
    assert.ok(network.nodes[lane.toNode]);
    assert.ok(Number.isFinite(lane.startDirection.x));
    assert.ok(Number.isFinite(lane.endDirection.z));
    assert.ok(['NS', 'EW'].includes(lane.axis));
  }

  // Most ways carry traffic; driveways, parking aisles and private service
  // ways stay visible but are flagged non-drivable.
  assert.ok(drivable.length > document.edges.length * 0.8);
  // Two-way edges produce a lane each way; one-way edges produce only one.
  assert.equal(network.lanes.length, document.edges.length * 2 - oneways);

  const signals = [...network.controls.values()].filter((kind) => kind === 'signal');
  const stops = network.lanes.filter((lane) => lane.control === 'stop');
  const yields = network.lanes.filter((lane) => lane.control === 'yield');
  // Signals and signs are mapped onto the nearest junction, so a few map
  // points can share one control node.
  assert.ok(signals.length > 0);
  assert.ok(signals.length <= document.signals.length);
  assert.ok(stops.length > document.stops.length * 0.5);
  assert.ok(yields.length >= Math.min(1, document.yields.length));

  // Every stop-signed lane points at a real junction node.
  for (const lane of [...stops, ...yields]) {
    assert.ok(network.nodes[lane.controlNode]);
  }
});

test('signals alternate on a stable 24 second cycle', () => {
  const ns = { axis: 'NS' };
  const ew = { axis: 'EW' };

  assert.equal(signalIsGreen(ns, 0), true);
  assert.equal(signalIsGreen(ew, 0), false);
  assert.equal(signalIsGreen(ns, 11), false);
  assert.equal(signalIsGreen(ew, 12), true);
  assert.equal(signalIsGreen(ew, 21.9), true);
  assert.equal(signalIsGreen(ew, 22.1), false);
  assert.equal(signalIsGreen(ns, 24), true);
});

test('traffic stays finite, moves and honours the requested fleet size', () => {
  const network = buildRoadNetwork(document);
  const traffic = new MapTraffic(network, { carCount: 64, seed: 0x5eed1234 });

  assert.equal(traffic.cars.length, 64);
  assert.equal(new Set(traffic.cars.map((car) => car.id)).size, 64);

  run(traffic, 40);
  const stats = traffic.getStats();
  assert.equal(stats.cars, 64);
  assert.ok(stats.moving > 20, `only ${stats.moving} cars moved`);
  assert.ok(stats.averageSpeed > 1, `average speed was ${stats.averageSpeed}`);

  const limitX = document.size.width / 2 + 80;
  const limitZ = document.size.depth / 2 + 80;
  for (const car of traffic.cars) {
    assert.ok(Number.isFinite(car.pose.x));
    assert.ok(Number.isFinite(car.pose.z));
    assert.ok(Number.isFinite(car.pose.heading));
    assert.ok(car.pose.x > -limitX && car.pose.x < limitX);
    assert.ok(car.pose.z > -limitZ && car.pose.z < limitZ);
    assert.ok(car.respawns < 10);
    assert.ok(car.lane.drivable);
  }

  traffic.setCarCount(20);
  assert.equal(traffic.cars.length, 20);
  run(traffic, 3);
  assert.equal(traffic.getStats().cars, 20);

  traffic.setCarCount(0);
  assert.equal(traffic.cars.length, 0);
  run(traffic, 1);
  const empty = traffic.getStats();
  assert.equal(empty.cars, 0);
  assert.equal(empty.moving, 0);
  assert.equal(empty.averageSpeed, 0);
  assert.ok(empty.time > 43);
});

test('the same seed produces the same traffic', () => {
  const network = buildRoadNetwork(document);
  const first = new MapTraffic(network, { carCount: 24, seed: 12345 });
  const second = new MapTraffic(network, { carCount: 24, seed: 12345 });

  run(first, 12);
  run(second, 12);

  assert.deepEqual(first.getSnapshots(), second.getSnapshots());
  assert.deepEqual(first.getStats(), second.getStats());
});

test('loading a saved Overpass file converts it without any service call', () => {
  // This is exactly what the in-browser loader does with a chosen .json file.
  const loaded = convertOverpass(fixtureRaw, {
    ...fixtureOptions,
    id: 'custom-test',
    name: 'healdsburg plaza',
    place: 'Loaded from your device',
  });

  assert.equal(loaded.id, 'custom-test');
  assert.equal(loaded.name, 'healdsburg plaza');
  assert.equal(loaded.place, 'Loaded from your device');
  assert.deepEqual(loaded.edges, fixtureDocument.edges);
  assert.deepEqual(loaded.size, fixtureDocument.size);

  const network = buildRoadNetwork(loaded);
  assert.ok(network.lanes.length > 0);
});
