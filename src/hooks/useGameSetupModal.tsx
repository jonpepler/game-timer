import { type ReactNode, type Ref, useState } from "react";
import { GameSetupWizard } from "@/components/GameSetupWizard";
import type {
  GameConfig,
  GameSetupWizardHandle,
  WizardPeerHooks,
} from "@/components/GameSetupWizard";

type UseGameSetupReturn = {
  open: () => void;
  isOpen: boolean;
  modal: React.ReactNode;
  config: GameConfig | null;
};

interface UseGameSetupOptions {
  onSubmit?: (config: GameConfig) => void;
  peerHooks?: WizardPeerHooks;
  // Caller-owned imperative handle. Lets the timer page route peer
  // SETUP_PICK messages into the wizard's setupContext without
  // crossing through the hook.
  wizardRef?: Ref<GameSetupWizardHandle>;
  // Optional companion-facing pane rendered alongside the wizard's
  // first screen. Forwarded directly to GameSetupWizard.
  sidePanel?: ReactNode;
  // Forwarded directly to GameSetupWizard.
  onScreenChange?: (screenIndex: number) => void;
}

export const useGameSetup = (
  options: UseGameSetupOptions = {},
): UseGameSetupReturn => {
  const { onSubmit, peerHooks, wizardRef, sidePanel, onScreenChange } = options;
  const [isOpen, setIsOpen] = useState(false);
  const [config, setConfig] = useState<GameConfig | null>(null);

  const handleSubmit = (incoming: GameConfig) => {
    setConfig(incoming);
    setIsOpen(false);
    onSubmit?.(incoming);
  };

  const modal = (
    <GameSetupWizard
      ref={wizardRef}
      isOpen={isOpen}
      onSubmit={handleSubmit}
      onClose={() => setIsOpen(false)}
      peerHooks={peerHooks}
      sidePanel={sidePanel}
      onScreenChange={onScreenChange}
    />
  );

  return {
    open: () => setIsOpen(true),
    isOpen,
    modal,
    config,
  };
};
