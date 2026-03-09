/**
 * Slappium CLI — Lightning-fast mobile testing for AI agents.
 *
 * Usage: slap <command> [args...]
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createAppium, ElementNotFoundError, type SessionStore } from "./appium";
import { parseTree } from "./tree";
import { createSimctl } from "./simctl";
import { createAdb, type Adb } from "./adb";
import { ok, fail, info, formatDuration } from "./fmt";

// --- Config Loading ---

interface SlappiumConfig {
  platform?: "ios" | "android";
  appiumUrl: string;
  capabilities: Record<string, unknown>;
  defaults: {
    timeout: number;
    pollInterval: number;
    screenshotDir: string;
    maxScrollAttempts: number;
  };
  login: {
    email: string;
    password: string;
    otp: string;
  };
}

function loadConfig(): SlappiumConfig {
  // Look for config in script directory, then cwd
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const paths = [
    resolve(scriptDir, "..", "slappium.config.json"),
    resolve(scriptDir, "slappium.config.json"),
    resolve(process.cwd(), "slappium.config.json"),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      return JSON.parse(readFileSync(p, "utf-8")) as SlappiumConfig;
    }
  }

  throw new Error("slappium.config.json not found");
}

// --- Session File Store ---

function createFileSessionStore(platform: string): SessionStore {
  const sessionFile = `/tmp/slappium-${platform}-session.json`;
  return {
    readSession: () => {
      try {
        const data = JSON.parse(readFileSync(sessionFile, "utf-8")) as { sessionId: string };
        return data.sessionId;
      } catch {
        return null;
      }
    },
    writeSession: (id: string) => {
      writeFileSync(sessionFile, JSON.stringify({ sessionId: id, createdAt: new Date().toISOString() }));
    },
  };
}

// --- Platform Context ---

interface PlatformCtx {
  platform: "ios" | "android";
  screenshot: (name?: string) => string;
  adb: Adb | null;
}

// --- Command Implementations ---

async function cmdSession(client: ReturnType<typeof createAppium>): Promise<void> {
  const start = Date.now();
  const id = await client.ensureSession();
  console.log(ok(`session: ${id}`, Date.now() - start));
}

async function cmdStatus(client: ReturnType<typeof createAppium>): Promise<void> {
  const alive = await client.isAlive();
  if (alive) {
    console.log(ok("session alive"));
  } else {
    console.log(fail("no active session"));
    process.exitCode = 1;
  }
}

async function cmdTap(
  client: ReturnType<typeof createAppium>,
  testID: string,
  timeout?: number
): Promise<void> {
  const start = Date.now();
  const elId = await client.findElement(testID, timeout);
  const sid = client.getSessionId()!;
  await client.click(sid, elId);
  console.log(ok(`tapped ${testID}`, Date.now() - start));
}

async function cmdTapText(
  client: ReturnType<typeof createAppium>,
  text: string,
  timeout?: number
): Promise<void> {
  const start = Date.now();
  const elId = await client.findByText(text, timeout);
  const sid = client.getSessionId()!;
  await client.click(sid, elId);
  console.log(ok(`tapped "${text}"`, Date.now() - start));
}

async function cmdType(
  client: ReturnType<typeof createAppium>,
  testID: string,
  text: string,
  timeout?: number
): Promise<void> {
  const start = Date.now();
  const elId = await client.findElement(testID, timeout);
  const sid = client.getSessionId()!;
  await client.click(sid, elId); // focus
  await client.clear(sid, elId);
  await client.setValue(sid, elId, text);
  console.log(ok(`typed "${text}" into ${testID}`, Date.now() - start));
}

async function cmdOtp(
  client: ReturnType<typeof createAppium>,
  digits: string
): Promise<void> {
  const start = Date.now();
  for (let i = 0; i < digits.length; i++) {
    const testID = `otp-digit-${i}`;
    const elId = await client.findElement(testID);
    const sid = client.getSessionId()!;
    await client.clear(sid, elId);
    await client.setValue(sid, elId, digits[i]);
  }
  console.log(ok(`entered OTP ${digits}`, Date.now() - start));
}

async function cmdBack(
  client: ReturnType<typeof createAppium>,
  ctx: PlatformCtx
): Promise<void> {
  const start = Date.now();

  // Try testID first (both platforms)
  try {
    const elId = await client.findElement("back-btn", 1000);
    const sid = client.getSessionId()!;
    await client.click(sid, elId);
    console.log(ok("navigated back", Date.now() - start));
    return;
  } catch {
    // Fallback varies by platform
  }

  if (ctx.platform === "android" && ctx.adb) {
    // Android: hardware back button
    ctx.adb.pressBack();
    console.log(ok("navigated back (hardware)", Date.now() - start));
    return;
  }

  // iOS: try label
  try {
    const elId = await client.findByText("Back", 1000);
    const sid = client.getSessionId()!;
    await client.click(sid, elId);
    console.log(ok("navigated back", Date.now() - start));
  } catch {
    console.log(fail("back button not found"));
    process.exitCode = 1;
  }
}

async function cmdWait(
  client: ReturnType<typeof createAppium>,
  testID: string,
  timeout?: number
): Promise<void> {
  const start = Date.now();
  await client.findElement(testID, timeout);
  console.log(ok(`found ${testID}`, Date.now() - start));
}

async function cmdWaitText(
  client: ReturnType<typeof createAppium>,
  text: string,
  timeout = 5000
): Promise<void> {
  const start = Date.now();
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const sid = await client.ensureSession();
    const source = await client.getSource(sid);
    if (source.includes(text)) {
      console.log(ok(`found "${text}"`, Date.now() - start));
      return;
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(fail(`text not found: "${text}" (${formatDuration(timeout)})`));
  process.exitCode = 1;
}

async function cmdWaitGone(
  client: ReturnType<typeof createAppium>,
  testID: string,
  timeout = 5000
): Promise<void> {
  const start = Date.now();
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      await client.findElement(testID, 200);
      // Still there — keep waiting
      await new Promise((r) => setTimeout(r, 300));
    } catch {
      // Gone!
      console.log(ok(`gone: ${testID}`, Date.now() - start));
      return;
    }
  }

  console.log(fail(`still visible: ${testID} (${formatDuration(timeout)})`));
  process.exitCode = 1;
}

async function cmdAssert(
  client: ReturnType<typeof createAppium>,
  testID: string
): Promise<void> {
  try {
    await client.findElement(testID, 500);
    console.log(ok(`visible: ${testID}`));
  } catch {
    console.log(fail(`not visible: ${testID}`));
    process.exitCode = 1;
  }
}

async function cmdAssertText(
  client: ReturnType<typeof createAppium>,
  text: string
): Promise<void> {
  const sid = await client.ensureSession();
  const source = await client.getSource(sid);
  if (source.includes(text)) {
    console.log(ok(`visible: "${text}"`));
  } else {
    console.log(fail(`not visible: "${text}"`));
    process.exitCode = 1;
  }
}

async function cmdAssertNot(
  client: ReturnType<typeof createAppium>,
  testID: string
): Promise<void> {
  try {
    await client.findElement(testID, 500);
    console.log(fail(`visible: ${testID} (expected not visible)`));
    process.exitCode = 1;
  } catch {
    console.log(ok(`not visible: ${testID}`));
  }
}

async function scrollOnce(
  client: ReturnType<typeof createAppium>,
  sid: string,
  direction: string,
  platform: string
): Promise<void> {
  if (platform === "android") {
    await client.executeScript(sid, "mobile: scrollGesture", [{
      left: 100, top: 300, width: 800, height: 1500,
      direction, percent: 0.75,
    }]);
  } else {
    await client.executeScript(sid, "mobile: scroll", [{ direction }]);
  }
}

async function cmdScroll(
  client: ReturnType<typeof createAppium>,
  direction: string,
  ctx: PlatformCtx
): Promise<void> {
  const sid = await client.ensureSession();
  await scrollOnce(client, sid, direction, ctx.platform);
  console.log(ok(`scrolled ${direction}`));
}

async function cmdScrollTo(
  client: ReturnType<typeof createAppium>,
  testID: string,
  ctx: PlatformCtx,
  maxAttempts = 10
): Promise<void> {
  const start = Date.now();
  const sid = await client.ensureSession();

  for (let i = 0; i < maxAttempts; i++) {
    try {
      await client.findElement(testID, 500);
      console.log(ok(`scrolled to ${testID} (${i} scrolls)`, Date.now() - start));
      return;
    } catch {
      await scrollOnce(client, sid, "down", ctx.platform);
    }
  }

  console.log(fail(`not found after ${maxAttempts} scrolls: ${testID}`));
  process.exitCode = 1;
}

async function cmdPeek(
  client: ReturnType<typeof createAppium>,
  ctx: PlatformCtx
): Promise<void> {
  const sid = await client.ensureSession();

  // Run screenshot and source fetch in parallel
  const [screenshotPath, source] = await Promise.all([
    Promise.resolve(ctx.screenshot("slap-peek")),
    client.getSource(sid),
  ]);

  console.log(`\u{1F4F8} ${screenshotPath}\n`);
  console.log(parseTree(source));
}

async function cmdTree(client: ReturnType<typeof createAppium>): Promise<void> {
  const sid = await client.ensureSession();
  const source = await client.getSource(sid);
  console.log(parseTree(source));
}

async function cmdScreenshot(
  ctx: PlatformCtx,
  name?: string
): Promise<void> {
  const path = ctx.screenshot(name);
  console.log(path);
}

async function cmdSource(client: ReturnType<typeof createAppium>): Promise<void> {
  const sid = await client.ensureSession();
  const source = await client.getSource(sid);
  console.log(source);
}

async function cmdInspect(
  client: ReturnType<typeof createAppium>,
  testID: string
): Promise<void> {
  const elId = await client.findElement(testID);
  const sid = client.getSessionId()!;

  const attrs = ["type", "label", "value", "visible", "enabled", "name"];
  const results: string[] = [];
  for (const attr of attrs) {
    const val = await client.getAttribute(sid, elId, attr);
    results.push(`${attr}: ${val ?? "null"}`);
  }
  console.log(results.join("\n"));
}

async function cmdFind(
  client: ReturnType<typeof createAppium>,
  searchText: string
): Promise<void> {
  const sid = await client.ensureSession();
  const source = await client.getSource(sid);

  // Search for elements with matching label, value, name, text, or content-desc
  const regex = new RegExp(
    `(?:label|value|name|text|content-desc)="([^"]*${searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"]*)"`,
    "gi"
  );
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    if (!matches.includes(match[1])) {
      matches.push(match[1]);
    }
  }

  if (matches.length > 0) {
    console.log(ok(`found ${matches.length} match(es) for "${searchText}"`));
    for (const m of matches) {
      console.log(`  "${m}"`);
    }
  } else {
    console.log(fail(`no matches for "${searchText}"`));
    process.exitCode = 1;
  }
}

async function cmdLogin(
  client: ReturnType<typeof createAppium>,
  config: SlappiumConfig,
  email?: string,
  password?: string,
  otp?: string
): Promise<void> {
  const start = Date.now();
  const e = email ?? config.login.email;
  const p = password ?? config.login.password;
  const o = otp ?? config.login.otp;

  console.log(info(`logging in as ${e}...`));

  // Type email
  await cmdType(client, "email-input", e);
  // Type password
  await cmdType(client, "password-input", p);
  // Tap login
  await cmdTap(client, "login-button");
  // Wait for OTP screen
  await cmdWait(client, "otp-digit-0", 10000);
  // Enter OTP
  await cmdOtp(client, o);
  // Tap verify button
  await cmdTap(client, "verify-otp-btn");
  // Wait for OTP screen to disappear
  await cmdWaitGone(client, "otp-digit-0", 15000);

  console.log(ok(`logged in as ${e}`, Date.now() - start));
}

async function cmdReload(
  client: ReturnType<typeof createAppium>,
  ctx: PlatformCtx
): Promise<void> {
  const sid = await client.ensureSession();
  if (ctx.platform === "android") {
    // Menu key triggers Metro dev menu on Android
    await client.executeScript(sid, "mobile: shell", [{
      command: "input", args: ["keyevent", "82"],
    }]);
  } else {
    // Shake gesture triggers Metro reload on iOS
    await client.executeScript(sid, "mobile: shake", []);
  }
  console.log(ok("reload triggered"));
}

async function cmdChain(
  args: string[],
  client: ReturnType<typeof createAppium>,
  ctx: PlatformCtx,
  config: SlappiumConfig
): Promise<void> {
  for (const cmdStr of args) {
    const parts = cmdStr.trim().split(/\s+/);
    const subcmd = parts[0];
    const subargs = parts.slice(1);
    console.log(info(`→ ${cmdStr}`));
    await routeCommand(subcmd, subargs, client, ctx, config);
    if (process.exitCode && Number(process.exitCode) > 0) {
      console.log(fail(`chain stopped at: ${cmdStr}`));
      return;
    }
  }
}

// --- Command Router ---

async function routeCommand(
  command: string,
  args: string[],
  client: ReturnType<typeof createAppium>,
  ctx: PlatformCtx,
  config: SlappiumConfig
): Promise<void> {
  switch (command) {
    case "session":
      return cmdSession(client);
    case "status":
      return cmdStatus(client);
    case "tap":
      if (!args[0]) throw new Error("Usage: slap tap <testID>");
      return cmdTap(client, args[0], args[1] ? parseInt(args[1]) : undefined);
    case "tap-text":
      if (!args[0]) throw new Error('Usage: slap tap-text "<text>"');
      return cmdTapText(client, args.join(" "), args[1] ? parseInt(args[1]) : undefined);
    case "type":
      if (!args[0] || !args[1]) throw new Error("Usage: slap type <testID> <text>");
      return cmdType(client, args[0], args.slice(1).join(" "));
    case "otp":
      if (!args[0]) throw new Error("Usage: slap otp <digits>");
      return cmdOtp(client, args[0]);
    case "back":
      return cmdBack(client, ctx);
    case "wait":
      if (!args[0]) throw new Error("Usage: slap wait <testID> [timeout]");
      return cmdWait(client, args[0], args[1] ? parseInt(args[1]) : undefined);
    case "wait-text":
      if (!args[0]) throw new Error('Usage: slap wait-text "<text>" [timeout]');
      return cmdWaitText(client, args[0], args[1] ? parseInt(args[1]) : undefined);
    case "wait-gone":
      if (!args[0]) throw new Error("Usage: slap wait-gone <testID> [timeout]");
      return cmdWaitGone(client, args[0], args[1] ? parseInt(args[1]) : undefined);
    case "assert":
      if (!args[0]) throw new Error("Usage: slap assert <testID>");
      return cmdAssert(client, args[0]);
    case "assert-text":
      if (!args[0]) throw new Error('Usage: slap assert-text "<text>"');
      return cmdAssertText(client, args.join(" "));
    case "assert-not":
      if (!args[0]) throw new Error("Usage: slap assert-not <testID>");
      return cmdAssertNot(client, args[0]);
    case "scroll":
      if (!args[0]) throw new Error("Usage: slap scroll <up|down>");
      return cmdScroll(client, args[0], ctx);
    case "scroll-to":
      if (!args[0]) throw new Error("Usage: slap scroll-to <testID> [maxScrolls]");
      return cmdScrollTo(client, args[0], ctx, args[1] ? parseInt(args[1]) : undefined);
    case "peek":
      return cmdPeek(client, ctx);
    case "tree":
      return cmdTree(client);
    case "screenshot":
      return cmdScreenshot(ctx, args[0]);
    case "source":
      return cmdSource(client);
    case "inspect":
      if (!args[0]) throw new Error("Usage: slap inspect <testID>");
      return cmdInspect(client, args[0]);
    case "find":
      if (!args[0]) throw new Error('Usage: slap find "<text>"');
      return cmdFind(client, args.join(" "));
    case "login":
      return cmdLogin(client, config, args[0], args[1], args[2]);
    case "reload":
      return cmdReload(client, ctx);
    case "chain":
      return cmdChain(args, client, ctx, config);
    default:
      console.log(fail(`unknown command: ${command}`));
      console.log(`
Usage: slap <command> [args...]

Commands:
  session              Create or verify Appium session
  status               Check if session is alive
  tap <testID>         Tap element by testID
  tap-text "<text>"    Tap element by visible text
  type <testID> <text> Type text into element
  otp <digits>         Enter OTP digits (one per input)
  back                 Navigate back
  wait <testID>        Wait for element to appear
  wait-text "<text>"   Wait for text to appear
  wait-gone <testID>   Wait for element to disappear
  assert <testID>      Assert element is visible
  assert-text "<text>" Assert text is visible
  assert-not <testID>  Assert element is NOT visible
  scroll <up|down>     Scroll one page
  scroll-to <testID>   Scroll until element found
  peek                 Screenshot + tree (best command)
  tree                 Show element tree
  screenshot [name]    Take screenshot
  source               Raw page source XML
  inspect <testID>     Show element details
  find "<text>"        Find elements containing text
  login [email] [pass] [otp]  Full login flow
  reload               Reload Metro bundle
  chain "cmd1" "cmd2"  Run commands sequentially`);
      process.exitCode = 2;
  }
}

// --- Main ---

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command) {
    console.log("slappium v2.0.0 — Lightning-fast mobile testing for AI agents");
    console.log("Usage: slap <command> [args...]");
    console.log("Run 'slap help' for available commands.");
    return;
  }

  if (command === "help") {
    await routeCommand("__help__", [], null as never, null as never, null as never);
    return;
  }

  const config = loadConfig();
  const platform = config.platform ?? "ios";
  const sessionStore = createFileSessionStore(platform);
  const client = createAppium(
    {
      appiumUrl: config.appiumUrl,
      capabilities: config.capabilities,
      platform,
      defaults: {
        timeout: config.defaults.timeout,
        pollInterval: config.defaults.pollInterval,
      },
    },
    globalThis.fetch,
    sessionStore
  );

  // Create platform-specific device commands
  const simctl = platform === "ios" ? createSimctl() : null;
  const adb = platform === "android" ? createAdb() : null;
  const ctx: PlatformCtx = {
    platform,
    screenshot: (name?: string) => {
      if (simctl) return simctl.screenshot(name);
      if (adb) return adb.screenshot(name);
      throw new Error("No device available for screenshots");
    },
    adb,
  };

  await routeCommand(command, args, client, ctx, config);
}

main().catch((err) => {
  if (err instanceof ElementNotFoundError) {
    console.log(fail(err.message));
    process.exitCode = 1;
  } else {
    console.error(fail(err instanceof Error ? err.message : String(err)));
    process.exitCode = 2;
  }
});
