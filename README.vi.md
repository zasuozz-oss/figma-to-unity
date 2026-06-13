<p align="center">
  <h1 align="center">Figma → Unity</h1>
  <p align="center">
    Công cụ chuyển đổi thiết kế Figma sang Unity UI tự động với MCP Bridge cho AI
    <br />
    <strong>🌐 <a href="README.md">English</a> · <a href="README.zh.md">中文</a></strong>
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

> **📖 Hướng dẫn đầy đủ Figma Plugin → [`docs/figma-plugin-guide.md`](docs/figma-plugin-guide.md)**

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
| **Text** | TextMeshPro với tính năng tự động ánh xạ họ font (font family), kiểu font (style), kích thước, màu sắc và căn lề |
| **Ánh xạ Font** | Tự động phát hiện các họ & kiểu font trong Figma và ánh xạ tới TextMeshPro Font Assets trong Unity |
| **Deduplication** | Loại bỏ ảnh PNG trùng lặp bằng mã băm FNV-1a — bỏ qua các tài nguyên giống nhau để tối giản dung lượng file ZIP |
| **Sprite Atlas** | Tự động tạo SpriteAtlas từ các sprite đã import với cấu hình padding (khoảng đệm) & cho phép xoay nâng cao |
| **Render Pipeline** | Hỗ trợ cả 2 chế độ dựng hình UGUI (Canvas + Image) và 2D Object (SpriteRenderer) |
| **Scale** | 0.5x, 0.75x, 1x, 1.5x, 2x, 3x, 4x hoặc cố định chiều rộng/cao (512w, 1024h, ...) |
| **Per-Element** | Các nút điều khiển inline Merge, Exclude, và PNG rasterize để kiểm soát chi tiết từng tài nguyên |
| **Đổi Tên Hàng Loạt** | Đổi tên hàng loạt layer sang `snake_case` với tùy chọn thêm tiền tố (prefix) tùy biến và tính năng hoàn tác |
| **Menu Ngữ Cảnh** | Click chuột phải vào layer để Đổi tên nhanh, Bật/tắt Ẩn/Hiện, Bật/tắt Gộp, hoặc Xuất riêng lẻ nhánh con |
| **Đồng bộ Cấu hình** | Xuất và nhập cấu hình qua file `settings.json` để khôi phục nhanh các thiết lập qua nhiều lần chạy |
| **Kích thước Window** | Giao diện responsive của plugin với các kích thước cửa sổ S, M, L dựng sẵn |
| **Minimize** | Thu nhỏ plugin thành thanh trạng thái MCP nhỏ gọn trên màn hình Figma |
| **Tùy chọn Canvas** | Các preset tỉ lệ Canvas, tùy chọn Tạo Canvas mới hoặc Dùng Canvas có sẵn trong scene, cấu hình Match Width/Height |
| **Texture Importer** | Thiết lập import ảnh nâng cao (Tự động phát hiện Max Size, tùy chỉnh nén compression, chế độ lọc filter, thư mục đầu ra) |

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

### 1. Build & chạy mọi thứ (một lệnh)

Chạy được trên **macOS, Linux, và Windows (git-bash)**:

```bash
./setup.sh
```

Lệnh này cài dependencies, build cả Figma plugin **lẫn** MCP bridge server, in hướng dẫn cài đặt, rồi khởi động bridge server trên `ws://localhost:1994`.

Quản lý server bất cứ lúc nào:

```bash
./setup.sh start      # khởi động bridge server (chạy nền)
./setup.sh stop       # dừng server
./setup.sh restart    # khởi động lại
./setup.sh status     # kiểm tra server có đang chạy không
./setup.sh logs       # xem log server theo thời gian thực
./setup.sh build      # chỉ build lại plugin + server (không start)
```

<details>
<summary>Build thủ công (không dùng setup.sh)</summary>

```bash
# Figma plugin
cd FigExportForUnity && npm install && npm run build

# MCP bridge server
cd FigExportForUnity/server && npm install && npx tsc   # hoặc: bun run build
```
</details>

Sau đó nạp plugin vào Figma Desktop:
1. **Plugins** → **Development** → **Import plugin from manifest...**
2. Chọn `FigExportForUnity/manifest.json`

### 2. Cấu hình MCP Client

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
>
> **Claude Code:** đăng ký server một lần từ thư mục gốc repo, rồi kiểm tra bằng `claude mcp list`:
> ```bash
> claude mcp add figma-bridge --scope project -- node <đường-dẫn-tuyệt-đối>/FigExportForUnity/server/dist/index.js
> ```

### 3. Cài đặt Unity Importer

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
3. *(Tuỳ chọn)* Đổi tên hàng loạt các layer bằng công cụ **Rename** với prefix
4. Cấu hình per-element (Merge / PNG / Exclude) trong layer tree
5. Chọn **Export Scale** (0.5x – 4x hoặc fixed size)
6. Click **▶ Export for Unity** → Download ZIP

### Import vào Unity

1. Giải nén file ZIP đã tải về.
2. Trong Unity, mở **Window** → **Figma Importer**.
3. Chọn thư mục chứa file `manifest.json`.
4. Cấu hình các tùy chọn nhập nâng cao trong cửa sổ:

| Nhóm Thiết Lập | Tùy Chọn | Mô Tả | Giá Trị / Phạm Vi | Mặc Định |
|:---|:---|:---|:---|:---|
| **Đầu Ra** | **Render Pipeline** | Chọn giữa giao diện UI Canvas (UGUI) hoặc sprite 2D trong không gian thế giới | UGUI / Object2D | UGUI |
| | **Chế Độ Xuất** | Dựng cây UI trong Scene hiện tại, lưu thành Prefab, hoặc cả hai | Scene / Prefab / Both | Scene |
| **Canvas** | **Canvas Target** | Tạo Canvas mới hoặc gắn vào Canvas có sẵn trong scene | Tạo Mới / Dùng Có Sẵn | Tạo Mới |
| | **Canvas Scale** | Hệ số tỉ lệ UI so với bản thiết kế gốc trên Figma | Auto / 1x / 1.5x / 2x / 3x / 4x / Custom | Auto |
| **Thư Mục Xuất** | **Output Folder** | Đường dẫn trong Assets để lưu sprite đã nhập | Nhấn Browse để chọn | `Assets/Sprites/` (tự nhận diện) |
| **Ánh Xạ Font** | **Font Mapping** | Ánh xạ từng font Figma (Family + Style) sang TMP_FontAsset trong dự án | Ô chọn đối tượng | Tự động theo tên |
| **Tuỳ Chọn Build** | **Disable Raycast** | Tắt Raycast Target trên các UI element không tương tác | Bật / Tắt | Tắt |
| | **Scale to Unity** | Tự động co giãn UI element theo độ phân giải Canvas mục tiêu | Bật / Tắt | Bật |
| **Texture** | **Tự nhận Max Size** | Tự động đặt Max Size của texture theo kích thước PNG thực tế | Bật / Tắt | Bật |
| | **Filter & Nén** | Cấu hình filter mode và định dạng nén cho sprite | Bilinear/Trilinear/Point & Compressed/HQ/... | Bilinear & Compressed |
| **Sprite Atlas** | **Tạo Atlas** | Đóng gói tất cả sprite UI đã nhập vào một SpriteAtlas duy nhất | Bật / Tắt | Tắt |
| | **Atlas Padding** | Khoảng đệm giữa các sprite bên trong atlas | 0 – 8 pixel | 2 px |

5. Click **Build UI**

### MCP Bridge (AI Tools)

Khi plugin Figma đang mở, MCP Bridge kết nối qua `ws://localhost:1994/ws`. AI tools có thể gọi các MCP tool sau:

| Tool | Mô tả |
|:---|:---|
| `get_document` | Toàn bộ document tree của Figma page hiện tại |
| `get_selection` | Các node đang được chọn |
| `get_node` | Lấy một node cụ thể theo ID |
| `get_styles` | Tất cả local color và text styles |
| `get_metadata` | Tên tài liệu, danh sách page, thông tin page hiện tại |
| `get_design_context` | Cây tóm tắt của selection hiện tại (tối ưu cho AI) |
| `get_variable_defs` | Tất cả variable collections, modes, và values (design tokens) |
| `get_screenshot` | Export PNG của node(s) — trả về base64 |
| `save_screenshots` | Export nhiều node và ghi PNG trực tiếp vào filesystem |
| `export_element` | Export một frame/component qua toàn bộ pipeline Unity — ghi `manifest.json` + PNG assets ra đĩa |

### Agent Workflow — Headless Import qua utk

AI agents (Claude Code, Cursor, ...) có thể chạy toàn bộ pipeline từ đầu đến cuối — không cần tải ZIP, không cần mở Editor window — bằng cách kết hợp MCP Bridge với [utk (Unity CLI AgentKit)](https://github.com/zasuozz-oss/unity-cli-agentkit), một CLI single-binary điều khiển Unity Editor từ terminal:

1. **Export** — gọi MCP tool `export_element` với `figmaUrl` (hoặc `nodeId`). Tool ghi `manifest.json` + PNG assets vào `~/Desktop/FigmaImports/<tên-element>` (hoặc `$FIGMA_EXPORT_ROOT`), nằm ngoài Unity project — importer sẽ tự copy những gì cần vào `Assets/`.
2. **Import** — chạy headless importer trong Unity Editor đang mở qua utk:

   ```bash
   utk exec 'return FigmaImporter.FigmaHeadlessImporter.Import("<export-folder>", "Both");'
   ```

   `Import(exportFolder, outputMode, prefabSavePath, spriteFolder)` — `outputMode` là `Scene`, `Prefab`, hoặc `Both`; prefab mặc định lưu tại `Assets/Prefabs/UI/`. Trả về JSON: `{ success, rootName, textureCount, outputMode, log[] }`.

Yêu cầu: Figma Desktop đang mở plugin (bước 1), và Unity Editor đang chạy đã kết nối utk — cài utk, chạy `utk init` trong Unity project, rồi kiểm tra bằng `utk status` (bước 2).

---

## 🔧 Điều Khiển Per-Element

### Nút inline (trên mỗi dòng trong layer tree)

| Nút | Chức năng |
|:---|:---|
| **M** — Merge | Gộp element và toàn bộ children thành 1 PNG duy nhất |
| **P** — PNG | Rasterize text node thành PNG thay vì tạo TextMeshPro component |
| **×** — Exclude | Loại bỏ element và subtree khỏi export hoàn toàn |
| **👁** — Visibility | Ẩn/hiện element trong Figma canvas |

### Menu chuột phải (Context menu)

| Mục | Chức năng |
|:---|:---|
| ✏️ **Đổi Tên** | Đổi tên element này trực tiếp trong layer tree |
| 👁 **Bật/Tắt Ẩn Hiện** | Giống nút 👁 inline |
| 🔗 **Bật/Tắt Gộp** | Giống nút M inline |
| 📦 **Xuất Element Này** | Xuất riêng subtree của element này thành ZIP độc lập |

---

## 📐 Ánh Xạ Constraint → Anchor

| Constraint trong Figma | Anchor trong Unity |
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
- Bảo vệ path traversal + exclusive write flag cho thao tác file
- Kiểm tra đầu vào qua [Zod](https://zod.dev/) cho tất cả MCP tool calls
- Không có `eval()`, `exec()`, hoặc hardcoded secrets

---

## 📝 Phát Triển

```bash
# Build mọi thứ + khởi động bridge server (macOS / Linux / git-bash)
./setup.sh

# Figma Plugin — watch mode (auto-rebuild khi save)
cd FigExportForUnity
npm run watch

# Build lại plugin + server mà không start (mọi nền tảng)
./setup.sh build
```

---

## 🙏 Ghi Công

- MCP Bridge Server dựa trên [figma-mcp-bridge](https://github.com/gethopp/figma-mcp-bridge) bởi **gethopp**

---

## 📝 Giấy Phép

Dự án được phân phối theo [MIT License](LICENSE).
