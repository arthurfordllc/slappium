/**
 * Parses Appium page source XML into a clean, collapsed testID tree.
 * Supports both iOS (XCUITest) and Android (UiAutomator2) XML formats.
 *
 * Collapsing rules:
 * - Unnamed wrapper elements are skipped; children promoted
 * - Interactive elements (Button, TextField/EditText, Switch, etc.) always show their type
 * - StaticText/TextView shows value in quotes
 * - Disabled elements get (disabled) suffix
 * - TextFields/EditTexts show placeholder text
 */

interface TreeNode {
  type: string; // e.g. "XCUIElementTypeButton" → "Button"
  name: string | null; // testID / accessibility id
  label: string | null;
  value: string | null;
  enabled: boolean;
  visible: boolean;
  placeholder: string | null;
  children: TreeNode[];
}

// iOS interactive element types
const INTERACTIVE_TYPES = new Set([
  "Button",
  "TextField",
  "SecureTextField",
  "TextView",
  "Switch",
  "Slider",
  "Stepper",
  "Picker",
  "DatePicker",
  "SegmentedControl",
  "PageIndicator",
  "Link",
  "SearchField",
]);

// Android interactive element types
const ANDROID_INTERACTIVE_TYPES = new Set([
  "EditText",
  "Button",
  "CheckBox",
  "RadioButton",
  "Spinner",
  "SeekBar",
  "Switch",
  "ToggleButton",
]);

// iOS wrapper element types (collapsed when unnamed)
const WRAPPER_TYPES = new Set([
  "Other",
  "Window",
  "Application",
  "Group",
  "Cell",
  "Table",
  "CollectionView",
]);

// Android wrapper element types (collapsed when unnamed)
const ANDROID_WRAPPER_TYPES = new Set([
  "FrameLayout",
  "LinearLayout",
  "RelativeLayout",
  "ConstraintLayout",
  "ViewGroup",
  "ScrollView",
]);

// Skip iOS root application element name (always first name= on XCUIElementTypeApplication)
const SKIP_TYPES = new Set(["Application"]);

/** Strip platform-specific element type prefixes */
function shortType(raw: string): string {
  return raw
    .replace(/^XCUIElementType/, "")
    .replace(/^android\.widget\./, "")
    .replace(/^android\.view\./, "");
}

/** Detect whether XML is Android (UiAutomator2) format */
function isAndroidXML(xml: string): boolean {
  return xml.slice(0, 200).includes("<hierarchy");
}

/** Parse XML attributes from a tag string like `name="foo" label="bar"` */
function parseAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(attrString)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

/** Recursive descent parser for Appium page source XML (iOS + Android) */
function parseXML(xml: string, pos: number, android: boolean): { nodes: TreeNode[]; endPos: number } {
  const nodes: TreeNode[] = [];

  while (pos < xml.length) {
    // Skip whitespace and text content
    const nextTag = xml.indexOf("<", pos);
    if (nextTag === -1) break;
    pos = nextTag;

    // Check for closing tag or comment/declaration
    if (xml[pos + 1] === "/") break; // closing tag — return to parent
    if (xml[pos + 1] === "?" || xml[pos + 1] === "!") {
      // XML declaration or comment — skip
      const end = xml.indexOf(">", pos);
      if (end === -1) break;
      pos = end + 1;
      continue;
    }

    // Find end of opening tag
    const tagEnd = xml.indexOf(">", pos);
    if (tagEnd === -1) break;

    const tagContent = xml.substring(pos + 1, tagEnd);
    const selfClosing = tagContent.endsWith("/");
    const cleanContent = selfClosing ? tagContent.slice(0, -1) : tagContent;

    // Extract tag name
    const spaceIdx = cleanContent.indexOf(" ");
    const tagName = spaceIdx === -1 ? cleanContent.trim() : cleanContent.substring(0, spaceIdx);
    const attrStr = spaceIdx === -1 ? "" : cleanContent.substring(spaceIdx + 1);
    const attrs = parseAttrs(attrStr);

    let node: TreeNode;

    if (android) {
      // Android: resource-id is the primary testID (React Native maps testID → resource-id),
      // content-desc is fallback (accessibilityLabel). text → label/value, hint → placeholder.
      const resourceId = attrs["resource-id"] || null;
      const contentDesc = attrs["content-desc"] || null;
      node = {
        type: shortType(tagName),
        name: resourceId || contentDesc,
        label: attrs["text"] || null,
        value: attrs["text"] || null,
        enabled: attrs["enabled"] !== "false",
        visible: attrs["displayed"] !== "false",
        placeholder: attrs["hint"] || null,
        children: [],
      };
    } else {
      // iOS: name, label, value, placeholderValue, visible
      node = {
        type: shortType(tagName),
        name: attrs["name"] || null,
        label: attrs["label"] || null,
        value: attrs["value"] || null,
        enabled: attrs["enabled"] !== "false",
        visible: attrs["visible"] !== "false",
        placeholder: attrs["placeholderValue"] || null,
        children: [],
      };
    }

    pos = tagEnd + 1;

    if (!selfClosing) {
      // Parse children recursively
      const result = parseXML(xml, pos, android);
      node.children = result.nodes;
      pos = result.endPos;

      // Skip the closing tag
      const closeEnd = xml.indexOf(">", pos);
      if (closeEnd !== -1) pos = closeEnd + 1;
    }

    nodes.push(node);
  }

  return { nodes, endPos: pos };
}

/** Render a tree node and its children to indented string lines */
function renderNode(node: TreeNode, indent: number, lines: string[]): void {
  const pad = "  ".repeat(indent);
  const sType = node.type;
  const isInteractive = INTERACTIVE_TYPES.has(sType) || ANDROID_INTERACTIVE_TYPES.has(sType);
  const isWrapper = WRAPPER_TYPES.has(sType) || ANDROID_WRAPPER_TYPES.has(sType);
  const isStaticText = sType === "StaticText" || sType === "TextView";
  const hasName = node.name && !SKIP_TYPES.has(sType);
  const isRootWrapper = sType === "AppiumAUT" || sType === "hierarchy";

  // Skip root wrapper elements entirely
  if (isRootWrapper) {
    for (const child of node.children) {
      renderNode(child, indent, lines);
    }
    return;
  }

  // StaticText — show value in quotes, no brackets
  if (isStaticText) {
    const text = node.value || node.label || "";
    if (text) {
      lines.push(`${pad}"${text}"`);
    }
    return;
  }

  // Named element — always show
  if (hasName) {
    let line = `${pad}[${node.name}]`;
    if (isInteractive) line += ` ${sType}`;
    if (node.label && node.label !== node.name) line += ` "${node.label}"`;
    if (node.placeholder) line += ` placeholder="${node.placeholder}"`;
    if (!node.enabled) line += " (disabled)";
    lines.push(line);
    for (const child of node.children) {
      renderNode(child, indent + 1, lines);
    }
    return;
  }

  // Interactive element without name — still show it
  if (isInteractive) {
    let line = `${pad}${sType}`;
    if (node.label) line += ` "${node.label}"`;
    if (node.placeholder) line += ` placeholder="${node.placeholder}"`;
    if (!node.enabled) line += " (disabled)";
    lines.push(line);
    for (const child of node.children) {
      renderNode(child, indent + 1, lines);
    }
    return;
  }

  // Unnamed wrapper — collapse: promote children to current level
  if (isWrapper || !hasName) {
    for (const child of node.children) {
      renderNode(child, indent, lines);
    }
    return;
  }

  // Fallback: show with type
  let line = `${pad}${sType}`;
  if (node.label) line += ` "${node.label}"`;
  lines.push(line);
  for (const child of node.children) {
    renderNode(child, indent + 1, lines);
  }
}

/** Parse Appium page source XML into a clean testID tree string (iOS + Android) */
export function parseTree(xml: string): string {
  if (!xml || !xml.trim()) return "";

  try {
    const android = isAndroidXML(xml);
    const { nodes } = parseXML(xml, 0, android);
    const lines: string[] = [];
    for (const node of nodes) {
      renderNode(node, 0, lines);
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}

/** Extract all testIDs (accessibility identifiers) from page source XML */
export function extractTestIDs(xml: string): string[] {
  if (!xml) return [];

  const android = isAndroidXML(xml);
  const ids: string[] = [];

  if (android) {
    // Android: extract both resource-id and content-desc (React Native uses both)
    for (const attr of ["resource-id", "content-desc"]) {
      const re = new RegExp(`\\b${attr}="([^"]+)"`, "g");
      let match: RegExpExecArray | null;
      while ((match = re.exec(xml)) !== null) {
        const name = match[1];
        ids.push(name);
      }
    }
  } else {
    // iOS: extract name attribute
    const re = /\bname="([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(xml)) !== null) {
      const name = match[1];
      if (!name.startsWith("XCUIElementType")) {
        ids.push(name);
      }
    }
  }

  // Deduplicate while preserving order
  return [...new Set(ids)];
}
