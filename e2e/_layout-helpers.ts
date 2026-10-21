import { expect, type Locator, type Page } from "@playwright/test";

/*
 * Geometry helpers for the timer page layout invariants: the ring is
 * the hero, never resized or moved by the panels around it, and every
 * point of its disc is a tap target.
 */

export const LAYOUT_VIEWPORTS = {
  phone: {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  },
  "1280": { viewport: { width: 1280, height: 800 } },
  "1920": { viewport: { width: 1920, height: 1080 } },
} as const;

export const ring = (page: Page) =>
  page.getByRole("button", { name: "Advance turn" });

export type Box = { x: number; y: number; width: number; height: number };

export async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  if (!b) throw new Error("element has no bounding box");
  return b;
}

/**
 * The part of an element the user can see: its box clipped by every
 * ancestor that clips overflow. Content taller than a scrolling region
 * has a box that reaches past the region, but only the region shows.
 */
export async function visibleBox(locator: Locator): Promise<Box> {
  return locator.evaluate((el) => {
    const b = el.getBoundingClientRect();
    let top = b.top;
    let bottom = b.bottom;
    let left = b.left;
    let right = b.right;
    for (let a = el.parentElement; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX === "visible" && s.overflowY === "visible") continue;
      const c = a.getBoundingClientRect();
      top = Math.max(top, c.top);
      bottom = Math.min(bottom, c.bottom);
      left = Math.max(left, c.left);
      right = Math.min(right, c.right);
    }
    return {
      x: left + window.scrollX,
      y: top + window.scrollY,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  });
}

/** Whether two boxes intersect by more than a pixel of rounding. */
export const overlaps = (a: Box, b: Box) =>
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 &&
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1;

/**
 * Let the ring's press transition and any entrance animations finish. A
 * transition cancelled part way (a hover leaving a control) counts as
 * settled rather than rejecting the wait.
 */
export const settle = async (page: Page) => {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  await page.waitForTimeout(150);
};

/**
 * The ring's box in page coordinates (scroll offset added), so a box
 * taken before and after the page scrolls still compares equal.
 */
export async function ringPageBox(page: Page): Promise<Box> {
  await settle(page);
  return ring(page).evaluate((el) => {
    const b = el.getBoundingClientRect();
    return {
      x: b.left + window.scrollX,
      y: b.top + window.scrollY,
      width: b.width,
      height: b.height,
    };
  });
}

/**
 * Points inside the ring's disc (sampled on a 21x21 grid) where the
 * topmost element is not the ring or one of its children. The ring is
 * scrolled into view first; points outside the viewport are skipped.
 */
export async function ringHitMisses(page: Page): Promise<string[]> {
  await ring(page).scrollIntoViewIfNeeded();
  await settle(page);
  return ring(page).evaluate((el) => {
    const b = el.getBoundingClientRect();
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    const radius = (b.width / 2) * 0.97;
    const misses: string[] = [];
    for (let i = -10; i <= 10; i++) {
      for (let j = -10; j <= 10; j++) {
        const x = cx + (i / 10) * radius;
        const y = cy + (j / 10) * radius;
        if (Math.hypot(x - cx, y - cy) > radius) continue;
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !el.contains(hit)) {
          misses.push(`${Math.round(x)},${Math.round(y)}`);
        }
      }
    }
    return misses;
  });
}

/**
 * The page never scrolls sideways: the layout viewport stays at the
 * device width and no element pokes past its right edge, once
 * transitions have finished.
 */
export async function expectNoHorizontalOverflow(page: Page) {
  const width = page.viewportSize()?.width ?? 0;
  await expect(async () => {
    const result = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      offenders: Array.from(document.querySelectorAll("body *"))
        .filter((el) => {
          const b = el.getBoundingClientRect();
          return b.width > 0 && b.right > window.innerWidth + 0.5;
        })
        .map((el) => `${el.tagName}.${String(el.className)}`)
        .slice(0, 5),
    }));
    expect(result.innerWidth).toBe(width);
    expect(result.scrollWidth).toBeLessThanOrEqual(width);
    expect(result.offenders).toEqual([]);
  }).toPass({ timeout: 5_000 });
}

/**
 * The element is fully inside the viewport, horizontally and vertically,
 * once the layout has come to rest. A dialog that is still sliding in or
 * a side panel still easing its width is measured again until it stops.
 */
export async function expectFullyInViewport(locator: Locator) {
  const page = locator.page();
  const size = page.viewportSize();
  if (!size) throw new Error("no viewport");
  await expect(async () => {
    const b = await box(locator);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(size.width + 0.5);
    expect(b.y + b.height).toBeLessThanOrEqual(size.height + 0.5);
  }).toPass({ timeout: 5_000 });
}

/** The full-width bottom row of a wide layout. */
export const bottomRow = (page: Page) => page.locator('[data-column="bottom"]');

/**
 * Wide layouts: the ring sits centred in the viewport, above the
 * full-width bottom row, and takes about half the viewport's height.
 */
export async function expectHeroRing(page: Page) {
  const size = page.viewportSize();
  if (!size) throw new Error("no viewport");
  const r = await box(ring(page));
  if (size.width >= 1024) {
    expect(Math.abs(r.x + r.width / 2 - size.width / 2)).toBeLessThan(1);
    // Sized from the viewport alone: about half its height or more.
    expect(r.width).toBeGreaterThan(size.height * 0.45);
    const panels = await bottomRow(page).locator("[data-panel]").all();
    for (const panel of panels) {
      expect(r.y + r.height).toBeLessThanOrEqual((await box(panel)).y);
    }
  } else {
    // Phone: full content width less the 16px gutters, below the banner.
    expect(r.width).toBeGreaterThanOrEqual(size.width - 32 - 1);
    expect(r.y + r.height).toBeLessThan(size.height);
  }
}
