// =============================================================================
// Naming Convention
// Based on NAMING.md
// =============================================================================

import type { FigmaElement } from './types';

/**
 * Generate the export filename for a Figma element.
 * Format: <root_name>_<sanitized_name>@<scale>x.png
 */
export function generateFileName(element: FigmaElement, scale: number = 2, rootName: string = ''): string {
    const name = sanitize(element.name);
    const prefix = rootName ? sanitize(rootName) + '_' : '';
    return `${prefix}${name}@${scale}x.png`;
}

/**
 * Auto-detect the appropriate prefix based on node type and name.
 *
 * Priority:
 * 1. VECTOR, BOOLEAN_OPERATION → ic_
 * 2. Name contains "button" or "btn" → btn_
 * 3. Name contains "background" or "bg" → bg_
 * 4. Name contains "icon" or "ic" → ic_
 * 5. RECTANGLE that is "full width" (spans >= 90% of parent) → bg_
 * 6. Default → img_
 */
function getPrefix(element: FigmaElement): string {
    const nameLower = element.name.toLowerCase();

    // Vector / boolean operations are icons
    if (element.type === 'VECTOR' || element.type === 'BOOLEAN_OPERATION') {
        return 'ic_';
    }

    // Name-based detection
    if (nameLower.includes('button') || nameLower.includes('btn')) {
        return 'btn_';
    }
    if (nameLower.includes('background') || nameLower.includes('bg')) {
        return 'bg_';
    }
    if (nameLower.includes('icon') || nameLower.includes('ic')) {
        return 'ic_';
    }

    // Default
    return 'img_';
}

/**
 * Sanitize a Figma layer name into a valid filename part.
 *
 * Rules:
 * 1. Lowercase
 * 2. Replace non-alphanumeric with _
 * 3. Collapse multiple _ into one
 * 4. Strip leading/trailing _
 * 5. If empty after sanitize → use element_<id>
 */
export function sanitize(name: string): string {
    let result = name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');

    if (result.length === 0) {
        return 'unnamed';
    }
    return result;
}

/**
 * Generate a safe unique fallback name from a Figma node ID.
 * E.g., "1:23" → "element_1_23"
 */
export function fallbackName(nodeId: string): string {
    return `element_${nodeId.replace(/:/g, '_')}`;
}
