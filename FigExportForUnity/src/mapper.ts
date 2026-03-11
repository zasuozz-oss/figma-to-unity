// =============================================================================
// Mapper — Figma Constraints → Unity Anchors
// Based on ANCHOR_MAPPING.md
// =============================================================================

import type { FigmaElement, Rect, UnityTransform } from './types';

/**
 * Convert Figma constraints to Unity RectTransform values.
 *
 * Key differences between Figma and Unity coordinate systems:
 * - Figma Y-axis: down = positive
 * - Unity Y-axis: up = positive
 * → Y values must be flipped during conversion.
 */
export function mapConstraintsToAnchors(
    element: FigmaElement,
    parentRect: Rect
): UnityTransform {
    const h = element.constraints.horizontal;
    const v = element.constraints.vertical;
    const rect = element.rect;

    // Compute anchor values based on constraint type
    const anchorX = mapHorizontalAnchor(h);
    const anchorY = mapVerticalAnchor(v);

    const anchorMin: [number, number] = [anchorX.min, anchorY.min];
    const anchorMax: [number, number] = [anchorX.max, anchorY.max];

    // Determine pivot
    const pivot = computePivot(anchorMin, anchorMax, element);

    const transform: UnityTransform = {
        anchorMin,
        anchorMax,
        pivot,
        localScale: [1, 1, 1],
    };

    // Calculate offset/sizeDelta based on whether stretching
    // SCALE uses same stretch anchors (0,1) so needs stretch offset math
    const isStretchH = h === 'STRETCH' || h === 'SCALE';
    const isStretchV = v === 'STRETCH' || v === 'SCALE';

    if (isStretchH || isStretchV) {
        // Stretch cases: keep Figma-derived anchors for stretch behavior,
        // but force middle-center for non-stretch axis
        const offsetMin: [number, number] = [0, 0];
        const offsetMax: [number, number] = [0, 0];

        // For non-stretch axes, override to middle-center
        if (!isStretchH) {
            anchorMin[0] = 0.5;
            anchorMax[0] = 0.5;
        }
        if (!isStretchV) {
            anchorMin[1] = 0.5;
            anchorMax[1] = 0.5;
        }

        // Recalculate pivot for the final anchors
        pivot[0] = 0.5;
        pivot[1] = 0.5;

        // Update transform with forced anchors
        transform.anchorMin = anchorMin;
        transform.anchorMax = anchorMax;
        transform.pivot = pivot;

        if (isStretchH) {
            // Stretch horizontal: offsets from parent edges
            offsetMin[0] = rect.x;
            offsetMax[0] = -(parentRect.w - (rect.x + rect.w));
        } else {
            // Non-stretch horizontal with middle-center anchor
            const anchoredPosX = rect.x + rect.w * 0.5 - parentRect.w * 0.5;
            offsetMin[0] = anchoredPosX - rect.w * 0.5;
            offsetMax[0] = anchoredPosX + rect.w * 0.5;
        }

        if (isStretchV) {
            // Stretch vertical (with Y flip)
            offsetMin[1] = parentRect.h - (rect.y + rect.h); // bottom gap
            offsetMax[1] = -(rect.y);                          // top gap (negative)
        } else {
            // Non-stretch vertical with middle-center anchor
            const unityY = parentRect.h - rect.y - rect.h; // flipped Y
            const anchoredPosY = unityY + rect.h * 0.5 - parentRect.h * 0.5;
            offsetMin[1] = anchoredPosY - rect.h * 0.5;
            offsetMax[1] = anchoredPosY + rect.h * 0.5;
        }

        transform.offsetMin = offsetMin;
        transform.offsetMax = offsetMax;
    } else {
        // Non-stretch: force middle-center anchor and pivot
        anchorMin[0] = 0.5; anchorMin[1] = 0.5;
        anchorMax[0] = 0.5; anchorMax[1] = 0.5;
        pivot[0] = 0.5; pivot[1] = 0.5;

        transform.anchorMin = anchorMin;
        transform.anchorMax = anchorMax;
        transform.pivot = pivot;

        transform.sizeDelta = [rect.w, rect.h];

        // Calculate anchoredPosition relative to middle-center anchor
        const unityY = parentRect.h - rect.y - rect.h; // flip Y

        const anchoredPosX = rect.x + rect.w * 0.5 - parentRect.w * 0.5;
        const anchoredPosY = unityY + rect.h * 0.5 - parentRect.h * 0.5;

        transform.offsetMin = [
            anchoredPosX - rect.w * 0.5,
            anchoredPosY - rect.h * 0.5,
        ];
        transform.offsetMax = [
            anchoredPosX + rect.w * 0.5,
            anchoredPosY + rect.h * 0.5,
        ];
    }

    return transform;
}

// ---------------------------------------------------------------------------
// Horizontal constraint → anchor X values
// ---------------------------------------------------------------------------

interface AnchorRange {
    min: number;
    max: number;
}

function mapHorizontalAnchor(constraint: string): AnchorRange {
    switch (constraint) {
        case 'MIN': return { min: 0, max: 0 }; // Pin left
        case 'MAX': return { min: 1, max: 1 }; // Pin right
        case 'CENTER': return { min: 0.5, max: 0.5 }; // Center
        case 'STRETCH': return { min: 0, max: 1 }; // Full width
        case 'SCALE': return { min: 0, max: 1 }; // Scale with parent (use stretch anchors)
        default: return { min: 0, max: 0 }; // Default: pin left
    }
}

// ---------------------------------------------------------------------------
// Vertical constraint → anchor Y values (Y-flipped!)
// ---------------------------------------------------------------------------

function mapVerticalAnchor(constraint: string): AnchorRange {
    switch (constraint) {
        case 'MIN': return { min: 1, max: 1 }; // Pin top (Y flipped: Figma MIN=top → Unity max Y)
        case 'MAX': return { min: 0, max: 0 }; // Pin bottom
        case 'CENTER': return { min: 0.5, max: 0.5 }; // Center
        case 'STRETCH': return { min: 0, max: 1 }; // Full height
        case 'SCALE': return { min: 0, max: 1 }; // Scale with parent
        default: return { min: 1, max: 1 }; // Default: pin top
    }
}

// ---------------------------------------------------------------------------
// Pivot calculation
// ---------------------------------------------------------------------------

function computePivot(
    anchorMin: [number, number],
    anchorMax: [number, number],
    element: FigmaElement
): [number, number] {
    let pivotX = 0.5;
    let pivotY = 0.5;

    // Text alignment overrides
    if (element.text) {
        const align = element.text.alignment.toLowerCase();
        if (align.includes('left')) pivotX = 0;
        else if (align.includes('right')) pivotX = 1;
        else pivotX = 0.5;
    }

    // Anchor-based pivot hints
    if (anchorMin[1] === 1 && anchorMax[1] === 1) {
        pivotY = 1; // Top-anchored → pivot at top
    } else if (anchorMin[1] === 0 && anchorMax[1] === 0) {
        pivotY = 0; // Bottom-anchored → pivot at bottom
    }

    return [pivotX, pivotY];
}

// ---------------------------------------------------------------------------
// Auto-Layout → Unity components suggestion
// ---------------------------------------------------------------------------

/**
 * Determine which Unity layout component to use based on Figma auto-layout.
 */
export function getLayoutComponent(element: FigmaElement): string | null {
    if (!element.autoLayout) return null;

    switch (element.autoLayout.layoutMode) {
        case 'HORIZONTAL': return 'HorizontalLayoutGroup';
        case 'VERTICAL': return 'VerticalLayoutGroup';
        default: return null;
    }
}

/**
 * Determine which Unity components to add based on the element's type and content.
 */
export function determineComponents(element: FigmaElement): string[] {
    const components: string[] = [];

    if (element.type === 'TEXT') {
        components.push('TextMeshProUGUI');
    } else if (element.exportable || hasVisualFill(element)) {
        components.push('Image');
    }

    // Add layout component if auto-layout
    const layout = getLayoutComponent(element);
    if (layout) {
        components.push(layout);
    }

    // Button detection: interactive elements with "button" or "btn" in name
    const nameLower = element.name.toLowerCase();
    if (nameLower.includes('button') || nameLower.includes('btn')) {
        components.push('Button');
    }

    return components;
}

/**
 * Check if interactive: buttons, inputs, toggles, or explicitly named interactive elements.
 */
export function isInteractive(element: FigmaElement): boolean {
    const nameLower = element.name.toLowerCase();
    return (
        nameLower.includes('button') ||
        nameLower.includes('btn') ||
        nameLower.includes('input') ||
        nameLower.includes('toggle') ||
        nameLower.includes('checkbox') ||
        nameLower.includes('switch') ||
        nameLower.includes('slider') ||
        nameLower.includes('dropdown')
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasVisualFill(element: FigmaElement): boolean {
    if (!element.fills || element.fills === figma.mixed) return false;
    return (element.fills as ReadonlyArray<Paint>).some(
        (f) => f.visible !== false && f.opacity !== 0
    );
}
