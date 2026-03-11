# Manifest Specification v1.0

## Overview
`manifest.json` là file chính chứa toàn bộ thông tin để Unity Importer tái tạo UI.

## Schema

### Root Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | string | ✅ | Schema version (`"1.0"`) |
| `exportDate` | string | ✅ | ISO 8601 timestamp |
| `screen` | Screen | ✅ | Screen metadata |
| `elements` | Element[] | ✅ | Flat list of all UI elements |
| `assets` | Asset[] | ✅ | List of exported image files |
| `fonts` | Font[] | ❌ | List of font families used |

### Screen

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Frame/page name from Figma |
| `figmaSize` | `{w, h}` | Original Figma frame size |
| `unityRefResolution` | `{w, h}` | Target Unity CanvasScaler resolution |

### Element

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✅ | Figma node ID (e.g. `"1:23"`) |
| `name` | string | ✅ | Layer name (sanitized) |
| `figmaType` | string | ✅ | `FRAME`, `TEXT`, `RECTANGLE`, `VECTOR`, `GROUP`, `COMPONENT`, `INSTANCE` |
| `parentId` | string? | ✅ | Parent element ID, `null` for root |
| `rect` | Rect | ✅ | Position and size |
| `unity` | UnityTransform | ✅ | Pre-computed RectTransform values |
| `components` | string[] | ✅ | Unity components to add |
| `style` | Style | ❌ | Visual style properties |
| `text` | TextProps | ❌ | Text content and font (TEXT type only) |
| `asset` | string? | ❌ | Filename of exported PNG |
| `interactive` | boolean | ✅ | If `true`, raycastTarget stays on |
| `children` | string[] | ✅ | Child element IDs (ordered) |

### Rect

| Field | Type | Description |
|-------|------|-------------|
| `x` | number | X position relative to parent |
| `y` | number | Y position relative to parent |
| `w` | number | Width in Figma pixels |
| `h` | number | Height in Figma pixels |

### UnityTransform

| Field | Type | Description |
|-------|------|-------------|
| `anchorMin` | [number, number] | Unity `anchorMin` (x, y) |
| `anchorMax` | [number, number] | Unity `anchorMax` (x, y) |
| `pivot` | [number, number] | Unity `pivot` (x, y) |
| `sizeDelta` | [number, number]? | Width/height when not stretching |
| `offsetMin` | [number, number]? | Left/bottom offset |
| `offsetMax` | [number, number]? | Right/top offset (negative = inset) |
| `localScale` | [number, number, number] | Always `[1, 1, 1]` |

### Style

| Field | Type | Description |
|-------|------|-------------|
| `fill` | [r,g,b,a] | Fill color, RGBA 0-1 |
| `cornerRadius` | number | Border radius in pixels |
| `opacity` | number | 0-1 |
| `shadow` | Shadow? | Drop shadow (optional) |

### Shadow

| Field | Type | Description |
|-------|------|-------------|
| `x` | number | Offset X |
| `y` | number | Offset Y |
| `blur` | number | Blur radius |
| `color` | [r,g,b,a] | Shadow color |

### TextProps

| Field | Type | Description |
|-------|------|-------------|
| `content` | string | Actual text content |
| `fontFamily` | string | Font family name |
| `fontStyle` | string | `"Regular"`, `"Bold"`, `"SemiBold"`, etc. |
| `fontSize` | number | Font size in px |
| `color` | [r,g,b,a] | Text color |
| `alignment` | string | Unity TextAlignmentOptions name |
| `lineHeight` | number? | Line height multiplier |
| `letterSpacing` | number? | Letter spacing in em |

### Asset

| Field | Type | Description |
|-------|------|-------------|
| `file` | string | Filename (e.g. `"btn_login@2x.png"`) |
| `nodeId` | string | Source Figma node ID |
| `scale` | number | Export scale (1, 2, or 3) |

### Font

| Field | Type | Description |
|-------|------|-------------|
| `family` | string | Font family |
| `styles` | string[] | Used styles |

---

## Example

```json
{
  "version": "1.0",
  "exportDate": "2026-03-10T10:00:00Z",
  "screen": {
    "name": "LoginScreen",
    "figmaSize": { "w": 390, "h": 844 },
    "unityRefResolution": { "w": 1080, "h": 1920 }
  },
  "elements": [
    {
      "id": "1:2",
      "name": "Root",
      "figmaType": "FRAME",
      "parentId": null,
      "rect": { "x": 0, "y": 0, "w": 390, "h": 844 },
      "unity": {
        "anchorMin": [0, 0],
        "anchorMax": [1, 1],
        "pivot": [0.5, 0.5],
        "offsetMin": [0, 0],
        "offsetMax": [0, 0],
        "localScale": [1, 1, 1]
      },
      "components": ["Image"],
      "style": { "fill": [0.1, 0.1, 0.18, 1], "cornerRadius": 0, "opacity": 1 },
      "asset": null,
      "interactive": false,
      "children": ["1:3", "1:10"]
    },
    {
      "id": "1:10",
      "name": "Title",
      "figmaType": "TEXT",
      "parentId": "1:2",
      "rect": { "x": 35, "y": 80, "w": 320, "h": 40 },
      "unity": {
        "anchorMin": [0.5, 1],
        "anchorMax": [0.5, 1],
        "pivot": [0.5, 1],
        "sizeDelta": [320, 40],
        "localScale": [1, 1, 1]
      },
      "components": ["TextMeshProUGUI"],
      "text": {
        "content": "Welcome Back",
        "fontFamily": "Inter",
        "fontStyle": "Bold",
        "fontSize": 28,
        "color": [1, 1, 1, 1],
        "alignment": "TopCenter"
      },
      "interactive": false,
      "children": []
    }
  ],
  "assets": [],
  "fonts": [
    { "family": "Inter", "styles": ["Regular", "SemiBold", "Bold"] }
  ]
}
```
