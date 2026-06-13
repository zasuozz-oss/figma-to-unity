// FigExportForUnity/src/convert.ts
// =============================================================================
// Pure converters: UI Contract value types → Figma Paint/Effect data.
// KHÔNG gọi figma.* — chỉ build plain objects (unit-testable).
// =============================================================================

import type { ContractPaint, ContractEffect, RGBA } from './contract';

function rgb(c: RGBA): { r: number; g: number; b: number } {
    return { r: c[0], g: c[1], b: c[2] };
}

function rgba(c: RGBA): { r: number; g: number; b: number; a: number } {
    return { r: c[0], g: c[1], b: c[2], a: c[3] };
}

/**
 * ContractPaint → Paint[] của Figma.
 * - solid: alpha tách thành opacity (SolidPaint không nhận alpha trong color)
 * - gradient linear: default top→bottom (xoay 90° so với identity left→right)
 * - gradient radial: identity transform (tâm giữa)
 * - none/undefined: []
 */
export function toFigmaPaints(paint: ContractPaint | undefined): Paint[] {
    if (!paint || paint.type === 'none') return [];
    if (paint.type === 'solid') {
        return [{ type: 'SOLID', color: rgb(paint.color), opacity: paint.color[3] } as SolidPaint];
    }
    const stops = paint.stops.map(function (s) {
        return { position: s.position, color: rgba(s.color) };
    });
    if (paint.gradientType === 'linear') {
        return [{
            type: 'GRADIENT_LINEAR',
            gradientTransform: [[0, 1, 0], [-1, 0, 1]],
            gradientStops: stops,
        } as GradientPaint];
    }
    return [{
        type: 'GRADIENT_RADIAL',
        gradientTransform: [[1, 0, 0], [0, 1, 0]],
        gradientStops: stops,
    } as GradientPaint];
}

/** ContractEffect[] → Effect[] của Figma. */
export function toFigmaEffects(effects: ContractEffect[] | undefined): Effect[] {
    if (!effects) return [];
    return effects.map(function (e): Effect {
        if (e.type === 'layer-blur') {
            return { type: 'LAYER_BLUR', radius: e.blur, visible: true } as BlurEffect;
        }
        return {
            type: e.type === 'drop-shadow' ? 'DROP_SHADOW' : 'INNER_SHADOW',
            color: rgba(e.color),
            offset: { x: e.offset.x, y: e.offset.y },
            radius: e.blur,
            spread: e.spread ?? 0,
            visible: true,
            blendMode: 'NORMAL',
        } as ShadowEffect;
    });
}

/** Contract stroke align → Figma strokeAlign. Default CENTER. */
export function toStrokeAlign(
    align: 'inside' | 'center' | 'outside' | undefined
): 'INSIDE' | 'CENTER' | 'OUTSIDE' {
    if (align === 'inside') return 'INSIDE';
    if (align === 'outside') return 'OUTSIDE';
    return 'CENTER';
}
