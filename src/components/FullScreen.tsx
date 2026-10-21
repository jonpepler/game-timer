import { Bug, Maximize, Minimize } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  type FullScreenHandle,
  FullScreen as InternalFullScreen,
  useFullScreenHandle,
} from "react-full-screen";
import { IconButton } from "@/components/ui";
import { cx } from "@/components/ui/contained";
import { DebugLogPanel, logEnvOnce } from "./DebugLogOverlay";
import styles from "./FullScreen.module.css";

interface FullScreenProps {
  children: ReactNode;
  /** Page controls for the header bar, between fullscreen and the debug log. */
  menuExtras?: ReactNode;
  /** Keeps the header bar on screen, on an opaque strip, as the page scrolls. */
  pinnedBar?: boolean;
}

/**
 * Exposes the fullscreen handle so a control inside a modal `<dialog>`
 * (the setup wizard), whose backdrop blocks the header bar, can offer
 * its own toggle.
 */
const FullScreenHandleContext = createContext<FullScreenHandle | null>(null);

/**
 * The page frame: fullscreen support and the header bar. The bar is one
 * row of square icon buttons: fullscreen first, the page's own controls,
 * then the debug log launcher at the far end.
 */
export const FullScreen = ({
  children,
  menuExtras,
  pinnedBar = false,
}: FullScreenProps) => {
  const handle = useFullScreenHandle();
  const [debugOpen, setDebugOpen] = useState(false);
  useEffect(() => logEnvOnce(), []);

  return (
    <FullScreenHandleContext.Provider value={handle}>
      <InternalFullScreen handle={handle}>
        {children}
        <header className={cx(styles.bar, pinnedBar && styles.pinned)}>
          <FullScreenToggle tooltipAlign="start" />
          {menuExtras}
          <IconButton
            label="Open debug log"
            shape="square"
            tooltipAlign="end"
            className={styles.end}
            aria-expanded={debugOpen}
            onClick={() => setDebugOpen((v) => !v)}
          >
            <Bug aria-hidden />
          </IconButton>
        </header>
        {debugOpen && <DebugLogPanel onClose={() => setDebugOpen(false)} />}
      </InternalFullScreen>
    </FullScreenHandleContext.Provider>
  );
};

/**
 * The fullscreen toggle as a header-bar button. Reads the handle from
 * context, so it works anywhere inside FullScreen, including in a modal.
 */
export const FullScreenToggle = ({
  tooltipAlign,
}: {
  tooltipAlign?: "center" | "start" | "end";
}) => {
  const handle = useContext(FullScreenHandleContext);
  if (!handle) return null;
  return (
    <IconButton
      label={handle.active ? "Exit fullscreen" : "Enter fullscreen"}
      shape="square"
      tooltipAlign={tooltipAlign}
      onClick={handle.active ? handle.exit : handle.enter}
    >
      {handle.active ? <Minimize aria-hidden /> : <Maximize aria-hidden />}
    </IconButton>
  );
};
