import { describe, it, expect } from "vitest";
import { parseTree, extractTestIDs } from "../src/tree";

// Realistic Appium XCUITest page source fixtures
const SIMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="CareCoordinate" label="CareCoordinate" enabled="true" visible="true" accessible="false" x="0" y="0" width="375" height="812">
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
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="CareCoordinate" label="CareCoordinate" enabled="true" visible="true" accessible="false" x="0" y="0" width="375" height="812">
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
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="CareCoordinate" enabled="true" visible="true" accessible="false" x="0" y="0" width="375" height="812">
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

    it("excludes application-level names", () => {
      const ids = extractTestIDs(NESTED_XML);
      expect(ids).not.toContain("CareCoordinate");
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
});
