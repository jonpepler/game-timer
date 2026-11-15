"use client";

import { Button, Segmented, Sheet } from "@/components/ui";
import { RoleToken } from "./identity/RoleToken";
import type { PlayerRole } from "@/state/gameDefinition";
import styles from "./RoleSheet.module.css";

export interface RoleSheetPlayer {
  name: string;
  color: string;
  roleId: string;
}

interface RoleSheetProps {
  title: string;
  roles: readonly PlayerRole[];
  players: readonly RoleSheetPlayer[];
  onChange: (playerIndex: number, roleId: string) => void;
  onClose: () => void;
}

/**
 * Every player's role, each changeable on the spot. A change applies at
 * once and never ends the turn.
 */
export function RoleSheet({
  title,
  roles,
  players,
  onChange,
  onClose,
}: RoleSheetProps) {
  return (
    <Sheet
      title={title}
      onDismiss={onClose}
      actions={
        <Button variant="primary" fullWidth onClick={onClose}>
          Done
        </Button>
      }
    >
      <ul className={styles.list}>
        {players.map((player, i) => {
          const role = roles.find((r) => r.id === player.roleId);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a seat's index is its identity; names can repeat
            <li key={i} className={styles.row}>
              <span className={styles.who}>
                <RoleToken color={player.color} role={role} size={32} />
                <span className={styles.name}>{player.name}</span>
              </span>
              <Segmented
                label={`${player.name} role`}
                options={roles.map((r) => ({ value: r.id, label: r.label }))}
                value={player.roleId}
                onChange={(roleId) => onChange(i, roleId)}
              />
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
