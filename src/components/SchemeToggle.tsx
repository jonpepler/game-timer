"use client";

import { Moon, Sun } from "lucide-react";
import { IconButton } from "@/components/ui";
import { useThemeScheme } from "@/hooks/useGameTheme";

/**
 * Switches the game theme between its light and dark schemes, for this
 * device. A header-bar button, shown only while a game theme applies.
 */
export const SchemeToggle = () => {
  const { themed, scheme, toggle } = useThemeScheme();
  if (!themed) return null;
  const next = scheme === "light" ? "dark" : "light";
  return (
    <IconButton
      label={`Switch to ${next} mode`}
      shape="square"
      data-scheme-toggle
      onClick={toggle}
    >
      {next === "dark" ? <Moon aria-hidden /> : <Sun aria-hidden />}
    </IconButton>
  );
};
