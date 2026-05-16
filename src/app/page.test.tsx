import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
