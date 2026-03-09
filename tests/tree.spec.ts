import { describe, it, expect } from "vitest";
import { parseTree, extractTestIDs } from "../src/tree";

// Realistic Appium XCUITest page source fixtures
const SIMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="MyApp" label="MyApp" enabled="true" visible="true" accessible="false" x="0" y="0" width="375" height="812">
    <XCUIElementTypeWindow type="XCUIElementTypeWindow" enabled="true" visible="true" accessible="false" x="0" y="0" width="375" height="812">
      <XCUIElementTypeOther type="XCUIElementTypeOther" enabled="true" visible="true" accessible="false" x="0" y="0" width="375" height="812">
        <XCUIElementTypeButton type="XCUIElementTypeButton" name="back-btn" label="Back" enabled="true" visible="true" accessible="true" x="8" y="48" width="60" height="32"/>
        <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" value="Guidance" name="Guidance" label="Guidance" enabled="true" visible="true" accessible="true" x="120" y="52" width="135" height="24"/>
      </XCUIElementTypeOther>
    </XCUIElementTypeWindow>
  </XCUIElementTypeApplication>
</AppiumAUT>`;

const NESTED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="MyApp" label="MyApp" enabled="true" visible="true" accessible="false" x="0" y="0" width="375" height="812">
    <XCUIElementTypeWindow type="XCUIElementTypeWindow" enabled="true" visible="true" accessible="false" x="0" y="0" width="375" height="812">
      <XCUIElementTypeOther type="XCUIElementTypeOther" enabled="true" visible="true" accessible="false" x="0" y="0" width="375" height="812">
        <XCUIElementTypeOther type="XCUIElementTypeOther" name="header-bar" enabled="true" visible="true" accessible="false" x="0" y="44" width="375" height="44">
          <XCUIElementTypeButton type="XCUIElementTypeButton" name="back-btn" label="Back" enabled="true" visible="true" accessible="true" x="8" y="48" width="60" height="32"/>
          <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" value="Guidance" name="Guidance" label="Guidance" enabled="true" visible="true" accessible="true" x="120" y="52" width="135" height="24"/>
        </XCUIElementTypeOther>
        <XCUIElementTypeTextField type="XCUIElementTypeTextField" name="question-input" label="" enabled="true" visible="true" accessible="true" x="36" y="200" width="303" height="42" placeholderValue="Ask about caregiving..."/>
        <XCUIElementTypeOther type="XCUIElementTypeOther" name="send-btn" label="Send question" enabled="false" visible="true" accessible="true" x="300" y="205" width="35" height="35"/>
      </XCUIElementTypeOther>
    </XCUIElementTypeWindow>
  </XCUIElementTypeApplication>
</AppiumAUT>`;

const GUIDE_CARD_XML = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="MyApp" enabled="true" visible="true" accessible="false" x="0" y="0" width="375" height="812">
    <XCUIElementTypeWindow type="XCUIElementTypeWindow" enabled="true" visible="true" accessible="false" x="0" y="0" width="375" height="812">
      <XCUIElementTypeOther type="XCUIElementTypeOther" enabled="true" visible="true" accessible="false" x="0" y="0" width="375" height="812">
        <XCUIElementTypeOther type="XCUIElementTypeOther" name="guide-card-g1" enabled="true" visible="true" accessible="false" x="20" y="300" width="335" height="120">
          <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" value="Medicare Part B Explained" label="Medicare Part B Explained" enabled="true" visible="true" accessible="true" x="36" y="316" width="200" height="20"/>
          <XCUIElementTypeOther type="XCUIElementTypeOther" name="category-pill" label="Medicare" enabled="true" visible="true" accessible="true" x="36" y="340" width="60" height="20"/>
          <XCUIElementTypeButton type="XCUIElementTypeButton" name="read-more-btn" label="Read More" enabled="true" visible="true" accessible="true" x="36" y="370" width="100" height="30"/>
          <XCUIElementTypeButton type="XCUIElementTypeButton" name="delete-guide-btn" label="Delete guide" enabled="true" visible="true" accessible="true" x="310" y="316" width="28" height="28"/>
        </XCUIElementTypeOther>
      </XCUIElementTypeOther>
    </XCUIElementTypeWindow>
  </XCUIElementTypeApplication>
</AppiumAUT>`;

// Realistic Appium UiAutomator2 page source fixtures (Android)
const ANDROID_SIMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <android.widget.FrameLayout index="0" package="com.example.myapp" class="android.widget.FrameLayout" text="" content-desc="" resource-id="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" scrollable="false" displayed="true" bounds="[0,0][1080,2340]">
    <android.view.ViewGroup index="0" class="android.view.ViewGroup" text="" content-desc="" clickable="false" enabled="true" displayed="true" bounds="[0,0][1080,2340]">
      <android.view.ViewGroup index="0" class="android.view.ViewGroup" text="" content-desc="back-btn" clickable="true" enabled="true" displayed="true" bounds="[24,132][180,216]"/>
      <android.widget.TextView index="1" class="android.widget.TextView" text="Guidance" content-desc="Guidance" clickable="false" enabled="true" displayed="true" bounds="[360,156][720,192]"/>
    </android.view.ViewGroup>
  </android.widget.FrameLayout>
</hierarchy>`;

// Android XML with resource-id testIDs (React Native maps testID to resource-id on some components)
const ANDROID_RESOURCE_ID_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <android.widget.FrameLayout index="0" package="com.example.myapp" class="android.widget.FrameLayout" text="" content-desc="" resource-id="" clickable="false" enabled="true" displayed="true" bounds="[0,0][1080,2400]">
    <android.widget.EditText index="0" class="android.widget.EditText" text="you@example.com" resource-id="email-input" content-desc="" clickable="true" enabled="true" displayed="true" hint="you@example.com" bounds="[200,756][965,868]"/>
    <android.widget.EditText index="1" class="android.widget.EditText" text="" resource-id="password-input" content-desc="" clickable="true" enabled="true" displayed="true" hint="Enter your password" bounds="[200,1055][912,1167]"/>
    <android.widget.Button index="2" class="android.widget.Button" text="" content-desc="Log In" resource-id="login-button" clickable="true" enabled="true" displayed="true" bounds="[74,1278][1007,1418]"/>
  </android.widget.FrameLayout>
</hierarchy>`;

const ANDROID_NESTED_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <android.widget.FrameLayout index="0" package="com.example.myapp" class="android.widget.FrameLayout" text="" content-desc="" clickable="false" enabled="true" displayed="true" bounds="[0,0][1080,2340]">
    <android.view.ViewGroup index="0" class="android.view.ViewGroup" text="" content-desc="header-bar" clickable="false" enabled="true" displayed="true" bounds="[0,132][1080,264]">
      <android.view.ViewGroup index="0" class="android.view.ViewGroup" text="" content-desc="back-btn" clickable="true" enabled="true" displayed="true" bounds="[24,132][180,216]"/>
      <android.widget.TextView index="1" class="android.widget.TextView" text="Guidance" content-desc="Guidance" clickable="false" enabled="true" displayed="true" bounds="[360,156][720,192]"/>
    </android.view.ViewGroup>
    <android.widget.EditText index="1" class="android.widget.EditText" text="" content-desc="question-input" clickable="true" enabled="true" displayed="true" hint="Ask about caregiving..." bounds="[108,600][972,726]"/>
    <android.view.ViewGroup index="2" class="android.view.ViewGroup" text="" content-desc="send-btn" clickable="true" enabled="false" displayed="true" bounds="[900,615][1005,711]"/>
  </android.widget.FrameLayout>
</hierarchy>`;

describe("tree", () => {
  describe("parseTree", () => {
    it("parses simple XML with named elements", () => {
      const tree = parseTree(SIMPLE_XML);
      expect(tree).toContain("[back-btn]");
      expect(tree).toContain("Button");
      expect(tree).toContain('"Back"');
      expect(tree).toContain('"Guidance"');
    });

    it("collapses unnamed wrapper elements", () => {
      const tree = parseTree(SIMPLE_XML);
      // Should NOT show XCUIElementTypeWindow or XCUIElementTypeOther without names
      expect(tree).not.toContain("[Window]");
      expect(tree).not.toContain("XCUIElementType");
    });

    it("shows testIDs in brackets", () => {
      const tree = parseTree(NESTED_XML);
      expect(tree).toContain("[header-bar]");
      expect(tree).toContain("[back-btn]");
      expect(tree).toContain("[question-input]");
      expect(tree).toContain("[send-btn]");
    });

    it("shows interactive element types", () => {
      const tree = parseTree(NESTED_XML);
      expect(tree).toMatch(/\[back-btn\].*Button/);
      expect(tree).toMatch(/\[question-input\].*TextField/);
    });

    it("shows text content in quotes", () => {
      const tree = parseTree(NESTED_XML);
      expect(tree).toContain('"Guidance"');
    });

    it("shows placeholder text for TextFields", () => {
      const tree = parseTree(NESTED_XML);
      expect(tree).toContain('placeholder="Ask about caregiving..."');
    });

    it("shows disabled state", () => {
      const tree = parseTree(NESTED_XML);
      // send-btn is enabled="false"
      expect(tree).toMatch(/\[send-btn\].*\(disabled\)/);
    });

    it("preserves nesting with indentation", () => {
      const tree = parseTree(NESTED_XML);
      const lines = tree.split("\n");
      // header-bar should be at a certain indent, its children deeper
      const headerLine = lines.find((l) => l.includes("[header-bar]"));
      const backBtnLine = lines.find((l) => l.includes("[back-btn]"));
      expect(headerLine).toBeDefined();
      expect(backBtnLine).toBeDefined();
      // back-btn should be indented more than header-bar
      const headerIndent = headerLine!.search(/\S/);
      const backBtnIndent = backBtnLine!.search(/\S/);
      expect(backBtnIndent).toBeGreaterThan(headerIndent);
    });

    it("handles guide card with nested elements", () => {
      const tree = parseTree(GUIDE_CARD_XML);
      expect(tree).toContain("[guide-card-g1]");
      expect(tree).toContain('"Medicare Part B Explained"');
      expect(tree).toContain("[read-more-btn]");
      expect(tree).toContain("[delete-guide-btn]");
    });

    it("handles empty XML gracefully", () => {
      expect(() => parseTree("")).not.toThrow();
      expect(parseTree("")).toBe("");
    });

    it("handles malformed XML gracefully", () => {
      expect(() => parseTree("<not valid xml")).not.toThrow();
    });
  });

  describe("extractTestIDs", () => {
    it("extracts all named elements from XML", () => {
      const ids = extractTestIDs(NESTED_XML);
      expect(ids).toContain("header-bar");
      expect(ids).toContain("back-btn");
      expect(ids).toContain("question-input");
      expect(ids).toContain("send-btn");
    });

    it("includes application-level names in testID list", () => {
      const ids = extractTestIDs(NESTED_XML);
      expect(ids).toContain("MyApp");
    });

    it("returns empty array for empty XML", () => {
      expect(extractTestIDs("")).toEqual([]);
    });

    it("extracts from guide card XML", () => {
      const ids = extractTestIDs(GUIDE_CARD_XML);
      expect(ids).toContain("guide-card-g1");
      expect(ids).toContain("read-more-btn");
      expect(ids).toContain("delete-guide-btn");
      expect(ids).toContain("category-pill");
    });
  });

  describe("parseTree — Android XML", () => {
    it("parses Android hierarchy with named elements", () => {
      const tree = parseTree(ANDROID_SIMPLE_XML);
      expect(tree).toContain("[back-btn]");
      expect(tree).toContain('"Guidance"');
    });

    it("collapses unnamed Android wrapper elements", () => {
      const tree = parseTree(ANDROID_SIMPLE_XML);
      expect(tree).not.toContain("FrameLayout");
      expect(tree).not.toContain("android.widget");
      expect(tree).not.toContain("android.view");
    });

    it("shows Android testIDs in brackets with indentation", () => {
      const tree = parseTree(ANDROID_NESTED_XML);
      expect(tree).toContain("[header-bar]");
      expect(tree).toContain("[back-btn]");
      expect(tree).toContain("[question-input]");
      expect(tree).toContain("[send-btn]");
    });

    it("shows interactive Android element types", () => {
      const tree = parseTree(ANDROID_NESTED_XML);
      expect(tree).toMatch(/\[question-input\].*EditText/);
    });

    it("shows placeholder text from hint attribute", () => {
      const tree = parseTree(ANDROID_NESTED_XML);
      expect(tree).toContain('placeholder="Ask about caregiving..."');
    });

    it("shows disabled state on Android", () => {
      const tree = parseTree(ANDROID_NESTED_XML);
      expect(tree).toMatch(/\[send-btn\].*\(disabled\)/);
    });

    it("preserves nesting for named Android elements", () => {
      const tree = parseTree(ANDROID_NESTED_XML);
      const lines = tree.split("\n");
      const headerLine = lines.find((l) => l.includes("[header-bar]"));
      const backBtnLine = lines.find((l) => l.includes("[back-btn]"));
      expect(headerLine).toBeDefined();
      expect(backBtnLine).toBeDefined();
      const headerIndent = headerLine!.search(/\S/);
      const backBtnIndent = backBtnLine!.search(/\S/);
      expect(backBtnIndent).toBeGreaterThan(headerIndent);
    });
  });

  describe("extractTestIDs — Android XML", () => {
    it("extracts content-desc testIDs from Android XML", () => {
      const ids = extractTestIDs(ANDROID_NESTED_XML);
      expect(ids).toContain("header-bar");
      expect(ids).toContain("back-btn");
      expect(ids).toContain("question-input");
      expect(ids).toContain("send-btn");
    });

    it("excludes empty content-desc values", () => {
      const ids = extractTestIDs(ANDROID_SIMPLE_XML);
      expect(ids).not.toContain("");
    });

    it("extracts Guidance text as testID (content-desc matches)", () => {
      const ids = extractTestIDs(ANDROID_NESTED_XML);
      expect(ids).toContain("Guidance");
    });
  });

  describe("parseTree — Android resource-id", () => {
    it("shows testIDs from resource-id when content-desc is empty", () => {
      const tree = parseTree(ANDROID_RESOURCE_ID_XML);
      expect(tree).toContain("[email-input]");
      expect(tree).toContain("[password-input]");
    });

    it("prefers resource-id over content-desc for testID name", () => {
      const tree = parseTree(ANDROID_RESOURCE_ID_XML);
      // login-button has resource-id="login-button" and content-desc="Log In"
      // Should show resource-id as the testID
      expect(tree).toContain("[login-button]");
    });

    it("shows interactive types for resource-id elements", () => {
      const tree = parseTree(ANDROID_RESOURCE_ID_XML);
      expect(tree).toMatch(/\[email-input\].*EditText/);
      expect(tree).toMatch(/\[login-button\].*Button/);
    });

    it("shows placeholder from hint on resource-id elements", () => {
      const tree = parseTree(ANDROID_RESOURCE_ID_XML);
      expect(tree).toContain('placeholder="Enter your password"');
    });
  });

  describe("extractTestIDs — Android resource-id", () => {
    it("extracts resource-id testIDs from Android XML", () => {
      const ids = extractTestIDs(ANDROID_RESOURCE_ID_XML);
      expect(ids).toContain("email-input");
      expect(ids).toContain("password-input");
      expect(ids).toContain("login-button");
    });

    it("extracts both content-desc and resource-id testIDs without duplicates", () => {
      const ids = extractTestIDs(ANDROID_RESOURCE_ID_XML);
      // login-button appears in both resource-id and content-desc="Log In"
      // "Log In" is a label, not a testID — only resource-id values should be extracted
      expect(ids).toContain("login-button");
      // "Log In" from content-desc should also be included (it's a valid accessibility id)
      expect(ids).toContain("Log In");
    });

    it("excludes empty resource-id values", () => {
      const ids = extractTestIDs(ANDROID_RESOURCE_ID_XML);
      expect(ids).not.toContain("");
    });
  });
});
