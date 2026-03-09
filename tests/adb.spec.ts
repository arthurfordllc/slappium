import { describe, it, expect, vi } from "vitest";
import { createAdb, type Executor } from "../src/adb";

describe("adb", () => {
  describe("screenshot", () => {
    it("captures screenshot via adb and saves to /tmp", () => {
      const exec = vi.fn<Executor>().mockReturnValue("");
      const adb = createAdb(exec);
      const path = adb.screenshot("test-shot");
      expect(exec).toHaveBeenCalledTimes(1);
      expect(exec.mock.calls[0][0]).toContain("adb exec-out screencap -p");
      expect(exec.mock.calls[0][0]).toContain("/tmp/test-shot.png");
      expect(path).toBe("/tmp/test-shot.png");
    });

    it("uses timestamp-based name when no name provided", () => {
      const exec = vi.fn<Executor>().mockReturnValue("");
      const adb = createAdb(exec);
      const path = adb.screenshot();
      expect(path).toMatch(/^\/tmp\/slap-\d+\.png$/);
    });
  });

  describe("launchApp", () => {
    it("launches app via am start with package and activity", () => {
      const exec = vi.fn<Executor>().mockReturnValue("");
      const adb = createAdb(exec);
      adb.launchApp("com.example.myapp", ".MainActivity");
      expect(exec).toHaveBeenCalledWith(
        'adb shell am start -n "com.example.myapp/.MainActivity"'
      );
    });
  });

  describe("terminateApp", () => {
    it("force-stops app via am", () => {
      const exec = vi.fn<Executor>().mockReturnValue("");
      const adb = createAdb(exec);
      adb.terminateApp("com.example.myapp");
      expect(exec).toHaveBeenCalledWith(
        'adb shell am force-stop "com.example.myapp"'
      );
    });
  });

  describe("pressBack", () => {
    it("sends KEYCODE_BACK via input keyevent", () => {
      const exec = vi.fn<Executor>().mockReturnValue("");
      const adb = createAdb(exec);
      adb.pressBack();
      expect(exec).toHaveBeenCalledWith(
        "adb shell input keyevent KEYCODE_BACK"
      );
    });
  });
});
