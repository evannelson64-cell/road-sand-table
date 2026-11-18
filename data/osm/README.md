# OpenStreetMap extracts

This folder holds the **one-time** OpenStreetMap snapshots used by the real-map
mode. The browser never calls Overpass or any other map service; it reads the
converted document in `data/maps/`, or a file the user picks from their own disk.

## Default extract — Heartland, Yorkville, Illinois

- **Place:** Heartland, Yorkville, Illinois.
- **Bounds (south, west, north, east):**
  `41.610, -88.490, 41.700, -88.370` — roughly a 3-mile radius (10 km × 10 km).
- **Extract date:** 2026-11-17.
- **Query:** `yorkville-heartland.query.overpassql`.
- **Converted document:** `data/maps/yorkville-heartland.json` — 19,462 street
  links, 18,073 junctions, 12,116 buildings, 1,138 areas, 89 streams,
  80 signals, 96 stop signs and 5 yield signs.
- **Raw response:** `yorkville-heartland.raw.json` is ~32 MB and is **not
  committed**. Fetch it once, convert it, then keep or discard it locally.

The app ships the converted document only. To regenerate it, fetch the query
once with a descriptive `User-Agent`, save the response next to the query file,
then run:

```bash
node scripts/osm-to-graph.mjs \
  data/osm/yorkville-heartland.raw.json \
  data/maps/yorkville-heartland.json \
  --id=yorkville-heartland \
  --name="Heartland · Yorkville" \
  --place="Yorkville, Illinois" \
  --bounds=41.610,-88.490,41.700,-88.370 \
  --source="Overpass API extract, 2026-11-17"
```

## Test fixture — Healdsburg Plaza, California

The small original extract stays in the repository so the unit tests can check
the converter byte for byte:

- **Bounds:** `38.6078, -122.8730, 38.6134, -122.8665`.
- **Files:** `healdsburg-plaza.query.overpassql`,
  `healdsburg-plaza.raw.json` and `data/maps/healdsburg-plaza.json`.
- **Role:** a 600 m extract used by `tests/unit/osmMap.test.js` and by the
  smoke tests that load a custom map file.

## Using your own extract in the app

Open **Real map**, then choose **Load OSM file…**. The loader accepts:

- a saved Overpass JSON response (any document with an `elements` array), which
  is converted in the browser with `src/map/osmGraph.js`; or
- an already-converted map document (any document with an `edges` array).

Nothing is uploaded, and no request leaves the page. **Default map** switches
back to the committed Yorkville extract.

## Licence and attribution

Data is **© OpenStreetMap contributors**, available under the
[Open Database License (ODbL) 1.0](https://www.openstreetmap.org/copyright).
The app displays the required credit in real-map mode. Keep this attribution
with the data and with any converted derivative.

A converted map is a derivative database of the OSM data. If you redistribute
it, keep the ODbL terms and the “© OpenStreetMap contributors” credit.
