/**
 * adb wrapper — screenshot, app lifecycle, hardware keys.
 * Android equivalent of simctl.ts.
 */

import { execSync, type ExecSyncOptionsWithStringEncoding } from "child_process";

export type Executor = (cmd: string, opts?: ExecSyncOptionsWithStringEncoding) => string;

const defaultExec: Executor = (cmd, opts) =>
  execSync(cmd, { encoding: "utf-8", ...opts }).trim();

export function createAdb(exec: Executor = defaultExec) {
  function screenshot(name?: string): string {
    const filename = name ?? `slap-${Date.now()}`;
    const path = `/tmp/${filename}.png`;
    exec(`adb exec-out screencap -p > "${path}"`);
    return path;
  }

  function launchApp(packageName: string, activityName: string): void {
    exec(`adb shell am start -n "${packageName}/${activityName}"`);
  }

  function terminateApp(packageName: string): void {
    exec(`adb shell am force-stop "${packageName}"`);
  }

  function pressBack(): void {
    exec("adb shell input keyevent KEYCODE_BACK");
  }

  return { screenshot, launchApp, terminateApp, pressBack };
}

export type Adb = ReturnType<typeof createAdb>;
