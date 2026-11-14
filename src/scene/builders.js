// Shared mesh helpers for the low-poly tabletop.
import * as THREE from 'three';

/**
 * Build a flat ribbon along a polyline in the X/Z plane.
 * Used for road surfaces and their wider sidewalk underlays.
 */
export function ribbonGeometry(points, width) {
  const vertices = [];
  const indices = [];

  for (let index = 0; index < points.length; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const length = Math.hypot(dx, dz) || 1;
    const perpX = -dz / length;
    const perpZ = dx / length;

    vertices.push(
      points[index].x + perpX * width * 0.5,
      0,
      points[index].z + perpZ * width * 0.5,
      points[index].x - perpX * width * 0.5,
      0,
      points[index].z - perpZ * width * 0.5,
    );

    if (index > 0) {
      const base = (index - 1) * 2;
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A flat, non-shadow-receiving box used for road paint and small props. */
export function flatBox(width, height, depth, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

export function lambert(color, options = {}) {
  return new THREE.MeshLambertMaterial({
    color,
    flatShading: true,
    ...options,
  });
}

/** A four-sided hip roof that fits a rectangular house body. */
export function roofGeometry(width, depth, height) {
  const w = width * 0.56;
  const d = depth * 0.56;
  const vertices = new Float32Array([
    -w, 0, -d,
    w, 0, -d,
    w, 0, d,
    -w, 0, d,
    0, height, 0,
  ]);
  const indices = [
    0, 4, 1,
    1, 4, 2,
    2, 4, 3,
    3, 4, 0,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
