/**
 * The small seating chart: one deterministic ring of jurors around an empty
 * middle, drawn at a glanceable size.
 *
 * The Live view's preview card is the only thing that draws it now. The Graph
 * view went back to the force-directed cloud (owner, 2026-09-04: "revert to
 * the previous one we had"), so the full courtroom plan this module used to
 * build is gone; what stays is the geometry the preview card needs.
 *
 * Angles are measured CLOCKWISE FROM THE TOP, so juror 1 sits at 12 o'clock,
 * juror 2 next clockwise, and the certificate at 180 degrees closes the ring
 * at the bottom. `polar` turns an angle into a screen point.
 */

export type Point = { x: number; y: number };

const TAU = Math.PI * 2;

/** The certificate always closes the ring at the bottom. */
export const CERTIFICATE_ANGLE = Math.PI;

/** Screen point for an angle measured clockwise from the top. */
export function polar(centre: Point, radius: number, angle: number): Point {
  return {
    x: centre.x + Math.sin(angle) * radius,
    y: centre.y - Math.cos(angle) * radius,
  };
}

/** Seat `index` of a `count`-seat ring: seat 0 at the top, then clockwise. */
export function seatAngle(index: number, count: number): number {
  return count <= 0 ? 0 : (index * TAU) / count;
}

/** Room around a small ring for the seat marks that sit on it. */
const MINI_RING_PADDING = 16;

/**
 * The seating chart at a glanceable size: seat 1 at the top, the rest
 * clockwise, the certificate closing it at the bottom.
 */
export function miniRing(
  seats: number,
  radius: number,
): {
  size: number;
  centre: Point;
  seats: Array<Point & { index: number; angle: number }>;
  certificate: Point;
} {
  const size = radius * 2 + MINI_RING_PADDING;
  const centre = { x: size / 2, y: size / 2 };
  const count = Math.max(0, Math.floor(seats));
  return {
    size,
    centre,
    seats: Array.from({ length: count }, (_, index) => {
      const angle = seatAngle(index, count);
      return { index, angle, ...polar(centre, radius, angle) };
    }),
    certificate: polar(centre, radius, CERTIFICATE_ANGLE),
  };
}
