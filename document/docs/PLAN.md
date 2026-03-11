# Implementation Plan

## Architecture

```
┌──────────────────────┐          ┌───────────────────────────┐
│   FIGMA PLUGIN       │  .zip    │   UNITY EDITOR TOOL       │
│   (TypeScript)       │─────────▶│   (C# EditorWindow)       │
│                      │          │                           │
│ 1. Traverse nodes    │          │ 1. Parse manifest.json    │
│ 2. Map constraints   │          │ 2. Import textures        │
│ 3. Export PNGs       │          │ 3. Build hierarchy        │
│ 4. Generate JSON     │          │ 4. Add components         │
│ 5. ZIP download      │          │ 5. Assign sprites/styles  │
│                      │          │ 6. Save as prefab         │
└──────────────────────┘          └───────────────────────────┘
```

---

## Figma Plugin

### Structure
```
figma-plugin/
├── manifest.json       ← Figma plugin config
├── package.json
├── tsconfig.json
├── esbuild.config.mjs  ← Build script
├── src/
│   ├── main.ts         ← Entry: selection → traverse → export
│   ├── ui.html         ← Config panel UI
│   ├── ui.ts           ← Panel logic (send/receive messages)
│   ├── traverser.ts    ← Recursive DFS node walk
│   ├── mapper.ts       ← Figma constraints → Unity anchors
│   ├── exporter.ts     ← exportAsync PNG + assemble manifest
│   ├── naming.ts       ← Layer name → file name convention
│   └── types.ts        ← TypeScript interfaces
└── dist/
    ├── main.js         ← Bundled plugin code
    └── ui.html         ← Inlined UI
```

### manifest.json (Figma Plugin)
```json
{
  "name": "Figma to Unity",
  "id": "figma-to-unity-exporter",
  "api": "1.0.0",
  "main": "dist/main.js",
  "ui": "dist/ui.html",
  "editorType": ["figma"]
}
```

### Core Logic Flow
```typescript
// main.ts — simplified
figma.showUI(__html__, { width: 320, height: 480 });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'export') {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) return;

    const rootNode = selection[0];
    const elements = traverseNode(rootNode);     // traverser.ts
    const manifest = buildManifest(elements);     // mapper.ts
    const assets = await exportAssets(elements);  // exporter.ts

    figma.ui.postMessage({
      type: 'download',
      manifest: JSON.stringify(manifest, null, 2),
      assets: assets
    });
  }
};
```

### Key Modules

#### traverser.ts
```typescript
interface FigmaElement {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  rect: { x: number; y: number; w: number; h: number };
  constraints: { horizontal: string; vertical: string };
  fills: Paint[];
  cornerRadius: number;
  opacity: number;
  visible: boolean;
  text?: TextProperties;
  children: string[];
  exportable: boolean;  // true if has visual content
}

function traverseNode(node: SceneNode, parentId?: string): FigmaElement[] {
  // DFS traverse
  // Skip hidden nodes
  // Classify: FRAME, TEXT, VECTOR, RECTANGLE, GROUP
  // Determine exportable (has fills/strokes/effects)
  // Recurse into children
}
```

#### mapper.ts
```typescript
interface UnityTransform {
  anchorMin: [number, number];
  anchorMax: [number, number];
  pivot: [number, number];
  sizeDelta?: [number, number];
  offsetMin?: [number, number];
  offsetMax?: [number, number];
  localScale: [number, number, number];
}

function mapConstraintsToAnchors(
  element: FigmaElement,
  parentRect: Rect
): UnityTransform {
  // Convert Figma constraints (MIN/MAX/CENTER/STRETCH)
  // to Unity anchorMin/anchorMax/pivot
  // Calculate offsetMin/offsetMax from positions
}
```

#### exporter.ts
```typescript
async function exportAssets(
  elements: FigmaElement[]
): Promise<{ name: string; data: Uint8Array }[]> {
  const assets = [];
  for (const el of elements) {
    if (!el.exportable) continue;
    const node = figma.getNodeById(el.id);
    const bytes = await (node as ExportMixin).exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: 2 }
    });
    assets.push({
      name: generateFileName(el),  // naming.ts
      data: bytes
    });
  }
  return assets;
}
```

#### naming.ts
```typescript
function generateFileName(element: FigmaElement): string {
  const prefix = getPrefix(element);  // bg_, btn_, ic_, img_
  const name = sanitize(element.name); // snake_case, remove special chars
  return `${prefix}${name}@2x.png`;
}

function getPrefix(el: FigmaElement): string {
  if (el.type === 'VECTOR' || el.type === 'BOOLEAN_OPERATION') return 'ic_';
  if (el.name.toLowerCase().includes('button')) return 'btn_';
  if (el.name.toLowerCase().includes('background') || el.name.toLowerCase().includes('bg')) return 'bg_';
  if (el.type === 'RECTANGLE' && isFullWidth(el)) return 'bg_';
  return 'img_';
}

function sanitize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}
```

---

## Unity Importer

### Structure
```
unity-importer/
├── package.json                 ← UPM package manifest
├── Editor/
│   ├── FigmaImporterWindow.cs   ← EditorWindow UI
│   ├── ManifestParser.cs        ← JSON → C# data classes
│   ├── HierarchyBuilder.cs      ← Create GameObjects + components
│   ├── TextureImportHelper.cs   ← Import PNG → Sprite
│   ├── NineSliceDetector.cs     ← cornerRadius → sprite border
│   ├── ScriptBinder.cs          ← Auto-bind SerializeField
│   ├── AnchorApplier.cs         ← Apply unity.anchorMin/Max
│   └── Models/
│       ├── ManifestData.cs      ← Data classes
│       └── ElementData.cs
├── README.md
└── CHANGELOG.md
```

### UPM Package
```json
{
  "name": "com.figma-to-unity.importer",
  "version": "0.1.0",
  "displayName": "Figma to Unity Importer",
  "description": "Import Figma designs as Unity uGUI prefabs",
  "unity": "6000.0",
  "dependencies": {
    "com.unity.textmeshpro": "4.0.0"
  }
}
```

### Key Classes

#### FigmaImporterWindow.cs
```
EditorWindow with:
- Folder browser (select FigmaExport folder)
- Manifest info display (screen name, element count)
- Hierarchy tree preview
- Output mode toggle (Scene / Prefab / Both)
- Options checkboxes (9-slice, raycast, script bind)
- Build button + progress bar
- Per-element log
```

#### HierarchyBuilder.cs
```
Pipeline:
1. CreateRootGameObject()
2. For each element (BFS order):
   a. CreateGameObject(name, parent)
   b. AddComponent<RectTransform>()
   c. ApplyAnchorData(unity.anchorMin/Max/pivot/offsets)
   d. AddUIComponents(Image, Button, TMP based on components[])
   e. AssignSprite(asset filename)
   f. ApplyStyle(fill color, opacity)
   g. SetRaycastTarget(interactive)
3. If text element:
   a. AddComponent<TextMeshProUGUI>()
   b. Set text.content, fontSize, fontFamily, color, alignment
4. SaveAsPrefab() or keep in Scene
```

#### NineSliceDetector.cs
```
Input: cornerRadius (from manifest)
Logic:
- If cornerRadius > 0:
  - Set sprite border = (radius, radius, radius, radius)
  - Set Image.type = Sliced
  - Set Image.pixelsPerUnit to match
```

#### ScriptBinder.cs
```
Logic:
1. Find MonoBehaviour scripts on root (or add if specified)
2. Get all [SerializeField] fields via reflection
3. For each field:
   - Match field name to element name (fuzzy: _loginButton → LoginButton)
   - If match → assign reference via SerializedObject
4. Log bound/unbound fields
```

---

## Phases

### Phase 1 — Figma Plugin MVP
- [ ] Project setup (TypeScript, esbuild)
- [ ] Node traversal (DFS, skip hidden)
- [ ] PNG export @2x
- [ ] Manifest.json generation (rect, hierarchy, basic styles)
- [ ] Naming convention
- [ ] UI panel (export button, options)
- [ ] ZIP assembly + download

### Phase 2 — Unity Importer MVP
- [ ] UPM package setup
- [ ] ManifestParser (JSON → C# data)
- [ ] TextureImportHelper (PNG → Sprite)
- [ ] HierarchyBuilder (create objects, RectTransform, Image, TMP)
- [ ] EditorWindow UI (folder browse, build button, log)
- [ ] Scene + Prefab output mode

### Phase 3 — Smart Features
- [ ] Constraint → anchor mapping (plugin-side)
- [ ] Auto-layout → LayoutGroup mapping
- [ ] 9-slice auto-detection
- [ ] Auto script binding
- [ ] RaycastTarget optimization
- [ ] Multi-scale export (1x, 2x, 3x)
- [ ] Font matching/fallback

### Phase 4 — Polish + MCP
- [ ] Error handling + validation
- [ ] Settings persistence (both sides)
- [ ] Progress reporting
- [ ] MCP workflow `/build from-figma`
- [ ] Figma Community publish
- [ ] Documentation
