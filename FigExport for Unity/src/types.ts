// =============================================================================
// Types — Figma Plugin + Manifest Schema
// Based on MANIFEST_SPEC.md v1.0
// =============================================================================

// ---------------------------------------------------------------------------
// Figma-side types (used during traversal)
// ---------------------------------------------------------------------------

/** Raw data collected from a Figma node during DFS traversal. */
export interface FigmaElement {
    id: string;
    name: string;
    type: string; // FRAME, TEXT, RECTANGLE, VECTOR, GROUP, COMPONENT, INSTANCE, BOOLEAN_OPERATION
    parentId: string | null;
    rect: Rect;
    constraints: { horizontal: string; vertical: string };
    fills: ReadonlyArray<Paint> | typeof figma.mixed;
    cornerRadius: number;
    opacity: number;
    visible: boolean;
    text?: FigmaTextProps;
    children: string[];
    exportable: boolean; // true if has visual content worth exporting as PNG
    autoLayout?: AutoLayoutProps;
}

/** Text properties extracted from a Figma TEXT node. */
export interface FigmaTextProps {
    content: string;
    fontFamily: string;
    fontStyle: string;
    fontSize: number;
    color: RGBA;
    alignment: string;
    lineHeight?: number;
    letterSpacing?: number;
}

/** Auto-layout properties from a Figma FRAME. */
export interface AutoLayoutProps {
    layoutMode: 'HORIZONTAL' | 'VERTICAL' | 'NONE';
    paddingTop: number;
    paddingBottom: number;
    paddingLeft: number;
    paddingRight: number;
    itemSpacing: number;
    primaryAxisAlignItems: string;
    counterAxisAlignItems: string;
}

// ---------------------------------------------------------------------------
// Unity-side types (manifest output)
// ---------------------------------------------------------------------------

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export type RGBA = [number, number, number, number]; // 0-1 range

export interface UnityTransform {
    anchorMin: [number, number];
    anchorMax: [number, number];
    pivot: [number, number];
    sizeDelta?: [number, number];
    offsetMin?: [number, number];
    offsetMax?: [number, number];
    localScale: [number, number, number];
}

export interface Style {
    fill: RGBA;
    cornerRadius: number;
    opacity: number;
    shadow?: Shadow;
}

export interface Shadow {
    x: number;
    y: number;
    blur: number;
    color: RGBA;
}

export interface TextProps {
    content: string;
    fontFamily: string;
    fontStyle: string;
    fontSize: number;
    color: RGBA;
    alignment: string;
    lineHeight?: number;
    letterSpacing?: number;
}

// ---------------------------------------------------------------------------
// Manifest schema (final JSON output)
// ---------------------------------------------------------------------------

export interface ManifestData {
    version: string;
    exportDate: string;
    screen: Screen;
    elements: ElementData[];
    assets: AssetEntry[];
    fonts: FontEntry[];
}

export interface Screen {
    name: string;
    figmaSize: { w: number; h: number };
    unityRefResolution: { w: number; h: number };
    exportScale: number;
}

export interface ElementData {
    id: string;
    name: string;
    figmaType: string;
    parentId: string | null;
    rect: Rect;
    unity: UnityTransform;
    components: string[];
    style?: Style;
    text?: TextProps;
    asset: string | null;
    interactive: boolean;
    children: string[];
    merged?: boolean; // true if this element was merged (flattened with children)
    autoLayout?: AutoLayoutProps;
}

export interface AssetEntry {
    file: string;
    nodeId: string;
    scale: number;
}

export interface FontEntry {
    family: string;
    styles: string[];
}

// ---------------------------------------------------------------------------
// Export options (filter what gets exported)
// ---------------------------------------------------------------------------

export interface ExportOptions {
    includeText: boolean;
    includeImages: boolean;
    includeIcons: boolean;
    includeContainers: boolean;
    slimManifest: boolean; // strip redundant rect/fill for sprite elements
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
    includeText: true,
    includeImages: true,
    includeIcons: true,
    includeContainers: true,
    slimManifest: true,
};

/** Scale constraint for export. */
export interface ExportScale {
    type: 'SCALE' | 'WIDTH' | 'HEIGHT';
    value: number;
}

export const DEFAULT_EXPORT_SCALE: ExportScale = { type: 'SCALE', value: 2 };

// ---------------------------------------------------------------------------
// Layer tree element (main → UI on selection)
// ---------------------------------------------------------------------------

/** Lightweight element for the UI layer tree. */
export interface TreeElement {
    id: string;
    name: string;
    figmaType: string;
    depth: number;
    size: { w: number; h: number };
    hasAsset: boolean;
    hasChildren: boolean;
}

// ---------------------------------------------------------------------------
// Per-element config (UI → main on export)
// ---------------------------------------------------------------------------

export interface ElementConfig {
    id: string;
    excluded: boolean;   // true = skip entirely
    merge: boolean;      // true = flatten parent+children into one PNG
    exportAsPng: boolean; // true = export TEXT as rasterized PNG instead of TMP data
}

// ---------------------------------------------------------------------------
// Plugin communication messages
// ---------------------------------------------------------------------------

/** Messages from UI → main. */
export type UIToMainMessage =
    | { type: 'export'; scale: ExportScale; options: ExportOptions; elementConfigs: ElementConfig[] }
    | { type: 'preview-element'; nodeId: string; excludedIds: string[] }
    | { type: 'highlight-element'; nodeId: string }
    | { type: 'lock-canvas'; locked: boolean }
    | { type: 'toggle-visibility'; nodeId: string; visible: boolean }
    | { type: 'reset-all-visibility'; nodeIds: string[] }
    | { type: 'rename-elements'; renames: { nodeId: string; newName: string }[] }
    | { type: 'resize-ui'; width: number; height: number }
    | { type: 'export-single-png'; nodeId: string; scale: ExportScale }
    | { type: 'toggle-lock'; nodeId: string; locked: boolean }
    | { type: 'reload' }
    | { type: 'cancel' };

/** Messages from main → UI. */
export type MainToUIMessage =
    | { type: 'selection-info'; name: string; elementCount: number; tree: TreeElement[]; selectedChildId?: string; locked?: boolean }
    | { type: 'no-selection' }
    | { type: 'progress'; current: number; total: number; label: string }
    | { type: 'export-complete'; manifest: string; assets: ExportedAsset[] }
    | { type: 'export-error'; message: string }
    | { type: 'element-preview'; nodeId: string; name: string; figmaType: string; size: { w: number; h: number }; imageData: number[] }
    | { type: 'visibility-changed'; changes: { nodeId: string; visible: boolean }[] }
    | { type: 'lock-changed'; changes: { nodeId: string; locked: boolean }[] }
    | { type: 'single-png-ready'; nodeId: string; data: number[] }
    | { type: 'highlight-tree-element'; nodeId: string };

export interface ExportedAsset {
    name: string;
    data: number[];
}
