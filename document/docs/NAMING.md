# Naming Convention

## Asset File Naming

### Format
```
<prefix>_<sanitized_name>@<scale>x.png
```

### Prefixes

| Prefix | Dùng cho | Ví dụ |
|--------|---------|-------|
| `bg_` | Background, panel, overlay | `bg_login_panel@2x.png` |
| `btn_` | Button graphic | `btn_primary@2x.png` |
| `ic_` | Icon, vector graphic | `ic_google@2x.png` |
| `img_` | Image, illustration, photo | `img_hero_banner@2x.png` |
| `spr_` | Game sprite | `spr_coin@2x.png` |

### Auto-Detection Rules

```
1. VECTOR, BOOLEAN_OPERATION → ic_
2. Layer name contains "button" or "btn" → btn_
3. Layer name contains "background" or "bg" → bg_
4. Layer name contains "icon" or "ic" → ic_
5. RECTANGLE that spans full width → bg_
6. Default → img_
```

### Name Sanitization

| Input | Output |
|-------|--------|
| `Login Button` | `login_button` |
| `BG-Header (Light)` | `bg_header_light` |
| `icon/Google` | `google` |
| `___test___` | `test` |
| `Кнопка` | `knopka` (transliterate or hash) |

Rules:
1. Lowercase
2. Replace non-alphanumeric with `_`
3. Collapse multiple `_` into one
4. Strip leading/trailing `_`
5. If empty after sanitize → use `element_<id>`

### Scale Suffix

| Scale | Suffix | Use case |
|-------|--------|----------|
| 1x | `@1x` | Low-res preview |
| 2x | `@2x` | Standard mobile (default) |
| 3x | `@3x` | High-DPI mobile |

---

## manifest.json Element Naming

Element names in `manifest.json` keep the **original Figma layer name** (not sanitized), so Unity importer can display readable names in the hierarchy.

Only **asset filenames** use the sanitized convention.
