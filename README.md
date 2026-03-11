# Figma-To-Unity — Export & Import Tool + MCP Bridge

**🌐 [Tiếng Việt](README.vi.md)**

> Automated Figma-to-Unity UI converter. Includes 3 parts: **Figma Plugin** (export + MCP client), **MCP Bridge Server**, and **Unity Editor Importer**.

---

## ✨ Key Features

- ✅ **Direct Export from Figma** — Plugin runs inside Figma, select frame → export manifest + PNGs
- ✅ **Import into Unity** — Editor Window parses manifest, auto-creates UI hierarchy
- ✅ **Integrated MCP Bridge** — AI tools (Cursor, Antigravity, Claude) read Figma design via MCP protocol
- ✅ **Dual Mode UI** — Switch between Export mode and MCP mode in one plugin
- ✅ **Auto Layout → Layout Groups** — Figma auto-layout → Unity HorizontalLayoutGroup / VerticalLayoutGroup
- ✅ **TextMeshPro** — Text auto-maps font, size, color, alignment
- ✅ **Per-element Merge/Exclude/PNG** — Customize each element in the layer tree
- ✅ **Hash-based Deduplication** — Auto-removes duplicate PNGs (FNV-1a hash)
- ✅ **Sprite Atlas** — Auto-creates SpriteAtlas from imported sprites
- ✅ **Render Pipeline** — Supports both UGUI (Canvas + Image) and 2D Object (SpriteRenderer)
- ✅ **Flexible Export Scale** — Scale (0.5x → 4x) or Fixed Size (512w, 1024h, ...)
- ✅ **Minimize Mode** — Collapse plugin into a compact MCP status bar

---

## 🏗️ Architecture

```
figma-to-unity/
├── FigExport for Unity/          # Figma Plugin + MCP Server
│   ├── src/                      # Plugin source (TypeScript)
│   │   ├── main.ts               # Plugin entry point (Figma sandbox)
│   │   ├── ui.ts / ui.html       # Plugin UI (layer tree, settings, MCP client)
│   │   ├── traverser.ts          # DFS node traversal
│   │   ├── mapper.ts             # Figma constraints → Unity anchors
│   │   ├── exporter.ts           # PNG export + manifest + hash dedup
│   │   ├── naming.ts             # File naming rules
│   │   └── types.ts              # Type definitions
│   │
│   ├── server/                   # MCP Bridge Server (TypeScript)
│   │   └── src/
│   │       ├── index.ts          # Server entry point (stdio transport)
│   │       ├── leader.ts         # HTTP server + WebSocket bridge
│   │       ├── follower.ts       # Proxy to leader via HTTP
│   │       ├── election.ts       # Leader/follower election
│   │       ├── bridge.ts         # WebSocket bridge to Figma plugin
│   │       ├── tools.ts          # MCP tool implementations
│   │       ├── schema.ts         # Zod input validation
│   │       └── types.ts          # Shared types
│   │
│   ├── dist/                     # Build output (plugin)
│   └── manifest.json             # Figma plugin manifest
│
└── UnityFigImporter/             # Unity Editor Package (C#)
    └── Editor/
        ├── FigmaImporterWindow.cs    # Main EditorWindow (UI + build flow)
        ├── ManifestParser.cs         # JSON → C# objects
        ├── TextureImportHelper.cs    # PNG → Sprite import + settings
        ├── HierarchyBuilder.cs       # Build UI hierarchy (UGUI / Object2D)
        ├── SpriteAtlasHelper.cs      # Auto SpriteAtlas creation
        └── Data/
            └── ManifestData.cs       # Data model classes
```

---

## 📦 Installation

### Requirements

| Component | Version |
|:---|:---|
| **Figma Desktop** | Latest |
| **Unity** | 2022.3+ LTS |
| **TextMeshPro** | Installed via Package Manager |
| **Newtonsoft JSON** | Installed via Package Manager |
| **Node.js** | >= 20 (to build plugin + server) |
| **Bun** (optional) | >= 1.0 (faster server builds) |

### Step 1: Build Figma Plugin

```bash
cd "FigExport for Unity"
npm install
npm run build
```

In Figma Desktop:
1. **Plugins** → **Development** → **Import plugin from manifest...**
2. Select `FigExport for Unity/manifest.json`
3. Plugin will appear in the Plugins menu

### Step 2: Build MCP Bridge Server

```bash
cd "FigExport for Unity/server"
bun install    # or npm install
bun run build  # or npx tsc
```

### Step 3: Configure MCP for your AI Tool

Add to your tool's MCP config file (e.g. `mcp_config.json`):

```json
{
  "mcpServers": {
    "figma-bridge": {
      "command": "node",
      "args": ["<path-to-repo>/FigExport for Unity/server/dist/index.js"]
    }
  }
}
```

> **Note:** Replace `<path-to-repo>` with the absolute path to this repo on your machine.

### Step 4: Install Unity Importer

**Option 1 — Copy folder:**
```
Copy the "UnityFigImporter" folder into Assets/ in your Unity project
```

**Option 2 — Unity Package Manager (Local):**
1. Open **Window** → **Package Manager**
2. **"+"** → **Add package from disk...**
3. Select `UnityFigImporter/package.json`

**Option 3 — Git URL:**
```
https://github.com/zasuozz-oss/figma-to-unity.git?path=UnityFigImporter
```

---

## 🚀 Usage

### Export from Figma

1. Open your design in Figma Desktop
2. **Select the Frame** to export
3. Run the plugin: **Plugins** → **Figma to Unity**
4. In the plugin UI:
   - Switch to **Export** tab to export design
   - Switch to **MCP** tab to view MCP Bridge status
   - Customize **Merge / PNG / Exclude** per element
   - Choose **Export Scale**: 0.5x, 0.75x, 1x, 1.5x, 2x (default), 3x, 4x or Fixed Size (512w, 1024h)
   - Click **▬** to minimize plugin (shows MCP status bar)
5. Click **"Export"** → Downloads ZIP containing manifest + PNG assets

### Import into Unity

1. Unzip the ZIP file into any folder
2. Open **Window** → **Figma Importer**
3. Select the folder containing `manifest.json` (drag & drop or browse)
4. Configure build options:
   - **Output Mode**: Scene / Prefab / Both
   - **Render Pipeline**: UGUI or Object2D
   - **Canvas Scale**: Auto / 1x / 1.5x / 2x / 3x / 4x / Custom
   - **Texture Settings**: Max size, compression, filter mode
   - **Sprite Atlas**: Auto-create atlas from sprites (optional)
5. Click **"Build UI"** → Unity auto-creates the UI hierarchy

### MCP Bridge (for AI Tools)

When the Figma plugin is open, MCP Bridge auto-connects via WebSocket (`ws://localhost:1994/ws`). AI tools can:
- Read document tree, selection, styles
- Export screenshots by node ID
- Get design context, variables, metadata

---

## 🔧 Per-Element Features

| Button | Function |
|:---|:---|
| **Merge** | Flatten parent + children into a single PNG |
| **PNG** (text) | Rasterize TEXT as PNG instead of TextMeshPro |
| **×** (exclude) | Skip element, don't export |
| **👁** (visibility) | Show/hide element in Figma |

---

## 📐 Constraint → Anchor Mapping

| Figma Constraint | Unity Anchor |
|:---|:---|
| `LEFT` | anchorMin.x = 0, anchorMax.x = 0 |
| `RIGHT` | anchorMin.x = 1, anchorMax.x = 1 |
| `CENTER` | anchorMin.x = 0.5, anchorMax.x = 0.5 |
| `LEFT_RIGHT` (scale) | anchorMin.x = 0, anchorMax.x = 1 |
| `TOP` | anchorMin.y = 1, anchorMax.y = 1 |
| `BOTTOM` | anchorMin.y = 0, anchorMax.y = 0 |
| `TOP_BOTTOM` (scale) | anchorMin.y = 0, anchorMax.y = 1 |

---

## 🔒 Security

- Server only binds to `localhost:1994` — not exposed to the network
- File writes have path traversal protection + exclusive write flag
- Input validation (Zod) for all MCP tool calls
- No `eval()`, `exec()`, or hardcoded secrets

---

## 📝 Development

### Build Figma Plugin
```bash
cd "FigExport for Unity"
npm run build        # Build once
npm run watch        # Watch mode (auto-rebuild)
```

### Build MCP Server
```bash
cd "FigExport for Unity/server"
bun run build        # TypeScript → JavaScript
```

---

## 🙏 Credits

- MCP Bridge Server based on [figma-mcp-bridge](https://github.com/gethopp/figma-mcp-bridge) by **gethopp**

---

## 📝 License

MIT License
