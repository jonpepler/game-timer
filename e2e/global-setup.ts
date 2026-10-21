import type { FullConfig } from "@playwright/test";

/**
 * The dev server compiles each route the first time it is requested. Under
 * parallel load that first compile can outlast a test's navigation wait, so
 * every page is requested once here before any test runs.
 */
const ROUTES = [
  "",
  "/timer",
  "/companion",
  "/games",
  "/games/new",
  "/games/edit",
];

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("no baseURL to warm");
  for (const route of ROUTES) {
    const res = await fetch(`${baseURL}/game-timer${route}`);
    if (!res.ok) throw new Error(`warming ${route} returned ${res.status}`);
  }
}
