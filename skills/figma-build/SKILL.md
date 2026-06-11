---
name: figma-build
description: Use when the user asks to build a Unity screen/UI/prefab from a Figma URL (optionally with a doc/description) — orchestrates export_element (figma-mcp bridge) + FigmaHeadlessImporter (via utk exec), cleans up the hierarchy to Unity naming standards, then generates and wires C# scripts.
---

# figma-build — Figma URL → production-ready Unity object

## When to use
The user provides: a screen/element name + Figma URL (+ optionally a doc/behavior description).
Result: a GameObject/prefab built through the figma-to-unity pipeline, with a clean
Unity-standard hierarchy and scripts attached and wired.

## Prerequisites (check FIRST; stop and instruct the user if missing)
1. MCP bridge alive: call tool `get_metadata` — failure means Figma Desktop/plugin is not open.
2. `utk status` OK — failure means Unity is not open or `utk init` was not run.
   (`utk` = [Unity CLI AgentKit](https://github.com/zasuozz-oss/unity-cli-agentkit) —
   single-binary CLI controlling the Unity Editor from the terminal.)

## Workflow
1. **Parse input**: extract node-id from the URL (`?node-id=1234-5678`).
2. **Export**: call tool `export_element { figmaUrl }` — do NOT pass `outputDir`; the tool
   writes to `~/Desktop/FigmaImports/<element-name>` (OUTSIDE the Unity project — the
   importer copies textures into `Assets/` itself).
   Read the returned JSON: take `outputDir` and sanity-check `assetCount` — a UI with
   images must have `assetCount > 0`; a text-only frame can legitimately return 0
   (manifest.json is still written).
3. **Import**: pick the mode the user needs (default `Both` when they want a usable prefab):
   `utk exec 'return FigmaImporter.FigmaHeadlessImporter.Import("<outputDir from step 2>", "<mode>");'`
   Optional extra args: `prefabSavePath` (3rd, default `"Assets/Prefabs/UI/"`) and
   `spriteFolder` (4th) — override them if the target project keeps prefabs/sprites elsewhere.
   Check `success: true`; if false, read the `log` array to diagnose.
4. **Clean up hierarchy** (prefab hygiene — ALWAYS do this step, via `utk exec`):
   - **Rename every element to a Unity-standard English name.** Imported names come straight
     from Figma (often Vietnamese, lowercase, spaces, "Rectangle 95", "image 21") and are not
     acceptable. Use PascalCase, English-only, role-based names: `BtnConfirm`, `IconGem`,
     `TxtPrice`, `ImgCover`, `PnlItemList`, `ItemCard`. Translate non-English names by meaning,
     not transliteration. Common prefixes: `Btn` (button), `Img` (image), `Txt` (text),
     `Icon`, `Pnl` (panel/container), `Bg` (background).
   - **Delete empty elements.** A GameObject with no visual component (Image/TMP_Text/etc.),
     no meaningful children, or that exists only as a leftover Figma wrapper must be removed.
   - **Flatten useless wrappers.** When a container adds nothing (single child, no component,
     no layout role), move its real children up to the parent with
     `child.SetParent(parent, worldPositionStays: true)` so positions are preserved, then
     delete the wrapper.
   - Duplicated siblings (e.g. list items) should share the same base name: `ItemCard`,
     `ItemCard (1)`, ... or be renamed with indices if scripts need to address them.
   - If output mode included a prefab, re-save it after cleanup with
     `PrefabUtility.SaveAsPrefabAsset`.
5. **Generate scripts** (only when a doc/description is given): read the doc, write C#
   (View/Controller/handlers) into the target project's scripts folder (find the nearest
   `Scripts/` directory; ask if ambiguous).
   Rule: serialized field names must match the CLEANED-UP node names from step 4 so they can
   be wired by name.
6. **Attach & wire**: via `utk exec` — `AddComponent` on the root GO, assign each
   `[SerializeField]` using `transform.Find("<node/path>")`, save the prefab with
   `PrefabUtility.SaveAsPrefabAsset`.
7. **Verify**: clean compile (any `utk exec` returning a value = compiled) + no new errors in
   `utk console` + run EditMode tests if the project has them (`utk test`).

## Rules
- ALL element names in the final UI hierarchy must be English, Unity-style (PascalCase).
  No Figma raw names ("Rectangle 95", "Gói item...") may survive cleanup.
- Do the cleanup (step 4) BEFORE script generation (step 5) — field wiring depends on final names.
- Do NOT edit files inside the export folder (`~/Desktop/FigmaImports/<name>/`) — pipeline
  output; re-export overwrites it.
- Do NOT export into the Unity project's `Assets/` — the importer already creates Unity
  assets from the export folder.
- Do NOT add LayoutGroup/9-slice — the figma-to-unity repo removes them by design.
- Every `utk` command gets a finite timeout; after 3 failures → stop and report to the user
  with the output.
- Re-running the same element: export_element clears old files in the folder; import creates
  a NEW GameObject — remind the user to delete the old GO/prefab if they don't want duplicates.
