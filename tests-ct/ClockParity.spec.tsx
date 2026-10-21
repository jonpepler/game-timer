import { expect, test } from "@playwright/experimental-ct-react";
import { TimerRing } from "@/components/timer/TimerRing";

/*
 * The default face against screenshots of the ring it replaced
 * (react-circular-progressbar plus the separate player ring), committed
 * before the swap. The overtime scene has no seats: the clock now paints
 * the seat arcs above the overtime wash rather than under it, on purpose.
 */

const PLAYERS = [
  { name: "One", color: "#A8322D" },
  { name: "Two", color: "#4E7A3A" },
  { name: "Three", color: "#7A5A8C" },
  { name: "Four", color: "#D6A43C" },
];

const SCENES = [
  {
    id: "early",
    value: 85,
    text: "04:15",
    paused: false,
    overtime: 0,
    active: 1,
    players: true,
  },
  {
    id: "near",
    value: 6,
    text: "00:18",
    paused: false,
    overtime: 0,
    active: 2,
    players: true,
  },
  {
    id: "paused",
    value: 55,
    text: "02:45",
    paused: true,
    overtime: 0,
    active: 3,
    players: true,
  },
  {
    id: "overtime",
    value: 0,
    text: "+01:40",
    paused: false,
    overtime: 1 / 3,
    active: 0,
    players: false,
  },
];

for (const s of SCENES) {
  test(`default face matches the legacy ring: ${s.id}`, async ({ mount }) => {
    const component = await mount(
      <div
        style={{
          display: "inline-block",
          background: "var(--color-surface)",
          padding: 16,
        }}
      >
        <div style={{ position: "relative", width: 300, height: 300 }}>
          <TimerRing
            players={s.players ? PLAYERS : undefined}
            activeIndex={s.active}
            value={s.value}
            text={s.text}
            paused={s.paused}
            overtimeOpacity={s.overtime}
          />
        </div>
      </div>,
    );
    await expect(component).toHaveScreenshot(`clock-parity-${s.id}.png`, {
      maxDiffPixels: 0,
    });
  });
}
