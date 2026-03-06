/**
 * xcrun simctl wrapper — screenshot, app lifecycle.
 * Uses child_process.execSync for simplicity.
 */

import { execSync, type ExecSyncOptionsWithStringEncoding } from "child_process";

type Executor = (cmd: string, opts?: ExecSyncOptionsWithStringEncoding) => string;

const defaultExec: Executor = (cmd, opts) =>
  execSync(cmd, { encoding: "utf-8", ...opts }).trim();

export function createSimctl(exec: Executor = defaultExec) {
  function screenshot(name?: string): string {
    const filename = name ?? `slap-${Date.now()}`;
    const path = `/tmp/${filename}.png`;
    exec(`xcrun simctl io booted screenshot "${path}" 2>/dev/null`);
    return path;
  }

  function launchApp(bundleId: string): void {
    exec(`xcrun simctl launch booted "${bundleId}"`);
  }

  function terminateApp(bundleId: string): void {
    exec(`xcrun simctl terminate booted "${bundleId}" 2>/dev/null || true`);
  }

  return { screenshot, launchApp, terminateApp };
}

export type Simctl = ReturnType<typeof createSimctl>;
