import fs from "node:fs";
import path from "node:path";
import { listFiles, REPO_ROOT } from "./ratchet";
import { codeOf } from "./styleScan";

/**
 * No local component takes a name the UI kit owns. A local `Button` or
 * `Sheet` reads as the kit's at every call site, so a reader trusts it to
 * carry the kit's focus ring, touch target and ARIA, and nothing says it
 * does not. If the local one really is different, name it for what it is
 * (`SeatNudge`, `PriceStepRow`); if it is not, import the kit's.
 *
 * The kit lives in src/components/ui. Its names are whatever it exports,
 * plus the names reserved below for primitives that are agreed but not yet
 * built, so the names cannot be taken in the meantime.
 */

const KIT_DIR = "src/components/ui";

const RESERVED = [
  "Badge",
  "Button",
  "Chip",
  "Disc",
  "Field",
  "Heading",
  "IconButton",
  "ListRow",
  "Prompt",
  "SectionLabel",
  "Sheet",
  "Stepper",
  "Toggle",
];

const DECLARED =
  /^(?:export\s+)?(?:default\s+)?(?:function\s+([A-Z]\w*)\s*[(<]|const\s+([A-Z]\w*)\s*(?::[^=]+)?=)/gm;

const componentsDeclaredIn = (source: string): string[] =>
  [...source.matchAll(DECLARED)].map((m) => m[1] ?? m[2]);

const kitNames = (): Set<string> => {
  const names = new Set(RESERVED);
  if (fs.existsSync(path.join(REPO_ROOT, KIT_DIR))) {
    for (const file of listFiles(KIT_DIR, [".ts", ".tsx"])) {
      for (const m of codeOf(file).matchAll(
        /^export\s+(?:function|const|class)\s+([A-Z]\w*)/gm,
      )) {
        names.add(m[1]);
      }
    }
  }
  return names;
};

describe("no local component shadows a UI kit name", () => {
  it("reads function and const component declarations", () => {
    expect(
      componentsDeclaredIn(
        [
          "export function Button({ children }: Props) {",
          "const Sheet = ({ open }: Props) => null;",
          "export const Chip: FC<Props> = () => null;",
          "function helper() {}",
          "  const Inner = 1;",
        ].join("\n"),
      ),
    ).toEqual(["Button", "Sheet", "Chip"]);
  });

  it("finds no component outside the kit under a kit name", () => {
    const kit = kitNames();
    const shadows = listFiles("src", [".tsx", ".ts"])
      .filter((f) => !f.startsWith(`${KIT_DIR}/`) && !/\.test\.tsx?$/.test(f))
      .flatMap((file) =>
        componentsDeclaredIn(codeOf(file))
          .filter((name) => kit.has(name))
          .map((name) => `  ${name}  (${file})`),
      );
    expect(
      shadows,
      `These declare a component under a name the UI kit owns, so every call site reads as the kit's component and is not:\n${shadows.join("\n")}\n\nImport the kit's version from ${KIT_DIR}, or rename the local one for what it actually is.`,
    ).toEqual([]);
  });
});
