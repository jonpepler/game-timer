import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  type ValueSeries,
  ValueHistoryChart,
  wrapLabel,
} from "./ValueHistoryChart";

const SERIES: ValueSeries[] = [
  {
    id: "a",
    name: "Alpha Bravo Charlie Delta Union",
    color: "#1c1a24",
    points: [
      { turn: 1, value: 70 },
      { turn: 4, value: 80 },
    ],
    live: true,
  },
  {
    id: "b",
    name: "Echo",
    color: "#cc7c7f",
    points: [{ turn: 2, value: 90 }],
    live: true,
  },
  {
    id: "c",
    name: "Foxtrot",
    color: "#536e54",
    points: [
      { turn: 1, value: 60 },
      { turn: 3, value: 50 },
    ],
    live: false,
  },
];

describe("wrapLabel", () => {
  it("wraps on spaces instead of truncating", () => {
    expect(wrapLabel("Alpha Bravo Charlie Union", 12)).toEqual([
      "Alpha Bravo",
      "Charlie",
      "Union",
    ]);
  });

  it("cuts only what does not fit in three lines", () => {
    expect(wrapLabel("One Two Three Four", 5)).toEqual(["One", "Two", "Thre…"]);
    expect(wrapLabel("Supercalifragilistic", 8)).toEqual(["Superca…"]);
  });
});

describe("ValueHistoryChart", () => {
  it("draws nothing before any value is set", () => {
    const { container } = render(
      <ValueHistoryChart label="Value" series={[]} currentTurn={1} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps full names and every value in the accessible table", () => {
    render(<ValueHistoryChart label="Value" series={SERIES} currentTurn={5} />);
    const table = screen.getByRole("table", { name: "Value" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      "Alpha Bravo Charlie Delta Union8070, 80",
      "Echo9090",
      "Foxtrotout60, 50",
    ]);
  });

  it("gives each entry in play its own fading gradient in a lifted colour", () => {
    render(<ValueHistoryChart label="Value" series={SERIES} currentTurn={5} />);
    const svg = screen.getByTestId("value-history-chart");
    const gradients = svg.querySelectorAll("linearGradient");
    expect(gradients).toHaveLength(2);
    const [top, bottom] = gradients[0].querySelectorAll("stop");
    expect(top.getAttribute("stop-color")).not.toBe("#1c1a24");
    expect(Number(top.getAttribute("stop-opacity"))).toBeGreaterThan(0);
    expect(bottom.getAttribute("stop-opacity")).toBe("0");
  });

  it("slopes between values instead of drawing vertical walls", () => {
    const series: ValueSeries[] = [
      {
        id: "a",
        name: "Alpha",
        color: "#cc7c7f",
        points: [
          { turn: 1, value: 70 },
          { turn: 1, value: 80 },
          { turn: 3, value: 90 },
          { turn: 5, value: 60 },
        ],
        live: true,
      },
    ];
    render(<ValueHistoryChart label="Value" series={series} currentTurn={5} />);
    const line = screen
      .getByTestId("value-history-chart")
      .querySelector("path[stroke]");
    const coords = [
      ...(line?.getAttribute("d") ?? "").matchAll(/(-?[\d.]+),(-?[\d.]+)/g),
    ].map((m) => [Number(m[1]), Number(m[2])]);
    expect(coords.length).toBeGreaterThan(3);
    for (let i = 1; i < coords.length; i++) {
      const [x0, y0] = coords[i - 1];
      const [x1, y1] = coords[i];
      expect(x1 === x0 && y1 !== y0).toBe(false);
    }
  });

  it("labels each entry in play with its current value", () => {
    render(<ValueHistoryChart label="Value" series={SERIES} currentTurn={5} />);
    const svg = screen.getByTestId("value-history-chart");
    expect(svg).toHaveTextContent("80");
    expect(svg).toHaveTextContent("Echo");
    expect(svg).not.toHaveTextContent("Foxtrot");
  });
});

describe("ValueHistoryChart, compact", () => {
  const TOKENS: ValueSeries[] = [
    { ...SERIES[0], symbol: "anchor", points: [{ turn: 1, value: 80 }] },
    { ...SERIES[1], symbol: "cog", points: [{ turn: 2, value: 80 }] },
    { ...SERIES[2], id: "d", symbol: "moon", live: true },
  ];
  const compact = () =>
    render(
      <ValueHistoryChart
        label="Value"
        series={TOKENS}
        currentTurn={5}
        variant="compact"
      />,
    );

  it("draws no axes and no names, only the lines", () => {
    compact();
    const svg = screen.getByTestId("value-history-chart");
    expect(svg.querySelectorAll("text")).toHaveLength(0);
    expect(svg).not.toHaveTextContent("Echo");
  });

  it("stacks the tokens of entries on one value, in the given order, with the value once", () => {
    const { container } = compact();
    const stacks = Array.from(container.querySelectorAll("[data-token-stack]"));
    expect(stacks.map((s) => s.textContent)).toEqual(["80", "50"]);
    const symbols = (i: number) =>
      Array.from(stacks[i].querySelectorAll("[data-symbol]")).map((t) =>
        t.getAttribute("data-symbol"),
      );
    expect(symbols(0)).toEqual(["anchor", "cog"]);
    expect(symbols(1)).toEqual(["moon"]);
  });

  /** The rightmost point any line or fill reaches, against the chart's width. */
  const drawnShare = () => {
    const svg = screen.getByTestId("value-history-chart");
    const xs = Array.from(svg.querySelectorAll("path")).flatMap((path) =>
      Array.from((path.getAttribute("d") ?? "").matchAll(/(-?[\d.]+),/g)).map(
        (m) => Number(m[1]),
      ),
    );
    return Math.max(...xs) / Number(svg.getAttribute("width"));
  };

  it("draws across only the played share of a game expected to run longer", () => {
    const { container } = render(
      <ValueHistoryChart
        label="Value"
        series={TOKENS}
        currentTurn={5}
        domainTurns={40}
        variant="compact"
      />,
    );
    expect(drawnShare()).toBeLessThan(0.25);
    const stack = container.querySelector<HTMLElement>("[data-token-stack]");
    expect(Number.parseFloat(stack?.style.left ?? "")).toBeLessThan(
      0.25 *
        Number(screen.getByTestId("value-history-chart").getAttribute("width")),
    );
  });

  it("fills the width without an expected length, or once play runs past it", () => {
    const { rerender } = compact();
    expect(drawnShare()).toBeGreaterThan(0.75);
    rerender(
      <ValueHistoryChart
        label="Value"
        series={TOKENS}
        currentTurn={5}
        domainTurns={3}
        variant="compact"
      />,
    );
    expect(drawnShare()).toBeGreaterThan(0.75);
  });

  it("still names every entry in the accessible table", () => {
    compact();
    expect(
      within(screen.getByRole("table", { name: "Value" })).getByText("Echo"),
    ).toBeInTheDocument();
  });
});
