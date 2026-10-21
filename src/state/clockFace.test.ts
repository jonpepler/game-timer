import { describe, expect, it } from "vitest";
import {
  CLOCK_FACE_PRESETS,
  ClockFaceSchema,
  DEFAULT_CLOCK_FACE,
} from "./clockFace";

const issues = (face: unknown) => {
  const result = ClockFaceSchema.safeParse(face);
  return result.success
    ? []
    : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};

describe("clock face schema", () => {
  it.each([
    [
      "the default",
      { track: { style: "hairline" }, progress: { style: "sweep" } },
    ],
    [
      "a sweep between double rules with an ornament",
      {
        track: { style: "double-rule" },
        progress: { style: "sweep", cap: "butt" },
        ornament: { slot: "above", kind: "rule-diamond" },
        numerals: { face: "old-standard-700" },
        players: { cap: "butt", active: "weight", keyline: true },
        paused: { cue: "tone-hollow" },
      },
    ],
    [
      "filled cells with a hatched overtime",
      {
        track: { style: "cells", count: 24 },
        progress: { style: "fill" },
        overtime: { style: "hatch" },
      },
    ],
    [
      "a light sweep inside ticks with a pointer",
      {
        track: { style: "ticks", divisions: 20 },
        progress: { style: "sweep", weight: "light", marker: "pointer" },
        ornament: { slot: "below", kind: "chevron-band" },
      },
    ],
  ])("accepts %s", (_, face) => {
    expect(issues(face)).toEqual([]);
  });

  it.each([
    [
      "clock minutes as ticks",
      {
        track: { style: "ticks", divisions: 60 },
        progress: { style: "sweep", weight: "light" },
      },
      "track",
    ],
    [
      "a fill on a continuous track",
      { track: { style: "hairline" }, progress: { style: "fill" } },
      "progress.style: fill needs a ticks or cells track",
    ],
    [
      "a sweep over cells",
      { track: { style: "cells", count: 20 }, progress: { style: "sweep" } },
      "progress.style: a cells track is read by its cells; use fill",
    ],
    [
      "a light sweep in a band",
      {
        track: { style: "band" },
        progress: { style: "sweep", weight: "light" },
      },
      "progress.weight: a light sweep is lost inside a band",
    ],
    [
      "a heavy sweep in ticks",
      {
        track: { style: "ticks", divisions: 10 },
        progress: { style: "sweep", weight: "heavy" },
      },
      "progress.weight",
    ],
    [
      "a pointer on a heavy sweep",
      {
        track: { style: "hairline" },
        progress: { style: "sweep", weight: "heavy", marker: "pointer" },
      },
      "progress.marker",
    ],
    [
      "two ornaments",
      {
        track: { style: "hairline" },
        progress: { style: "sweep" },
        ornament: [{ slot: "above", kind: "diamond" }],
      },
      "ornament",
    ],
    [
      "an ornament without a kind",
      {
        track: { style: "hairline" },
        progress: { style: "sweep" },
        ornament: { slot: "above" },
      },
      "ornament.kind",
    ],
    [
      "a numeral face off the list",
      {
        track: { style: "hairline" },
        progress: { style: "sweep" },
        numerals: { face: "cinzel-700" },
      },
      "numerals.face",
    ],
    [
      "an overtime lap",
      {
        track: { style: "hairline" },
        progress: { style: "sweep" },
        overtime: { style: "lap" },
      },
      "overtime.style",
    ],
    [
      "a raw size",
      {
        track: { style: "hairline" },
        progress: { style: "sweep" },
        strokeWidth: 4,
      },
      "Unrecognized key",
    ],
    [
      "colours on the face",
      {
        track: { style: "hairline" },
        progress: { style: "sweep" },
        tokens: { clockTrack: "#000000" },
      },
      "Unrecognized key",
    ],
  ])("rejects %s", (_, face, expected) => {
    expect(issues(face).join("\n")).toContain(expected);
  });

  it("fills today's ring in from the defaults", () => {
    expect(DEFAULT_CLOCK_FACE).toEqual({
      track: { style: "hairline" },
      progress: {
        style: "sweep",
        weight: "regular",
        cap: "round",
        marker: "none",
      },
      ornament: { slot: "none" },
      numerals: { face: "body" },
      players: { cap: "round", active: "glow", keyline: false },
      overtime: { style: "wash" },
      paused: { cue: "tone" },
    });
  });

  it("builds a face from a preset", () => {
    expect(ClockFaceSchema.parse({ preset: "theodolite" })).toEqual(
      ClockFaceSchema.parse(CLOCK_FACE_PRESETS.theodolite),
    );
  });

  it("lets a theme replace one of a preset's options", () => {
    const face = ClockFaceSchema.parse({
      preset: "theodolite",
      ornament: { slot: "above", kind: "rule-diamond" },
    });
    expect(face.ornament).toEqual({
      slot: "above",
      kind: "rule-diamond",
      overtime: {},
    });
    expect(face.track).toEqual({ style: "ticks", divisions: 20 });
  });

  it("rejects a preset off the list", () => {
    expect(issues({ preset: "sundial" }).join("\n")).toContain("preset");
  });

  it("takes an overtime shape for the ornament", () => {
    const face = ClockFaceSchema.parse({
      preset: "survey-plate",
      ornament: {
        slot: "above",
        kind: "rule-diamond",
        overtime: { kind: "rule-star" },
      },
    });
    expect(face.ornament).toMatchObject({ overtime: { kind: "rule-star" } });
    expect(
      issues({
        preset: "survey-plate",
        ornament: {
          slot: "above",
          kind: "rule-diamond",
          overtime: { kind: "x" },
        },
      }).join("\n"),
    ).toContain("ornament.overtime.kind");
  });
});
