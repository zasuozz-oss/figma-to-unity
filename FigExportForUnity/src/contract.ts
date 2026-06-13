// FigExportForUnity/src/contract.ts
// =============================================================================
// UI Contract — types + pure helpers (NO figma global; unit-testable)
// Mirror của zod schema phía server (server/src/ui-contract.ts).
// =============================================================================

export type RGBA = [number, number, number, number]; // 0..1

export interface ContractRect { x: number; y: number; w: number; h: number }
export interface ContractSize { w: number; h: number }

export type ContractPaint =
    | { type: 'solid'; color: RGBA }
    | { type: 'gradient'; gradientType: 'linear' | 'radial'; stops: { position: number; color: RGBA }[] }
    | { type: 'none' };

export interface ContractStroke {
    color: RGBA;
    weight: number;
    align?: 'inside' | 'center' | 'outside';
}

export type ContractEffect =
    | { type: 'drop-shadow'; color: RGBA; offset: { x: number; y: number }; blur: number; spread?: number }
    | { type: 'inner-shadow'; color: RGBA; offset: { x: number; y: number }; blur: number; spread?: number }
    | { type: 'layer-blur'; blur: number };

export interface ContractAutoLayout {
    mode: 'horizontal' | 'vertical' | 'none';
    gap?: number;
    padding?: { t: number; r: number; b: number; l: number };
    primaryAlign?: 'min' | 'center' | 'max' | 'space-between';
    counterAlign?: 'min' | 'center' | 'max';
}

export interface ContractTextProps {
    content: string;
    fontFamily?: string;
    fontStyle?: string;
    fontSize: number;
    color: RGBA;
    align?: 'left' | 'center' | 'right';
    lineHeight?: number;
    letterSpacing?: number;
}

export type AssetSource =
    | { kind: 'custom'; data: number[] }
    | { kind: 'iconify'; icon: string; color?: RGBA };

interface ContractNodeBase {
    name: string;
    rect?: ContractRect;   // khi parent KHÔNG auto-layout
    size?: ContractSize;   // khi parent auto-layout
    opacity?: number;
    visible?: boolean;
    effects?: ContractEffect[];
}

export type ContractNode =
    | (ContractNodeBase & {
        type: 'frame'; fill?: ContractPaint; stroke?: ContractStroke;
        cornerRadius?: number; clipsContent?: boolean;
        layout?: ContractAutoLayout; children?: ContractNode[];
    })
    | (ContractNodeBase & { type: 'text'; text: ContractTextProps })
    | (ContractNodeBase & { type: 'rect'; fill?: ContractPaint; stroke?: ContractStroke; cornerRadius?: number })
    | (ContractNodeBase & { type: 'ellipse'; fill?: ContractPaint; stroke?: ContractStroke })
    | (ContractNodeBase & { type: 'line'; stroke: ContractStroke })
    | (ContractNodeBase & { type: 'polygon'; pointCount?: number; fill?: ContractPaint; stroke?: ContractStroke })
    | (ContractNodeBase & { type: 'vector'; svg: string; fill?: ContractPaint })
    | (ContractNodeBase & { type: 'asset'; source?: AssetSource });

export interface UIContract { version: '1.0'; root: ContractNode }

/** Kết quả build trả về AI: cây id lồng nhau (KHÔNG map phẳng — tên có thể trùng). */
export interface BuiltNodeInfo {
    id: string;
    name: string;
    type: string;
    children: BuiltNodeInfo[];
}

export interface BuildResult { tree: BuiltNodeInfo; warnings: string[] }

export interface FontRef { family: string; style: string }

export const DEFAULT_FONT: FontRef = { family: 'Inter', style: 'Regular' };

/** DFS gom mọi font của text node trong cây; thiếu family/style → default Inter Regular. Dedupe theo family+style. */
export function collectFonts(root: ContractNode): FontRef[] {
    const seen = new Set<string>();
    const out: FontRef[] = [];
    const visit = (n: ContractNode): void => {
        if (n.type === 'text') {
            const family = n.text.fontFamily || DEFAULT_FONT.family;
            const style = n.text.fontStyle || DEFAULT_FONT.style;
            const key = family + '##' + style;
            if (!seen.has(key)) { seen.add(key); out.push({ family, style }); }
        }
        if (n.type === 'frame' && n.children) n.children.forEach(visit);
    };
    visit(root);
    return out;
}

/** Bọc chuỗi SVG bằng thẻ <svg> nếu thiếu (createNodeFromSvg cần SVG đầy đủ). */
export function normalizeSvg(svg: string): string {
    const trimmed = svg.trim();
    if (trimmed.toLowerCase().startsWith('<svg')) return svg;
    return '<svg xmlns="http://www.w3.org/2000/svg">' + svg + '</svg>';
}

/**
 * Mô hình định vị (spec):
 * - parent KHÔNG auto-layout → rect tuyệt đối {x,y,w,h}
 * - parent CÓ auto-layout   → size (x/y do Figma layout tính → trả 0)
 * - thiếu dữ liệu → default 100x100
 */
export function resolvePlacement(
    node: ContractNode,
    parentHasAutoLayout: boolean
): { x: number; y: number; w: number; h: number } {
    const w = node.size?.w ?? node.rect?.w ?? 100;
    const h = node.size?.h ?? node.rect?.h ?? 100;
    if (parentHasAutoLayout) return { x: 0, y: 0, w, h };
    return { x: node.rect?.x ?? 0, y: node.rect?.y ?? 0, w, h };
}
