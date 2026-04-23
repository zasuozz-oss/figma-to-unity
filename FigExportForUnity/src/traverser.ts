// =============================================================================
// Traverser — DFS Node Traversal
// Walks the Figma node tree and collects FigmaElement data.
// =============================================================================

import type { FigmaElement, FigmaTextProps, RGBA, AutoLayoutProps, Rect } from './types';

interface AbsoluteBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

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
    const clipsContent = getClipsContent(node);
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
        clipsContent: clipsContent || undefined,
    };
}

// ---------------------------------------------------------------------------
// Property extractors
// ---------------------------------------------------------------------------

function getRect(node: SceneNode): Rect {
    const absoluteBounds = readAbsoluteBounds(node);
    const parentBounds = readParentAbsoluteBounds(node);

    const x = absoluteBounds && parentBounds
        ? absoluteBounds.x - parentBounds.x
        : node.x;
    const y = absoluteBounds && parentBounds
        ? absoluteBounds.y - parentBounds.y
        : node.y;
    const w = absoluteBounds ? absoluteBounds.width : node.width;
    const h = absoluteBounds ? absoluteBounds.height : node.height;

    return { x, y, w, h };
}

function readAbsoluteBounds(node: SceneNode): AbsoluteBounds | null {
    const bounds = (node as any).absoluteBoundingBox;
    return isValidAbsoluteBounds(bounds) ? bounds as AbsoluteBounds : null;
}

function readParentAbsoluteBounds(node: SceneNode): AbsoluteBounds | null {
    const parent = (node as any).parent;
    if (!parent || parent.type === 'PAGE') {
        return null;
    }

    const bounds = (parent as any).absoluteBoundingBox;
    return isValidAbsoluteBounds(bounds) ? bounds as AbsoluteBounds : null;
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

function getClipsContent(node: SceneNode): boolean {
    if ('clipsContent' in node) {
        return Boolean((node as SceneNode & { clipsContent?: boolean }).clipsContent);
    }
    return false;
}

function getTextProps(node: SceneNode): FigmaTextProps | null {
    if (node.type !== 'TEXT') return null;

    const textNode = node as TextNode;
    const rawContent = resolveTextContent(textNode);
    const textCase = getTextProperty(textNode, 'textCase', (value: TextCase) => value, 'ORIGINAL');
    const content = applyTextCase(rawContent, textCase);

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

function resolveTextContent(textNode: TextNode): string {
    const directContent = typeof textNode.characters === 'string' ? textNode.characters : '';
    const propertyReference = getTextComponentPropertyReference(textNode);
    if (!propertyReference) {
        return directContent;
    }

    const instanceOverride = getInstanceTextOverride(textNode, propertyReference);
    if (typeof instanceOverride === 'string' && instanceOverride.length > 0) {
        return instanceOverride;
    }

    return directContent;
}

function getTextComponentPropertyReference(textNode: TextNode): string | null {
    const references = (textNode as any).componentPropertyReferences;
    if (!references || typeof references !== 'object') {
        return null;
    }

    if (typeof references.characters === 'string' && references.characters.length > 0) {
        return references.characters;
    }

    if (typeof references.text === 'string' && references.text.length > 0) {
        return references.text;
    }

    return null;
}

function getInstanceTextOverride(textNode: TextNode, propertyReference: string): string | null {
    let parent: BaseNode | null = textNode.parent;
    while (parent) {
        if (parent.type === 'INSTANCE') {
            const componentProperties = (parent as any).componentProperties;
            if (componentProperties && typeof componentProperties === 'object') {
                const directMatch = componentProperties[propertyReference];
                if (directMatch && typeof directMatch.value === 'string' && directMatch.value.length > 0) {
                    return directMatch.value;
                }

                const entries = Object.keys(componentProperties);
                for (let index = 0; index < entries.length; index++) {
                    const key = entries[index];
                    const entry = componentProperties[key];
                    if (!entry || typeof entry !== 'object') continue;

                    if (typeof entry.value === 'string' && typeof entry.name === 'string') {
                        const normalizedReference = propertyReference.toLowerCase();
                        const normalizedName = entry.name.toLowerCase();
                        if (normalizedReference.indexOf(normalizedName) >= 0 && entry.value.length > 0) {
                            return entry.value;
                        }
                    }
                }
            }
        }
        parent = parent.parent;
    }

    return null;
}

function applyTextCase(content: string, textCase: TextCase): string {
    switch (textCase) {
        case 'UPPER':
        case 'SMALL_CAPS_FORCED':
            return content.toUpperCase();
        case 'LOWER':
            return content.toLowerCase();
        case 'TITLE':
            return content.replace(/\S+/g, function (word) {
                return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
            });
        case 'SMALL_CAPS':
        case 'ORIGINAL':
        default:
            return content;
    }
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

export function isIconContainer(node: SceneNode): boolean {
    const validTypes = ['GROUP', 'FRAME', 'COMPONENT', 'INSTANCE'];
    if (validTypes.indexOf(node.type) < 0) return false;

    let isIcon = true;
    let hasVectorLeaf = false;
    function check(n: SceneNode) {
        if (!isIcon) return;

        // Skip invisible nodes — hidden bounding rects, guides, etc.
        if ('visible' in n && !n.visible) return;

        if (n.type === 'VECTOR' || n.type === 'BOOLEAN_OPERATION' || n.type === 'LINE'
            || n.type === 'ELLIPSE' || n.type === 'POLYGON' || n.type === 'STAR'
            || n.type === 'RECTANGLE') {
            hasVectorLeaf = true;
            return;
        }

        if (n.type === 'GROUP') {
            if (!('children' in n) || n.children.length === 0) {
                isIcon = false;
                return;
            }
            for (let i = 0; i < n.children.length; i++) {
                check(n.children[i]);
            }
            return;
        }

        if (n.type === 'FRAME' || n.type === 'COMPONENT' || n.type === 'INSTANCE' || n.type === 'TEXT') {
            isIcon = false;
            return;
        }

        isIcon = false;
    }

    // An icon container must have children
    if (!('children' in node) || (node as ChildrenMixin).children.length === 0) return false;

    const parentNode = node as ChildrenMixin;
    for (var i = 0; i < parentNode.children.length; i++) {
        check(parentNode.children[i]);
    }
    return isIcon && hasVectorLeaf;
}

/**
 * Determine if a node should be exported as a PNG.
 *
 * Export rules:
 * - TEXT → never export (text is rendered by TMP in Unity)
 * - GROUP → never export (only a hierarchy container), UNLESS it is an icon group
 * - VECTOR, BOOLEAN_OPERATION → always export (icons)
 * - FRAME/RECTANGLE/COMPONENT/INSTANCE → export if has visual fills/effects
 */
function isExportable(node: SceneNode): boolean {
    // Never export text
    if (node.type === 'TEXT') return false;

    // Never export pure groups, unless it is a pure vector icon
    if (node.type === 'GROUP') {
        if (isIconContainer(node)) return true;
        return false;
    }

    // Always export vectors/icons
    if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION' || node.type === 'LINE'
        || node.type === 'ELLIPSE' || node.type === 'POLYGON' || node.type === 'STAR') return true;

    // For frames that are containers (have children but no visual fills), don't export
    if ('children' in node && (node as ChildrenMixin & SceneNode).children.length > 0) {
        // If it's a pure vector icon component/instance, always export
        if (isIconContainer(node)) return true;

        // Container frame: export only if it has meaningful fills
        if ('fills' in node) {
            const fills = (node as GeometryMixin).fills;
            if (fills !== figma.mixed) {
                const visibleFills = (fills as ReadonlyArray<Paint>).filter(
                    (f) => f.visible !== false
                );
                if (visibleFills.length === 0 && !hasVisibleStroke(node)) return false; // Pure container
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

    if (hasVisibleStroke(node)) return true;

    // Check effects (shadows, blurs, etc.)
    if ('effects' in node) {
        const effects = (node as BlendMixin).effects;
        if (effects.length > 0) return true;
    }

    return false;
}

export function hasVisibleStroke(node: SceneNode): boolean {
    if (!('strokes' in node)) return false;

    const strokes = (node as GeometryMixin).strokes;
    if (strokes === figma.mixed) return true;

    return (strokes as ReadonlyArray<Paint>).some(function (stroke) {
        return stroke.visible !== false && stroke.opacity !== 0;
    });
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
