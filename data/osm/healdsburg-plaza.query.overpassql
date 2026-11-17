// Healdsburg Plaza, California — compact real-world demo extract.
// Fetched once from the Overpass API and committed; the app never calls OSM at runtime.
[out:json][timeout:60];
(
  way["highway"](38.6078,-122.8730,38.6134,-122.8665);
  way["building"](38.6078,-122.8730,38.6134,-122.8665);
  way["natural"="water"](38.6078,-122.8730,38.6134,-122.8665);
  way["waterway"](38.6078,-122.8730,38.6134,-122.8665);
  way["leisure"~"park|garden|playground|nature_reserve|pitch"](38.6078,-122.8730,38.6134,-122.8665);
  way["landuse"~"grass|forest|meadow|recreation_ground|cemetery|vineyard|orchard"](38.6078,-122.8730,38.6134,-122.8665);
  way["amenity"~"parking|school|hospital"](38.6078,-122.8730,38.6134,-122.8665);
  node["highway"="traffic_signals"](38.6078,-122.8730,38.6134,-122.8665);
  node["highway"~"stop|give_way"](38.6078,-122.8730,38.6134,-122.8665);
  node["natural"="tree"](38.6078,-122.8730,38.6134,-122.8665);
);
out body geom;
