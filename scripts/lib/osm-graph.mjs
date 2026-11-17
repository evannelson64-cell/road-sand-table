// One-time OSM extract converter.
//
// Turns a small Overpass API response into the static, compact road-graph JSON
// the app loads at runtime. Nothing in this file runs in the browser, and the
// app never contacts an OSM service — the converted file is committed.
//
// The output deliberately keeps only what the visual sand table needs:
// a routable street graph, building footprints, green/blue/parking areas,
// stream lines, and the handful of traffic-control points we asked Overpass for.

const METERS_PER_DEGREE = 111_320;

export const DRIVABLE_HIGHWAYS = new Set([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'road',
]);

const AREA_HIGHWAYS = new Set(['pedestrian', 'footway', 'living_street', 'service']);

const WATER_VALUES = new Set(['water', 'reservoir', 'riverbank', 'basin']);

const PARK_LEISURE = new Set([
  'park',
  'garden',
  'playground',
  'nature_reserve',
  'pitch',
  'common',
]);

const GREEN_LANDUSE = new Set([
  'grass',
  'forest',
  'meadow',
  'recreation_ground',
  'cemetery',
  'vineyard',
  'orchard',
]);

const PARKING_AMENITY = new Set(['parking', 'school', 'hospital']);

const WIDTH_BY_CLASS = {
  motorway: 15,
  motorway_link: 8,
  trunk: 13,
  trunk_link: 8,
  primary: 11,
  primary_link: 8,
  secondary: 9.5,
  secondary_link: 7.5,
  tertiary: 8.5,
  tertiary_link: 7,
  unclassified: 7.2,
  residential: 7.2,
  living_street: 6.4,
  service: 5.2,
  road: 6.4,
};

const SPEED_BY_CLASS = {
  motorway: 26,
  motorway_link: 14,
  trunk: 22,
  trunk_link: 14,
  primary: 16,
  primary_link: 13,
  secondary: 14,
  secondary_link: 12,
  tertiary: 12.5,
  tertiary_link: 11,
  unclassified: 10.5,
  residential: 9.5,
  living_street: 6,
  service: 5.5,
  road: 8,
};

const BUILDING_HEIGHT_BY_KIND = {
  house: 6.5,
  detached: 6.5,
  residential: 11,
  apartments: 13,
  retail: 8,
  commercial: 9,
  office: 12,
  hotel: 15,
  church: 14,
  school: 9,
  industrial: 8,
  warehouse: 8,
  garage: 3.4,
  garages: 3.4,
  shed: 3,
  hut: 3,
  parking: 3,
  government: 10,
  civic: 10,
  train_station: 9,
};

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function parseMaxspeed(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim().toLowerCase();
  if (!text || text === 'none' || text === 'signals' || text === 'variable') {
    return null;
  }
  if (text === 'walk') {
    return 5;
  }

  const number = Number.parseFloat(text);
  if (!Number.isFinite(number)) {
    return null;
  }
  if (text.includes('mph')) {
    return number * 0.44704;
  }
  if (text.includes('knots')) {
    return number * 0.514444;
  }
  // Bare values in an extract like this are km/h by OSM convention.
  return number / 3.6;
}

export function parseMeters(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const number = Number.parseFloat(String(value));
  return Number.isFinite(number) ? number : null;
}

function parseLanes(tags) {
  const value = Number.parseInt(tags.lanes ?? '', 10);
  return Number.isFinite(value) && value > 0 ? Math.min(8, value) : null;
}

function isOneWay(tags) {
  if (tags.oneway === '-1') {
    return true;
  }
  if (tags.junction === 'roundabout' || tags.junction === 'circular') {
    return tags.oneway === 'no' ? false : true;
  }
  return ['yes', 'true', '1'].includes(String(tags.oneway ?? '').toLowerCase());
}

function isReverseOneWay(tags) {
  return tags.oneway === '-1';
}

function roadWidth(tags, highway, oneway) {
  const tagged = parseMeters(tags.width);
  if (tagged && tagged > 2 && tagged < 40) {
    return round(tagged, 1);
  }
  const base = WIDTH_BY_CLASS[highway] ?? 6.5;
  const lanes = parseLanes(tags);
  if (!lanes) {
    return base;
  }
  if (oneway) {
    return round(Math.max(4.5, lanes * 3.3 + 1.4), 1);
  }
  return round(Math.max(6.2, lanes * 1.75 + 3.2), 1);
}

function roadSpeed(tags, highway) {
  const tagged = parseMaxspeed(tags.maxspeed);
  const fallback = SPEED_BY_CLASS[highway] ?? 8;
  if (!tagged) {
    return fallback;
  }
  // Keep the miniature calm; the demo is not a speed study.
  return round(Math.max(4, Math.min(20, tagged)), 2);
}

function buildingKind(tags) {
  return (
    tags.building ??
    tags['building:type'] ??
    tags.amenity ??
    tags.tourism ??
    tags.shop ??
    'yes'
  );
}

function buildingHeight(tags, kind) {
  const taggedHeight = parseMeters(tags.height);
  if (taggedHeight && taggedHeight >= 2 && taggedHeight <= 60) {
    return round(taggedHeight, 1);
  }
  const levels = Number.parseFloat(tags['building:levels'] ?? '');
  if (Number.isFinite(levels) && levels > 0) {
    return round(Math.min(60, levels * 3.2 + 0.8), 1);
  }
  return BUILDING_HEIGHT_BY_KIND[kind] ?? 7;
}

export function ringArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [ax, az] = points[index];
    const [bx, bz] = points[(index + 1) % points.length];
    area += ax * bz - bx * az;
  }
  return Math.abs(area) / 2;
}

export function simplifyRing(points, tolerance = 0.25) {
  const cleaned = [];
  for (const point of points) {
    const previous = cleaned[cleaned.length - 1];
    if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > tolerance) {
      cleaned.push(point);
    }
  }
  if (cleaned.length > 1) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= tolerance) {
      cleaned.pop();
    }
  }
  return cleaned;
}

function sampleRing(points, maxPoints) {
  if (points.length <= maxPoints) {
    return points;
  }
  const sampled = [];
  const step = points.length / maxPoints;
  for (let index = 0; index < maxPoints; index += 1) {
    sampled.push(points[Math.floor(index * step)]);
  }
  return sampled;
}

function areaKind(tags) {
  const highway = tags.highway;
  if (highway && AREA_HIGHWAYS.has(highway) && tags.area === 'yes') {
    return 'plaza';
  }
  if (WATER_VALUES.has(tags.natural) || WATER_VALUES.has(tags.landuse) || WATER_VALUES.has(tags.waterway)) {
    return 'water';
  }
  if (PARK_LEISURE.has(tags.leisure)) {
    return 'park';
  }
  if (GREEN_LANDUSE.has(tags.landuse) || tags.natural === 'wood' || tags.natural === 'grassland') {
    return 'green';
  }
  if (PARKING_AMENITY.has(tags.amenity)) {
    return 'parking';
  }
  return null;
}

function makeProjector(originLat, originLon) {
  const metersPerLon = METERS_PER_DEGREE * Math.cos((originLat * Math.PI) / 180);
  return (lat, lon) => [
    round((lon - originLon) * metersPerLon, 2),
    // Compass north is -Z, matching a conventional top-down map view.
    round(-(lat - originLat) * METERS_PER_DEGREE, 2),
  ];
}

/**
 * Convert an Overpass JSON response to the app's static map document.
 *
 * @param {object} raw Overpass JSON (`out body geom`)
 * @param {object} options
 * @param {string} options.id
 * @param {string} options.name
 * @param {string} [options.place]
 * @param {string} [options.source]
 */
export function convertOverpass(raw, options = {}) {
  if (!raw || !Array.isArray(raw.elements)) {
    throw new Error('Expected an Overpass JSON document with an elements array.');
  }

  const ways = raw.elements.filter((element) => element.type === 'way' && Array.isArray(element.nodes));
  const nodes = raw.elements.filter((element) => element.type === 'node');

  const bbox = options.bbox ?? deriveBbox(ways);
  const originLat = (bbox.south + bbox.north) / 2;
  const originLon = (bbox.west + bbox.east) / 2;
  const project = makeProjector(originLat, originLon);

  const roads = ways.filter((way) => DRIVABLE_HIGHWAYS.has(way.tags?.highway));
  const stats = {
    wayCount: ways.length,
    roadWays: roads.length,
    buildings: 0,
    areas: 0,
    signals: 0,
    stops: 0,
    yields: 0,
  };

  const nodesById = buildRoadGraph(roads, project, stats, bbox);
  const buildings = buildBuildings(ways, project, bbox);
  const { areas, streams } = buildAreas(ways, project, bbox);
  stats.buildings = buildings.length;
  stats.areas = areas.length;

  const signals = [];
  const stops = [];
  const yields = [];
  for (const node of nodes) {
    if (!Number.isFinite(node.lat) || !Number.isFinite(node.lon)) {
      continue;
    }
    const position = project(node.lat, node.lon);
    if (node.tags?.highway === 'traffic_signals') {
      signals.push(position);
    } else if (node.tags?.highway === 'stop') {
      stops.push(position);
    } else if (node.tags?.highway === 'give_way') {
      yields.push(position);
    }
  }
  stats.signals = signals.length;
  stats.stops = stops.length;
  stats.yields = yields.length;

  const width = Math.abs(project(originLat, bbox.east)[0] - project(originLat, bbox.west)[0]);
  const depth = Math.abs(project(bbox.south, originLon)[1] - project(bbox.north, originLon)[1]);

  return {
    id: options.id ?? 'osm-map',
    name: options.name ?? 'OpenStreetMap extract',
    place: options.place ?? '',
    attribution: '© OpenStreetMap contributors · ODbL 1.0',
    source: options.source ?? 'Overpass API one-time extract',
    bbox: {
      south: round(bbox.south, 7),
      west: round(bbox.west, 7),
      north: round(bbox.north, 7),
      east: round(bbox.east, 7),
    },
    origin: { lat: round(originLat, 7), lon: round(originLon, 7) },
    size: { width: round(width, 1), depth: round(depth, 1) },
    stats,
    nodes: nodesById.nodes,
    edges: nodesById.edges,
    buildings,
    areas,
    streams,
    signals,
    stops,
    yields,
  };
}

function deriveBbox(ways) {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const way of ways) {
    for (const point of way.geometry ?? []) {
      south = Math.min(south, point.lat);
      north = Math.max(north, point.lat);
      west = Math.min(west, point.lon);
      east = Math.max(east, point.lon);
    }
  }
  if (!Number.isFinite(south)) {
    throw new Error('The Overpass document has no usable way geometry.');
  }
  return { south, west, north, east };
}

function buildRoadGraph(roads, project, stats, bbox) {
  const corners = [
    project(bbox.south, bbox.west),
    project(bbox.north, bbox.east),
  ];
  const bounds = {
    minX: Math.min(corners[0][0], corners[1][0]) - 25,
    maxX: Math.max(corners[0][0], corners[1][0]) + 25,
    minZ: Math.min(corners[0][1], corners[1][1]) - 25,
    maxZ: Math.max(corners[0][1], corners[1][1]) + 25,
  };

  // Count every reference. Split a way wherever another road touches it, and
  // wherever it passes through the same vertex twice.
  const referenceCounts = new Map();
  for (const way of roads) {
    for (const reference of way.nodes) {
      referenceCounts.set(reference, (referenceCounts.get(reference) ?? 0) + 1);
    }
  }

  const nodes = [];
  const nodeIndex = new Map();
  const edges = [];
  const edgeKeys = new Set();

  function nodeFor(reference, lat, lon) {
    const existing = nodeIndex.get(reference);
    if (existing !== undefined) {
      return existing;
    }
    const [x, z] = project(lat, lon);
    const index = nodes.length;
    nodes.push({ id: reference, x, z });
    nodeIndex.set(reference, index);
    return index;
  }

  for (const way of roads) {
    const tags = way.tags ?? {};
    const highway = tags.highway;
    if (!DRIVABLE_HIGHWAYS.has(highway)) {
      continue;
    }

    const geometry = way.geometry ?? [];
    if (geometry.length < 2 || geometry.length !== way.nodes.length) {
      continue;
    }

    const reverse = isReverseOneWay(tags);
    const oneway = isOneWay(tags);

    // Split indices: every reference shared with another way, plus endpoints.
    const splitIndices = [0];
    for (let index = 1; index < way.nodes.length - 1; index += 1) {
      if ((referenceCounts.get(way.nodes[index]) ?? 0) >= 2) {
        splitIndices.push(index);
      }
    }
    splitIndices.push(way.nodes.length - 1);

    for (let part = 0; part < splitIndices.length - 1; part += 1) {
      const start = splitIndices[part];
      const end = splitIndices[part + 1];
      if (end <= start) {
        continue;
      }

      const fromRef = way.nodes[start];
      const toRef = way.nodes[end];
      if (fromRef === toRef) {
        continue;
      }

      const points = [];
      for (let index = start; index <= end; index += 1) {
        const [x, z] = project(geometry[index].lat, geometry[index].lon);
        const previous = points[points.length - 1];
        if (!previous || Math.hypot(x - previous[0], z - previous[1]) > 0.2) {
          points.push([x, z]);
        }
      }
      if (points.length < 2) {
        continue;
      }

      // Ways are returned whole by Overpass, so a boundary road can run far
      // outside the extract. Keep the map tidy and bounded.
      if (points.some(([x, z]) => (
        x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ
      ))) {
        continue;
      }

      let length = 0;
      for (let index = 1; index < points.length; index += 1) {
        length += Math.hypot(
          points[index][0] - points[index - 1][0],
          points[index][1] - points[index - 1][1],
        );
      }
      if (length < 1.2) {
        continue;
      }

      const fromNode = reverse
        ? nodeFor(toRef, geometry[end].lat, geometry[end].lon)
        : nodeFor(fromRef, geometry[start].lat, geometry[start].lon);
      const toNode = reverse
        ? nodeFor(fromRef, geometry[start].lat, geometry[start].lon)
        : nodeFor(toRef, geometry[end].lat, geometry[end].lon);

      const oriented = reverse ? points.slice().reverse() : points;
      const key = `${way.id}:${start}:${end}:${reverse ? 'r' : 'f'}`;
      if (edgeKeys.has(key)) {
        continue;
      }
      edgeKeys.add(key);

      const privateAccess = ['private', 'no', 'customers', 'delivery'].includes(tags.access);
      const serviceBlocked = highway === 'service' &&
        ['parking_aisle', 'driveway', 'drive-through', 'emergency_access'].includes(tags.service);

      edges.push({
        id: key,
        from: fromNode,
        to: toNode,
        points: oriented,
        width: roadWidth(tags, highway, oneway),
        oneway,
        class: highway,
        speed: roadSpeed(tags, highway),
        name: tags.name ?? '',
        bridge: tags.bridge === 'yes' || tags.bridge === 'viaduct',
        tunnel: tags.tunnel === 'yes' || tags.layer === '-1',
        lanes: parseLanes(tags) ?? (oneway ? 1 : 2),
        service: tags.service ?? '',
        access: tags.access ?? '',
        // Parking aisles, driveways and private ways stay visible, but the
        // demo's traffic stays on the public street network.
        drivable: !privateAccess && !serviceBlocked,
      });
    }
  }

  // Drop nodes that no edge uses, then remap.
  const used = new Set();
  for (const edge of edges) {
    used.add(edge.from);
    used.add(edge.to);
  }
  const remap = new Map();
  const compactNodes = [];
  for (let index = 0; index < nodes.length; index += 1) {
    if (!used.has(index)) {
      continue;
    }
    remap.set(index, compactNodes.length);
    compactNodes.push(nodes[index]);
  }
  for (const edge of edges) {
    edge.from = remap.get(edge.from);
    edge.to = remap.get(edge.to);
  }

  stats.roadNodes = compactNodes.length;
  stats.roadEdges = edges.length;
  return { nodes: compactNodes, edges };
}

function boundsFor(project, bbox, margin) {
  const a = project(bbox.south, bbox.west);
  const b = project(bbox.north, bbox.east);
  return {
    minX: Math.min(a[0], b[0]) - margin,
    maxX: Math.max(a[0], b[0]) + margin,
    minZ: Math.min(a[1], b[1]) - margin,
    maxZ: Math.max(a[1], b[1]) + margin,
  };
}

function insideBounds(points, bounds) {
  return points.every(([x, z]) => (
    x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ
  ));
}

function buildBuildings(ways, project, bbox) {
  const buildings = [];
  const bounds = boundsFor(project, bbox, 20);
  for (const way of ways) {
    const tags = way.tags ?? {};
    if (!tags.building || tags.building === 'no' || tags.building === 'roof') {
      continue;
    }
    if (!Array.isArray(way.geometry) || way.geometry.length < 4) {
      continue;
    }

    const ring = simplifyRing(
      way.geometry.map((point) => project(point.lat, point.lon)),
      0.3,
    );
    if (ring.length < 3 || !insideBounds(ring, bounds)) {
      continue;
    }
    const area = ringArea(ring);
    if (area < 10) {
      continue;
    }

    const kind = buildingKind(tags);
    buildings.push({
      points: sampleRing(ring, 22),
      height: buildingHeight(tags, kind),
      kind,
    });
  }
  return buildings;
}

function buildAreas(ways, project, bbox) {
  const areas = [];
  const streams = [];
  const bounds = boundsFor(project, bbox, 30);

  for (const way of ways) {
    const tags = way.tags ?? {};
    if (!Array.isArray(way.geometry) || way.geometry.length < 2) {
      continue;
    }

    const kind = areaKind(tags);
    const isStream = ['stream', 'ditch', 'drain', 'river'].includes(tags.waterway) && tags.area !== 'yes';
    if (!kind && !isStream) {
      continue;
    }

    const projected = way.geometry.map((point) => project(point.lat, point.lon));
    if (!insideBounds(projected, bounds)) {
      continue;
    }
    if (isStream) {
      streams.push({
        points: projected.map((point) => [point[0], point[1]]),
        width: tags.waterway === 'river' ? 8 : 2.4,
        name: tags.name ?? '',
      });
      continue;
    }

    const ring = simplifyRing(projected, 0.35);
    if (ring.length < 3) {
      continue;
    }
    const area = ringArea(ring);
    if (kind !== 'parking' && area < 30) {
      continue;
    }
    if (kind === 'parking' && area < 60) {
      continue;
    }

    areas.push({
      kind,
      points: sampleRing(ring, 36),
      name: tags.name ?? '',
    });
  }

  return { areas, streams };
}
