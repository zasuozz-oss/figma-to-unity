# Figma → Unity Importer

Unity Editor tool để import design từ Figma Plugin vào Unity UI.

## Cài đặt

### Cách 1: Local Package (Development)
1. Mở Unity project
2. `Window > Package Manager > + > Add package from disk...`
3. Chọn file `package.json` trong folder `unity-importer/`

### Cách 2: Git URL
```
Window > Package Manager > + > Add package from git URL...
```
```
https://github.com/<user>/figma-to-unity.git?path=unity-importer
```

## Sử dụng

1. Export từ Figma Plugin → download ZIP → giải nén
2. Trong Unity: `Window > Figma > Import`
3. Click **Browse** → chọn folder `FigmaExport_*`
4. Chọn output mode (Scene / Prefab / Both)
5. Cấu hình Canvas settings (nếu Scene mode)
6. Click **Build UI**

## Tính năng

- ✅ Parse `manifest.json` v1.0
- ✅ Import textures as Sprites (1x/2x/3x)
- ✅ 9-slice auto-detection (cornerRadius)
- ✅ Build UI hierarchy (RectTransform, Image, TextMeshProUGUI)
- ✅ Layout Groups (Horizontal/Vertical)
- ✅ Canvas settings (Create New / Use Existing)
- ✅ Prefab output (without Canvas/EventSystem)
- ✅ raycastTarget optimization
- ✅ Per-element build log

## Yêu cầu

- Unity 2022.3+
- TextMeshPro package
- Newtonsoft.Json package (com.unity.nuget.newtonsoft-json)
