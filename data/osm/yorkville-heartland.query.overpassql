// Heartland & Yorkville, Illinois — 3-mile radius extract.
[out:json][timeout:90];
(
  way["highway"](41.610,-88.490,41.700,-88.370);
  way["building"](41.610,-88.490,41.700,-88.370);
  way["natural"="water"](41.610,-88.490,41.700,-88.370);
  way["waterway"](41.610,-88.490,41.700,-88.370);
  way["leisure"~"park|garden|playground|nature_reserve|pitch"](41.610,-88.490,41.700,-88.370);
  way["landuse"~"grass|forest|meadow|recreation_ground|cemetery|vineyard|orchard"](41.610,-88.490,41.700,-88.370);
  way["amenity"~"parking|school|hospital"](41.610,-88.490,41.700,-88.370);
  node["highway"="traffic_signals"](41.610,-88.490,41.700,-88.370);
  node["highway"~"stop|give_way"](41.610,-88.490,41.700,-88.370);
  node["natural"="tree"](41.610,-88.490,41.700,-88.370);
);
out body geom;
