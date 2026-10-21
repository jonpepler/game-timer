import { X } from "lucide-react";
import { IconButton } from "@/components/ui";
import styles from "./PeerNotice.module.css";

interface PeerNoticeProps {
  message: string;
  // `alert` interrupts (a version mismatch); `status` waits its turn (a
  // refused action).
  tone: "alert" | "status";
  onDismiss: () => void;
}

/**
 * A floating notice about the link between screens: an action another
 * screen beat this one to, or two screens on different app versions.
 * Clicks stop here so the host never reads one as a turn advance.
 */
export function PeerNotice({ message, tone, onDismiss }: PeerNoticeProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: propagation guard only, not an interactive element
    // biome-ignore lint/a11y/useKeyWithClickEvents: propagation guard only, not an interactive element
    <div
      role={tone}
      className={`${styles.notice} ${tone === "alert" ? styles.alert : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <span className={styles.message}>{message}</span>
      <IconButton
        label="Dismiss notice"
        tone="plain"
        tooltip={false}
        onClick={onDismiss}
      >
        <X aria-hidden />
      </IconButton>
    </div>
  );
}
