# Spec: Figma ↔ Unity Realtime Sync (Editor tool + REST bridge + URL chuẩn)

**Ngày:** 2026-06-12
**Nhánh:** `feature/figma-unity-realtime-sync`
**Trạng thái:** Chờ user review spec → writing-plans

## Mục tiêu

Cho phép sync một popup/element từ Figma vào Unity **ngay trong Editor**, không bắt
buộc phải có AI agent: mở một `EditorWindow`, chọn element (dán URL **hoặc** dùng
selection hiện tại trên Figma), bấm **Sync** → prefab được import; trùng tên thì
replace. Sau khi import, có cơ chế **bàn giao cho AI** để làm phần nặng (rename
element, dọn/chia hierarchy, sinh + gắn + wire scripts).

Tái dùng **100% logic export/import hiện có** (manifest contract, `export_element`,
`FigmaHeadlessImporter`). Chỉ thêm "cổng vào" mới (REST API + Editor UI) và một tính
năng "URL chuẩn" trong plugin.

## Quyết định đã chốt (brainstorming)

| Hạng mục | Quyết định |
|----------|-----------|
| Chọn element | **Cả hai**: dán Figma URL + nút "Use current Figma selection" |
| Sync mode | Tạo prefab mới; **trùng tên thì replace (overwrite)** |
| Preview | Ảnh **kết quả render trên Unity** sau import + dòng status kiểu UDEV |
| Kết nối | **Auto-detect** (Phương án A): dùng bridge đang chạy nếu sống, else spawn standalone |
| Phạm vi AI | Chạy được **không cần AI**; thêm cơ chế **handoff** cho AI sau khi prefab import xong |
| Plugin URL | Xuất **URL chuẩn trung lập**, dùng chung cho 2 chiều (Figma→Unity nay, Unity→Figma sau) |

## Kiến trúc

```
┌──────────────────┐  HTTP /api/*   ┌────────────────────────┐  WebSocket  ┌──────────────┐
│ Unity Editor     │ ─────────────► │ Figma Bridge (Node)    │ ──────────► │ Figma Plugin │
│ FigmaSyncWindow  │ ◄───────────── │ HTTP+WS :1994          │ ◄────────── │ (Desktop)    │
└──────────────────┘  JSON          │ + NEW /api/* routes    │  std-URL    └──────────────┘
        │ spawn nếu /api/health chết │ + standalone mode      │
        ▼                           └────────────────────────┘
   FigmaHeadlessImporter.Import(outputDir, mode) → Prefab (replace nếu trùng tên)
        │
        ▼  render preview + "Done. Built <name> (N nodes)"  →  [Refine with AI] (handoff)
```

Điểm nối giữa các phía vẫn là **manifest contract** và **HTTP relay xuống cùng một
plugin** (MCP tool và REST route dùng chung core export).

## Thành phần

### A. Figma Plugin (`FigExportForUnity/src/main.ts`) — "URL chuẩn"

- **Lõi contract là `nodeId`** (dạng colon `1234:5678`) — đây là thứ cả 2 tool thực sự
  cần (`export_element` đã nhận `nodeId` HOẶC `figmaUrl`).
- Hàm thuần `buildCanonicalRef(node)` →
  `{ nodeId: "1234:5678", name, fileKey?, url? }`.
  - `fileKey` lấy từ `figma.fileKey` **nếu có** — ⚠️ API này có thể trả `undefined`
    (file chưa lưu / community / quyền hạn); repo hiện **chưa hề** đọc `fileKey` (dùng
    `figma.root.name`). Khi undefined → bỏ qua `url`, tool vẫn chạy bằng `nodeId`.
  - `url` (best-effort): `https://www.figma.com/design/<fileKey>/<name>?node-id=1234-5678`.
- Enrich tại handler `get_selection` (main.ts:511) — hiện trả `serializeNode(node,2)`
  (chỉ id+name); thêm `nodeId`/`fileKey`/`url`. **Không đổi protocol**, chỉ thêm field.
- (nhỏ) Nút "Copy Unity ref" trong UI plugin.

### B. Bridge (`FigExportForUnity/server/src`) — REST API + standalone mode

> Sửa **TypeScript source** (`src/*.ts`) rồi rebuild ra `dist/` — không sửa `dist` trực tiếp.

- HTTP server là class **`Leader`** (`src/leader.ts`); router hiện chỉ có `GET /ping`
  và WS `handleUpgrade`. Thêm `/api/*` ngay trong router của `Leader`.
- Tách core export thành **một hàm dùng chung** để MCP tool `export_element` (tools.ts)
  và HTTP route cùng gọi (tránh trùng lặp logic).
- Routes mới:
  - `GET  /api/health` → `{ ok, role, pluginConnected }`
  - `GET  /api/selection` → relay `get_selection` của plugin (kèm `nodeId`, `name`, `fileKey?`, `url?`)
  - `POST /api/export_element { nodeId | figmaUrl, scale? }` →
    `{ outputDir, assetCount, name, nodeCount }` — `nodeCount` derive từ
    `manifest.elements.length` (export hiện chỉ trả `assetCount`).
- **Entry standalone** (`src/standalone.ts`): boot `Node`+`Election`(→`Leader` HTTP+WS)
  **không** tạo `McpServer`/`StdioServerTransport`. Routes `/api/*` gọi thẳng `node.send(...)`,
  không phụ thuộc McpServer. Unity spawn `node dist/standalone.js` headless khi không có
  bridge MCP đang chạy.

### C. Unity Editor (`UnityFigImporter/Editor`) — `FigmaSyncWindow`

`EditorWindow`, menu `Window/Figma/Sync`. Các section:

- **Connection:** ô Port (mặc định 1994) + đèn status (probe `/api/health`); nếu chết
  → nút spawn standalone bridge (ô cấu hình đường dẫn node/bridge, lưu `EditorPrefs`).
- **Source:** ô Figma URL **+** nút "Use current Figma selection" (gọi `/api/selection`,
  điền URL + hiện tên element).
- **Options:** dropdown mode (`Both`/`Prefab`/`Scene`) — **UI default = `Both`** (lưu ý
  `Import` mặc định nội bộ là `"Scene"`), prefab save path, sprite folder — tái dùng
  settings của `FigmaImporterWindow`.
- **Sync:** `POST /api/export_element` → `FigmaHeadlessImporter.Import(exportFolder,
  outputMode, prefabSavePath, spriteFolder)`. **Replace nếu trùng tên là TỰ ĐỘNG**:
  `HierarchyBuilder` lưu `<savePath>/<root.name>.prefab` qua `SaveAsPrefabAsset`
  (overwrite cùng path) — không cần code merge.
- **Result:** render prefab vừa import ra `Texture` preview + dòng status
  `"Done. Built <name> (<N> nodes)"`.
- **Refine with AI:** ghi `last-import.json` (outputDir, prefabPath, nodeId,
  canonicalUrl, name) vào vị trí cố định + copy prompt sẵn vào clipboard để user chạy
  với Claude (figma-build bước 4–6). *Unity không gọi trực tiếp Claude — đây là cơ
  chế bàn giao.*

## Luồng dữ liệu (1 lần sync)

1. Chọn source (dán URL hoặc "Use selection" → `GET /api/selection`).
2. Bấm Sync → `POST /api/export_element` → bridge relay xuống plugin → plugin export
   PNG+manifest ra `~/Desktop/FigmaImports/<name>` → trả `outputDir`.
3. Unity gọi `FigmaHeadlessImporter.Import(outputDir, mode)` → build prefab, replace
   nếu trùng tên.
4. Render preview + status.
5. (tùy chọn) Refine with AI handoff.

## Error handling

| Tình huống | Hành vi |
|-----------|---------|
| `/api/health` chết | "Bridge offline" + nút spawn / hướng dẫn |
| Plugin chưa kết nối WS | bridge trả 409 → "Mở Figma Desktop + plugin" |
| `assetCount==0` mà UI có ảnh | cảnh báo (theo rule figma-build), vẫn cho text-only |
| Import `success:false` | in mảng `log` trong window |
| Spawn node thất bại | hiện ô cấu hình đường dẫn node/bridge |

## Testing

- **Bridge:** `bun:test` cho export-core + parse input của route + `/api/health`
  (theo mẫu `figma-url.test.js`).
- **Plugin:** unit test `buildCanonicalRef` (hàm thuần) — cả nhánh có/không `fileKey`.
- **Unity:** EditMode test cho URL/node-id parser + writer của `last-import.json`.

## Ngoài phạm vi (YAGNI)

- **Không** build Unity→Figma push lúc này — chỉ làm URL chuẩn để tái dùng sau.
- **Không** merge/re-sync giữ component đã wire — replace là overwrite.
- **Không** tự khởi động Claude — AI handoff chỉ chuẩn bị descriptor + prompt.

## Rủi ro / điểm cần xác nhận khi làm plan

- **`figma.fileKey` có thể `undefined`** → URL đầy đủ là best-effort; mọi tool phải chạy
  được chỉ với `nodeId`. (Repo hiện chưa dùng fileKey bao giờ.)
- **Spawn standalone bridge từ Unity**: cần biết đường dẫn `node` + `dist/standalone.js`;
  nếu Unity đang chạy trong môi trường không có Node trong PATH → phải cấu hình tay
  (ô đường dẫn trong EditorPrefs).
- **Race khi đồng thời có MCP bridge + standalone**: chỉ một tiến trình bind được
  port 1994 (Election xử lý leader/follower) → Unity luôn probe `/api/health` trước,
  không spawn nếu đã sống.
