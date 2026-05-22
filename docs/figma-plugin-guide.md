# Figma Plugin — User Guide

Complete reference for the **FigExportForUnity** Figma plugin.

---

## Table of Contents

- [Installation](#installation)
- [Plugin Window Overview](#plugin-window-overview)
- [Export Tab](#export-tab)
  - [Selecting a Frame](#selecting-a-frame)
  - [Options Bar](#options-bar)
  - [Layer Tree](#layer-tree)
  - [Preview Panel](#preview-panel)
  - [Exporting](#exporting)
- [MCP Tab](#mcp-tab)
- [Minimize Mode](#minimize-mode)
- [Settings Import / Export](#settings-import--export)
- [Per-Element Controls Reference](#per-element-controls-reference)
- [Scale Options Reference](#scale-options-reference)
- [Context Menu Reference](#context-menu-reference)
- [Tips & Workflows](#tips--workflows)

---

## Installation

### 1. Build the plugin

```bash
cd FigExportForUnity
npm install
npm run build
```

### 2. Load into Figma Desktop

1. Open **Figma Desktop** (the plugin does not work in the browser version).
2. Go to **Menu → Plugins → Development → Import plugin from manifest...**
3. Select `FigExportForUnity/manifest.json`.
4. The plugin now appears under **Plugins → Development → Figma to Unity**.

> **Note:** Every time you rebuild (`npm run build` or `npm run watch`), Figma picks up the new `dist/` files automatically — no need to re-import.

---

## Plugin Window Overview

```
┌─────────────────────────────────────────────────┐
│ 🎨 ● Figma → Unity  v1.x   [S][M][L]  Frame  ▬ │  ← Header
├──────────────────┬──────────────────────────────┤
│  📦 Export  ☁️ MCP │                              │  ← Mode Tabs
├──────────────────┴──────────────────────────────┤
│ Scale: [2x ▾]  Disable Auto Merge □  🔃  🔒     │  ← Options Bar
│ Rename: [prefix...]  ✏️  ↩️                       │
├─────────────────────────┬───────────────────────┤
│ 🔍 Search elements...   │                       │
│                         │    Preview Panel      │
│   Layer Tree            │                       │
│   (with per-element     │  (click element to    │
│    controls)            │   see preview)        │
│                         │                       │
├─────────────────────────┴───────────────────────┤
│ [████████████░░░]  Exporting... 60%             │  ← Progress
├─────────────────────────────────────────────────┤
│  📥 Import          ▶ Export for Unity          │  ← Bottom Bar
└─────────────────────────────────────────────────┘
```

### Header elements

| Element | Description |
|:---|:---|
| **●** (colored dot) | MCP Bridge connection status — green = connected, red = disconnected, amber = reconnecting |
| **v1.x build N** | Plugin version, shown at bottom-right corner |
| **S / M / L** | Resize the plugin window — Small (480×600), Medium (600×750), Large (800×900) |
| **Frame** | Name of the currently selected frame |
| **▬** | Minimize the plugin to a compact status bar |

---

## Export Tab

### Selecting a Frame

The plugin requires a **Frame** (not a Group or Component) to be selected in Figma before it can display the layer tree.

1. Click any Frame on the canvas.
2. The plugin loads the layer tree and enables the options bar automatically.
3. If nothing is selected, the plugin shows **"Select a Frame to export"**.

> Selecting a different frame reloads the tree. Use **🔃 Reload** if the tree seems out of sync.

---

### Options Bar

Appears once a Frame is selected. Contains three rows.

#### Row 1 — Scale

Controls the export resolution of PNG assets.

| Value | Meaning |
|:---|:---|
| `0.5x` | Half resolution |
| `0.75x` | 75% resolution |
| `1x` | Native Figma pixel size |
| `1.5x` | 150% (good for low-DPI screens) |
| `2x` *(default)* | Double resolution — recommended for most mobile UI |
| `3x` | Triple resolution |
| `4x` | Quadruple resolution |
| `512w` | Fixed width: 512 px (height scales proportionally) |
| `512h` | Fixed height: 512 px (width scales proportionally) |
| `1024w` | Fixed width: 1024 px |
| `1024h` | Fixed height: 1024 px |

#### Row 2 — Tools

| Control | Description |
|:---|:---|
| **Disable Auto Merge** checkbox | By default, the plugin automatically merges shape groups into a single PNG. Check this to keep all children separate. |
| **🔃 Reload** | Re-scans the selected frame. Use when you modify the design after the plugin has already loaded the tree. |
| **🔒 / 🔓 Preview Lock** | When locked (🔒), clicking an element in the tree also moves the Figma canvas to that element. Unlock to browse the tree without the canvas jumping. |

#### Row 3 — Rename

Batch-rename layer names to `snake_case` for cleaner asset file names in Unity.

| Control | Description |
|:---|:---|
| **Prefix input** | Optional prefix prepended to every renamed element (e.g., `btn_` → `btn_close`, `btn_back`). |
| **✏️ Rename All** | Renames all visible elements in the tree to `snake_case`, with the prefix applied. Original names are saved so you can undo. |
| **↩️ Undo Rename** | Restores all original layer names. Only available after a rename. |

> Renamed layers update in Figma immediately. The rename is reflected in exported file names.

---

### Layer Tree

The main panel showing the design hierarchy of the selected frame.

#### Searching

Type in the **🔍 Search elements...** box to filter the tree. The search is case-insensitive and matches any part of the element name.

#### Tree View Modes

Click the **◀** button between the tree and preview panels to cycle through three layouts:

| Mode | Description |
|:---|:---|
| Normal (◀) | Tree and preview side by side |
| Expanded (◁) | Tree takes more horizontal space |
| Full (▷) | Tree fills the entire content area |

#### Per-Element Controls

Each row in the tree shows the element name and up to four control buttons on the right:

| Button | Label | Function |
|:---|:---|:---|
| **M** | Merge | Flatten this element and all its children into a single PNG. The entire subtree is rasterized as one image. |
| **P** | PNG | Rasterize this element as a PNG instead of the default behavior. Useful for text nodes you want as an image rather than TextMeshPro. |
| **×** | Exclude | Remove this element from the export entirely. Neither the element nor its children appear in the manifest or ZIP. |
| **👁** | Visibility | Toggle the element's visibility in the Figma canvas (live — no undo). |

> Buttons only appear when the action is applicable. For example, **P** (PNG) only shows on text nodes.

#### Visual Indicators

| Indicator | Meaning |
|:---|:---|
| Indentation | Hierarchy depth — child elements are indented under their parent |
| ~~Strikethrough~~ | Element is excluded (×) |
| Dimmed text | Element will be merged into its parent (M is set on an ancestor) |

#### Collapse / Expand

Click on a parent element's name to collapse or expand its children. Collapsed groups show a `▶` arrow; expanded groups show `▼`.

---

### Preview Panel

Located on the right side of the content area. Shows a live rasterized preview of the element you click in the tree.

| Feature | Description |
|:---|:---|
| **Click to preview** | Click any element in the tree to see its export preview |
| **Element info** | Below the preview: element name, type, and pixel dimensions |
| **🔒 Lock** | When Preview Lock is on, clicking an element also scrolls the Figma canvas to center on it |

---

### Exporting

1. Ensure a Frame is selected and the options are configured.
2. Click **▶ Export for Unity** in the bottom bar.
3. The progress bar shows overall export progress; the log area below shows per-asset status.
4. When complete, the browser's **Save File** dialog opens automatically.
5. The downloaded file is named after the root frame: `FrameName.zip`.

#### ZIP Contents

| File | Description |
|:---|:---|
| `manifest.json` | Full element tree with positions, sizes, constraints, text properties, and asset references |
| `settings.json` | Your current per-element configuration (merge/exclude/PNG flags and filter state) — used for re-import |
| `*.png` | PNG assets, named by element, deduplicated via FNV-1a hash |

---

## MCP Tab

Switch to this tab by clicking **☁️ MCP** in the mode tab bar.

The MCP (Model Context Protocol) Bridge lets AI tools — such as Cursor, Claude Desktop, or Antigravity — read your Figma design data in real time while the plugin is open.

### Connection Status

| Status | Color | Meaning |
|:---|:---|:---|
| Connected | 🟢 Green | AI tool is connected and can read design data |
| Disconnected | 🔴 Red | MCP Bridge server is not running, or plugin just opened |
| Reconnecting | 🟡 Amber (blinking) | Plugin is trying to re-establish the WebSocket connection |

The MCP panel shows:
- Current status label
- Server address: `ws://localhost:1994`
- Hint to select a Frame when no frame is selected

### Setting Up the MCP Bridge Server

The server must be running separately before the plugin can connect.

```bash
cd FigExportForUnity/server
npm install
npx tsc           # build once
node dist/index.js  # run manually, or configure in your AI tool
```

**Or configure as a persistent MCP server** in your AI tool:

```json
{
  "mcpServers": {
    "figma-bridge": {
      "command": "node",
      "args": ["/absolute/path/to/FigExportForUnity/server/dist/index.js"]
    }
  }
}
```

### What AI Tools Can Do

Once connected, AI tools can call these MCP tools:

| MCP Tool | Description |
|:---|:---|
| `get_document_tree` | Full design tree of the current Figma document |
| `get_selection` | Currently selected nodes |
| `get_styles` | Document color and text styles |
| `get_variables` | Figma variable collections and values |
| `get_screenshot` | Rasterized PNG export of a specific node by ID |
| `get_metadata` | Document name, page info, plugin version |

---

## Minimize Mode

Click **▬** in the top-right of the header to collapse the plugin to a compact 250×36 px status bar.

The minimized bar shows:
- **Colored dot** — current MCP connection status
- **Status label** — "MCP: Connected" / "MCP: Disconnected"
- **"click to expand"** hint

Click anywhere on the bar to restore the plugin to its previous size.

> Use minimize mode to keep the plugin active (maintaining the MCP WebSocket connection) without it taking up screen space while you design.

---

## Settings Import / Export

Plugin configurations (which elements are merged, excluded, or PNG-forced) can be saved and reloaded across sessions.

### Exporting Settings

Settings are saved automatically in `settings.json` inside every exported ZIP. No separate action needed.

### Importing Settings

1. Click **📥 Import** in the bottom bar.
2. Select a `settings.json` file (from a previous export ZIP).
3. The plugin matches elements by **name first**, then by **ID** as a fallback, and applies the saved merge/exclude/PNG flags.
4. Filter state (Images / Icons / Containers / Disable Auto Merge) is also restored if present.

> This is useful when you return to a design after changes — element IDs may have changed, but names typically stay the same.

---

## Per-Element Controls Reference

### Inline Buttons

| Button | Keyboard | Applied to | Effect on Export |
|:---|:---|:---|:---|
| **M** (Merge) | — | Any element with children | Element + all descendants → single PNG |
| **P** (PNG) | — | Text nodes | Node exported as PNG instead of TextMeshPro component |
| **×** (Exclude) | — | Any element | Element and all children omitted from manifest and ZIP |
| **👁** (Visibility) | — | Any element | Toggles Figma visibility; excluded from export if hidden |

### Right-Click Context Menu

Right-click any element in the tree to open the context menu:

| Item | Function |
|:---|:---|
| ✏️ **Rename** | Rename this single element inline |
| 👁 **Toggle Visibility** | Same as the 👁 button |
| 🔗 **Toggle Merge** | Same as the M button |
| 📦 **Export This Element** | Export only this element (and its subtree) as a standalone ZIP |

---

## Scale Options Reference

| Option | Type | Unity Use Case |
|:---|:---|:---|
| `0.5x` | Scale | Very low-res / placeholder assets |
| `1x` | Scale | 1:1 Figma pixel → Unity pixel (rare) |
| `2x` | Scale | Standard mobile (recommended default) |
| `3x` | Scale | High-DPI mobile or tablets |
| `4x` | Scale | Maximum quality; large file sizes |
| `512w` | Fixed width | Normalized sprite width; height proportional |
| `1024w` | Fixed width | Large normalized sprites |
| `512h` | Fixed height | Normalized sprite height; width proportional |
| `1024h` | Fixed height | Large normalized sprites (height-locked) |

---

## Tips & Workflows

### Typical Export Workflow

1. Finish your design in Figma.
2. Select the root Frame.
3. Run **Plugins → Figma to Unity**.
4. Review the layer tree — exclude decorative layers, merge icon groups.
5. Set scale to **2x** (default) for mobile.
6. Click **▶ Export for Unity**.
7. Unzip the downloaded file and open Unity Importer.

### Reducing ZIP Size

- Use **Merge** on icon groups — one PNG instead of many small ones.
- Use **Exclude** on hidden or placeholder layers.
- Use **1x** scale for UI that doesn't need high-DPI assets.
- The plugin automatically deduplicates identical PNGs via FNV-1a hash — duplicate shapes cost zero extra bytes.

### Working with Text

- By default, text nodes are exported as **TextMeshPro** data (font, size, color, alignment) — no PNG generated.
- If a text node contains stylized effects that Unity can't replicate, use **P (PNG)** to rasterize it as an image instead.

### Keeping Configurations Across Sessions

- After the first export, keep the `settings.json` from the ZIP.
- On the next session, use **📥 Import** to restore merge/exclude settings in one click.

### Using Rename Before Export

- Figma layer names often contain spaces and special characters that become awkward file names.
- Use **✏️ Rename All** with a prefix like `ui_` to get clean names: `ui_button_close.png`, `ui_header_bg.png`.
- Always rename *before* exporting — file names in the ZIP come from the layer names at export time.

### Auto Merge Behavior

By default, the plugin automatically merges groups of shapes that look like a single visual element (e.g., icon groups with multiple vector paths). If you need individual paths as separate assets, check **Disable Auto Merge** in the options bar.
