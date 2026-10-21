import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { builtInDefinitions } from "./definitions";
import {
  CORE_SOUNDS,
  creditLine,
  GameSoundsSchema,
  resolveSoundUrls,
  SOUND_SLOTS,
  soundCredits,
} from "./gameSounds";

const credited = {
  licence: "CC-BY-4.0",
  title: "Chime",
  author: "Someone",
  url: "https://example.com/chime",
} as const;

describe("resolveSoundUrls", () => {
  it("uses the core sounds when no game is chosen", () => {
    expect(resolveSoundUrls(undefined)).toEqual(CORE_SOUNDS);
  });

  it("keeps the core turn and overtime sounds, and no loop, for a game that names none", () => {
    expect(resolveSoundUrls({ id: "alpha" })).toEqual({
      next_turn: "sound/next.wav",
      last_30: null,
      overtime: "sound/overtime.mp3",
    });
  });

  it("swaps in a game's files from its asset folder, slot by slot", () => {
    const sounds = GameSoundsSchema.parse({
      last_30: { file: "sound/loop.flac", credit: { licence: "CC0-1.0" } },
      overtime: { file: "sound/cue.mp3", credit: credited },
    });
    expect(resolveSoundUrls({ id: "alpha", sounds })).toEqual({
      next_turn: "sound/next.wav",
      last_30: "games/alpha/sound/loop.flac",
      overtime: "games/alpha/sound/cue.mp3",
    });
  });
});

describe("GameSoundsSchema", () => {
  it("requires title, author and source for a licence that requires credit", () => {
    const result = GameSoundsSchema.safeParse({
      next_turn: { file: "a.mp3", credit: { licence: "CC-BY-NC-4.0" } },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a public-domain sound with only its licence", () => {
    const result = GameSoundsSchema.safeParse({
      next_turn: { file: "a.mp3", credit: { licence: "CC0-1.0" } },
    });
    expect(result.success).toBe(true);
  });

  it("refuses a sound with no credit at all", () => {
    expect(
      GameSoundsSchema.safeParse({ next_turn: { file: "a.mp3" } }).success,
    ).toBe(false);
  });

  it("refuses a licence it does not know", () => {
    const result = GameSoundsSchema.safeParse({
      next_turn: { file: "a.mp3", credit: { ...credited, licence: "MIT" } },
    });
    expect(result.success).toBe(false);
  });

  it.each([
    "/sound/a.mp3",
    "../other/a.mp3",
    "sound/../../a.mp3",
    "https://example.com/a.mp3",
  ])("refuses %s, which is not inside the game's folder", (file) => {
    expect(
      GameSoundsSchema.safeParse({ next_turn: { file, credit: credited } })
        .success,
    ).toBe(false);
  });
});

describe("soundCredits", () => {
  it("lists credits in slot order with the licence spelled out", () => {
    const sounds = GameSoundsSchema.parse({
      overtime: {
        file: "b.mp3",
        credit: { ...credited, licence: "CC-BY-NC-4.0" },
      },
      next_turn: { file: "a.mp3", credit: credited },
    });
    expect(soundCredits({ sounds })).toEqual([
      expect.objectContaining({
        slot: "next_turn",
        licenceLabel: "Attribution 4.0",
        nonCommercial: false,
      }),
      expect.objectContaining({
        slot: "overtime",
        licenceLabel: "Attribution NonCommercial 4.0",
        licenceUrl: "https://creativecommons.org/licenses/by-nc/4.0/",
        nonCommercial: true,
      }),
    ]);
  });

  it("writes each credit as title, author, source and licence", () => {
    const [view] = soundCredits({
      sounds: GameSoundsSchema.parse({
        next_turn: { file: "a.mp3", credit: credited },
      }),
    });
    expect(creditLine(view)).toBe(
      "Chime by Someone -- https://example.com/chime -- License: Attribution 4.0",
    );
  });

  it("is empty for a game with core sounds only", () => {
    expect(soundCredits({})).toEqual([]);
  });
});

describe("built-in definitions", () => {
  it.each(
    builtInDefinitions.flatMap((definition) =>
      SOUND_SLOTS.flatMap((slot) => {
        const url = resolveSoundUrls(definition)[slot];
        return url ? [[definition.id, slot, url] as const] : [];
      }),
    ),
  )("%s ships its %s sound at public/%s", (_id, _slot, url) => {
    expect(existsSync(join(process.cwd(), "public", url))).toBe(true);
  });
});
