# OpenStreetMap extract — Healdsburg Plaza

This folder holds the **one-time** OpenStreetMap extract used by the real-map
mode. The browser never calls Overpass or any other map service; it only reads
the converted document at `data/maps/healdsburg-plaza.json`.

## Provenance

- **Place:** Healdsburg Plaza, Healdsburg, California.
- **Bounds (south, west, north, east):**
  `38.6078, -122.8730, 38.6134, -122.8665`.
- **Extract date:** 2026-11-17.
- **Source:** Overpass API response saved from `healdsburg-plaza.query.overpassql`.
- **Query:** streets, buildings, water, parks, parking, tree nodes, traffic
  signals, stop signs and give-way signs inside the bounds.

## Licence and attribution

Data is **© OpenStreetMap contributors**, available under the
[Open Database License (ODbL) 1.0](https://www.openstreetmap.org/copyright).
The app displays the required credit in real-map mode. Keep this attribution
with the data and with any converted derivative.

## Regenerating the app document

```bash
node scripts/osm-to-graph.mjs \
  data/osm/healdsburg-plaza.raw.json \
  data/maps/healdsburg-plaza.json \
  --id=healdsburg-plaza \
  --name="Healdsburg Plaza" \
  --place="Healdsburg, California" \
  --bounds=38.6078,-122.8730,38.6134,-122.8665 \
  --source="Overpass API extract, 2026-11-17"
```

To refresh the snapshot, fetch the query once with a descriptive `User-Agent`,
replace `healdsburg-plaza.raw.json`, update the extract date in the command and
in `data/maps/healdsburg-plaza.json`, then re-run the converter and the tests.

A converted map is a derivate database of the OSM data. If you redistribute it,
keep the ODbL terms and the “© OpenStreetMap contributors” credit.
