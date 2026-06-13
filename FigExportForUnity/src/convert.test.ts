// FigExportForUnity/src/convert.test.ts
import { describe, expect, test } from 'bun:test';
import { toFigmaPaints, toFigmaEffects, toStrokeAlign } from './convert';

describe('toFigmaPaints', () => {
    test('solid → SOLID + opacity từ kênh alpha', () => {
        expect(toFigmaPaints({ type: 'solid', color: [1, 0.5, 0, 0.8] })).toEqual([
            { type: 'SOLID', color: { r: 1, g: 0.5, b: 0 }, opacity: 0.8 },
        ]);
    });
    test('none → []', () => {
        expect(toFigmaPaints({ type: 'none' })).toEqual([]);
    });
    test('undefined → []', () => {
        expect(toFigmaPaints(undefined)).toEqual([]);
    });
    test('gradient linear → GRADIENT_LINEAR, transform top→bottom, stops RGBA', () => {
        const paints = toFigmaPaints({
            type: 'gradient', gradientType: 'linear',
            stops: [
                { position: 0, color: [1, 0, 0, 1] },
                { position: 1, color: [0, 0, 1, 0.5] },
            ],
        });
        expect(paints).toEqual([{
            type: 'GRADIENT_LINEAR',
            gradientTransform: [[0, 1, 0], [-1, 0, 1]],
            gradientStops: [
                { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
                { position: 1, color: { r: 0, g: 0, b: 1, a: 0.5 } },
            ],
        }]);
    });
    test('gradient radial → GRADIENT_RADIAL, transform identity', () => {
        const paints = toFigmaPaints({
            type: 'gradient', gradientType: 'radial',
            stops: [{ position: 0, color: [1, 1, 1, 1] }, { position: 1, color: [0, 0, 0, 1] }],
        });
        expect(paints[0].type).toBe('GRADIENT_RADIAL');
        expect((paints[0] as any).gradientTransform).toEqual([[1, 0, 0], [0, 1, 0]]);
    });
});

describe('toFigmaEffects', () => {
    test('drop-shadow đủ field', () => {
        expect(toFigmaEffects([
            { type: 'drop-shadow', color: [0, 0, 0, 0.4], offset: { x: 0, y: 4 }, blur: 8, spread: 2 },
        ])).toEqual([{
            type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.4 },
            offset: { x: 0, y: 4 }, radius: 8, spread: 2,
            visible: true, blendMode: 'NORMAL',
        }]);
    });
    test('inner-shadow + layer-blur', () => {
        const fx = toFigmaEffects([
            { type: 'inner-shadow', color: [1, 0, 0, 1], offset: { x: 1, y: 1 }, blur: 4 },
            { type: 'layer-blur', blur: 12 },
        ]);
        expect(fx[0].type).toBe('INNER_SHADOW');
        expect((fx[0] as any).spread).toBe(0);
        expect(fx[1]).toEqual({ type: 'LAYER_BLUR', radius: 12, visible: true });
    });
    test('undefined → []', () => {
        expect(toFigmaEffects(undefined)).toEqual([]);
    });
});

describe('toStrokeAlign', () => {
    test('map đủ 3 giá trị + default CENTER', () => {
        expect(toStrokeAlign('inside')).toBe('INSIDE');
        expect(toStrokeAlign('center')).toBe('CENTER');
        expect(toStrokeAlign('outside')).toBe('OUTSIDE');
        expect(toStrokeAlign(undefined)).toBe('CENTER');
    });
});
