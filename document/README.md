# Figma-To-Unity

Hệ thống chuyển đổi thiết kế Figma sang Unity uGUI — tự động, chính xác, miễn phí.

## Tổng quan

**Figma-To-Unity** gồm 2 phần:

| Part | Công nghệ | Chức năng |
|------|-----------|----------|
| **Figma Plugin** | TypeScript | Export PNG + manifest.json từ Figma |
| **Unity Importer** | C# EditorWindow | Build hierarchy + prefab từ manifest |

```
Figma Design ──[Plugin]──▶ ZIP (manifest.json + PNGs) ──[Importer]──▶ Unity UI Prefab
```

## Tính năng

### Figma Plugin
- ✅ Traverse toàn bộ node tree, giữ nguyên hierarchy
- ✅ Export PNGs @1x/@2x/@3x với naming convention chuẩn
- ✅ Generate `manifest.json` chứa sẵn Unity RectTransform values
- ✅ Constraint → Anchor tự động convert
- ✅ Text properties → TextMeshPro parameters
- ✅ Download ZIP

### Unity Importer
- ✅ Parse manifest.json → preview hierarchy
- ✅ Import textures → Sprite với correct settings
- ✅ Build UI hierarchy → RectTransform + components
- ✅ **Prefab mode**: Tạo prefab, không spam scene
- ✅ **9-slice auto-detect**: cornerRadius → sprite border
- ✅ **Auto script binding**: Match SerializeField tên → assign
- ✅ **RaycastTarget optimization**: Non-interactive = false
- ✅ Per-element error logging

### MCP/AI Layer (Optional)
- Agent đọc manifest.json → auto-build via MCP tools
- Không cần Unity Importer — agent tự làm mọi thứ

## Quick Start

### 1. Figma
- Cài plugin từ Figma Community
- Chọn Frame → Run Plugin → Export for Unity
- Download ZIP

### 2. Unity
- Import package `com.figma-to-unity`
- Menu: `Tools > Figma Importer`
- Browse đến folder unzip → Build UI

## Documentation
- [Implementation Plan](docs/PLAN.md)
- [Manifest Specification](docs/MANIFEST_SPEC.md)
- [Naming Convention](docs/NAMING.md)
- [Anchor Mapping](docs/ANCHOR_MAPPING.md)

## Tech Stack
- **Figma Plugin**: TypeScript, Figma Plugin API
- **Unity Importer**: C# (.NET Standard 2.1), Unity 6+, TextMeshPro
- **Target**: uGUI (Canvas, RectTransform, Image, Button, TMP)

## License
MIT
