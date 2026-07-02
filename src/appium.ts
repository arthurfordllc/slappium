/**
 * Appium HTTP client — all REST calls, session management, element finding with auto-wait.
 * Zero runtime dependencies — uses native fetch().
 */

import { extractTestIDs } from "./tree";
import { AdaptivePoll, FixedPoll, type PollStrategy } from "./polling";
import { closestMatches } from "./fuzzy";

export interface AppiumConfig {
  appiumUrl: string;
  capabilities: Record<string, unknown>;
  platform?: "ios" | "android";
  defaults: {
    timeout: number;
    pollInterval: number;
  };
}

export interface SessionStore {
  readSession: () => string | null;
  writeSession: (id: string) => void;
}

export class ElementNotFoundError extends Error {
  constructor(
    public readonly testID: string,
    public readonly timeoutMs: number,
    public readonly availableIDs: string[]
  ) {
    const idList = availableIDs.length > 0
      ? availableIDs.join(", ")
      : "(none detected)";
    let msg = `not found: ${testID} (${(timeoutMs / 1000).toFixed(1)}s)`;
    const suggestions = closestMatches(testID, availableIDs);
    if (suggestions.length > 0) {
      msg += `\n  did you mean: ${suggestions.join(", ")}`;
    }
    msg += `\n  visible: ${idList}`;
    super(msg);
    this.name = "ElementNotFoundError";
  }
}

/**
 * The app under test is not in the foreground — every "element not found"
 * would be a lie about the real problem. queryAppState values (XCUITest):
 * 0 not installed, 1 not running, 2/3 backgrounded, 4 foreground.
 */
export class AppNotRunningError extends Error {
  constructor(appId: string, state: number) {
    const desc = state === 0 ? "not installed"
      : state === 1 ? "not running (crashed or terminated)"
      : "backgrounded";
    super(`app ${appId} is ${desc} (state=${state}) — try \`slap relaunch\``);
    this.name = "AppNotRunningError";
  }
}

type Fetcher = typeof globalThis.fetch;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extract element ID from Appium's response value (handles both old and new formats) */
function extractElementId(value: Record<string, unknown>): string {
  if (typeof value["ELEMENT"] === "string") return value["ELEMENT"];
  // New format: key is a UUID-like string
  for (const key of Object.keys(value)) {
    if (key !== "error" && key !== "message" && key !== "stacktrace") {
      const v = value[key];
      if (typeof v === "string") return v;
    }
  }
  throw new Error("Could not extract element ID from response");
}

/** Wrap a fetcher with retry logic: 2 retries for 5xx/network errors, no retry on 4xx. */
function withRetry(fetcher: Fetcher, maxRetries = 2, baseDelay = 200): Fetcher {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const resp = await fetcher(input, init);
        if (resp.status >= 500 && attempt < maxRetries) {
          await sleep(baseDelay * (attempt + 1));
          continue;
        }
        return resp;
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          await sleep(baseDelay * (attempt + 1));
          continue;
        }
      }
    }
    throw lastError;
  };
}

export function createAppium(
  config: AppiumConfig,
  rawFetcher: Fetcher = globalThis.fetch,
  sessionStore?: SessionStore
) {
  const { appiumUrl } = config;
  const fetcher = withRetry(rawFetcher);

  /** The app id under test — iOS bundleId or Android appPackage, from capabilities. */
  function configuredAppId(): string | null {
    const caps = config.capabilities;
    const id = caps["appium:bundleId"] ?? caps["bundleId"] ?? caps["appium:appPackage"] ?? caps["appPackage"];
    return typeof id === "string" ? id : null;
  }

  // Default file-based session store
  const store: SessionStore = sessionStore ?? {
    readSession: () => null,
    writeSession: () => {},
  };

  // --- Session Management ---

  async function createSession(): Promise<string> {
    const resp = await fetcher(`${appiumUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capabilities: {
          alwaysMatch: config.capabilities,
        },
      }),
    });
    const data = await resp.json() as { value: { sessionId: string } };
    const sessionId = data.value.sessionId;
    store.writeSession(sessionId);
    return sessionId;
  }

  async function isAlive(): Promise<boolean> {
    const sessionId = store.readSession();
    if (!sessionId) return false;

    try {
      const resp = await fetcher(`${appiumUrl}/session/${sessionId}`);
      if (!resp.ok) return false;
      const data = await resp.json() as { value: Record<string, unknown> };
      return !data.value?.error;
    } catch {
      return false;
    }
  }

  async function ensureSession(): Promise<string> {
    const existing = store.readSession();
    if (existing) {
      const alive = await isAlive();
      if (alive) return existing;
    }
    return createSession();
  }

  // --- Element Finding ---

  async function findElement(
    testID: string,
    timeout?: number,
    pollStrategy?: PollStrategy
  ): Promise<string> {
    const sid = await ensureSession();
    const deadline = Date.now() + (timeout ?? config.defaults.timeout);
    const poller = pollStrategy ?? new AdaptivePoll(50, config.defaults.pollInterval);
    const isAndroid = config.platform === "android";

    poller.reset();
    while (Date.now() < deadline) {
      // Try accessibility id first (works on both platforms)
      const resp = await fetcher(`${appiumUrl}/session/${sid}/element`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ using: "accessibility id", value: testID }),
      });
      const data = await resp.json() as { value: Record<string, unknown> };

      if (data.value && !data.value.error) {
        return extractElementId(data.value);
      }

      // On Android, fall back to UiAutomator resourceId (React Native maps testID → resource-id)
      if (isAndroid) {
        const resp2 = await fetcher(`${appiumUrl}/session/${sid}/element`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            using: "-android uiautomator",
            value: `new UiSelector().resourceId("${testID}")`,
          }),
        });
        const data2 = await resp2.json() as { value: Record<string, unknown> };

        if (data2.value && !data2.value.error) {
          return extractElementId(data2.value);
        }
      }

      const delay = poller.nextDelay();
      if (Date.now() + delay >= deadline) break;
      await sleep(delay);
    }

    // Timeout — before blaming the element, check whether the app is even
    // in the foreground. A dead app used to surface as "(none detected)".
    const sid2 = store.readSession() ?? "";
    await assertAppForeground(sid2);
    let available: string[] = [];
    try {
      const source = await getSource(sid2);
      available = extractTestIDs(source);
    } catch {
      // If we can't get source, that's ok — just show empty list
    }
    throw new ElementNotFoundError(testID, timeout ?? config.defaults.timeout, available);
  }

  /** Throw AppNotRunningError when the configured app is not foreground. Best-effort. */
  async function assertAppForeground(sessionId: string): Promise<void> {
    const appId = configuredAppId();
    if (!appId || !sessionId) return;
    try {
      const state = await queryAppState(sessionId);
      if (state !== null && state < 4) {
        throw new AppNotRunningError(appId, state);
      }
    } catch (err) {
      if (err instanceof AppNotRunningError) throw err;
      // State query unsupported/failed — fall through to the normal error.
    }
  }

  async function findByPredicate(
    predicate: string,
    timeout?: number
  ): Promise<string> {
    const sid = await ensureSession();
    const deadline = Date.now() + (timeout ?? config.defaults.timeout);
    const poller = new AdaptivePoll(50, config.defaults.pollInterval);

    poller.reset();
    while (Date.now() < deadline) {
      const resp = await fetcher(`${appiumUrl}/session/${sid}/element`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          using: "-ios predicate string",
          value: predicate,
        }),
      });
      const data = await resp.json() as { value: Record<string, unknown> };

      if (data.value && !data.value.error) {
        return extractElementId(data.value);
      }

      const delay = poller.nextDelay();
      if (Date.now() + delay >= deadline) break;
      await sleep(delay);
    }

    throw new ElementNotFoundError(predicate, timeout ?? config.defaults.timeout, []);
  }

  async function findByText(
    text: string,
    timeout?: number
  ): Promise<string> {
    const isAndroid = config.platform === "android";
    const using = isAndroid ? "-android uiautomator" : "-ios predicate string";
    // Case-insensitive substring match on label OR name — exact-equality
    // predicates couldn't hit tab labels or text with surrounding chrome.
    const iosText = text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const androidText = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const value = isAndroid
      ? `new UiSelector().textContains("${androidText}").enabled(true)`
      : `(label CONTAINS[c] '${iosText}' OR name CONTAINS[c] '${iosText}') AND visible == true`;

    const sid = await ensureSession();
    const deadline = Date.now() + (timeout ?? config.defaults.timeout);
    const poller = new AdaptivePoll(50, config.defaults.pollInterval);

    poller.reset();
    while (Date.now() < deadline) {
      const resp = await fetcher(`${appiumUrl}/session/${sid}/element`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ using, value }),
      });
      const data = await resp.json() as { value: Record<string, unknown> };

      if (data.value && !data.value.error) {
        return extractElementId(data.value);
      }

      const delay = poller.nextDelay();
      if (Date.now() + delay >= deadline) break;
      await sleep(delay);
    }

    await assertAppForeground(store.readSession() ?? "");
    throw new ElementNotFoundError(text, timeout ?? config.defaults.timeout, []);
  }

  // --- Element Actions ---

  async function click(sessionId: string, elementId: string): Promise<void> {
    await fetcher(`${appiumUrl}/session/${sessionId}/element/${elementId}/click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  }

  async function clear(sessionId: string, elementId: string): Promise<void> {
    await fetcher(`${appiumUrl}/session/${sessionId}/element/${elementId}/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  }

  async function setValue(
    sessionId: string,
    elementId: string,
    text: string
  ): Promise<void> {
    await fetcher(
      `${appiumUrl}/session/${sessionId}/element/${elementId}/value`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      }
    );
  }

  async function getAttribute(
    sessionId: string,
    elementId: string,
    name: string
  ): Promise<string | null> {
    const resp = await fetcher(
      `${appiumUrl}/session/${sessionId}/element/${elementId}/attribute/${name}`
    );
    const data = await resp.json() as { value: string | null };
    return data.value;
  }

  // --- Page Inspection ---

  async function getSource(sessionId: string): Promise<string> {
    const resp = await fetcher(`${appiumUrl}/session/${sessionId}/source`);
    const data = await resp.json() as { value: string };
    return data.value;
  }

  // --- Window Size (cached) ---

  let cachedWindowSize: { width: number; height: number } | null = null;

  async function getWindowSize(sessionId: string): Promise<{ width: number; height: number }> {
    if (cachedWindowSize) return cachedWindowSize;
    const resp = await fetcher(`${appiumUrl}/session/${sessionId}/window/rect`);
    const data = await resp.json() as { value: { width: number; height: number } };
    cachedWindowSize = { width: data.value.width, height: data.value.height };
    return cachedWindowSize;
  }

  // --- Mobile Commands ---

  async function executeScript(
    sessionId: string,
    script: string,
    args: unknown[] = []
  ): Promise<unknown> {
    const resp = await fetcher(`${appiumUrl}/session/${sessionId}/execute/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script, args }),
    });
    const data = await resp.json() as { value: unknown };
    return data.value;
  }

  // --- App Lifecycle ---

  /** XCUITest/UiAutomator2 app state: 0 not installed, 1 not running, 2/3 background, 4 foreground. */
  async function queryAppState(sessionId: string): Promise<number | null> {
    const appId = configuredAppId();
    if (!appId) return null;
    const value = await executeScript(sessionId, "mobile: queryAppState", [
      { bundleId: appId, appId },
    ]);
    return typeof value === "number" ? value : null;
  }

  /** Terminate (best-effort) then activate the configured app — the crash recovery path. */
  async function relaunchApp(): Promise<void> {
    const appId = configuredAppId();
    if (!appId) throw new Error("relaunch requires a bundleId/appPackage capability");
    const sid = await ensureSession();
    try {
      await executeScript(sid, "mobile: terminateApp", [{ bundleId: appId, appId }]);
    } catch {
      // Already dead — that's the usual reason we're relaunching.
    }
    await executeScript(sid, "mobile: activateApp", [{ bundleId: appId, appId }]);
  }

  /** Open a deep link in the app under test. */
  async function openDeepLink(url: string): Promise<void> {
    const appId = configuredAppId();
    const sid = await ensureSession();
    await executeScript(sid, "mobile: deepLink", [
      appId ? { url, bundleId: appId } : { url },
    ]);
  }

  // --- Keyboard ---

  async function isKeyboardShown(sessionId: string): Promise<boolean> {
    try {
      const resp = await fetcher(`${appiumUrl}/session/${sessionId}/appium/device/is_keyboard_shown`);
      const data = await resp.json() as { value: boolean };
      return data.value === true;
    } catch {
      return false;
    }
  }

  async function hideKeyboard(sessionId: string): Promise<void> {
    try {
      await fetcher(`${appiumUrl}/session/${sessionId}/appium/device/hide_keyboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } catch {
      // Keyboard hiding is best-effort — a tap can still proceed.
    }
  }

  return {
    createSession,
    isAlive,
    ensureSession,
    findElement,
    findByPredicate,
    findByText,
    click,
    clear,
    setValue,
    getAttribute,
    getSource,
    getWindowSize,
    executeScript,
    queryAppState,
    relaunchApp,
    openDeepLink,
    isKeyboardShown,
    hideKeyboard,
    getSessionId: () => store.readSession(),
  };
}

export type AppiumClient = ReturnType<typeof createAppium>;
