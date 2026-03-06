/**
 * Parses Appium XCUITest page source XML into a clean, collapsed testID tree.
 *
 * Collapsing rules:
 * - Unnamed wrapper elements (Other, Window, Application) are skipped; children promoted
 * - Interactive elements (Button, TextField, Switch, etc.) always show their type
 * - StaticText shows value in quotes
 * - Disabled elements get (disabled) suffix
 * - TextFields show placeholder text
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

const WRAPPER_TYPES = new Set([
  "Other",
  "Window",
  "Application",
  "Group",
  "Cell",
  "Table",
  "CollectionView",
]);

const SKIP_NAMES = new Set(["CareCoordinate"]);

/** Strip "XCUIElementType" prefix */
function shortType(raw: string): string {
  return raw.replace(/^XCUIElementType/, "");
}

/** Parse XML attributes from a tag string like `name="foo" label="bar"` */
function parseAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(attrString)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

/** Recursive descent parser for XCUITest XML */
function parseXML(xml: string, pos: number): { nodes: TreeNode[]; endPos: number } {
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

    const node: TreeNode = {
      type: shortType(tagName),
      name: attrs["name"] || null,
      label: attrs["label"] || null,
      value: attrs["value"] || null,
      enabled: attrs["enabled"] !== "false",
      visible: attrs["visible"] !== "false",
      placeholder: attrs["placeholderValue"] || null,
      children: [],
    };

    pos = tagEnd + 1;

    if (!selfClosing) {
      // Parse children recursively
      const result = parseXML(xml, pos);
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
  const isInteractive = INTERACTIVE_TYPES.has(sType);
  const isWrapper = WRAPPER_TYPES.has(sType);
  const isStaticText = sType === "StaticText";
  const hasName = node.name && !SKIP_NAMES.has(node.name);
  const isAppiumAUT = sType === "AppiumAUT";

  // Skip AppiumAUT wrapper entirely
  if (isAppiumAUT) {
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

/** Parse Appium XCUITest page source XML into a clean testID tree string */
export function parseTree(xml: string): string {
  if (!xml || !xml.trim()) return "";

  try {
    const { nodes } = parseXML(xml, 0);
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

  const ids: string[] = [];
  const re = /\bname="([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const name = match[1];
    if (!SKIP_NAMES.has(name) && !name.startsWith("XCUIElementType")) {
      ids.push(name);
    }
  }

  // Deduplicate while preserving order
  return [...new Set(ids)];
}
