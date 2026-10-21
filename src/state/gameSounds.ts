import { z } from "zod";

/**
 * Licences a game's sound may carry. `attribution` licences must credit
 * the work's title, author and source, so the schema requires them;
 * `nonCommercial` ones bar commercial use of the app while they ship.
 */
export const SOUND_LICENCES = {
  "CC0-1.0": {
    label: "Creative Commons 0",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    attribution: false,
    nonCommercial: false,
  },
  "CC-BY-4.0": {
    label: "Attribution 4.0",
    url: "https://creativecommons.org/licenses/by/4.0/",
    attribution: true,
    nonCommercial: false,
  },
  "CC-BY-SA-4.0": {
    label: "Attribution ShareAlike 4.0",
    url: "https://creativecommons.org/licenses/by-sa/4.0/",
    attribution: true,
    nonCommercial: false,
  },
  "CC-BY-NC-4.0": {
    label: "Attribution NonCommercial 4.0",
    url: "https://creativecommons.org/licenses/by-nc/4.0/",
    attribution: true,
    nonCommercial: true,
  },
  "CC-BY-NC-SA-4.0": {
    label: "Attribution NonCommercial ShareAlike 4.0",
    url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    attribution: true,
    nonCommercial: true,
  },
} as const;

export type SoundLicence = keyof typeof SOUND_LICENCES;

const AttributionLicenceSchema = z.enum([
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "CC-BY-NC-4.0",
  "CC-BY-NC-SA-4.0",
]);

const SoundCreditSchema = z.discriminatedUnion("licence", [
  z.object({
    licence: z.literal("CC0-1.0"),
    title: z.string().min(1).optional(),
    author: z.string().min(1).optional(),
    url: z.url().optional(),
  }),
  z.object({
    licence: AttributionLicenceSchema,
    title: z.string().min(1),
    author: z.string().min(1),
    url: z.url(),
  }),
]);
export type SoundCredit = z.infer<typeof SoundCreditSchema>;

/**
 * A file path inside the game's asset folder (`public/games/<id>/`):
 * relative, and unable to climb out of the folder.
 */
const AssetFileSchema = z
  .string()
  .regex(
    /^(?!\/)(?![a-z]+:)(?!.*(^|\/)\.\.(\/|$)).+$/i,
    "must be a path inside the game's asset folder",
  );

const SoundSlotConfigSchema = z.object({
  file: AssetFileSchema,
  credit: SoundCreditSchema,
});

/**
 * Sounds a game swaps in for the core ones. Each key is a slot; a slot
 * left out keeps the core sound, or stays silent when core has none.
 */
export const GameSoundsSchema = z.object({
  /** Played when a turn ends and the next begins */
  next_turn: SoundSlotConfigSchema.optional(),
  /** Looped under the final stretch of the countdown, rising to full volume */
  last_30: SoundSlotConfigSchema.optional(),
  /** Played once when the countdown runs out */
  overtime: SoundSlotConfigSchema.optional(),
});
export type GameSounds = z.infer<typeof GameSoundsSchema>;
export type SoundSlot = keyof GameSounds;

export const SOUND_SLOTS: readonly SoundSlot[] = [
  "next_turn",
  "last_30",
  "overtime",
];

/** Core sounds, relative to the deployment's base path. `null` means silent. */
export const CORE_SOUNDS: Record<SoundSlot, string | null> = {
  next_turn: "sound/next.wav",
  last_30: null,
  overtime: "sound/overtime.mp3",
};

/**
 * Relative URLs, so they resolve under the deployment's base path the
 * same way the core sounds do.
 */
export const resolveSoundUrls = (
  definition: { id: string; sounds?: GameSounds } | undefined,
): Record<SoundSlot, string | null> => {
  const resolve = (slot: SoundSlot): string | null => {
    const configured = definition?.sounds?.[slot];
    if (!definition || !configured) return CORE_SOUNDS[slot];
    return `games/${definition.id}/${configured.file}`;
  };
  return {
    next_turn: resolve("next_turn"),
    last_30: resolve("last_30"),
    overtime: resolve("overtime"),
  };
};

export interface SoundCreditView {
  slot: SoundSlot;
  title?: string;
  author?: string;
  url?: string;
  licence: SoundLicence;
  licenceLabel: string;
  licenceUrl: string;
  nonCommercial: boolean;
}

/** Credits for every sound the definition names, in slot order. */
export const soundCredits = (definition: {
  sounds?: GameSounds;
}): SoundCreditView[] =>
  SOUND_SLOTS.flatMap((slot) => {
    const configured = definition.sounds?.[slot];
    if (!configured) return [];
    const { credit } = configured;
    const licence = SOUND_LICENCES[credit.licence];
    return [
      {
        slot,
        ...(credit.title !== undefined ? { title: credit.title } : {}),
        ...(credit.author !== undefined ? { author: credit.author } : {}),
        ...(credit.url !== undefined ? { url: credit.url } : {}),
        licence: credit.licence,
        licenceLabel: licence.label,
        licenceUrl: licence.url,
        nonCommercial: licence.nonCommercial,
      },
    ];
  });

/**
 * One credit in the form the sounds' source credits them:
 * `<title> by <author> -- <url> -- License: <licence>`, with the parts a
 * public-domain sound leaves out dropped.
 */
export const creditLine = (credit: SoundCreditView): string =>
  [
    [credit.title, credit.author && `by ${credit.author}`]
      .filter(Boolean)
      .join(" "),
    credit.url,
    `License: ${credit.licenceLabel}`,
  ]
    .filter(Boolean)
    .join(" -- ");
