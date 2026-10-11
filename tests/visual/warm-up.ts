/* global fetch */

import { config } from "../general-config";

/*
 * Load the guest page once before the snapshots. In runs 38106773735 and
 * 38110056978 the first guest page of one of the two workers, requested at
 * the same moment as the other worker's on a portal that had just started,
 * never finished loading.
 */
export default async function warmUp(): Promise<void> {
  const response = await fetch(`${config.url}f/welcome/normal/render.uP`, {
    signal: AbortSignal.timeout(120_000),
  });
  await response.arrayBuffer();
  if (!response.ok) {
    throw new Error(`Warm-up request answered ${response.status}`);
  }
}
