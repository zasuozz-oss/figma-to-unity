# UnityFig Importer — Figma → Unity UI Builder

Unity Editor package để import design từ Figma Plugin vào Unity UI tự động.

---

## Cài Đặt

### Cách 1: Local Package (khuyến nghị khi develop)
1. Mở Unity project
2. `Window > Package Manager > + > Add package from disk...`
3. Chọn file `package.json` trong folder `UnityFig Importer/`

### Cách 2: Copy trực tiếp
```
Copy thư mục "UnityFig Importer" vào Assets/ trong Unity project
```

### Cách 3: Git URL
```
Window > Package Manager > + > Add package from git URL...
```
```
https://github.com/<user>/figma-to-unity.git?path=UnityFig Importer
```

---

## Sử Dụng

1. Export từ Figma Plugin → download ZIP → giải nén vào `Assets/`
2. Trong Unity: `Window > Figma Importer`
3. Chọn folder chứa `manifest.json`
4. Chọn output mode (Scene / Prefab / Both)
5. Cấu hình Canvas settings (nếu Scene mode)
6. Click **Build UI**

---

## Figma Dashboard (`Window > Figma > Dashboard`)

Menu duy nhất của tool. Sync một element từ Figma, xem ngay **kết quả import
thật của Unity**, rồi mới Build prefab.

1. Mở Figma Desktop + plugin FigExportForUnity.
2. Mở `Window > Figma > Dashboard`. Mở foldout **Settings** nếu cần đổi
   Port (mặc định `1994`, nút **Check**), spawn standalone bridge, Output Mode,
   Prefab Save Path, Sprite Folder.
3. Bấm **Use current Figma selection** (hoặc dán URL/node-id) → **Sync**.
4. Sync = export assets + manifest vào `.unity-figma/<node-id>/` **+ dựng
   hierarchy thật bằng sprite in-memory** (không ghi gì vào `Assets/` — không
   import texture, không tạo atlas) → render `unity-preview.png` offscreen.
   Detail panel hiện đúng những gì Unity sẽ build (nền trong suốt, khớp render
   Figma) — thấy ngay lỗi gộp ảnh / nhầm font / nhầm text để quay lại sửa trên
   Figma. Panel **Child Nodes** bên trái preview là tree mở rộng/thu nhỏ được:
   click 1 node để highlight đúng vị trí của nó trên preview, double-click (hoặc
   F2) để đổi tên — tên mới lưu vào manifest và Build sẽ dùng làm tên GameObject.
   Log warning/error hiện dưới preview.
5. Ưng rồi thì bấm **Build** → lúc này texture mới được import vào Sprite
   Folder và prefab được tạo (Output Mode trong Settings), prefab được ping
   trong Project window. Data staging giữ nguyên.
6. Cột trái: mọi element đã sync (search, tuổi `22m`/`4h`); chọn để xem lại,
   **Build** lại hoặc **Delete** (xoá khỏi `.unity-figma`).
7. Tùy chọn **Refine with AI** sau khi Build để ghi descriptor và copy prompt bàn giao
   cho figma-build bước 4-6.

> Khuyến nghị thêm `.unity-figma/` vào `.gitignore` của Unity project.

---

## Tính Năng

- ✅ Parse `manifest.json` v1.0
- ✅ Import textures as Sprites (1x/2x/3x/4x)
- ✅ 9-slice auto-detection (cornerRadius)
- ✅ Build UI hierarchy (RectTransform, Image, TextMeshProUGUI)
- ✅ Auto Layout → HorizontalLayoutGroup / VerticalLayoutGroup
- ✅ Canvas settings (Create New / Use Existing)
- ✅ Prefab output (without Canvas/EventSystem)
- ✅ Raycast optimization — disable cho decorative elements
- ✅ Font mapping — auto-match hoặc chọn thủ công
- ✅ Per-element build log

---

## Yêu Cầu

| Package | Nguồn |
|:---|:---|
| Unity 2022.3+ | — |
| TextMeshPro | Package Manager |
| Newtonsoft.Json | `com.unity.nuget.newtonsoft-json` |

---

## Cấu Trúc

```
UnityFig Importer/
├── Editor/
│   ├── FigmaImporterWindow.cs    # Main EditorWindow
│   ├── ManifestParser.cs         # JSON → C# data classes
│   ├── TextureImportHelper.cs    # PNG → Sprite import + 9-slice
│   ├── HierarchyBuilder.cs       # RectTransform + component builder
│   ├── SpriteAtlasHelper.cs      # Sprite Atlas grouping
│   └── Data/
│       └── ManifestData.cs       # Manifest data model
├── package.json                  # UPM package descriptor
└── README.md
```
