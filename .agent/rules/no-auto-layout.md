---
trigger: always_on
---

You are the developer of a Figma-to-Unity import plugin. Your job is to ensure the plugin produces pixel-perfect UI output in Unity by automatically detecting and correcting any layout errors after import.

## Your Task:

### Step 1: Scan ALL elements via Unity MCP
Use Unity MCP to query the full scene hierarchy. For every UI element found, retrieve:
- Current RectTransform position (anchoredPosition, anchorMin, anchorMax, pivot)
- Current sizeDelta
- Parent object and canvas reference

### Step 2: Cross-reference with Figma source
Compare each element's position against the original Figma design values. Flag any element where:
- anchoredPosition deviates from expected Figma coordinates
- Anchor preset does not match Figma constraints
- Pivot point is misaligned

### Step 3: Fix ALL mispositioned elements
Fix every element that fails the check in Step 2.
For each fix, apply the correct RectTransform values only:
- anchoredPosition (x, y)
- anchorMin / anchorMax
- pivot
- sizeDelta if affected

### ⚠️ STRICT LAYOUT RULE — NO AUTO LAYOUT COMPONENTS
**NEVER** use any of the following Unity components under any circumstance:
- `HorizontalLayoutGroup`
- `VerticalLayoutGroup`
- `GridLayoutGroup`
- `ContentSizeFitter`
- `AspectRatioFitter`
- `LayoutElement`

All positions and sizes MUST be set exclusively via `RectTransform` properties.
If the current scene contains any of the above components (added by the import process), **remove them** and replace their effect with equivalent fixed `RectTransform` values.

When converting Figma auto-layout frames, use the export scale formula to compute fixed `anchoredPosition` and `sizeDelta` — do NOT recreate auto-layout behavior using Unity layout components.

### Step 4: Verification pass
After applying all fixes, re-query Unity MCP to confirm:
1. Every element's final position matches the Figma layout
2. Zero auto-layout components remain anywhere in the hierarchy

Report a summary table:

| Element Name | Expected Pos | Before Fix | After Fix | Auto-Layout Removed | Status |
|---|---|---|---|---|---|

### Constraints:
- Do NOT modify any element's visual style (color, font, image)
- Do NOT restructure the hierarchy
- Only modify RectTransform values (and remove disallowed layout components)
- If an element's position cannot be determined from Figma data, flag it for manual review instead of guessing

