import {
  FullScreen as InternalFullScreen,
  useFullScreenHandle,
} from "react-full-screen";

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
          <button onClick={handle.exit}>x</button>
        ) : (
          <button onClick={handle.enter}>⛶</button>
        )}
        {menuExtras}
      </div>
    </InternalFullScreen>
  );
};
