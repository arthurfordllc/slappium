/**
 * Appium HTTP client — all REST calls, session management, element finding with auto-wait.
 * Zero runtime dependencies — uses native fetch().
 */

import { extractTestIDs } from "./tree";

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
    super(
      `not found: ${testID} (${(timeoutMs / 1000).toFixed(1)}s)\n  visible: ${idList}`
    );
    this.name = "ElementNotFoundError";
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

export function createAppium(
  config: AppiumConfig,
  fetcher: Fetcher = globalThis.fetch,
  sessionStore?: SessionStore
) {
  const { appiumUrl } = config;

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
    timeout?: number
  ): Promise<string> {
    const sid = await ensureSession();
    const deadline = Date.now() + (timeout ?? config.defaults.timeout);
    const poll = config.defaults.pollInterval;
    const isAndroid = config.platform === "android";

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

      if (Date.now() + poll >= deadline) break;
      await sleep(poll);
    }

    // Timeout — gather available testIDs for error message
    const sid2 = store.readSession() ?? "";
    let available: string[] = [];
    try {
      const source = await getSource(sid2);
      available = extractTestIDs(source);
    } catch {
      // If we can't get source, that's ok — just show empty list
    }
    throw new ElementNotFoundError(testID, timeout ?? config.defaults.timeout, available);
  }

  async function findByPredicate(
    predicate: string,
    timeout?: number
  ): Promise<string> {
    const sid = await ensureSession();
    const deadline = Date.now() + (timeout ?? config.defaults.timeout);
    const poll = config.defaults.pollInterval;

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

      if (Date.now() + poll >= deadline) break;
      await sleep(poll);
    }

    throw new ElementNotFoundError(predicate, timeout ?? config.defaults.timeout, []);
  }

  async function findByText(
    text: string,
    timeout?: number
  ): Promise<string> {
    const isAndroid = config.platform === "android";
    const using = isAndroid ? "-android uiautomator" : "-ios predicate string";
    const value = isAndroid
      ? `new UiSelector().text("${text}").enabled(true)`
      : `label == '${text}' AND visible == true`;

    const sid = await ensureSession();
    const deadline = Date.now() + (timeout ?? config.defaults.timeout);
    const poll = config.defaults.pollInterval;

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

      if (Date.now() + poll >= deadline) break;
      await sleep(poll);
    }

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
    executeScript,
    getSessionId: () => store.readSession(),
  };
}

export type AppiumClient = ReturnType<typeof createAppium>;
