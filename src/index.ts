/**
 * Slappium CLI — Lightning-fast iOS testing for AI agents.
 *
 * Usage: slap <command> [args...]
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createAppium, ElementNotFoundError, type SessionStore } from "./appium";
import { parseTree } from "./tree";
import { createSimctl } from "./simctl";
import { ok, fail, info, formatDuration } from "./fmt";

// --- Config Loading ---

interface SlappiumConfig {
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

const SESSION_FILE = "/tmp/slappium-session.json";

function createFileSessionStore(): SessionStore {
  return {
    readSession: () => {
      try {
        const data = JSON.parse(readFileSync(SESSION_FILE, "utf-8")) as { sessionId: string };
        return data.sessionId;
      } catch {
        return null;
      }
    },
    writeSession: (id: string) => {
      writeFileSync(SESSION_FILE, JSON.stringify({ sessionId: id, createdAt: new Date().toISOString() }));
    },
  };
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
  const predicate = `label == '${text}' AND visible == true`;
  const elId = await client.findByPredicate(predicate, timeout);
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

async function cmdBack(client: ReturnType<typeof createAppium>): Promise<void> {
  const start = Date.now();
  try {
    const elId = await client.findElement("back-btn", 1000);
    const sid = client.getSessionId()!;
    await client.click(sid, elId);
    console.log(ok("navigated back", Date.now() - start));
    return;
  } catch {
    // Fallback: try label
  }

  try {
    const predicate = "label == 'Back' AND visible == true";
    const elId = await client.findByPredicate(predicate, 1000);
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

async function cmdScroll(
  client: ReturnType<typeof createAppium>,
  direction: string
): Promise<void> {
  const sid = await client.ensureSession();
  await client.executeScript(sid, "mobile: scroll", [{ direction }]);
  console.log(ok(`scrolled ${direction}`));
}

async function cmdScrollTo(
  client: ReturnType<typeof createAppium>,
  testID: string,
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
      await client.executeScript(sid, "mobile: scroll", [{ direction: "down" }]);
    }
  }

  console.log(fail(`not found after ${maxAttempts} scrolls: ${testID}`));
  process.exitCode = 1;
}

async function cmdPeek(
  client: ReturnType<typeof createAppium>,
  simctl: ReturnType<typeof createSimctl>
): Promise<void> {
  const sid = await client.ensureSession();

  // Run screenshot and source fetch in parallel
  const [screenshotPath, source] = await Promise.all([
    Promise.resolve(simctl.screenshot("slap-peek")),
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
  simctl: ReturnType<typeof createSimctl>,
  name?: string
): Promise<void> {
  const path = simctl.screenshot(name);
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

  // Search for elements with matching label or value
  const regex = new RegExp(
    `(?:label|value|name)="([^"]*${searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"]*)"`,
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
  // Wait for dashboard
  await cmdWait(client, "dashboard-header", 15000);

  console.log(ok(`logged in as ${e}`, Date.now() - start));
}

async function cmdReload(client: ReturnType<typeof createAppium>): Promise<void> {
  const sid = await client.ensureSession();
  // Shake gesture triggers Metro reload
  await client.executeScript(sid, "mobile: shake", []);
  console.log(ok("reload triggered"));
}

async function cmdChain(
  args: string[],
  client: ReturnType<typeof createAppium>,
  simctl: ReturnType<typeof createSimctl>,
  config: SlappiumConfig
): Promise<void> {
  for (const cmdStr of args) {
    const parts = cmdStr.trim().split(/\s+/);
    const subcmd = parts[0];
    const subargs = parts.slice(1);
    console.log(info(`→ ${cmdStr}`));
    await routeCommand(subcmd, subargs, client, simctl, config);
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
  simctl: ReturnType<typeof createSimctl>,
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
      return cmdBack(client);
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
      return cmdScroll(client, args[0]);
    case "scroll-to":
      if (!args[0]) throw new Error("Usage: slap scroll-to <testID> [maxScrolls]");
      return cmdScrollTo(client, args[0], args[1] ? parseInt(args[1]) : undefined);
    case "peek":
      return cmdPeek(client, simctl);
    case "tree":
      return cmdTree(client);
    case "screenshot":
      return cmdScreenshot(simctl, args[0]);
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
      return cmdReload(client);
    case "chain":
      return cmdChain(args, client, simctl, config);
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
    console.log("slappium v1.0.0 — Lightning-fast iOS testing for AI agents");
    console.log("Usage: slap <command> [args...]");
    console.log("Run 'slap help' for available commands.");
    return;
  }

  if (command === "help") {
    await routeCommand("__help__", [], null as never, null as never, null as never);
    return;
  }

  const config = loadConfig();
  const sessionStore = createFileSessionStore();
  const client = createAppium(
    {
      appiumUrl: config.appiumUrl,
      capabilities: config.capabilities,
      defaults: {
        timeout: config.defaults.timeout,
        pollInterval: config.defaults.pollInterval,
      },
    },
    globalThis.fetch,
    sessionStore
  );
  const simctl = createSimctl();

  await routeCommand(command, args, client, simctl, config);
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
