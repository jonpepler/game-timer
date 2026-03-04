import {
  FullScreen as InternalFullScreen,
  useFullScreenHandle,
} from "react-full-screen";

import styles from "./FullScreen.module.css";

export const FullScreen = ({ children }: { children: React.ReactNode }) => {
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
      </div>
    </InternalFullScreen>
  );
};
