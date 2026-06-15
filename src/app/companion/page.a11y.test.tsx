import { render } from "@testing-library/react";
import { axe } from "jest-axe";
import { describe, expect, it } from "vitest";
import { CodeEntryPanel } from "./CodeEntryPanel";

/*
 * Accessibility smoke tests (jest-axe). These catch STRUCTURAL a11y
 * issues — missing form labels, buttons without an accessible name,
 * duplicate ids, invalid aria. They do NOT catch colour-contrast or
 * focus-visibility: jsdom has no layout/style engine (and vitest runs
 * with css:false), so axe skips those rules here. The unreadable-connect-
 * button bug, for example, is a contrast issue these tests can't see —
 * that class of regression needs a real-browser axe pass
 * (@axe-core/playwright) wired into the Playwright suite.
 */
describe("companion accessibility", () => {
  it("code-entry panel has no structural axe violations", async () => {
    const { container } = render(<CodeEntryPanel />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
