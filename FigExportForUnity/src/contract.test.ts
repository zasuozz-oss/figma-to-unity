// FigExportForUnity/src/contract.test.ts
import { describe, expect, test } from 'bun:test';
import {
    collectFonts, normalizeSvg, resolvePlacement,
    type ContractNode,
} from './contract';

describe('collectFonts', () => {
    test('gom font từ text node lồng nhau, dedupe, default Inter Regular', () => {
        const root: ContractNode = {
            name: 'Root', type: 'frame',
            rect: { x: 0, y: 0, w: 100, h: 100 },
            children: [
                { name: 'TxtA', type: 'text', rect: { x: 0, y: 0, w: 50, h: 20 },
                  text: { content: 'A', fontFamily: 'Roboto', fontStyle: 'Bold', fontSize: 12, color: [0, 0, 0, 1] } },
                { name: 'TxtB', type: 'text', rect: { x: 0, y: 30, w: 50, h: 20 },
                  text: { content: 'B', fontSize: 12, color: [0, 0, 0, 1] } }, // no font → default
                { name: 'TxtC', type: 'text', rect: { x: 0, y: 60, w: 50, h: 20 },
                  text: { content: 'C', fontFamily: 'Roboto', fontStyle: 'Bold', fontSize: 14, color: [0, 0, 0, 1] } }, // dup
            ],
        };
        const fonts = collectFonts(root);
        expect(fonts).toEqual([
            { family: 'Roboto', style: 'Bold' },
            { family: 'Inter', style: 'Regular' },
        ]);
    });

    test('cây không có text → mảng rỗng', () => {
        expect(collectFonts({ name: 'R', type: 'rect', rect: { x: 0, y: 0, w: 10, h: 10 } })).toEqual([]);
    });
});

describe('normalizeSvg', () => {
    test('giữ nguyên khi đã có <svg>', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>';
        expect(normalizeSvg(svg)).toBe(svg);
    });
    test('bọc <svg> khi chỉ có <path>', () => {
        expect(normalizeSvg('<path d="M0 0L10 10"/>')).toBe(
            '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10"/></svg>'
        );
    });
});

describe('resolvePlacement', () => {
    test('parent thường → dùng rect tuyệt đối', () => {
        const node: ContractNode = { name: 'A', type: 'rect', rect: { x: 5, y: 6, w: 70, h: 80 } };
        expect(resolvePlacement(node, false)).toEqual({ x: 5, y: 6, w: 70, h: 80 });
    });
    test('parent auto-layout → dùng size, x/y = 0', () => {
        const node: ContractNode = { name: 'A', type: 'rect', size: { w: 70, h: 80 } };
        expect(resolvePlacement(node, true)).toEqual({ x: 0, y: 0, w: 70, h: 80 });
    });
    test('auto-layout nhưng chỉ có rect → lấy w/h từ rect', () => {
        const node: ContractNode = { name: 'A', type: 'rect', rect: { x: 5, y: 6, w: 70, h: 80 } };
        expect(resolvePlacement(node, true)).toEqual({ x: 0, y: 0, w: 70, h: 80 });
    });
    test('thiếu cả rect lẫn size → default 100x100', () => {
        const node: ContractNode = { name: 'A', type: 'rect' };
        expect(resolvePlacement(node, false)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    });
});
