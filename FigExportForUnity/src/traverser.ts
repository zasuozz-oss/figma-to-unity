// =============================================================================
// Traverser — DFS Node Traversal
// Walks the Figma node tree and collects FigmaElement data.
// =============================================================================

import type { FigmaElement, FigmaTextProps, RGBA, AutoLayoutProps, Rect } from './types';

/**
 * Traverse a Figma node tree using depth-first search.
 * Returns a flat array of FigmaElement, maintaining parent-child relationships via IDs.
 *
 * @param rootNode - The selected Figma node (typically a Frame/Component)
 * @returns Flat array of all visible elements
 */
export function traverseNode(rootNode: SceneNode): FigmaElement[] {
    const elements: FigmaElement[] = [];
    walkNode(rootNode, null, elements);
    return elements;
}

// ---------------------------------------------------------------------------
// Recursive DFS walker
// ---------------------------------------------------------------------------

function walkNode(
    node: SceneNode,
    parentId: string | null,
    elements: FigmaElement[]
): void {
    // Include all nodes (visible and hidden) — UI will auto-exclude hidden ones

    const element = extractElement(node, parentId);
    elements.push(element);

    // Recurse into children if the node has them
    if ('children' in node) {
        const container = node as ChildrenMixin & SceneNode;
        for (const child of container.children) {
            walkNode(child, node.id, elements);
        }
        // Populate children IDs (all children, including hidden)
        element.children = container.children
            .map((c) => c.id);
    }
}

// ---------------------------------------------------------------------------
// Extract element data from a Figma node
// ---------------------------------------------------------------------------

function extractElement(node: SceneNode, parentId: string | null): FigmaElement {
    const rect = getRect(node);
    const constraints = getConstraints(node);
    const fills = getFills(node);
    const cornerRadius = getCornerRadius(node);
    const opacity = getOpacity(node);
    const text = getTextProps(node);
    const autoLayout = getAutoLayoutProps(node);
    const exportable = isExportable(node);

    return {
        id: node.id,
        name: node.name,
        type: node.type,
        parentId,
        rect,
        constraints,
        fills,
        cornerRadius,
        opacity,
        visible: node.visible,
        text: text ?? undefined,
        children: [],
        exportable,
        autoLayout: autoLayout ?? undefined,
    };
}

// ---------------------------------------------------------------------------
// Property extractors
// ---------------------------------------------------------------------------

function getRect(node: SceneNode): Rect {
    // Use relative transform for position relative to parent
    const x = node.x;
    const y = node.y;
    const w = node.width;
    const h = node.height;
    return { x, y, w, h };
}

function getConstraints(node: SceneNode): { horizontal: string; vertical: string } {
    if ('constraints' in node) {
        const c = (node as ConstraintMixin).constraints;
        return {
            horizontal: c.horizontal,
            vertical: c.vertical,
        };
    }
    // Default: pin to top-left
    return { horizontal: 'MIN', vertical: 'MIN' };
}

function getFills(node: SceneNode): ReadonlyArray<Paint> | typeof figma.mixed {
    if ('fills' in node) {
        return (node as GeometryMixin).fills;
    }
    return [];
}

function getCornerRadius(node: SceneNode): number {
    if ('cornerRadius' in node) {
        const cr = (node as CornerMixin).cornerRadius;
        if (typeof cr === 'number') return cr;
        // Mixed corner radius: use the max value
        if ('topLeftRadius' in node) {
            const rn = node as RectangleCornerMixin;
            return Math.max(
                rn.topLeftRadius ?? 0,
                rn.topRightRadius ?? 0,
                rn.bottomLeftRadius ?? 0,
                rn.bottomRightRadius ?? 0
            );
        }
    }
    return 0;
}

function getOpacity(node: SceneNode): number {
    if ('opacity' in node) {
        return (node as BlendMixin).opacity;
    }
    return 1;
}

function getTextProps(node: SceneNode): FigmaTextProps | null {
    if (node.type !== 'TEXT') return null;

    const textNode = node as TextNode;
    const content = textNode.characters;

    // Get font properties (handle mixed values)
    const fontFamily = getTextProperty(textNode, 'fontName', (fn: FontName) => fn.family, 'Inter');
    const fontStyle = getTextProperty(textNode, 'fontName', (fn: FontName) => fn.style, 'Regular');
    const fontSize = getTextProperty(textNode, 'fontSize', (s: number) => s, 16);
    const color = getTextColor(textNode);
    const alignment = mapTextAlignment(textNode);
    const lineHeight = getLineHeight(textNode);
    const letterSpacing = getLetterSpacing(textNode);

    return {
        content,
        fontFamily,
        fontStyle,
        fontSize,
        color,
        alignment,
        lineHeight: lineHeight ?? undefined,
        letterSpacing: letterSpacing ?? undefined,
    };
}

function getAutoLayoutProps(node: SceneNode): AutoLayoutProps | null {
    if (!('layoutMode' in node)) return null;

    const frame = node as FrameNode;
    if (frame.layoutMode === 'NONE') return null;

    return {
        layoutMode: frame.layoutMode as 'HORIZONTAL' | 'VERTICAL',
        paddingTop: frame.paddingTop ?? 0,
        paddingBottom: frame.paddingBottom ?? 0,
        paddingLeft: frame.paddingLeft ?? 0,
        paddingRight: frame.paddingRight ?? 0,
        itemSpacing: frame.itemSpacing ?? 0,
        primaryAxisAlignItems: frame.primaryAxisAlignItems ?? 'MIN',
        counterAxisAlignItems: frame.counterAxisAlignItems ?? 'MIN',
    };
}

// ---------------------------------------------------------------------------
// Exportable detection
// ---------------------------------------------------------------------------

/**
 * Determine if a node should be exported as a PNG.
 *
 * Export rules:
 * - TEXT → never export (text is rendered by TMP in Unity)
 * - GROUP → never export (only a hierarchy container)
 * - VECTOR, BOOLEAN_OPERATION → always export (icons)
 * - FRAME/RECTANGLE/COMPONENT/INSTANCE → export if has visual fills/effects
 */
function isExportable(node: SceneNode): boolean {
    // Never export text
    if (node.type === 'TEXT') return false;

    // Never export pure groups
    if (node.type === 'GROUP') return false;

    // Always export vectors/icons
    if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') return true;

    // For frames that are containers (have children but no visual fills), don't export
    if ('children' in node && (node as ChildrenMixin & SceneNode).children.length > 0) {
        // Container frame: export only if it has meaningful fills
        if ('fills' in node) {
            const fills = (node as GeometryMixin).fills;
            if (fills !== figma.mixed) {
                const visibleFills = (fills as ReadonlyArray<Paint>).filter(
                    (f) => f.visible !== false
                );
                if (visibleFills.length === 0) return false; // Pure container
            }
        }
    }

    // Check if it has visual content
    if ('fills' in node) {
        const fills = (node as GeometryMixin).fills;
        if (fills === figma.mixed) return true;
        const hasVisibleFill = (fills as ReadonlyArray<Paint>).some(
            (f) => f.visible !== false && f.type !== 'IMAGE'
        );
        const hasImageFill = (fills as ReadonlyArray<Paint>).some(
            (f) => f.visible !== false && f.type === 'IMAGE'
        );
        if (hasVisibleFill || hasImageFill) return true;
    }

    // Check effects (shadows, blurs, etc.)
    if ('effects' in node) {
        const effects = (node as BlendMixin).effects;
        if (effects.length > 0) return true;
    }

    return false;
}

// ---------------------------------------------------------------------------
// Text property helpers
// ---------------------------------------------------------------------------

function getTextProperty<T, R>(
    textNode: TextNode,
    prop: string,
    extract: (value: T) => R,
    fallback: R
): R {
    try {
        const value = (textNode as any)[prop];
        if (value === figma.mixed) return fallback;
        return extract(value as T);
    } catch {
        return fallback;
    }
}

function getTextColor(textNode: TextNode): RGBA {
    try {
        const fills = textNode.fills;
        if (fills === figma.mixed || !Array.isArray(fills) || fills.length === 0) {
            return [1, 1, 1, 1];
        }
        // Figma fills render bottom-to-top: last visible solid fill = topmost
        let lastSolid: SolidPaint | undefined;
        for (const f of fills) {
            if (f.type === 'SOLID' && f.visible !== false) {
                lastSolid = f as SolidPaint;
            }
        }
        if (lastSolid) {
            return [
                Math.round(lastSolid.color.r * 1000) / 1000,
                Math.round(lastSolid.color.g * 1000) / 1000,
                Math.round(lastSolid.color.b * 1000) / 1000,
                lastSolid.opacity ?? 1,
            ];
        }
    } catch { /* fallback */ }
    return [1, 1, 1, 1];
}

function mapTextAlignment(textNode: TextNode): string {
    const hAlign = textNode.textAlignHorizontal;
    const vAlign = textNode.textAlignVertical;

    const vMap: Record<string, string> = {
        TOP: 'Top',
        CENTER: 'Middle',
        BOTTOM: 'Bottom',
    };
    const hMap: Record<string, string> = {
        LEFT: 'Left',
        CENTER: 'Center',
        RIGHT: 'Right',
        JUSTIFIED: 'Justified',
    };

    return `${vMap[vAlign] ?? 'Top'}${hMap[hAlign] ?? 'Left'}`;
}

function getLineHeight(textNode: TextNode): number | null {
    try {
        const lh = textNode.lineHeight;
        if (lh === figma.mixed) return null;
        if ((lh as any).unit === 'AUTO') return null;
        if ((lh as any).unit === 'PERCENT') return (lh as any).value / 100;
        if ((lh as any).unit === 'PIXELS') return (lh as any).value;
    } catch { /* ignore */ }
    return null;
}

function getLetterSpacing(textNode: TextNode): number | null {
    try {
        const ls = textNode.letterSpacing;
        if (ls === figma.mixed) return null;
        if ((ls as any).unit === 'PERCENT') return (ls as any).value / 100;
        if ((ls as any).unit === 'PIXELS') return (ls as any).value;
    } catch { /* ignore */ }
    return null;
}
