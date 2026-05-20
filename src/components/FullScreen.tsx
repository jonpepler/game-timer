import {
  FullScreen as InternalFullScreen,
  type FullScreenHandle,
  useFullScreenHandle,
} from "react-full-screen";
import { Maximize, Minimize } from "lucide-react";

import styles from "./FullScreen.module.css";
import { createContext, useContext, type ReactNode } from "react";
import { DebugLogOverlay } from "./DebugLogOverlay";

interface FullScreenProps {
  children: ReactNode;
  // Optional extra controls rendered alongside the fullscreen toggle in
  // the top-left chrome.
  menuExtras?: ReactNode;
}

// React context exposing the FullScreen handle so inner components
// (notably the wizard, which renders inside a modal `<dialog>` that
// blocks pointer events to the chrome) can render their own toggle
// that's reachable from within the modal layer.
const FullScreenHandleContext = createContext<FullScreenHandle | null>(null);

export const FullScreen = ({ children, menuExtras }: FullScreenProps) => {
  const handle = useFullScreenHandle();

  return (
    <FullScreenHandleContext.Provider value={handle}>
      <InternalFullScreen handle={handle}>
        {children}
        <div className={styles.menuContainer}>
          <FullScreenToggle />
          {menuExtras}
        </div>
        {/* Debug log overlay — small bug-icon launcher in the
            top-right corner. Expands into a panel showing live
            log entries with copy / clear / level-filter
            affordances. Available on every page that wraps with
            FullScreen (timer + companion). */}
        <DebugLogOverlay />
      </InternalFullScreen>
    </FullScreenHandleContext.Provider>
  );
};

// Standalone toggle button — reads the FullScreen handle from
// context so it can be mounted anywhere inside the FullScreen
// tree (including inside a modal `<dialog>`). Falls back to a
// disabled placeholder when there's no provider above it.
export const FullScreenToggle = ({ className }: { className?: string }) => {
  const handle = useContext(FullScreenHandleContext);
  if (!handle) return null;
  const cls = className ?? styles.toggle;
  return handle.active ? (
    <button
      type="button"
      onClick={handle.exit}
      className={cls}
      aria-label="Exit fullscreen"
    >
      <Minimize size={16} aria-hidden />
    </button>
  ) : (
    <button
      type="button"
      onClick={handle.enter}
      className={cls}
      aria-label="Enter fullscreen"
    >
      <Maximize size={16} aria-hidden />
    </button>
  );
};
