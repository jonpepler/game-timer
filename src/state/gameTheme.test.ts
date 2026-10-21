import { describe, expect, it } from "vitest";
import {
  GameThemeSchema,
  REQUIRED_COLOUR_TOKENS,
  schemeTokens,
  themeCss,
} from "./gameTheme";

const colours = (surface: string, text: string) =>
  Object.fromEntries(
    REQUIRED_COLOUR_TOKENS.map((t) => [
      t,
      t.startsWith("surface") ? surface : text,
    ]),
  );

const scheme = (surface: string, text: string) => ({
  colors: colours(surface, text),
  elevation: { backdrop: "#00000080", shadow: "#000000" },
});

const valid = () => ({
  schemaVersion: 1,
  name: "Fixture",
  fonts: {
    body: "inter",
    display: "cinzel",
    label: "inter",
    numeric: "inter",
  },
  light: scheme("#FFFFFF", "#111111"),
  dark: scheme("#111111", "#FFFFFF"),
});

const issues = (theme: unknown) => {
  const result = GameThemeSchema.safeParse(theme);
  return result.success
    ? ""
    : result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("\n");
};

describe("game theme schema", () => {
  it("accepts a theme that sets only tokens, and gives it the default clock", () => {
    const parsed = GameThemeSchema.parse(valid());
    expect(parsed.clock.track).toEqual({ style: "hairline" });
    expect(parsed.defaultScheme).toBeUndefined();
  });

  it("accepts an ornament, a texture, radii and a default scheme", () => {
    const theme = valid();
    expect(
      issues({
        ...theme,
        defaultScheme: "dark",
        radius: { control: 2, sheet: 0 },
        light: {
          ...theme.light,
          colors: {
            ...theme.light.colors,
            frame: "#111111",
            texture: "#886622",
          },
          ornament: { frame: "double-rule", texture: "grain" },
        },
      }),
    ).toBe("");
  });

  it.each<[string, (t: ReturnType<typeof valid>) => unknown, string]>([
    [
      "a colour token the app does not declare",
      (t) => ({
        ...t,
        light: {
          ...t.light,
          colors: { ...t.light.colors, "button-glow": "#FFFFFF" },
        },
      }),
      "Unrecognized key",
    ],
    [
      "a scheme missing a required colour",
      (t) => {
        const { danger: _, ...rest } = t.dark.colors;
        return { ...t, dark: { ...t.dark, colors: rest } };
      },
      "dark.colors.danger",
    ],
    [
      "a named colour, which could smuggle in anything",
      (t) => ({
        ...t,
        light: { ...t.light, colors: { ...t.light.colors, accent: "url(x)" } },
      }),
      "light.colors.accent",
    ],
    [
      "a see-through surface",
      (t) => ({
        ...t,
        light: {
          ...t.light,
          colors: { ...t.light.colors, surface: "#FFFFFF80" },
        },
      }),
      "a surface must be opaque",
    ],
    [
      "a face off the bundled list",
      (t) => ({ ...t, fonts: { ...t.fonts, body: "comic-sans" } }),
      "fonts.body",
    ],
    [
      "a numeric face without tabular figures",
      (t) => ({ ...t, fonts: { ...t.fonts, numeric: "cinzel" } }),
      "the numeric face needs tabular figures",
    ],
    [
      "a frame with no frame colour",
      (t) => ({ ...t, dark: { ...t.dark, ornament: { frame: "spine" } } }),
      "a frame needs a frame colour",
    ],
    [
      "a corner past the scale",
      (t) => ({ ...t, radius: { panel: 40 } }),
      "radius.panel",
    ],
    [
      "a component or layout setting",
      (t) => ({ ...t, layout: { ringSize: 300 } }),
      "Unrecognized key",
    ],
    [
      "a raw CSS value",
      (t) => ({ ...t, css: "body { display: none }" }),
      "Unrecognized key",
    ],
  ])("rejects %s", (_, mutate, expected) => {
    expect(issues(mutate(valid()))).toContain(expected);
  });
});

describe("theme stylesheet", () => {
  it("scopes each scheme to its game and scheme on the html element", () => {
    const theme = GameThemeSchema.parse(valid());
    const css = themeCss({ definitionId: "fixture", theme });
    expect(css).toContain(
      'html[data-game-theme="fixture"][data-scheme="light"] {',
    );
    expect(css).toContain(
      'html[data-game-theme="fixture"][data-scheme="dark"] {',
    );
    expect(css).toContain("--color-surface: #FFFFFF;");
    expect(css).toContain("--font-display: var(--font-face-cinzel);");
  });

  it("caps the overtime wash so the value keeps 3:1 on it", () => {
    const theme = GameThemeSchema.parse(valid());
    // White text on a white overtime wash cannot take the full wash.
    const dark = schemeTokens(theme, "dark");
    expect(Number(dark["--clock-wash-cap"])).toBeLessThan(1);
    expect(dark["--clock-inactive-opacity"]).toBe("0.3");
    expect(schemeTokens(theme, "light")["--clock-inactive-opacity"]).toBe(
      "0.5",
    );
  });
});
