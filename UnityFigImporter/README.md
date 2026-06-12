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

## Realtime Sync window (`Window > Figma > Sync`)

Sync một element từ Figma vào Unity không cần AI. V2 tách 2 bước: **Sync** chỉ
export + preview ảnh thật từ Figma vào staging `.unity-figma/` (cạnh `Assets/`,
Unity bỏ qua folder này); **Build** mới tạo prefab.

1. Mở Figma Desktop + plugin FigExportForUnity.
2. Mở `Window > Figma > Sync`, bấm **Check** (port mặc định `1994`).
   Nếu bridge offline, set **Bridge dir** = `FigExportForUnity/server` rồi bấm **Spawn standalone bridge**.
3. Dán Figma URL hoặc bấm **Use current Figma selection**.
4. Bấm **Sync (export + preview)** để ghi asset, `manifest.json`, và `preview.png`
   vào `.unity-figma/<node-id>/`; ảnh preview hiện trong window. Chưa có gì vào `Assets/`.
5. Chỉnh Output Mode / Prefab Save Path nếu cần, bấm **Build prefab** để tạo prefab;
   trùng tên thì prefab được replace. Data staging vẫn được giữ lại.
6. Tab **Library** liệt kê mọi element đã sync: search, tuổi dạng `22m`/`4h`,
   preview với Zoom/Fit/1:1/lăn chuột, **Build** lại hoặc **Delete** khỏi `.unity-figma`.
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
