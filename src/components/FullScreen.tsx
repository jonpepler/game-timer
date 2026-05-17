import {
  FullScreen as InternalFullScreen,
  useFullScreenHandle,
} from "react-full-screen";
import { Maximize, Minimize } from "lucide-react";

import styles from "./FullScreen.module.css";
import type { ReactNode } from "react";

interface FullScreenProps {
  children: ReactNode;
  // Optional extra controls rendered alongside the fullscreen toggle in
  // the top-left chrome.
  menuExtras?: ReactNode;
}

export const FullScreen = ({ children, menuExtras }: FullScreenProps) => {
  const handle = useFullScreenHandle();

  return (
    <InternalFullScreen handle={handle}>
      {children}
      <div className={styles.menuContainer}>
        {handle.active ? (
          <button
            type="button"
            onClick={handle.exit}
            className={styles.toggle}
            aria-label="Exit fullscreen"
          >
            <Minimize size={16} aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={handle.enter}
            className={styles.toggle}
            aria-label="Enter fullscreen"
          >
            <Maximize size={16} aria-hidden />
          </button>
        )}
        {menuExtras}
      </div>
    </InternalFullScreen>
  );
};
