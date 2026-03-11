<p align="center">
  <h1 align="center">Figma → Unity</h1>
  <p align="center">
    Công cụ chuyển đổi thiết kế Figma sang Unity UI tự động với MCP Bridge cho AI
    <br />
    <strong>🌐 <a href="README.md">English</a></strong>
    <br />
    <br />
    <a href="#-bắt-đầu-nhanh">Bắt Đầu Nhanh</a>
    ·
    <a href="#-tính-năng">Tính Năng</a>
    ·
    <a href="https://github.com/zasuozz-oss/figma-to-unity/issues">Báo Lỗi</a>
    ·
    <a href="https://github.com/zasuozz-oss/figma-to-unity/issues">Yêu Cầu Tính Năng</a>
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

## 📖 Mục Lục

- [Tổng Quan](#-tổng-quan)
- [Tính Năng](#-tính-năng)
- [Kiến Trúc](#-kiến-trúc)
- [Yêu Cầu Hệ Thống](#-yêu-cầu-hệ-thống)
- [Bắt Đầu Nhanh](#-bắt-đầu-nhanh)
- [Hướng Dẫn Sử Dụng](#-hướng-dẫn-sử-dụng)
- [Điều Khiển Per-Element](#-điều-khiển-per-element)
- [Anchor Mapping](#-constraint--anchor-mapping)
- [Bảo Mật](#-bảo-mật)
- [Development](#-development)
- [Credits](#-credits)
- [License](#-license)

---

## 🔍 Tổng Quan

**Figma → Unity** là pipeline end-to-end chuyển đổi thiết kế Figma sang Unity UI với tối thiểu thao tác thủ công. Gồm 3 thành phần:

| Thành phần | Mô tả |
|:---|:---|
| **Figma Plugin** | Chạy trong Figma Desktop. Duyệt design tree, export manifest JSON + PNG assets dưới dạng ZIP. |
| **MCP Bridge Server** | Server [Model Context Protocol](https://modelcontextprotocol.io/) (stdio). Cho phép AI tools (Cursor, Claude, Antigravity) đọc dữ liệu thiết kế Figma real-time qua WebSocket. |
| **Unity Importer** | Editor Window parse manifest, import textures, và build toàn bộ UI hierarchy tự động. |

---

## ✨ Tính Năng

| Nhóm | Tính năng |
|:---|:---|
| **Export** | One-click export từ Figma → ZIP (manifest.json + PNGs) |
| **Import** | Tự động tạo UI hierarchy hoàn chỉnh trong Unity từ manifest |
| **AI** | MCP Bridge cho phép AI tools đọc Figma design data real-time |
| **Layout** | Figma Auto Layout → Unity HorizontalLayoutGroup / VerticalLayoutGroup |
| **Text** | TextMeshPro với auto mapping font, size, color, alignment |
| **Deduplication** | FNV-1a hash-based loại bỏ PNG trùng lặp |
| **Sprite Atlas** | Tự động tạo SpriteAtlas từ sprites đã import |
| **Render Pipeline** | UGUI (Canvas + Image) và 2D Object (SpriteRenderer) |
| **Scale** | 0.5x, 0.75x, 1x, 1.5x, 2x, 3x, 4x hoặc fixed size (512w, 1024h, ...) |
| **Per-Element** | Merge, Exclude, PNG rasterize cho từng node |
| **Minimize** | Thu nhỏ plugin thành thanh trạng thái MCP nhỏ gọn |

---

## 🏗️ Kiến Trúc

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

## 📋 Yêu Cầu Hệ Thống

### Figma Plugin & MCP Server

| Dependency | Version | Ghi chú |
|:---|:---|:---|
| **Node.js** | `>= 20.0.0` | Cần cho build và chạy MCP server |
| **npm** | `>= 9` | Đi kèm Node.js |
| **Bun** *(tuỳ chọn)* | `>= 1.0` | Thay thế nhanh hơn cho server builds |
| **Figma Desktop** | Latest | Plugin không hoạt động trên Figma web |

### Unity Importer

| Dependency | Version | Ghi chú |
|:---|:---|:---|
| **Unity** | `2022.3+` LTS | Đã test trên 2022.3 và 6000.x |
| **TextMeshPro** | `3.0.6+` | `com.unity.textmeshpro` qua Package Manager |
| **Newtonsoft JSON** | `3.2.1+` | `com.unity.nuget.newtonsoft-json` qua Package Manager |
| **SpriteAtlas** *(tuỳ chọn)* | Built-in | Cho auto atlas generation |

### MCP Client (AI Tool)

Bất kỳ AI tool nào hỗ trợ [Model Context Protocol](https://modelcontextprotocol.io/) stdio transport:
- **Cursor** — qua `.cursor/mcp.json`
- **Claude Desktop** — qua `claude_desktop_config.json`
- **Antigravity** — qua `mcp_config.json`

---

## 🚀 Bắt Đầu Nhanh

### 1. Build Figma Plugin

```bash
cd FigExportForUnity
npm install
npm run build
```

Trong Figma Desktop:
1. **Plugins** → **Development** → **Import plugin from manifest...**
2. Chọn `FigExportForUnity/manifest.json`

### 2. Build MCP Bridge Server

```bash
cd FigExportForUnity/server
npm install       # hoặc: bun install
npx tsc           # hoặc: bun run build
```

### 3. Cấu hình MCP Client

Thêm vào file cấu hình MCP của AI tool:

```json
{
  "mcpServers": {
    "figma-bridge": {
      "command": "node",
      "args": ["<đường-dẫn-tuyệt-đối>/FigExportForUnity/server/dist/index.js"]
    }
  }
}
```

> Thay `<đường-dẫn-tuyệt-đối>` bằng đường dẫn đầy đủ tới repo trên máy bạn.

### 4. Cài đặt Unity Importer

**Cách A — Git URL (khuyên dùng):**
```
https://github.com/zasuozz-oss/figma-to-unity.git?path=UnityFigImporter
```

**Cách B — Local Package:**
1. **Window** → **Package Manager** → **"+"** → **Add package from disk...**
2. Chọn `UnityFigImporter/package.json`

**Cách C — Thủ công:**
Copy thư mục `UnityFigImporter/` vào `Assets/` trong Unity project.

---

## 📖 Hướng Dẫn Sử Dụng

### Export từ Figma

1. Chọn **Frame** cần export
2. Chạy **Plugins** → **Figma to Unity**
3. Cấu hình per-element (Merge / PNG / Exclude)
4. Chọn **Export Scale** (0.5x – 4x hoặc fixed size)
5. Click **Export** → Download ZIP

### Import vào Unity

1. Giải nén file ZIP
2. Mở **Window** → **Figma Importer**
3. Chọn thư mục chứa `manifest.json`
4. Cấu hình:

| Tuỳ chọn | Giá trị | Mặc định |
|:---|:---|:---|
| **Output Mode** | Scene / Prefab / Both | Scene |
| **Render Pipeline** | UGUI / Object2D | UGUI |
| **Canvas Scale** | Auto / 1x / 1.5x / 2x / 3x / 4x / Custom | Auto |
| **Sprite Atlas** | On / Off | Off |

5. Click **Build UI**

### MCP Bridge (AI Tools)

Khi plugin Figma đang mở, MCP Bridge kết nối qua `ws://localhost:1994/ws`. AI tools có thể:
- Đọc document tree, selection, styles, variables
- Export screenshots theo node ID
- Lấy design context và metadata

---

## 🔧 Điều Khiển Per-Element

| Nút | Chức năng |
|:---|:---|
| **Merge** | Gộp parent + children thành 1 PNG duy nhất |
| **PNG** | Rasterize text node thành PNG thay vì TextMeshPro |
| **×** | Loại bỏ element khỏi export |
| **👁** | Ẩn/hiện element trong Figma |

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

## 🔒 Bảo Mật

- Server chỉ bind `localhost:1994` — không expose ra mạng
- Path traversal protection + exclusive write flag cho file operations
- Input validation qua [Zod](https://zod.dev/) cho tất cả MCP tool calls
- Không có `eval()`, `exec()`, hoặc hardcoded secrets

---

## 📝 Development

```bash
# Figma Plugin — build một lần
cd FigExportForUnity
npm run build

# Figma Plugin — watch mode (auto-rebuild khi save)
npm run watch

# MCP Server — build
cd FigExportForUnity/server
npx tsc
```

---

## 🙏 Credits

- MCP Bridge Server dựa trên [figma-mcp-bridge](https://github.com/gethopp/figma-mcp-bridge) bởi **gethopp**

---

## 📝 License

Dự án được phân phối theo [MIT License](LICENSE).
