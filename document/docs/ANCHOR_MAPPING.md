# Figma Constraint → Unity Anchor Mapping

## Concept

Figma dùng **constraints** (MIN/MAX/CENTER/STRETCH) để nói layer resize thế nào khi parent thay đổi.
Unity dùng **anchors** (anchorMin/anchorMax/pivot) cho mục đích tương tự.

Plugin convert Figma constraints → Unity anchors **tại thời điểm export**, để Unity Importer chỉ cần copy giá trị.

---

## Mapping Table

> Figma Y-axis: down = positive. Unity Y-axis: up = positive.
> → Cần flip Y khi convert.

### Horizontal Constraint

| Figma H | anchorMin.x | anchorMax.x | Behavior |
|---------|-------------|-------------|----------|
| `MIN` (Left) | `0` | `0` | Pin to left |
| `MAX` (Right) | `1` | `1` | Pin to right |
| `CENTER` | `0.5` | `0.5` | Center horizontally |
| `STRETCH` | `0` | `1` | Stretch full width |
| `SCALE` | proportional | proportional | Scale with parent |

### Vertical Constraint

| Figma V | anchorMin.y | anchorMax.y | Behavior |
|---------|-------------|-------------|----------|
| `MIN` (Top) | `1` | `1` | Pin to top (Y flipped!) |
| `MAX` (Bottom) | `0` | `0` | Pin to bottom |
| `CENTER` | `0.5` | `0.5` | Center vertically |
| `STRETCH` | `0` | `1` | Stretch full height |
| `SCALE` | proportional | proportional | Scale with parent |

### Combined Presets

| Figma (H, V) | Unity Anchor | anchorMin | anchorMax |
|--------------|-------------|-----------|-----------|
| MIN, MIN | Top-Left | [0, 1] | [0, 1] |
| CENTER, MIN | Top-Center | [0.5, 1] | [0.5, 1] |
| MAX, MIN | Top-Right | [1, 1] | [1, 1] |
| MIN, CENTER | Middle-Left | [0, 0.5] | [0, 0.5] |
| CENTER, CENTER | Middle-Center | [0.5, 0.5] | [0.5, 0.5] |
| MAX, CENTER | Middle-Right | [1, 0.5] | [1, 0.5] |
| MIN, MAX | Bottom-Left | [0, 0] | [0, 0] |
| CENTER, MAX | Bottom-Center | [0.5, 0] | [0.5, 0] |
| MAX, MAX | Bottom-Right | [1, 0] | [1, 0] |
| STRETCH, MIN | Top-Stretch | [0, 1] | [1, 1] |
| STRETCH, MAX | Bottom-Stretch | [0, 0] | [1, 0] |
| STRETCH, CENTER | Middle-Stretch | [0, 0.5] | [1, 0.5] |
| MIN, STRETCH | Left-Stretch | [0, 0] | [0, 1] |
| MAX, STRETCH | Right-Stretch | [1, 0] | [1, 1] |
| CENTER, STRETCH | Center-V-Stretch | [0.5, 0] | [0.5, 1] |
| STRETCH, STRETCH | Full Stretch | [0, 0] | [1, 1] |

---

## Offset Calculation

Khi anchor KHÔNG phải stretch, dùng `sizeDelta`:
```
sizeDelta = [element.width, element.height]
```

Khi anchor là stretch, tính `offsetMin`/`offsetMax`:
```
offsetMin.x = element.x - parent.x
offsetMin.y = parent.bottom - element.bottom  // Y flip
offsetMax.x = -(parent.right - element.right)
offsetMax.y = -(element.y - parent.y)          // Y flip
```

## Pivot

Default pivot = `[0.5, 0.5]` (center).

Exceptions:
- Text alignment left → pivot.x = 0
- Text alignment right → pivot.x = 1
- Top-anchored elements → pivot.y = 1
- Bottom-anchored elements → pivot.y = 0

---

## Auto-Layout → LayoutGroup

| Figma layoutMode | Unity Component |
|------------------|----------------|
| `HORIZONTAL` | `HorizontalLayoutGroup` |
| `VERTICAL` | `VerticalLayoutGroup` |
| `GRID` | `GridLayoutGroup` |
| `NONE` | No layout component |

| Figma Property | Unity Property |
|---------------|---------------|
| `paddingTop/Bottom/Left/Right` | `padding` |
| `itemSpacing` | `spacing` |
| `primaryAxisAlignItems` | `childAlignment` (axis) |
| `counterAxisAlignItems` | `childAlignment` (cross) |
