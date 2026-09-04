import { describe, expect, it } from "vitest";

import { miniRing, polar, seatAngle } from "./courtroom-layout";

const TAU = Math.PI * 2;

describe("polar", () => {
  it("measures clockwise from the top", () => {
    const centre = { x: 100, y: 100 };
    expect(polar(centre, 10, 0)).toEqual({ x: 100, y: 90 });
    const right = polar(centre, 10, Math.PI / 2);
    expect(right.x).toBeCloseTo(110, 6);
    expect(right.y).toBeCloseTo(100, 6);
    const bottom = polar(centre, 10, Math.PI);
    expect(bottom.x).toBeCloseTo(100, 6);
    expect(bottom.y).toBeCloseTo(110, 6);
  });
});

describe("seatAngle", () => {
  it("spaces a ring evenly from the top, clockwise", () => {
    expect(seatAngle(0, 5)).toBe(0);
    expect(seatAngle(1, 5)).toBeCloseTo(TAU / 5, 6);
    expect(seatAngle(4, 5)).toBeCloseTo((4 * TAU) / 5, 6);
  });

  it("survives an empty ring", () => {
    expect(seatAngle(0, 0)).toBe(0);
  });
});

describe("miniRing", () => {
  it("draws the seating chart at a glanceable size", () => {
    const ring = miniRing(5, 36);
    expect(ring.size).toBe(88);
    expect(ring.seats).toHaveLength(5);
    const [first] = ring.seats;
    // Seat 1 at the top, the certificate closing the ring at the bottom.
    expect(first?.x).toBeCloseTo(ring.centre.x, 6);
    expect(first?.y).toBeCloseTo(ring.centre.y - 36, 6);
    expect(ring.certificate.x).toBeCloseTo(ring.centre.x, 6);
    expect(ring.certificate.y).toBeCloseTo(ring.centre.y + 36, 6);
    for (const seat of ring.seats) {
      expect(Math.hypot(seat.x - ring.centre.x, seat.y - ring.centre.y)).toBeCloseTo(36, 6);
    }
  });

  it("survives an empty jury", () => {
    expect(miniRing(0, 36).seats).toEqual([]);
  });
});
