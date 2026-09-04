import { describe, expect, it } from "vitest";

import { assignDebateRole, rankDebateRoles, type RoleSeat } from "./debate-role";

function seat(modelId: string, role: string, active = true): RoleSeat {
  return { modelId, role, active };
}

describe("assignDebateRole", () => {
  it("starts an empty pool with the first tie-break role", () => {
    expect(assignDebateRole([], "model-a")).toBe("INVESTIGATOR");
  });

  it("keeps the tie-break order on a balanced pool", () => {
    const pool = [
      seat("model-a", "INVESTIGATOR"),
      seat("model-a", "SKEPTIC"),
      seat("model-a", "SOURCE_AUTHENTICITY"),
    ];

    expect(assignDebateRole(pool, "model-a")).toBe("INVESTIGATOR");
    expect(rankDebateRoles(pool, "model-a")).toEqual([
      "INVESTIGATOR",
      "SKEPTIC",
      "SOURCE_AUTHENTICITY",
    ]);
  });

  it("fills the missing role on a model with two skeptics", () => {
    const pool = [
      seat("model-a", "SKEPTIC"),
      seat("model-a", "SKEPTIC"),
      seat("model-a", "SOURCE_AUTHENTICITY"),
    ];

    expect(assignDebateRole(pool, "model-a")).toBe("INVESTIGATOR");
    // Least represented first: the two skeptics rank last.
    expect(rankDebateRoles(pool, "model-a")).toEqual([
      "INVESTIGATOR",
      "SOURCE_AUTHENTICITY",
      "SKEPTIC",
    ]);
  });

  it("breaks a tie between two empty roles in order", () => {
    const pool = [seat("model-a", "INVESTIGATOR")];

    expect(assignDebateRole(pool, "model-a")).toBe("SKEPTIC");
    expect(rankDebateRoles(pool, "model-a")).toEqual([
      "SKEPTIC",
      "SOURCE_AUTHENTICITY",
      "INVESTIGATOR",
    ]);
  });

  it("counts only the seats that run the same model", () => {
    const pool = [
      seat("model-a", "INVESTIGATOR"),
      seat("model-b", "SKEPTIC"),
      seat("model-b", "SKEPTIC"),
      seat("model-b", "SOURCE_AUTHENTICITY"),
    ];

    // model-a holds one investigator, so the next model-a seat is a skeptic.
    expect(assignDebateRole(pool, "model-a")).toBe("SKEPTIC");
    // model-b is short an investigator, whatever model-a holds.
    expect(assignDebateRole(pool, "model-b")).toBe("INVESTIGATOR");
  });

  it("ignores deactivated seats: the draw never sees them", () => {
    const pool = [
      seat("model-a", "INVESTIGATOR", false),
      seat("model-a", "SKEPTIC"),
      seat("model-a", "SOURCE_AUTHENTICITY"),
    ];

    expect(assignDebateRole(pool, "model-a")).toBe("INVESTIGATOR");
  });

  it("ignores a label that is not one of the debate roles", () => {
    const pool = [seat("model-a", "ANALYST"), seat("model-a", "INVESTIGATOR")];

    expect(assignDebateRole(pool, "model-a")).toBe("SKEPTIC");
  });
});
