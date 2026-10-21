import { describe, expect, it } from "vitest";
import {
  addSeat,
  followSeats,
  moveSeat,
  removeSeat,
  renameSeat,
  type Seat,
  setSeatColor,
} from "./seating";

const seats = (...names: string[]): Seat[] =>
  names.map((name) => ({ id: name.toLowerCase(), name }));

const COLORS = [
  { id: "red", label: "Red", color: "#f00" },
  { id: "blue", label: "Blue", color: "#00f" },
  { id: "green", label: "Green", color: "#0f0" },
];

describe("seating operations", () => {
  it("moves a seat to a new index", () => {
    const moved = moveSeat(seats("A", "B", "C"), 2, 0);
    expect(moved.map((s) => s.name)).toEqual(["C", "A", "B"]);
  });

  it("ignores a move off either end", () => {
    const list = seats("A", "B");
    expect(moveSeat(list, 0, -1)).toBe(list);
    expect(moveSeat(list, 1, 2)).toBe(list);
  });

  it("adds a seat with the next default name and the first free colour", () => {
    const list = [{ id: "a", name: "A", colorId: "red" }];
    expect(addSeat(list, { id: "n" }, COLORS)).toEqual([
      ...list,
      { id: "n", name: "Player 2", colorId: "blue" },
    ]);
  });

  it("trims a rename", () => {
    expect(renameSeat(seats("A", "B"), 1, "  Bea ")[1].name).toBe("Bea");
  });

  it("removes only a seat that exists", () => {
    const list = seats("A", "B");
    expect(removeSeat(list, 0).map((s) => s.name)).toEqual(["B"]);
    expect(removeSeat(list, 5)).toBe(list);
  });

  it("swaps colours when a seat takes one another seat holds", () => {
    const list: Seat[] = [
      { id: "a", name: "A", colorId: "red" },
      { id: "b", name: "B", colorId: "blue" },
    ];
    expect(setSeatColor(list, 0, "blue").map((s) => s.colorId)).toEqual([
      "blue",
      "red",
    ]);
  });
});

describe("followSeats", () => {
  it("keeps each claim on its seat through two reorders in a row", () => {
    const start = seats("A", "B", "C", "D");
    const once = moveSeat(start, 2, 1);
    const twice = moveSeat(once, 1, 0);
    const claims = followSeats(
      followSeats({ phone: 2, other: 0 }, start, once),
      once,
      twice,
    );
    expect(claims).toEqual({ phone: 0, other: 1 });
  });

  it("drops the claim on a removed seat and shifts the ones after it", () => {
    const start = seats("A", "B", "C");
    expect(
      followSeats(
        { gone: 1, after: 2, before: 0 },
        start,
        removeSeat(start, 1),
      ),
    ).toEqual({ after: 1, before: 0 });
  });

  it("keeps claims by index when the seating first appears", () => {
    expect(followSeats({ a: 0, b: 3 }, null, seats("A", "B"))).toEqual({
      a: 0,
    });
  });

  it("returns the same map when nothing moved", () => {
    const list = seats("A", "B");
    const claims = { a: 1 };
    expect(followSeats(claims, list, renameSeat(list, 0, "Z"))).toBe(claims);
  });
});
