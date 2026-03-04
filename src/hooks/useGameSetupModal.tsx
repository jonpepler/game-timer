import { useState } from "react";
import { GameSetupModal } from "@/components/GameSetupModal";
import type { GameConfig } from "@/components/GameSetupModal";

type UseGameSetupReturn = {
  open: () => void;
  isOpen: boolean;
  modal: React.ReactNode;
  config: GameConfig | null;
};

export const useGameSetup = (
  onSubmit?: (config: GameConfig) => void,
): UseGameSetupReturn => {
  const [isOpen, setIsOpen] = useState(false);
  const [config, setConfig] = useState<GameConfig | null>(null);

  const handleSubmit = (incoming: GameConfig) => {
    setConfig(incoming);
    setIsOpen(false);
    onSubmit?.(incoming);
  };

  const modal = (
    <GameSetupModal
      isOpen={isOpen}
      onSubmit={handleSubmit}
      onClose={() => setIsOpen(false)}
    />
  );

  return {
    open: () => setIsOpen(true),
    isOpen,
    modal,
    config,
  };
};
