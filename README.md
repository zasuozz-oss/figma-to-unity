# Figma-To-Unity — Export & Import Tool + MCP Bridge

> Công cụ chuyển đổi thiết kế Figma sang Unity UI tự động. Gồm 3 phần: **Figma Plugin** (export + MCP client), **MCP Bridge Server**, và **Unity Editor Importer**.

---

## ✨ Tính Năng Chính

- ✅ **Export trực tiếp từ Figma** — Plugin chạy trong Figma, chọn frame → export manifest + PNG
- ✅ **Import vào Unity** — Editor Window parse manifest, tạo UI hierarchy tự động
- ✅ **MCP Bridge tích hợp** — AI tools (Cursor, Antigravity, Claude) đọc Figma design qua MCP protocol
- ✅ **Dual Mode UI** — Chuyển giữa Export mode và MCP mode trong cùng 1 plugin
- ✅ **Auto Layout → Layout Groups** — Figma auto-layout → Unity HorizontalLayoutGroup / VerticalLayoutGroup
- ✅ **TextMeshPro** — Text tự động map font, size, color, alignment
- ✅ **Per-element Merge/Exclude/PNG** — Tuỳ chỉnh từng element trong layer tree
- ✅ **Hash-based Deduplication** — Tự động loại bỏ PNG trùng lặp (FNV-1a hash)
- ✅ **Sprite Atlas** — Tự động tạo SpriteAtlas gom các sprite đã import
- ✅ **Render Pipeline** — Hỗ trợ cả UGUI (Canvas + Image) và 2D Object (SpriteRenderer)
- ✅ **Flexible Export Scale** — Scale (0.5x → 4x) hoặc Fixed Size (512w, 1024h, ...)
- ✅ **Minimize Mode** — Thu nhỏ plugin thành thanh trạng thái MCP nhỏ gọn

---

## 🏗️ Kiến Trúc

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
└── UnityFigImporter/            # Unity Editor Package (C#)
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

## 📦 Cài Đặt

### Yêu cầu

| Component | Phiên bản |
|:---|:---|
| **Figma Desktop** | Latest |
| **Unity** | 2022.3+ LTS |
| **TextMeshPro** | Installed via Package Manager |
| **Newtonsoft JSON** | Installed via Package Manager |
| **Node.js** | >= 20 (để build plugin + server) |
| **Bun** (optional) | >= 1.0 (để build server nhanh hơn) |

### Bước 1: Build Figma Plugin

```bash
cd "FigExport for Unity"
npm install
npm run build
```

Trong Figma Desktop:
1. **Plugins** → **Development** → **Import plugin from manifest...**
2. Chọn file `FigExport for Unity/manifest.json`
3. Plugin sẽ xuất hiện trong menu Plugins

### Bước 2: Build MCP Bridge Server

```bash
cd "FigExport for Unity/server"
bun install    # hoặc npm install
bun run build  # hoặc npx tsc
```

### Bước 3: Cấu hình MCP cho AI Tool

Thêm vào file cấu hình MCP của tool bạn dùng (ví dụ `mcp_config.json`):

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

> **Lưu ý:** Thay `<path-to-repo>` bằng đường dẫn tuyệt đối tới thư mục repo trên máy bạn.

### Bước 4: Cài đặt Unity Importer

**Cách 1 — Copy thư mục:**
```
Copy thư mục "UnityFigImporter" vào Assets/ trong Unity project
```

**Cách 2 — Unity Package Manager (Local):**
1. Mở **Window** → **Package Manager**
2. **"+"** → **Add package from disk...**
3. Chọn file `UnityFigImporter/package.json`

**Cách 3 — Git URL:**
```
https://github.com/<user>/figma-to-unity.git?path=UnityFigImporter
```

---

## 🚀 Hướng Dẫn Sử Dụng

### Export từ Figma

1. Mở design trong Figma Desktop
2. **Chọn Frame** cần export
3. Chạy plugin: **Plugins** → **Figma to Unity**
4. Trong plugin UI:
   - Chuyển tab **Export** để xuất design
   - Chuyển tab **MCP** để xem trạng thái MCP Bridge
   - Tuỳ chỉnh **Merge / PNG / Exclude** trên từng element
   - Chọn **Export Scale**: 0.5x, 0.75x, 1x, 1.5x, 2x (mặc định), 3x, 4x hoặc Fixed Size (512w, 1024h)
   - Click **▬** để thu nhỏ plugin (hiện thanh trạng thái MCP)
5. Click **"Export"** → Download ZIP chứa manifest + PNG assets

### Import vào Unity

1. Giải nén ZIP vào thư mục bất kỳ
2. Mở **Window** → **Figma Importer**
3. Chọn thư mục chứa `manifest.json` (drag & drop hoặc browse)
4. Cấu hình build options:
   - **Output Mode**: Scene / Prefab / Both
   - **Render Pipeline**: UGUI hoặc Object2D
   - **Canvas Scale**: Auto / 1x / 1.5x / 2x / 3x / 4x / Custom
   - **Texture Settings**: Max size, compression, filter mode
   - **Sprite Atlas**: Tự động tạo atlas gom sprites (tuỳ chọn)
5. Click **"Build UI"** → Unity tự động tạo UI hierarchy

### MCP Bridge (cho AI Tools)

Khi plugin Figma đang mở, MCP Bridge tự động kết nối qua WebSocket (`ws://localhost:1994/ws`). AI tools có thể:
- Đọc document tree, selection, styles
- Export screenshots theo node ID
- Lấy design context, variables, metadata

---

## 🔧 Tính Năng Per-Element

| Nút | Chức năng |
|:---|:---|
| **Merge** | Flatten parent + children thành 1 PNG duy nhất |
| **PNG** (text) | Rasterize TEXT thành PNG thay vì TextMeshPro |
| **×** (exclude) | Bỏ qua element, không export |
| **👁** (visibility) | Ẩn/hiện element trong Figma |

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

## 🔒 Bảo Mật

- Server chỉ bind `localhost:1994` — không expose ra mạng
- File write có path traversal protection + exclusive write flag
- Input validation (Zod) cho tất cả MCP tool calls
- Không có `eval()`, `exec()`, hoặc hardcoded secrets

---

## 📝 Development

### Build Figma Plugin
```bash
cd "FigExport for Unity"
npm run build        # Build một lần
npm run watch        # Watch mode (auto-rebuild)
```

### Build MCP Server
```bash
cd "FigExport for Unity/server"
bun run build        # TypeScript → JavaScript
```

---

## 🙏 Credits

- MCP Bridge Server dựa trên [figma-mcp-bridge](https://github.com/gethopp/figma-mcp-bridge) bởi **gethopp**

---

## 📝 License

MIT License
