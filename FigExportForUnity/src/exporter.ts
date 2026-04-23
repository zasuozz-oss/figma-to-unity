// =============================================================================
// Exporter — Export PNGs + Assemble Manifest
// Supports per-element exclude and merge (flatten parent+children into one PNG)
// =============================================================================

import type {
    FigmaElement,
    ManifestData,
    ElementData,
    AssetEntry,
    FontEntry,
    ExportedAsset,
    Style,
    TextProps,
    RGBA,
    Rect,
    AssetBounds,
    ExportOptions,
    ExportScale,
    ElementConfig,

} from './types';
import { DEFAULT_EXPORT_OPTIONS, DEFAULT_EXPORT_SCALE } from './types';
import { traverseNode, hasVisibleStroke } from './traverser';
import { mapConstraintsToAnchors, determineComponents, isInteractive } from './mapper';
import { generateFileName, fallbackName } from './naming';

export interface ExportResult {
    manifest: ManifestData;
    assets: ExportedAsset[];
}

interface PngExportResult {
    bytes: Uint8Array;
    assetBounds: AssetBounds;
}

/**
 * Main export pipeline with merge + exclude support.
 */
export async function exportDesign(
    rootNode: SceneNode,
    scale: ExportScale = DEFAULT_EXPORT_SCALE,
    onProgress?: (current: number, total: number, label: string) => void,
    options: ExportOptions = DEFAULT_EXPORT_OPTIONS,
    configs: ElementConfig[] = [],
): Promise<ExportResult> {
    // Step 1: Traverse
    if (onProgress) onProgress(0, 1, 'Traversing node tree...');
    const allElements = traverseNode(rootNode);

    // Build config lookup maps
    const excludeSet = new Set<string>();
    const mergeSet = new Set<string>();
    const exportAsPngSet = new Set<string>();
    for (var i = 0; i < configs.length; i++) {
        if (configs[i].excluded) excludeSet.add(configs[i].id);
        if (configs[i].merge) mergeSet.add(configs[i].id);
        if (configs[i].exportAsPng) exportAsPngSet.add(configs[i].id);
    }

    // Build merged-children set (children of merged parents get skipped)
    const mergedChildSet = new Set<string>();
    const parentMap = new Map<string, string>(); // id -> parentId
    for (var i = 0; i < allElements.length; i++) {
        if (allElements[i].parentId) {
            parentMap.set(allElements[i].id, allElements[i].parentId!);
        }
        // Figma locked nodes intentionally mean merge=true in this workflow.
        if (!mergeSet.has(allElements[i].id)) {
            var fNode = figma.getNodeById(allElements[i].id);
            if (fNode && 'locked' in fNode && (fNode as any).locked) {
                mergeSet.add(allElements[i].id);
            }
        }
    }
    // Propagate: if parent is merged or is a merged-child, mark this as merged-child
    for (var i = 0; i < allElements.length; i++) {
        var elId = allElements[i].id;
        var pId = parentMap.get(elId);
        if (pId && (mergeSet.has(pId) || mergedChildSet.has(pId))) {
            mergedChildSet.add(elId);
        }
    }

    // Step 2: Filter elements
    var figmaElements = [];
    var hiddenSubtreeSet = new Set<string>();
    for (var i = 0; i < allElements.length; i++) {
        var el = allElements[i];

        // Skip hidden elements and their entire subtree
        // This handles component variant state branches (ON/OFF) where
        // only the active state is visible in the Figma design.
        if (el.parentId && hiddenSubtreeSet.has(el.parentId)) {
            hiddenSubtreeSet.add(el.id);
            continue;
        }
        if (!el.visible && i > 0) {
            hiddenSubtreeSet.add(el.id);
            continue;
        }

        // Skip excluded elements
        if (excludeSet.has(el.id)) continue;

        // Skip merged children (they're part of parent's flattened PNG)
        if (mergedChildSet.has(el.id)) continue;

        // Apply type-based filters (skip root)
        if (i > 0 && !shouldIncludeElement(el, options)) continue;

        figmaElements.push(el);
    }

    const figmaElementById = new Map<string, FigmaElement>();
    for (var i = 0; i < figmaElements.length; i++) {
        figmaElementById.set(figmaElements[i].id, figmaElements[i]);
    }

    const suppressedStateIds = new Set<string>();
    for (var i = 0; i < figmaElements.length; i++) {
        var stateParent = figmaElements[i];
        var stateChildIds = stateParent.children.filter(function (cid) {
            var child = figmaElementById.get(cid);
            return child ? isBinaryStateName(child.name) : false;
        });

        if (stateChildIds.length < 2) continue;

        var chosenStateId = pickActiveStateChild(stateParent, stateChildIds, figmaElementById);
        for (var s = 0; s < stateChildIds.length; s++) {
            var stateId = stateChildIds[s];
            if (stateId === chosenStateId) continue;
            collectSubtreeIds(stateId, figmaElementById, suppressedStateIds);
        }
    }

    if (suppressedStateIds.size > 0) {
        figmaElements = figmaElements.filter(function (el) {
            return !suppressedStateIds.has(el.id);
        });
    }

    // Build parent rect lookup for anchor mapping
    const rectMap = new Map<string, Rect>();
    for (var i = 0; i < figmaElements.length; i++) {
        rectMap.set(figmaElements[i].id, figmaElements[i].rect);
    }
    const includedElementIds = new Set<string>();
    for (var i = 0; i < figmaElements.length; i++) {
        includedElementIds.add(figmaElements[i].id);
    }

    // Step 3: Build manifest elements + collect assets to export
    const elements: ElementData[] = [];
    const assetsToExport: { element: FigmaElement; fileName: string; isMerged: boolean }[] = [];
    const assetNameCounts = new Map<string, number>();
    const fontMap = new Map<string, Set<string>>();
    const scaleNum = scale.type === 'SCALE' ? scale.value : 1;

    const rootRect: Rect = { x: 0, y: 0, w: rootNode.width, h: rootNode.height };

    // Build parent type lookup for coordinate adjustment
    // Figma GROUPs don't create their own coordinate space — children of a GROUP
    // have coordinates relative to the GROUP's parent (e.g., the FRAME above it).
    // We need to convert these to be relative to the GROUP itself.
    for (var i = 0; i < figmaElements.length; i++) {
        var el = figmaElements[i];
        var parentRect = el.parentId ? rectMap.get(el.parentId) || rootRect : rootRect;

        var relativeRect: Rect = el.rect;

        // Pass parent rect with zeroed position (mapper only needs width/height)
        var mappingElement = { ...el, rect: relativeRect };
        var mappingParent: Rect = { x: 0, y: 0, w: parentRect.w, h: parentRect.h };
        var unity = mapConstraintsToAnchors(mappingElement as FigmaElement, mappingParent);
        var components = determineComponents(el);
        var isMerged = mergeSet.has(el.id);

        // Root element (no parent) is a container — strip Image component and style
        // to prevent it from rendering a fill that covers child elements
        var isRoot = !el.parentId;
        if (isRoot) {
            var imgIdx = components.indexOf('Image');
            if (imgIdx >= 0) components.splice(imgIdx, 1);
        }

        // Determine if this element should be exported as PNG
        // Root element (no parent) is never exported as PNG — it's the container
        // TEXT nodes: only export as PNG if per-element exportAsPng config is set
        var shouldExportPng: boolean;
        var isTextAsPng = el.type === 'TEXT' && exportAsPngSet.has(el.id);
        if (!el.parentId) {
            // Root is never auto-exported to prevent massive full-screen background PNGs,
            // unless it is explicitly merged/locked.
            shouldExportPng = isMerged;
        } else if (el.type === 'TEXT') {
            shouldExportPng = isTextAsPng;
        } else {
            shouldExportPng = el.exportable || isMerged;
        }

        var assetFile: string | null = null;
        if (shouldExportPng) {
            var fileName = generateFileName(el, scaleNum, rootNode.name);
            var duplicateCount = assetNameCounts.get(fileName) || 0;
            assetNameCounts.set(fileName, duplicateCount + 1);

            if (duplicateCount > 0) {
                var dotIndex = fileName.lastIndexOf('.');
                var baseName = dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName;
                var extension = dotIndex >= 0 ? fileName.slice(dotIndex) : '';
                fileName = baseName + '_' + duplicateCount + extension;
            }

            assetFile = fileName;
            assetsToExport.push({
                element: el, fileName: fileName, isMerged: isMerged,
            });

            // Ensure elements with asset always have Image component
            if (components.indexOf('Image') < 0 && el.type !== 'TEXT') {
                components.unshift('Image');
            }
        }

        // Collect font info
        if (el.text) {
            var family = el.text.fontFamily;
            var style = el.text.fontStyle;
            if (!fontMap.has(family)) fontMap.set(family, new Set());
            fontMap.get(family)!.add(style);
        }

        // For merged parents: clear ALL children (fully flattened into parent PNG)
        var childrenIds = isMerged ? [] : el.children.filter(function (cid) {
            return includedElementIds.has(cid)
                && !hiddenSubtreeSet.has(cid)
                && !excludeSet.has(cid)
                && !mergedChildSet.has(cid);
        });

        // Layout group stripping removed — auto-layout components are no longer generated

        // Build element data
        // For TEXT exported as PNG: swap TextMeshProUGUI → Image, strip text data
        var elementText = el.text ? {
            content: el.text.content,
            fontFamily: el.text.fontFamily,
            fontStyle: el.text.fontStyle,
            fontSize: el.text.fontSize,
            color: el.text.color,
            alignment: el.text.alignment,
            lineHeight: el.text.lineHeight,
            letterSpacing: el.text.letterSpacing,
        } : undefined;

        if (isTextAsPng) {
            // Replace TMP with Image component
            var tmpIdx = components.indexOf('TextMeshProUGUI');
            if (tmpIdx >= 0) components[tmpIdx] = 'Image';
            // Strip text data — Unity will use the PNG image instead
            elementText = undefined;
        }



        elements.push({
            id: el.id,
            name: el.name,
            figmaType: el.type,
            parentId: el.parentId,
            rect: el.rect,
            unity: unity,
            components: components,
            style: isRoot ? undefined : extractStyle(el),
            text: elementText,
            asset: assetFile,
            assetBounds: undefined,
            interactive: isInteractive(el),
            children: childrenIds,
            merged: isMerged || undefined,
            autoLayout: el.autoLayout || undefined,
            clipsContent: el.clipsContent || undefined,

        });
    }

    // Step 4: Export PNGs with hash-based deduplication
    const assets: ExportedAsset[] = [];
    const assetEntries: AssetEntry[] = [];
    const total = assetsToExport.length;

    // Hash map: hash → fileName (for dedup)
    const hashToFile = new Map<string, string>();
    // Track element id → actual fileName for dedup back-fill
    const elementIdToFile = new Map<string, string>();
    const elementIdToAssetBounds = new Map<string, AssetBounds>();
    var dedupCount = 0;
    var suspiciousExportCount = 0;

    for (var i = 0; i < assetsToExport.length; i++) {
        var item = assetsToExport[i];
        if (onProgress) onProgress(i + 1, total, 'Exporting: ' + item.element.name + (item.isMerged ? ' (merged)' : ''));

        try {
            var node = figma.getNodeById(item.element.id);
            if (node && 'exportAsync' in node) {
                // Hide exportable descendants before export (exportAsync renders
                // ALL visible children — they would burn into parent PNG).
                // This hides: non-PNG text nodes + all other exportable children
                // that will have their own separate PNG assets.
                var hiddenNodes: { node: SceneNode; wasVisible: boolean }[] = [];
                var unclippedAncestors: { node: { clipsContent: boolean }; wasClipsContent: boolean }[] = [];
                if (!item.isMerged && 'children' in node) {
                    hideExportableDescendants(
                        node as ChildrenMixin & SceneNode,
                        exportAsPngSet,
                        mergeSet,
                        hiddenNodes
                    );
                }

                // Export the node's full Figma-rendered pixels. Ancestor clipping is
                // represented in Unity by RectMask2D, so baking it into child PNGs
                // makes scroll/offscreen items permanently cropped.
                disableAncestorClippingForExport(node as SceneNode, unclippedAncestors);

                var exportScale = scale;

                var exportResult: PngExportResult;
                try {
                    var bytes = await (node as ExportMixin).exportAsync({
                        format: 'PNG',
                        contentsOnly: true,
                        constraint: { type: exportScale.type, value: exportScale.value },
                    });
                    exportResult = {
                        bytes: bytes,
                        assetBounds: getNativeAssetBounds(node as SceneNode, item.element, bytes, scaleNum),
                    };
                } finally {
                    // Restore visibility safely
                    for (var h = 0; h < hiddenNodes.length; h++) {
                        try { hiddenNodes[h].node.visible = hiddenNodes[h].wasVisible; } catch (e) { }
                    }
                    for (var c = 0; c < unclippedAncestors.length; c++) {
                        try { unclippedAncestors[c].node.clipsContent = unclippedAncestors[c].wasClipsContent; } catch (e) { }
                    }
                }

                if (shouldWarnSuspiciousExport(item.element, exportResult.bytes, scaleNum, node as SceneNode)) {
                    suspiciousExportCount++;
                    logSuspiciousExport(item.element, exportResult.bytes, scaleNum);
                }

                // Compute simple hash (FNV-1a) for dedup
                var hash = hashBytes(exportResult.bytes);
                var existingFile = hashToFile.get(hash);

                if (existingFile) {
                    // Duplicate detected — reuse existing asset file
                    dedupCount++;
                    elementIdToFile.set(item.element.id, existingFile);
                    elementIdToAssetBounds.set(item.element.id, exportResult.assetBounds);
                    if (onProgress) onProgress(i + 1, total, 'Skipped duplicate: ' + item.element.name);

                    assetEntries.push({
                        file: existingFile,
                        nodeId: item.element.id,
                        scale: scaleNum,
                    });
                } else {
                    // New unique asset
                    hashToFile.set(hash, item.fileName);
                    elementIdToFile.set(item.element.id, item.fileName);
                    elementIdToAssetBounds.set(item.element.id, exportResult.assetBounds);

                    assets.push({
                        name: item.fileName,
                        data: Array.from(exportResult.bytes),
                    });

                    assetEntries.push({
                        file: item.fileName,
                        nodeId: item.element.id,
                        scale: scaleNum,
                    });
                }
            }
        } catch (err) {
            console.error('[Export] Failed to export "' + item.element.name + '":', err);
        }
    }

    // Back-fill element asset references for deduped items
    for (var i = 0; i < elements.length; i++) {
        var actualFile = elementIdToFile.get(elements[i].id);
        if (actualFile && elements[i].asset !== actualFile) {
            elements[i].asset = actualFile;
        }
        var actualAssetBounds = elementIdToAssetBounds.get(elements[i].id);
        if (actualAssetBounds) {
            elements[i].assetBounds = actualAssetBounds;
        }
    }

    if (dedupCount > 0) {
        console.log('[Export] Deduplication: ' + dedupCount + ' duplicate asset(s) skipped');
    }
    if (suspiciousExportCount > 0) {
        console.warn('[Export] Suspicious PNG assets: ' + suspiciousExportCount + ' asset(s) may be clipped or empty');
    }

    // Step 5: Build fonts list
    const fonts: FontEntry[] = [];
    fontMap.forEach(function (styles, family) {
        fonts.push({ family: family, styles: Array.from(styles) });
    });

    // Step 6: Assemble manifest
    const manifest: ManifestData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        screen: {
            name: rootNode.name,
            figmaSize: { w: rootNode.width, h: rootNode.height },
            unityRefResolution: computeUnityResolution(rootNode.width, rootNode.height, scaleNum),
            exportScale: scaleNum,
        },
        elements: elements,
        assets: assetEntries,
        fonts: fonts,
    };

    // Step 7: Slim manifest (strip redundant data for sprite elements)
    if (options.slimManifest) {
        var slimCount = 0;
        for (var si = 0; si < manifest.elements.length; si++) {
            var slimEl = manifest.elements[si];
            // Elements with sprites don't need rect position (Unity uses anchors)
            // but we preserve w/h for fallback sizing
            if (slimEl.asset) {
                slimEl.rect = { x: 0, y: 0, w: slimEl.rect.w, h: slimEl.rect.h };
                // Strip fill for sprite elements (sprite renders its own visuals)
                if (slimEl.style) {
                    delete (slimEl.style as any).fill;
                    // If style is now empty (no cornerRadius, opacity=1), remove it
                    if (slimEl.style.cornerRadius === 0 && slimEl.style.opacity === 1
                        && !slimEl.style.shadow) {
                        slimEl.style = undefined;
                    }
                }
                slimCount++;
            }
            // Strip children array if empty (save JSON bytes)
            if (slimEl.children && slimEl.children.length === 0) {
                (slimEl as any).children = undefined;
            }
        }
        if (slimCount > 0) {
            console.log('[Export] Slim manifest: stripped redundant data for ' + slimCount + ' sprite element(s)');
        }
    }

    return { manifest: manifest, assets: assets };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractStyle(element: FigmaElement): Style | undefined {
    var fill = extractFillColor(element);
    if (!fill && element.cornerRadius === 0 && element.opacity === 1) {
        return undefined;
    }
    return {
        fill: fill || [1, 1, 1, 1] as RGBA,
        cornerRadius: element.cornerRadius,
        opacity: element.opacity,
    };
}

function extractFillColor(element: FigmaElement): RGBA | null {
    if (!element.fills || element.fills === figma.mixed) return null;

    var solidFill: any = null;
    var fills = element.fills as ReadonlyArray<Paint>;
    for (var i = 0; i < fills.length; i++) {
        if (fills[i].type === 'SOLID' && fills[i].visible !== false) {
            solidFill = fills[i];
            break;
        }
    }

    if (solidFill) {
        return [
            Math.round(solidFill.color.r * 1000) / 1000,
            Math.round(solidFill.color.g * 1000) / 1000,
            Math.round(solidFill.color.b * 1000) / 1000,
            solidFill.opacity != null ? solidFill.opacity : 1,
        ];
    }
    return null;
}

function computeUnityResolution(w: number, h: number, exportScale: number): { w: number; h: number } {
    // Unity reference resolution = Figma design size × export scale
    // This ensures sprites render at native resolution (1:1 pixel mapping)
    var scale = exportScale > 0 ? exportScale : 1;
    return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

function shouldIncludeElement(el: FigmaElement, options: ExportOptions): boolean {
    if (el.type === 'TEXT') return options.includeText;
    if (el.type === 'VECTOR' || el.type === 'BOOLEAN_OPERATION' || el.type === 'LINE'
        || el.type === 'ELLIPSE' || el.type === 'POLYGON' || el.type === 'STAR') return options.includeIcons;
    var containerTypes = ['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'];
    if (containerTypes.indexOf(el.type) >= 0 && !el.exportable) return options.includeContainers;
    return options.includeImages;
}

/**
 * Temporarily hide descendants that would be baked into parent PNG.
 * Hides: non-PNG text nodes + exportable children (VECTOR, BOOLEAN_OPERATION,
 * filled frames, etc.) that will have their own separate PNG assets.
 * This prevents double rendering in Unity.
 */
function hideExportableDescendants(
    parent: ChildrenMixin & SceneNode,
    exportAsPngSet: Set<string>,
    mergeSet: Set<string>,
    hidden: { node: SceneNode; wasVisible: boolean }[]
): void {
    for (var i = 0; i < parent.children.length; i++) {
        var child = parent.children[i];
        if (!child.visible) continue;

        // If this child is explicitly MERGED (locked or set in UI), it is a standalone PNG!
        // We MUST hide it fully so it doesn't bake into parent, and do NOT recurse.
        if (mergeSet.has(child.id)) {
            hidden.push({ node: child, wasVisible: true });
            try { child.visible = false; } catch (e) { }
            continue;
        }

        // Hide non-PNG text (will be TextMeshPro in Unity)
        if (child.type === 'TEXT' && !exportAsPngSet.has(child.id)) {
            hidden.push({ node: child, wasVisible: true });
            try { child.visible = false; } catch (e) { }
            continue;
        }

        // Hide exportable non-text children (VECTOR, icons, filled frames, etc.)
        // They will get their own PNG assets → don't bake into parent
        if (child.type !== 'TEXT' && isChildExportable(child)) {
            hidden.push({ node: child, wasVisible: true });
            try { child.visible = false; } catch (e) { }
            continue;
        }

        // Recurse into container children
        if ('children' in child) {
            hideExportableDescendants(
                child as ChildrenMixin & SceneNode,
                exportAsPngSet,
                mergeSet,
                hidden
            );
        }
    }
}

function disableAncestorClippingForExport(
    node: SceneNode,
    changed: { node: { clipsContent: boolean }; wasClipsContent: boolean }[]
): void {
    var parent = (node as any).parent;
    while (parent && parent.type !== 'PAGE') {
        if ('clipsContent' in parent && parent.clipsContent === true) {
            changed.push({ node: parent as { clipsContent: boolean }, wasClipsContent: true });
            try { parent.clipsContent = false; } catch (e) { }
        }
        parent = parent.parent;
    }
}

/** Check if a child node would be exported as its own PNG */
function isChildExportable(node: SceneNode): boolean {
    if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION' || node.type === 'LINE'
        || node.type === 'ELLIPSE' || node.type === 'POLYGON' || node.type === 'STAR') return true;
    if (node.type === 'GROUP' || node.type === 'FRAME' || node.type === 'INSTANCE' || node.type === 'COMPONENT') {
        if (isIconContainer(node)) return true;
    }
    // Frames/instances with visible fills are exportable
    if ('fills' in node) {
        var fills = (node as any).fills;
        if (fills && fills !== figma.mixed) {
            var hasVisibleFill = (fills as ReadonlyArray<Paint>).some(
                (f: Paint) => f.visible !== false
            );
            if (hasVisibleFill) return true;
        }
    }
    if (hasVisibleStroke(node)) return true;
    return false;
}

/**
 * FNV-1a hash for Uint8Array — fast, good distribution for dedup.
 * Returns a hex string.
 */
function hashBytes(data: Uint8Array): string {
    var h = 0x811c9dc5 | 0; // FNV offset basis (32-bit)
    for (var i = 0; i < data.length; i++) {
        h ^= data[i];
        h = Math.imul(h, 0x01000193); // FNV prime
    }
    // Convert to unsigned 32-bit then hex
    return (h >>> 0).toString(16).padStart(8, '0');
}

function shouldWarnSuspiciousExport(
    element: FigmaElement,
    bytes: Uint8Array,
    exportScale: number,
    node?: SceneNode
): boolean {
    var pngSize = readPngSize(bytes);
    if (!pngSize) return true;

    if (pngSize.w <= 1 || pngSize.h <= 1) return true;

    if (node && isVectorLikeRasterNode(node) && hasVisibleStroke(node)) {
        return false;
    }

    var expected = getExpectedPngSize(element, exportScale);
    return pngSize.w < expected.w - 2 || pngSize.h < expected.h - 2;
}

function logSuspiciousExport(
    element: FigmaElement,
    bytes: Uint8Array,
    exportScale: number
): void {
    var expected = getExpectedPngSize(element, exportScale);
    var pngSize = readPngSize(bytes);
    var actual = pngSize ? (pngSize.w + 'x' + pngSize.h) : 'unknown';
    console.warn(
        '[Export] Suspicious PNG for "' + element.name + '"'
        + ' node=' + element.id
        + ' expected~=' + expected.w + 'x' + expected.h
        + ' actual=' + actual
    );
}

function isVectorLikeRasterNode(node: SceneNode): boolean {
    return node.type === 'VECTOR'
        || node.type === 'LINE'
        || node.type === 'ELLIPSE'
        || node.type === 'RECTANGLE'
        || node.type === 'POLYGON'
        || node.type === 'STAR';
}

function getExpectedPngSize(element: FigmaElement, exportScale: number): { w: number; h: number } {
    return {
        w: Math.max(1, Math.round(element.rect.w * exportScale)),
        h: Math.max(1, Math.round(element.rect.h * exportScale)),
    };
}

function readPngSize(bytes: Uint8Array): { w: number; h: number } | null {
    if (!bytes || bytes.length < 24) return null;
    if (bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71) return null;

    var width = (((bytes[16] << 24) >>> 0) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
    var height = (((bytes[20] << 24) >>> 0) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
    return { w: width, h: height };
}

interface AbsoluteBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

function getNativeAssetBounds(
    node: SceneNode,
    element: FigmaElement,
    bytes: Uint8Array,
    exportScale: number
): AssetBounds {
    var layoutBounds = getAbsoluteLayoutBounds(node, element);
    var renderBounds = getAbsoluteRenderBounds(node, layoutBounds);
    return normalizeAssetBoundsToPngSize(
        {
            x: renderBounds.x - layoutBounds.x,
            y: renderBounds.y - layoutBounds.y,
            w: renderBounds.width,
            h: renderBounds.height,
            pixelWidth: 0,
            pixelHeight: 0,
            exportScale: exportScale,
        },
        bytes,
        exportScale,
        element
    );
}

function normalizeAssetBoundsToPngSize(
    bounds: AssetBounds,
    bytes: Uint8Array,
    exportScale: number,
    element: FigmaElement
): AssetBounds {
    var pngSize = readPngSize(bytes);
    var scaleValue = exportScale > 0.01 ? exportScale : 1;
    if (!pngSize) {
        return {
            x: bounds.x,
            y: bounds.y,
            w: bounds.w,
            h: bounds.h,
            pixelWidth: Math.max(1, Math.round(bounds.w * scaleValue)),
            pixelHeight: Math.max(1, Math.round(bounds.h * scaleValue)),
            exportScale: exportScale,
        };
    }

    var pngWidth = pngSize.w / scaleValue;
    var pngHeight = pngSize.h / scaleValue;
    var normalized = {
        x: bounds.x + (bounds.w - pngWidth) * 0.5,
        y: bounds.y + (bounds.h - pngHeight) * 0.5,
        w: pngWidth,
        h: pngHeight,
        pixelWidth: pngSize.w,
        pixelHeight: pngSize.h,
        exportScale: exportScale,
    };

    return normalized;
}

function getAbsoluteLayoutBounds(node: SceneNode, element: FigmaElement): AbsoluteBounds {
    var rawBounds = (node as any).absoluteBoundingBox;
    if (isValidAbsoluteBounds(rawBounds)) {
        return rawBounds as AbsoluteBounds;
    }

    return {
        x: element.rect.x,
        y: element.rect.y,
        width: element.rect.w,
        height: element.rect.h,
    };
}

function getAbsoluteRenderBounds(node: SceneNode, fallback: AbsoluteBounds): AbsoluteBounds {
    var rawBounds = (node as any).absoluteRenderBounds;
    if (isValidAbsoluteBounds(rawBounds)) {
        return rawBounds as AbsoluteBounds;
    }

    return fallback;
}

function isValidAbsoluteBounds(value: any): value is AbsoluteBounds {
    return !!value
        && typeof value.x === 'number'
        && typeof value.y === 'number'
        && typeof value.width === 'number'
        && typeof value.height === 'number'
        && value.width > 0
        && value.height > 0;
}

function isBinaryStateName(name: string): boolean {
    var normalized = (name || '').trim().toUpperCase();
    return normalized === 'ON' || normalized === 'OFF';
}

function pickActiveStateChild(
    parent: FigmaElement,
    stateChildIds: string[],
    elementById: Map<string, FigmaElement>
): string {
    if (parent.type === 'COMPONENT') {
        return stateChildIds[0];
    }

    for (var i = stateChildIds.length - 1; i >= 0; i--) {
        if (elementById.has(stateChildIds[i])) {
            return stateChildIds[i];
        }
    }

    return stateChildIds[0];
}

function collectSubtreeIds(
    rootId: string,
    elementById: Map<string, FigmaElement>,
    suppressedIds: Set<string>
): void {
    if (suppressedIds.has(rootId)) return;
    suppressedIds.add(rootId);

    var element = elementById.get(rootId);
    if (!element || !element.children) return;

    for (var i = 0; i < element.children.length; i++) {
        collectSubtreeIds(element.children[i], elementById, suppressedIds);
    }
}
