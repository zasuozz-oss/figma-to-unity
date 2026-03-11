<p align="center">
  <h1 align="center">Figma → Unity</h1>
  <p align="center">
    Automated Figma-to-Unity UI converter with AI-powered MCP Bridge
    <br />
    <strong>🌐 <a href="README.vi.md">Vietnamese</a></strong>
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
| **Text** | TextMeshPro with auto font, size, color, alignment mapping |
| **Deduplication** | FNV-1a hash-based PNG deduplication — skips identical assets |
| **Sprite Atlas** | Auto-creates SpriteAtlas from imported sprites |
| **Render Pipeline** | UGUI (Canvas + Image) and 2D Object (SpriteRenderer) |
| **Scale Options** | 0.5x, 0.75x, 1x, 1.5x, 2x, 3x, 4x or fixed size (512w, 1024h, ...) |
| **Per-Element** | Merge, Exclude, PNG rasterize controls per node |
| **Minimize Mode** | Collapse plugin into a compact MCP status bar |

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

### 1. Build Figma Plugin

```bash
cd FigExportForUnity
npm install
npm run build
```

Then in Figma Desktop:
1. **Plugins** → **Development** → **Import plugin from manifest...**
2. Select `FigExportForUnity/manifest.json`

### 2. Build MCP Bridge Server

```bash
cd FigExportForUnity/server
npm install       # or: bun install
npx tsc           # or: bun run build
```

### 3. Configure MCP Client

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

### 4. Install Unity Importer

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
3. Configure per-element settings (Merge / PNG / Exclude)
4. Choose **Export Scale** (0.5x – 4x or fixed size)
5. Click **Export** → Downloads a ZIP file

### Import into Unity

1. Unzip the exported file
2. Open **Window** → **Figma Importer**
3. Select the folder containing `manifest.json`
4. Configure:

| Option | Values | Default |
|:---|:---|:---|
| **Output Mode** | Scene / Prefab / Both | Scene |
| **Render Pipeline** | UGUI / Object2D | UGUI |
| **Canvas Scale** | Auto / 1x / 1.5x / 2x / 3x / 4x / Custom | Auto |
| **Sprite Atlas** | On / Off | Off |

5. Click **Build UI**

### MCP Bridge (AI Tools)

When the Figma plugin is open, MCP Bridge connects via `ws://localhost:1994/ws`. AI tools can:
- Read document tree, selection, styles, variables
- Export screenshots by node ID
- Get design context and metadata

---

## 🔧 Per-Element Controls

| Button | Function |
|:---|:---|
| **Merge** | Flatten parent + children into a single PNG |
| **PNG** | Rasterize text node as PNG instead of TextMeshPro |
| **×** | Exclude element from export |
| **👁** | Toggle visibility in Figma |

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
# Figma Plugin — build once
cd FigExportForUnity
npm run build

# Figma Plugin — watch mode (auto-rebuild on save)
npm run watch

# MCP Server — build
cd FigExportForUnity/server
npx tsc
```

---

## 🙏 Credits

- MCP Bridge Server based on [figma-mcp-bridge](https://github.com/gethopp/figma-mcp-bridge) by **gethopp**

---

## 📝 License

This project is licensed under the [MIT License](LICENSE).
