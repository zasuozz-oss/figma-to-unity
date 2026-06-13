<p align="center">
  <h1 align="center">Figma → Unity</h1>
  <p align="center">
    Automated Figma-to-Unity UI converter with AI-powered MCP Bridge
    <br />
    <strong>🌐 <a href="README.vi.md">Tiếng Việt</a> · <a href="README.zh.md">中文</a></strong>
    <br />
    <br />
    <a href="#-quick-start">Quick Start</a>
    ·
    <a href="#-features">Features</a>
    ·
    <a href="https://github.com/zasuozz-oss/figma-to-unity/issues">Report Bug</a>
    ·
    <a href="https://github.com/zasuozz-oss/figma-to-unity/issues">Request Feature</a>
  </p>
</p>

<p align="center">
  <a href="https://github.com/zasuozz-oss/figma-to-unity/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License" /></a>
  <a href="https://unity.com/"><img src="https://img.shields.io/badge/Unity-2022.3%2B-black?logo=unity" alt="Unity" /></a>
  <a href="https://www.figma.com/"><img src="https://img.shields.io/badge/Figma-Plugin-F24E1E?logo=figma&logoColor=white" alt="Figma" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%3E%3D20-339933?logo=node.js&logoColor=white" alt="Node.js" /></a>
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP-Compatible-8B5CF6" alt="MCP" /></a>
</p>

> **📖 Figma Plugin full reference → [`docs/figma-plugin-guide.md`](docs/figma-plugin-guide.md)**

---

## 📖 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Architecture](#-architecture)
- [Requirements](#-requirements)
- [Quick Start](#-quick-start)
- [Usage](#-usage)
- [Per-Element Controls](#-per-element-controls)
- [Anchor Mapping](#-constraint--anchor-mapping)
- [Security](#-security)
- [Development](#-development)
- [Credits](#-credits)
- [License](#-license)

---

## 🔍 Overview

**Figma → Unity** is an end-to-end pipeline that converts Figma designs into Unity UI with minimal manual work. It consists of three components:

| Component | Description |
|:---|:---|
| **Figma Plugin** | Runs inside Figma Desktop. Traverses the design tree, exports manifest JSON + PNG assets as a ZIP file. |
| **MCP Bridge Server** | Stdio-based [Model Context Protocol](https://modelcontextprotocol.io/) server. Allows AI tools (Cursor, Claude, Antigravity) to read Figma design data in real-time via WebSocket. |
| **Unity Importer** | Editor Window that parses the manifest, imports textures, and builds the complete UI hierarchy automatically. |

---

## ✨ Features

| Category | Feature |
|:---|:---|
| **Export** | One-click export from Figma → ZIP (manifest.json + PNGs) |
| **Import** | Auto-creates full UI hierarchy in Unity from manifest |
| **AI Integration** | MCP Bridge lets AI tools read Figma design data in real-time |
| **Layout** | Figma Auto Layout → Unity HorizontalLayoutGroup / VerticalLayoutGroup |
| **Text** | TextMeshPro with auto font family, style, size, color, and alignment mapping |
| **Font Mapping** | Auto-detects Figma font families & styles and maps them to TextMeshPro Font Assets |
| **Deduplication** | FNV-1a hash-based PNG deduplication — skips identical assets to minimize ZIP size |
| **Sprite Atlas** | Auto-creates SpriteAtlas from imported sprites with advanced padding & rotation settings |
| **Render Pipeline** | UGUI (Canvas + Image) and 2D Object (SpriteRenderer) modes |
| **Scale Options** | 0.5x, 0.75x, 1x, 1.5x, 2x, 3x, 4x or fixed width/height (512w, 1024h, ...) |
| **Per-Element** | Inline Merge, Exclude, and PNG rasterize controls for ultimate asset control |
| **Batch Rename** | Batch-rename layers to `snake_case` with optional custom prefix and undo function |
| **Context Menu** | Right-click layers to inline Rename, Toggle Visibility, Toggle Merge, or Export Subtree |
| **Settings Sync** | Import and export configurations via `settings.json` to restore settings across runs |
| **Window Resize** | Responsive plugin UI with S, M, L window size presets |
| **Minimize Mode** | Collapse plugin into a compact MCP status bar |
| **Canvas Options** | Canvas Scale presets, Create New or Use Existing canvas, Match Width/Height settings |
| **Texture Importer** | Advanced texture settings (Compression, filter mode, max size auto-detect, custom output folder) |

---

## 🏗️ Architecture

```
figma-to-unity/
├── FigExportForUnity/                # Figma Plugin + MCP Server
│   ├── src/                          # Plugin source (TypeScript)
│   │   ├── main.ts                   # Plugin entry (Figma sandbox)
│   │   ├── ui.ts / ui.html           # Plugin UI (layer tree, settings)
│   │   ├── traverser.ts              # DFS node traversal
│   │   ├── mapper.ts                 # Constraints → Unity anchors
│   │   ├── exporter.ts               # PNG export + manifest + hash dedup
│   │   ├── naming.ts                 # File naming rules
│   │   └── types.ts                  # Type definitions
│   │
│   ├── server/                       # MCP Bridge Server
│   │   └── src/
│   │       ├── index.ts              # Stdio transport entry
│   │       ├── leader.ts             # HTTP + WebSocket bridge
│   │       ├── follower.ts           # Proxy to leader
│   │       ├── election.ts           # Leader/follower election
│   │       ├── bridge.ts             # WebSocket ↔ Figma plugin
│   │       ├── tools.ts              # MCP tool definitions
│   │       ├── schema.ts             # Zod validation
│   │       └── types.ts              # Shared types
│   │
│   ├── dist/                         # Build output
│   └── manifest.json                 # Figma plugin manifest
│
└── UnityFigImporter/                 # Unity Editor Package (C#)
    └── Editor/
        ├── FigmaImporterWindow.cs    # Main EditorWindow
        ├── ManifestParser.cs         # JSON → C# data
        ├── TextureImportHelper.cs    # PNG → Sprite import
        ├── HierarchyBuilder.cs       # UI hierarchy builder
        ├── SpriteAtlasHelper.cs      # Auto SpriteAtlas
        └── Data/
            └── ManifestData.cs       # Data models
```

---

## 📋 Requirements

### Figma Plugin & MCP Server

| Dependency | Version | Notes |
|:---|:---|:---|
| **Node.js** | `>= 20.0.0` | Required for build and MCP server |
| **npm** | `>= 9` | Comes with Node.js |
| **Bun** *(optional)* | `>= 1.0` | Faster alternative for server builds |
| **Figma Desktop** | Latest | Plugin does not work in Figma web |

### Unity Importer

| Dependency | Version | Notes |
|:---|:---|:---|
| **Unity** | `2022.3+` LTS | Tested on 2022.3 and 6000.x |
| **TextMeshPro** | `3.0.6+` | `com.unity.textmeshpro` via Package Manager |
| **Newtonsoft JSON** | `3.2.1+` | `com.unity.nuget.newtonsoft-json` via Package Manager |
| **SpriteAtlas** *(optional)* | Built-in | For auto atlas generation |

### MCP Client (AI Tool)

Any AI tool supporting [Model Context Protocol](https://modelcontextprotocol.io/) stdio transport:
- **Cursor** — via `.cursor/mcp.json`
- **Claude Desktop** — via `claude_desktop_config.json`
- **Antigravity** — via `mcp_config.json`

---

## 🚀 Quick Start

### 1. Build & start everything (one command)

Works on **macOS, Linux, and Windows (git-bash)**:

```bash
./setup.sh
```

This installs dependencies, builds the Figma plugin **and** the MCP bridge server, prints the install guide, then starts the bridge server on `ws://localhost:1994`.

Manage the server anytime:

```bash
./setup.sh start      # start the bridge server (background)
./setup.sh stop       # stop it
./setup.sh restart    # restart it
./setup.sh status     # check if it is running
./setup.sh logs       # follow the server log
./setup.sh build      # rebuild plugin + server only (no start)
```

<details>
<summary>Manual build (without setup.sh)</summary>

```bash
# Figma plugin
cd FigExportForUnity && npm install && npm run build

# MCP bridge server
cd FigExportForUnity/server && npm install && npx tsc   # or: bun run build
```
</details>

Then load the plugin in Figma Desktop:
1. **Plugins** → **Development** → **Import plugin from manifest...**
2. Select `FigExportForUnity/manifest.json`

### 2. Configure MCP Client

Add to your AI tool's MCP config:

```json
{
  "mcpServers": {
    "figma-bridge": {
      "command": "node",
      "args": ["<absolute-path>/FigExportForUnity/server/dist/index.js"]
    }
  }
}
```

> Replace `<absolute-path>` with the full path to this repo on your machine.
>
> **Claude Code:** register the server once from the repo root, then confirm with `claude mcp list`:
> ```bash
> claude mcp add figma-bridge --scope project -- node <absolute-path>/FigExportForUnity/server/dist/index.js
> ```

### 3. Install Unity Importer

**Option A — Git URL (recommended):**
```
https://github.com/zasuozz-oss/figma-to-unity.git?path=UnityFigImporter
```

**Option B — Local Package:**
1. **Window** → **Package Manager** → **"+"** → **Add package from disk...**
2. Select `UnityFigImporter/package.json`

**Option C — Manual:**
Copy `UnityFigImporter/` into your Unity project's `Assets/` folder.

---

## 📖 Usage

### Export from Figma

1. Select the **Frame** you want to export
2. Run **Plugins** → **Figma to Unity**
3. *(Optional)* Batch-rename layers with the **Rename** tool and a prefix
4. Configure per-element settings (Merge / PNG / Exclude) in the layer tree
5. Choose **Export Scale** (0.5x – 4x or fixed size)
6. Click **▶ Export for Unity** → Downloads a ZIP file

### Import into Unity

1. Unzip the exported file
2. Open **Window** → **Figma Importer**
3. Select the folder containing `manifest.json`
4. Configure the advanced import options in the window:

| Setting Category | Option | Description | Values / Range | Default |
|:---|:---|:---|:---|:---|
| **Output Settings** | **Render Pipeline** | Choose between Canvas-based UI or World space 2D sprites | UGUI / Object2D | UGUI |
| | **Output Mode** | Build hierarchy in current active Scene, save as Prefab, or both | Scene / Prefab / Both | Scene |
| **Canvas Settings** | **Canvas Target** | Target a new Canvas or attach elements to an existing scene Canvas | Create New / Use Existing | Create New |
| | **Canvas Scale** | Scale factor for the Canvas UI elements relative to Figma design | Auto / 1x / 1.5x / 2x / 3x / 4x / Custom | Auto |
| **Sprite Output** | **Output Folder** | Absolute/relative path in Assets where imported sprites are stored | Browse and pick any asset folder | `Assets/Sprites/` (auto-detected) |
| **Font Mapping** | **Font Mapping** | Map each unique Figma Font (Family + Style) to a project TMP_FontAsset | Interactive object fields | Auto-matched by name |
| **Build Options** | **Disable Raycast** | Turn off Raycast Target on all generated non-interactive UI elements | On / Off | Off (Enabled) |
| | **Scale to Unity** | Automatically scale UI elements to target Unity reference resolution | On / Off | On |
| **Texture Import** | **Auto-detect Size**| Set texture Max Size automatically based on PNG dimensions | On / Off | On |
| | **Filter & Comp** | Configure imported sprite filter mode and texture compression format | Bilinear/Trilinear/Point & Compressed/HQ/etc | Bilinear & Compressed |
| **Sprite Atlas** | **Create Atlas** | Package all imported UI sprites into a single Unity SpriteAtlas | On / Off | Off |
| | **Atlas Padding** | Visual padding (spacing) between sprite textures inside the atlas | 0 to 8 pixels | 2 px |

5. Click **Build UI**

### MCP Bridge (AI Tools)

When the Figma plugin is open, the MCP Bridge connects via `ws://localhost:1994/ws`. AI tools can call these MCP tools:

| Tool | Description |
|:---|:---|
| `get_document` | Full document tree of the current Figma page |
| `get_selection` | Currently selected nodes |
| `get_node` | Fetch a specific node by ID |
| `get_styles` | All local color and text styles |
| `get_metadata` | Document name, page list, current page info |
| `get_design_context` | Summarized tree of the current selection (optimized for AI) |
| `get_variable_defs` | All variable collections, modes, and values (design tokens) |
| `get_screenshot` | Rasterized PNG export of node(s) — returns base64 |
| `save_screenshots` | Export multiple nodes and write PNGs directly to the filesystem |
| `export_element` | Export one frame/component through the full Unity pipeline — writes `manifest.json` + PNG assets to disk |

### Agent Workflow — Headless Import via utk

AI agents (Claude Code, Cursor, ...) can run the whole pipeline end-to-end — no ZIP download, no Editor window — by combining the MCP Bridge with [utk (Unity CLI AgentKit)](https://github.com/zasuozz-oss/unity-cli-agentkit), a single-binary CLI that controls the Unity Editor from the terminal:

1. **Export** — call the `export_element` MCP tool with a `figmaUrl` (or `nodeId`). It writes `manifest.json` + PNG assets to `~/Desktop/FigmaImports/<element-name>` (or `$FIGMA_EXPORT_ROOT`), outside the Unity project — the importer copies what it needs into `Assets/` itself.
2. **Import** — run the headless importer inside the open Unity Editor via utk:

   ```bash
   utk exec 'return FigmaImporter.FigmaHeadlessImporter.Import("<export-folder>", "Both");'
   ```

   `Import(exportFolder, outputMode, prefabSavePath, spriteFolder)` — `outputMode` is `Scene`, `Prefab`, or `Both`; prefabs default to `Assets/Prefabs/UI/`. Returns JSON: `{ success, rootName, textureCount, outputMode, log[] }`.

Requirements: Figma Desktop with the plugin open (step 1), and a running Unity Editor connected to utk — install utk, run `utk init` in the Unity project, then verify with `utk status` (step 2).

---

## 🔧 Per-Element Controls

### Inline buttons (per row in the layer tree)

| Button | Function |
|:---|:---|
| **M** — Merge | Flatten this element and all its children into a single PNG |
| **P** — PNG | Rasterize a text node as PNG instead of generating a TextMeshPro component |
| **×** — Exclude | Remove the element (and its subtree) from the export entirely |
| **👁** — Visibility | Toggle the element's visibility in the Figma canvas |

### Right-click context menu

| Item | Function |
|:---|:---|
| ✏️ **Rename** | Rename this single element inline |
| 👁 **Toggle Visibility** | Same as the inline 👁 button |
| 🔗 **Toggle Merge** | Same as the inline M button |
| 📦 **Export This Element** | Export only this element's subtree as a standalone ZIP |

---

## 📐 Constraint → Anchor Mapping

| Figma Constraint | Unity Anchor |
|:---|:---|
| `LEFT` | `anchorMin.x = 0, anchorMax.x = 0` |
| `RIGHT` | `anchorMin.x = 1, anchorMax.x = 1` |
| `CENTER` | `anchorMin.x = 0.5, anchorMax.x = 0.5` |
| `LEFT_RIGHT` | `anchorMin.x = 0, anchorMax.x = 1` |
| `TOP` | `anchorMin.y = 1, anchorMax.y = 1` |
| `BOTTOM` | `anchorMin.y = 0, anchorMax.y = 0` |
| `TOP_BOTTOM` | `anchorMin.y = 0, anchorMax.y = 1` |

---

## 🔒 Security

- Server binds to `localhost:1994` only — not exposed to the network
- Path traversal protection + exclusive write flag on file operations
- Input validation via [Zod](https://zod.dev/) for all MCP tool calls
- No `eval()`, `exec()`, or hardcoded secrets

---

## 📝 Development

```bash
# Build everything + start the bridge server (macOS / Linux / git-bash)
./setup.sh

# Figma Plugin — watch mode (auto-rebuild on save)
cd FigExportForUnity
npm run watch

# Rebuild plugin + server without starting (any platform)
./setup.sh build
```

---

## 🙏 Credits

- MCP Bridge Server based on [figma-mcp-bridge](https://github.com/gethopp/figma-mcp-bridge) by **gethopp**

---

## 📝 License

This project is licensed under the [MIT License](LICENSE).
