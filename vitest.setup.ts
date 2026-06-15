import "@testing-library/jest-dom/vitest";
import { expect } from "vitest";
import { toHaveNoViolations } from "jest-axe";

// jest-axe matcher for accessibility assertions: `expect(await
// axe(container)).toHaveNoViolations()`. NOTE: this runs in jsdom, which
// has no layout engine and (with vitest css:false) no styles — so axe's
// color-contrast and focus-visibility rules can't be evaluated here. It
// catches STRUCTURAL issues (missing labels/names, bad roles, dup ids,
// aria misuse). For contrast/focus, use a real-browser axe pass.
expect.extend(toHaveNoViolations);
