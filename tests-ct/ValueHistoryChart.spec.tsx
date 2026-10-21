import { expect, test } from "@playwright/experimental-ct-react";
import {
  type ValueSeries,
  ValueHistoryChart,
} from "@/components/ValueHistoryChart";

const SERIES: ValueSeries[] = [
  {
    id: "a",
    name: "Alpha",
    color: "#B3A997",
    points: [
      { turn: 2, value: 70 },
      { turn: 5, value: 80 },
      { turn: 9, value: 90 },
    ],
    live: true,
  },
  {
    id: "b",
    name: "Bravo Charlie Delta Echo Union",
    color: "#536E54",
    points: [
      { turn: 3, value: 70 },
      { turn: 7, value: 60 },
      { turn: 10, value: 70 },
    ],
    live: true,
  },
  {
    id: "c",
    name: "Foxtrot",
    color: "#2a3140",
    points: [
      { turn: 2, value: 100 },
      { turn: 6, value: 90 },
      { turn: 8, value: 100 },
    ],
    live: true,
  },
  {
    id: "d",
    name: "Golf Hotel",
    color: "#1c1a24",
    points: [
      { turn: 2, value: 80 },
      { turn: 4, value: 80 },
      { turn: 8, value: 90 },
    ],
    live: true,
  },
  {
    id: "e",
    name: "India",
    color: "#3F5064",
    points: [
      { turn: 3, value: 80 },
      { turn: 6, value: 70 },
    ],
    live: false,
  },
];

for (const width of [360, 520]) {
  test(`ValueHistoryChart at ${width}px`, async ({ mount }) => {
    const component = await mount(
      <div
        style={{
          width,
          padding: 16,
          background: "#000",
          color: "white",
          ["--color-surface" as string]: "#000",
          ["--color-text" as string]: "#fff",
          ["--color-text-dim" as string]: "rgba(255, 255, 255, 0.7)",
          ["--color-text-muted" as string]: "rgba(255, 255, 255, 0.6)",
          ["--color-border" as string]: "rgba(255, 255, 255, 0.2)",
        }}
      >
        <ValueHistoryChart label="Value" series={SERIES} currentTurn={11} />
      </div>,
    );
    await expect(component.getByTestId("value-history-chart")).toBeVisible();
    await expect(component).toHaveScreenshot(`value-history-${width}.png`, {
      maxDiffPixelRatio: 0.02,
    });
  });
}
