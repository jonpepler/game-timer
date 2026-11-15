import { describe, expect, it } from "vitest";
import {
  GameThemeSchema,
  REQUIRED_COLOUR_TOKENS,
  schemeTokens,
  seatNeedsInk,
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

describe("role grounds", () => {
  const grounds = {
    head: {
      surface: "#221122",
      "surface-elevated": "#332233",
      "surface-muted": "#443344",
    },
  };

  it("accepts a ground per role, each setting the three surfaces", () => {
    const theme = valid();
    expect(issues({ ...theme, dark: { ...theme.dark, grounds } })).toBe("");
  });

  it("rejects a ground that leaves a surface out or names an unknown token", () => {
    const theme = valid();
    expect(
      issues({
        ...theme,
        dark: { ...theme.dark, grounds: { head: { surface: "#221122" } } },
      }),
    ).not.toBe("");
    expect(
      issues({
        ...theme,
        dark: {
          ...theme.dark,
          grounds: { head: { ...grounds.head, glow: "#FFFFFF" } },
        },
      }),
    ).not.toBe("");
  });

  it("lets a ground set its own ink, as a light board on a dark scheme", () => {
    const theme = GameThemeSchema.parse({
      ...valid(),
      dark: {
        ...valid().dark,
        grounds: {
          head: {
            surface: "#E0B870",
            "surface-elevated": "#EAC889",
            "surface-muted": "#D4AA60",
            text: "#1F1D1C",
          },
        },
      },
    });
    const css = themeCss({ definitionId: "fixture", theme });
    const block = css.slice(css.indexOf('[data-ground="head"]'));
    expect(block).toContain("--color-text: #1F1D1C;");
    // Names on a light ground are pulled to the ink, as on the light scheme.
    expect(block).toContain("--seat-text-ink: 100%;");
    expect(block).toContain("--clock-inactive-opacity: 0.5;");
  });

  it("swaps the surfaces while that role's holder takes their turn", () => {
    const theme = GameThemeSchema.parse({
      ...valid(),
      dark: { ...valid().dark, grounds },
    });
    const css = themeCss({ definitionId: "fixture", theme });
    expect(css).toContain(
      'html[data-game-theme="fixture"][data-scheme="dark"][data-ground="head"] {',
    );
    expect(css).toContain("--color-surface: #221122;");
    expect(css).not.toContain('[data-scheme="light"][data-ground');
  });
});

describe("seatNeedsInk", () => {
  const theme = GameThemeSchema.parse({
    ...valid(),
    dark: {
      ...valid().dark,
      grounds: {
        head: {
          surface: "#4E3D5C",
          "surface-elevated": "#433451",
          "surface-muted": "#3A2C47",
        },
      },
    },
  });

  it("asks for ink when a seat colour falls under 3:1 on the ground in play", () => {
    expect(seatNeedsInk(theme, "dark", "head", "#7B3F8C")).toBe(true);
    expect(seatNeedsInk(theme, "dark", "head", "#F0C63A")).toBe(false);
  });

  it("reads the scheme's own surface outside a ground, and leaves CSS colours alone", () => {
    expect(seatNeedsInk(theme, "dark", undefined, "#2A2A2E")).toBe(true);
    expect(seatNeedsInk(theme, "dark", undefined, "var(--color-text)")).toBe(
      false,
    );
  });
});
