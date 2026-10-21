import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Chip, ChipRow, Segmented } from "./Chip";

function PricePicker() {
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <ChipRow>
      {[60, 70, 80].map((v) => (
        <Chip key={v} pressed={picked === v} onPress={() => setPicked(v)}>
          {v}
        </Chip>
      ))}
    </ChipRow>
  );
}

describe("Chip", () => {
  it("is a static label without onPress", () => {
    render(<Chip tone="muted">Built-in</Chip>);
    expect(screen.getByText("Built-in")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps its press from reaching the surface behind it", async () => {
    const advances: string[] = [];
    const pressed: string[] = [];
    render(
      // biome-ignore lint/a11y/useKeyWithClickEvents: stands in for the tap-to-advance surface
      // biome-ignore lint/a11y/noStaticElementInteractions: stands in for the tap-to-advance surface
      <div onClick={() => advances.push("tap")}>
        <Chip onPress={() => pressed.push("60")}>60</Chip>
      </div>,
    );
    await userEvent.click(screen.getByRole("button", { name: "60" }));
    expect(pressed).toEqual(["60"]);
    expect(advances).toEqual([]);
  });

  it("shows which value is chosen", async () => {
    render(<PricePicker />);
    const seventy = screen.getByRole("button", { name: "70" });
    expect(seventy).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(seventy);
    expect(seventy).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "80" }));
    expect(seventy).toHaveAttribute("aria-pressed", "false");
  });
});

function Views() {
  const [view, setView] = useState<"players" | "items">("players");
  return (
    <>
      <Segmented
        label="Show list"
        options={[
          { value: "players", label: "Players" },
          { value: "items", label: "Items" },
        ]}
        value={view}
        onChange={setView}
      />
      <p>Showing {view}</p>
    </>
  );
}

describe("Segmented", () => {
  it("switches between views as one named group", async () => {
    render(<Views />);
    expect(screen.getByRole("group", { name: "Show list" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Items" }));
    expect(screen.getByText("Showing items")).toBeVisible();
    expect(screen.getByRole("button", { name: "Items" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
