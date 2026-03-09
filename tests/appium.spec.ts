import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAppium } from "../src/appium";

// Mock fetch helper — returns a Response-like object
function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

// Mock fs for session persistence — in-memory store
function createMockFs(): {
  readSession: () => string | null;
  writeSession: (id: string) => void;
  stored: { sessionId: string | null };
} {
  const stored = { sessionId: null as string | null };
  return {
    stored,
    readSession: () => stored.sessionId,
    writeSession: (id: string) => {
      stored.sessionId = id;
    },
  };
}

describe("appium client", () => {
  describe("createSession", () => {
    it("sends POST /session with capabilities", async () => {
      const fetcher = vi.fn().mockResolvedValue(
        mockResponse({
          value: { sessionId: "sess-123", capabilities: {} },
        })
      );
      const fs = createMockFs();
      const client = createAppium(
        {
          appiumUrl: "http://localhost:4723",
          capabilities: { platformName: "iOS" },
          defaults: { timeout: 5000, pollInterval: 300 },
        },
        fetcher,
        fs
      );

      const id = await client.createSession();

      expect(id).toBe("sess-123");
      expect(fetcher).toHaveBeenCalledWith(
        "http://localhost:4723/session",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
      );
      // Verify body contains capabilities
      const body = JSON.parse(fetcher.mock.calls[0][1].body);
      expect(body.capabilities.alwaysMatch.platformName).toBe("iOS");
    });

    it("persists session ID to fs", async () => {
      const fetcher = vi.fn().mockResolvedValue(
        mockResponse({
          value: { sessionId: "sess-456", capabilities: {} },
        })
      );
      const fs = createMockFs();
      const client = createAppium(
        {
          appiumUrl: "http://localhost:4723",
          capabilities: { platformName: "iOS" },
          defaults: { timeout: 5000, pollInterval: 300 },
        },
        fetcher,
        fs
      );

      await client.createSession();
      expect(fs.stored.sessionId).toBe("sess-456");
    });
  });

  describe("isAlive", () => {
    it("returns true for valid session", async () => {
      const fetcher = vi.fn().mockResolvedValue(
        mockResponse({ value: { sessionId: "sess-123" } })
      );
      const fs = createMockFs();
      fs.stored.sessionId = "sess-123";
      const client = createAppium(
        {
          appiumUrl: "http://localhost:4723",
          capabilities: {},
          defaults: { timeout: 5000, pollInterval: 300 },
        },
        fetcher,
        fs
      );

      expect(await client.isAlive()).toBe(true);
    });

    it("returns false for invalid session", async () => {
      const fetcher = vi.fn().mockResolvedValue(
        mockResponse({ value: { error: "invalid session id" } }, 404)
      );
      const fs = createMockFs();
      fs.stored.sessionId = "dead-session";
      const client = createAppium(
        {
          appiumUrl: "http://localhost:4723",
          capabilities: {},
          defaults: { timeout: 5000, pollInterval: 300 },
        },
        fetcher,
        fs
      );

      expect(await client.isAlive()).toBe(false);
    });

    it("returns false when no session stored", async () => {
      const fetcher = vi.fn();
      const fs = createMockFs();
      const client = createAppium(
        {
          appiumUrl: "http://localhost:4723",
          capabilities: {},
          defaults: { timeout: 5000, pollInterval: 300 },
        },
        fetcher,
        fs
      );

      expect(await client.isAlive()).toBe(false);
      expect(fetcher).not.toHaveBeenCalled();
    });
  });

  describe("ensureSession", () => {
    it("reuses existing alive session", async () => {
      const fetcher = vi.fn().mockResolvedValue(
        mockResponse({ value: { sessionId: "existing-sess" } })
      );
      const fs = createMockFs();
      fs.stored.sessionId = "existing-sess";
      const client = createAppium(
        {
          appiumUrl: "http://localhost:4723",
          capabilities: {},
          defaults: { timeout: 5000, pollInterval: 300 },
        },
        fetcher,
        fs
      );

      const id = await client.ensureSession();
      expect(id).toBe("existing-sess");
      // Should only call GET /session (alive check), not POST /session (create)
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][0]).toContain("/session/existing-sess");
    });

    it("creates new session when none exists", async () => {
      const fetcher = vi.fn().mockResolvedValue(
        mockResponse({
          value: { sessionId: "new-sess", capabilities: {} },
        })
      );
      const fs = createMockFs();
      const client = createAppium(
        {
          appiumUrl: "http://localhost:4723",
          capabilities: { platformName: "iOS" },
          defaults: { timeout: 5000, pollInterval: 300 },
        },
        fetcher,
        fs
      );

      const id = await client.ensureSession();
      expect(id).toBe("new-sess");
    });

    it("auto-recovers when session is dead", async () => {
      let callCount = 0;
      const fetcher = vi.fn().mockImplementation((url: string) => {
        callCount++;
        // First call: alive check — fails
        if (callCount === 1) {
          return Promise.resolve(
            mockResponse({ value: { error: "invalid session id" } }, 404)
          );
        }
        // Second call: create session — succeeds
        return Promise.resolve(
          mockResponse({
            value: { sessionId: "recovered-sess", capabilities: {} },
          })
        );
      });
      const fs = createMockFs();
      fs.stored.sessionId = "dead-sess";
      const client = createAppium(
        {
          appiumUrl: "http://localhost:4723",
          capabilities: { platformName: "iOS" },
          defaults: { timeout: 5000, pollInterval: 300 },
        },
        fetcher,
        fs
      );

      const id = await client.ensureSession();
      expect(id).toBe("recovered-sess");
      expect(fs.stored.sessionId).toBe("recovered-sess");
    });
  });

  describe("findElement", () => {
    it("finds element by accessibility id", async () => {
      const fetcher = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/element")) {
          return Promise.resolve(
            mockResponse({
              value: { ELEMENT: "el-abc", "element-6066-...": "el-abc" },
            })
          );
        }
        // Session alive check
        return Promise.resolve(
          mockResponse({ value: { sessionId: "sess-1" } })
        );
      });
      const fs = createMockFs();
      fs.stored.sessionId = "sess-1";
      const client = createAppium(
        {
          appiumUrl: "http://localhost:4723",
          capabilities: {},
          defaults: { timeout: 5000, pollInterval: 300 },
        },
        fetcher,
        fs
      );

      const elId = await client.findElement("save-btn");
      expect(elId).toBe("el-abc");
    });

    it("auto-waits and retries when element not found initially", async () => {
      let elementCalls = 0;
      const fetcher = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        if (url.endsWith("/element") && opts?.method === "POST") {
          elementCalls++;
          if (elementCalls < 3) {
            return Promise.resolve(
              mockResponse({
                value: { error: "no such element", message: "not found" },
              })
            );
          }
          return Promise.resolve(
            mockResponse({
              value: { ELEMENT: "found-after-wait" },
            })
          );
        }
        return Promise.resolve(
          mockResponse({ value: { sessionId: "sess-1" } })
        );
      });
      const fs = createMockFs();
      fs.stored.sessionId = "sess-1";
      const client = createAppium(
        {
          appiumUrl: "http://localhost:4723",
          capabilities: {},
          defaults: { timeout: 5000, pollInterval: 50 },
        },
        fetcher,
        fs
      );

      const elId = await client.findElement("delayed-btn");
      expect(elId).toBe("found-after-wait");
      expect(elementCalls).toBe(3);
    });

    it("throws with available testIDs when element never found", async () => {
      const fetcher = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        if (opts?.method === "POST") {
          return Promise.resolve(
            mockResponse({
              value: { error: "no such element", message: "not found" },
            })
          );
        }
        // GET for source
        if (url.endsWith("/source")) {
          return Promise.resolve(
            mockResponse({
              value: '<XCUIElementTypeButton name="other-btn" label="Other"/>',
            })
          );
        }
        return Promise.resolve(
          mockResponse({ value: { sessionId: "sess-1" } })
        );
      });
      const fs = createMockFs();
      fs.stored.sessionId = "sess-1";
      const client = createAppium(
        {
          appiumUrl: "http://localhost:4723",
          capabilities: {},
          defaults: { timeout: 500, pollInterval: 50 },
        },
        fetcher,
        fs
      );

      await expect(client.findElement("nonexistent")).rejects.toThrow(
        /not found.*nonexistent/i
      );
    });
  });

  describe("click", () => {
    it("sends POST to element click endpoint", async () => {
      const fetcher = vi.fn().mockResolvedValue(mockResponse({ value: null }));
      const fs = createMockFs();
      fs.stored.sessionId = "sess-1";
      const client = createAppium(
        {
          appiumUrl: "http://localhost:4723",
          capabilities: {},
          defaults: { timeout: 5000, pollInterval: 300 },
        },
        fetcher,
        fs
      );

      await client.click("sess-1", "el-123");
      expect(fetcher).toHaveBeenCalledWith(
        "http://localhost:4723/session/sess-1/element/el-123/click",
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  describe("setValue", () => {
    it("sends text to element value endpoint", async () => {
      const fetcher = vi.fn().mockResolvedValue(mockResponse({ value: null }));
      const fs = createMockFs();
      fs.stored.sessionId = "sess-1";
      const client = createAppium(
        {
          appiumUrl: "http://localhost:4723",
          capabilities: {},
          defaults: { timeout: 5000, pollInterval: 300 },
        },
        fetcher,
        fs
      );

      await client.setValue("sess-1", "el-123", "hello world");
      const body = JSON.parse(fetcher.mock.calls[0][1].body);
      expect(body.text).toBe("hello world");
    });
  });

  describe("getSource", () => {
    it("returns page source XML", async () => {
      const xml = '<XCUIElementTypeApplication name="App"/>';
      const fetcher = vi.fn().mockResolvedValue(
        mockResponse({ value: xml })
      );
      const fs = createMockFs();
      fs.stored.sessionId = "sess-1";
      const client = createAppium(
        {
          appiumUrl: "http://localhost:4723",
          capabilities: {},
          defaults: { timeout: 5000, pollInterval: 300 },
        },
        fetcher,
        fs
      );

      const source = await client.getSource("sess-1");
      expect(source).toBe(xml);
    });
  });

  describe("findElement — Android", () => {
    it("uses accessibility id first, falls back to UiAutomator resourceId on Android", async () => {
      let callCount = 0;
      const fetcher = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        if (url.endsWith("/element") && opts?.method === "POST") {
          callCount++;
          const body = JSON.parse(opts.body as string);
          // accessibility id fails
          if (body.using === "accessibility id") {
            return Promise.resolve(
              mockResponse({ value: { error: "no such element", message: "not found" } })
            );
          }
          // UiAutomator resourceId succeeds
          if (body.using === "-android uiautomator" && body.value.includes("resourceId")) {
            return Promise.resolve(
              mockResponse({ value: { ELEMENT: "el-via-resourceid" } })
            );
          }
          return Promise.resolve(
            mockResponse({ value: { error: "no such element", message: "not found" } })
          );
        }
        return Promise.resolve(mockResponse({ value: { sessionId: "sess-1" } }));
      });
      const fs = createMockFs();
      fs.stored.sessionId = "sess-1";
      const client = createAppium(
        {
          appiumUrl: "http://localhost:4723",
          capabilities: { platformName: "Android" },
          platform: "android",
          defaults: { timeout: 5000, pollInterval: 300 },
        },
        fetcher,
        fs
      );

      const elId = await client.findElement("email-input");
      expect(elId).toBe("el-via-resourceid");
    });

    it("uses accessibility id when it succeeds on Android (no fallback needed)", async () => {
      const fetcher = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        if (url.endsWith("/element") && opts?.method === "POST") {
          return Promise.resolve(
            mockResponse({ value: { ELEMENT: "el-via-a11y" } })
          );
        }
        return Promise.resolve(mockResponse({ value: { sessionId: "sess-1" } }));
      });
      const fs = createMockFs();
      fs.stored.sessionId = "sess-1";
      const client = createAppium(
        {
          appiumUrl: "http://localhost:4723",
          capabilities: { platformName: "Android" },
          platform: "android",
          defaults: { timeout: 5000, pollInterval: 300 },
        },
        fetcher,
        fs
      );

      const elId = await client.findElement("sign-out-btn");
      expect(elId).toBe("el-via-a11y");
      // Should only call element endpoint once (accessibility id succeeded)
      const elementCalls = fetcher.mock.calls.filter(
        (c: [string, RequestInit?]) => c[0].endsWith("/element")
      );
      expect(elementCalls.length).toBe(1);
    });

    it("still uses only accessibility id when platform is ios", async () => {
      const fetcher = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        if (url.endsWith("/element") && opts?.method === "POST") {
          return Promise.resolve(
            mockResponse({ value: { ELEMENT: "el-ios" } })
          );
        }
        return Promise.resolve(mockResponse({ value: { sessionId: "sess-1" } }));
      });
      const fs = createMockFs();
      fs.stored.sessionId = "sess-1";
      const client = createAppium(
        {
          appiumUrl: "http://localhost:4723",
          capabilities: { platformName: "iOS" },
          platform: "ios",
          defaults: { timeout: 5000, pollInterval: 300 },
        },
        fetcher,
        fs
      );

      await client.findElement("save-btn");
      const body = JSON.parse(fetcher.mock.calls[1][1].body);
      expect(body.using).toBe("accessibility id");
    });
  });

  describe("findByText", () => {
    it("uses iOS predicate string when platform is ios", async () => {
      const fetcher = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/element")) {
          return Promise.resolve(
            mockResponse({ value: { ELEMENT: "el-text" } })
          );
        }
        return Promise.resolve(
          mockResponse({ value: { sessionId: "sess-1" } })
        );
      });
      const fs = createMockFs();
      fs.stored.sessionId = "sess-1";
      const client = createAppium(
        {
          appiumUrl: "http://localhost:4723",
          capabilities: { platformName: "iOS" },
          platform: "ios",
          defaults: { timeout: 5000, pollInterval: 300 },
        },
        fetcher,
        fs
      );

      await client.findByText("Back");
      const body = JSON.parse(fetcher.mock.calls[1][1].body);
      expect(body.using).toBe("-ios predicate string");
      expect(body.value).toContain("Back");
    });

    it("uses android uiautomator when platform is android", async () => {
      const fetcher = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/element")) {
          return Promise.resolve(
            mockResponse({ value: { ELEMENT: "el-text" } })
          );
        }
        return Promise.resolve(
          mockResponse({ value: { sessionId: "sess-1" } })
        );
      });
      const fs = createMockFs();
      fs.stored.sessionId = "sess-1";
      const client = createAppium(
        {
          appiumUrl: "http://localhost:4723",
          capabilities: { platformName: "Android" },
          platform: "android",
          defaults: { timeout: 5000, pollInterval: 300 },
        },
        fetcher,
        fs
      );

      await client.findByText("Back");
      const body = JSON.parse(fetcher.mock.calls[1][1].body);
      expect(body.using).toBe("-android uiautomator");
      expect(body.value).toContain("Back");
    });

    it("defaults to ios when platform not specified", async () => {
      const fetcher = vi.fn().mockImplementation((url: string) => {
        if (url.endsWith("/element")) {
          return Promise.resolve(
            mockResponse({ value: { ELEMENT: "el-text" } })
          );
        }
        return Promise.resolve(
          mockResponse({ value: { sessionId: "sess-1" } })
        );
      });
      const fs = createMockFs();
      fs.stored.sessionId = "sess-1";
      const client = createAppium(
        {
          appiumUrl: "http://localhost:4723",
          capabilities: { platformName: "iOS" },
          defaults: { timeout: 5000, pollInterval: 300 },
        },
        fetcher,
        fs
      );

      await client.findByText("Submit");
      const body = JSON.parse(fetcher.mock.calls[1][1].body);
      expect(body.using).toBe("-ios predicate string");
    });
  });
});
