import { isGroupLayer, isKnownLayer, type Layer } from "@album/document";
type Matrix = [number, number, number, number, number, number];
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
/** Match C1 renderer: top-left rotation, then group child scale, then ancestor transforms. */
export function framesWithinPage(
  layers: Layer[],
  width: number,
  height: number,
): boolean {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return false;
  const walk = (list: Layer[], parent: Matrix): boolean =>
    list.every((layer) => {
      if (!isKnownLayer(layer)) return false;
      if (
        ![layer.x, layer.y, layer.width, layer.height, layer.rotation].every(
          Number.isFinite,
        ) ||
        layer.width <= 0 ||
        layer.height <= 0
      )
        return false;
      const angle = (layer.rotation * Math.PI) / 180,
        c = Math.cos(angle),
        s = Math.sin(angle),
        m = multiply(parent, [c, s, -s, c, layer.x, layer.y]);
      for (const [x, y] of [
        [0, 0],
        [layer.width, 0],
        [0, layer.height],
        [layer.width, layer.height],
      ]) {
        const xx = m[0] * x + m[2] * y + m[4],
          yy = m[1] * x + m[3] * y + m[5];
        if (
          xx < -0.000001 ||
          yy < -0.000001 ||
          xx > width + 0.000001 ||
          yy > height + 0.000001
        )
          return false;
      }
      if (isGroupLayer(layer)) {
        const scale = layer.scale ?? 1;
        if (!Number.isFinite(scale) || scale <= 0) return false;
        return walk(layer.children, multiply(m, [scale, 0, 0, scale, 0, 0]));
      }
      return true;
    });
  return walk(layers, [1, 0, 0, 1, 0, 0]);
}
