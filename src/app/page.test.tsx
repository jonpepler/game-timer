import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { builtInDefinitions } from "@/state/definitions";
import { creditLine, soundCredits } from "@/state/gameSounds";
import Home from "./page";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("landing page", () => {
  it("renders a link that starts a new game", () => {
    render(<Home />);
    const link = screen.getByRole("link", { name: /new game/i });
    expect(link).toHaveAttribute("href", "/timer");
  });

  it("credits every sound a bundled game ships, with its licence", () => {
    render(<Home />);
    const credited = builtInDefinitions.filter(
      (definition) => soundCredits(definition).length > 0,
    );
    expect(credited.length).toBeGreaterThan(0);
    for (const definition of credited) {
      const group = screen.getByRole("region", {
        name: `${definition.name} sound credits`,
      });
      for (const credit of soundCredits(definition)) {
        expect(group).toHaveTextContent(creditLine(credit));
      }
    }
  });
});
