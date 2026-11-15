import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RoleSheet } from "./RoleSheet";

const roles = [
  { id: "member", label: "Member" },
  { id: "head", label: "Head", mark: "crown" as const },
];

describe("RoleSheet", () => {
  it("shows each player's role and reports a change", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RoleSheet
        title="Change roles"
        roles={roles}
        players={[
          { name: "Ann", color: "#7b3f8c", roleId: "head" },
          { name: "Bo", color: "#d9563b", roleId: "member" },
        ]}
        onChange={onChange}
        onClose={vi.fn()}
      />,
    );
    const sheet = screen.getByRole("dialog", { name: "Change roles" });
    const bo = within(sheet).getByRole("group", { name: "Bo role" });
    expect(within(bo).getByRole("button", { name: "Member" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(within(bo).getByRole("button", { name: "Head" }));
    expect(onChange).toHaveBeenCalledWith(1, "head");
  });

  it("closes from Done", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <RoleSheet
        title="Change roles"
        roles={roles}
        players={[{ name: "Ann", color: "#7b3f8c", roleId: "head" }]}
        onChange={vi.fn()}
        onClose={onClose}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });
});
