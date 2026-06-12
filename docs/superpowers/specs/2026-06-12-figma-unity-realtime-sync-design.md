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

### A. Figma Plugin (`FigExportForUnity/src`) — "URL chuẩn"

- Hàm thuần `buildCanonicalUrl(node)` →
  `{ nodeId: "1234:5678", fileKey, name, url: "https://www.figma.com/design/<fileKey>/<name>?node-id=1234-5678" }`.
- Gắn `canonicalUrl` + `fileKey` vào payload `get_selection` đang có — **không đổi
  protocol**, chỉ thêm field. Trung lập để dùng được cho cả 2 chiều sau này.
- (nhỏ) Nút "Copy Unity URL" trong UI plugin.

### B. Bridge (`FigExportForUnity/server`) — REST API + standalone mode

- Tách core export thành **một hàm dùng chung** để MCP tool `export_element` và HTTP
  route cùng gọi (tránh trùng lặp logic).
- Thêm routes trên HTTP server 1994 sẵn có (server đã làm `handleUpgrade` cho WS):
  - `GET  /api/health` → `{ ok, role, pluginConnected }`
  - `GET  /api/selection` → relay selection của plugin (kèm `canonicalUrl`, `nodeId`, `name`)
  - `POST /api/export_element { nodeId | figmaUrl, scale? }` → `{ outputDir, assetCount, name, nodeCount }`
- **Entry standalone**: boot HTTP+WS **không** dùng `StdioServerTransport`, để Unity
  spawn `node dist/<entry>` headless khi không có bridge MCP đang chạy.

### C. Unity Editor (`UnityFigImporter/Editor`) — `FigmaSyncWindow`

`EditorWindow`, menu `Window/Figma/Sync`. Các section:

- **Connection:** ô Port (mặc định 1994) + đèn status (probe `/api/health`); nếu chết
  → nút spawn standalone bridge (ô cấu hình đường dẫn node/bridge, lưu `EditorPrefs`).
- **Source:** ô Figma URL **+** nút "Use current Figma selection" (gọi `/api/selection`,
  điền URL + hiện tên element).
- **Options:** dropdown mode (`Both`/`PrefabOnly`/`SceneOnly`), prefab save path,
  sprite folder — tái dùng settings của `FigmaImporterWindow`.
- **Sync:** `POST /api/export_element` → `FigmaHeadlessImporter.Import(outputDir, mode,
  prefabSavePath, spriteFolder)` → **replace prefab nếu trùng tên**.
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
- **Plugin:** unit test `buildCanonicalUrl` (hàm thuần).
- **Unity:** EditMode test cho URL/node-id parser + writer của `last-import.json`.

## Ngoài phạm vi (YAGNI)

- **Không** build Unity→Figma push lúc này — chỉ làm URL chuẩn để tái dùng sau.
- **Không** merge/re-sync giữ component đã wire — replace là overwrite.
- **Không** tự khởi động Claude — AI handoff chỉ chuẩn bị descriptor + prompt.
