// FigExportForUnity/src/builder.ts
// =============================================================================
// Builder — dựng node Figma native từ UI Contract + mutate helpers.
// Chính sách lỗi: một leaf hỏng (font/iconify/asset) KHÔNG fail cả build;
// thay bằng placeholder và đẩy message vào warnings.
// =============================================================================

import {
    collectFonts, normalizeSvg, resolvePlacement, DEFAULT_FONT,
    type AssetSource, type BuildResult, type BuiltNodeInfo,
    type ContractAutoLayout, type ContractNode, type ContractStroke,
    type ContractTextProps, type UIContract,
} from './contract';
import { toFigmaPaints, toFigmaEffects, toStrokeAlign } from './convert';

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export async function buildContract(
    contract: UIContract,
    parentId?: string
): Promise<BuildResult> {
    const warnings: string[] = [];

    let parent: BaseNode & ChildrenMixin = figma.currentPage;
    if (parentId) {
        const found = figma.getNodeById(parentId);
        if (!found || !('appendChild' in found)) {
            throw new Error('parent node not found or cannot hold children: ' + parentId);
        }
        parent = found as BaseNode & ChildrenMixin;
    }

    await loadFonts(contract.root, warnings);
    const tree = await createNode(contract.root, parent, false, warnings);
    return { tree, warnings };
}

/** Load mọi font trong cây trước khi set characters (bắt buộc bởi Figma API). Fail → fallback Inter Regular + warning. */
async function loadFonts(root: ContractNode, warnings: string[]): Promise<void> {
    const fonts = collectFonts(root);
    let needDefault = false;
    for (const f of fonts) {
        try {
            await figma.loadFontAsync({ family: f.family, style: f.style });
        } catch (e) {
            warnings.push('font load failed: ' + f.family + ' ' + f.style + ' → fallback Inter Regular');
            needDefault = true;
        }
    }
    if (needDefault || fonts.length === 0) {
        await figma.loadFontAsync({ family: DEFAULT_FONT.family, style: DEFAULT_FONT.style });
    }
}

/** Font đã load được ghi nhớ để text node fallback khi font của nó fail. */
function isFontLoadable(warnings: string[], family: string, style: string): boolean {
    return !warnings.some(function (w) { return w.indexOf('font load failed: ' + family + ' ' + style) === 0; });
}

async function createNode(
    node: ContractNode,
    parent: BaseNode & ChildrenMixin,
    parentHasAutoLayout: boolean,
    warnings: string[]
): Promise<BuiltNodeInfo> {
    const place = resolvePlacement(node, parentHasAutoLayout);
    let scene: SceneNode;
    let childInfos: BuiltNodeInfo[] = [];

    switch (node.type) {
        case 'frame': {
            const frame = figma.createFrame();
            frame.resize(place.w, place.h);
            frame.fills = toFigmaPaints(node.fill);
            applyStroke(frame, node.stroke);
            if (node.cornerRadius !== undefined) frame.cornerRadius = node.cornerRadius;
            frame.clipsContent = node.clipsContent === true;
            parent.appendChild(frame);

            // Thứ tự QUAN TRỌNG (spec risk): append con TRƯỚC, bật layoutMode SAU
            // để Figma xếp con theo thứ tự children mà không reflow sai.
            const hasLayout = !!node.layout && node.layout.mode !== 'none';
            if (node.children) {
                for (const child of node.children) {
                    childInfos.push(await createNode(child, frame, hasLayout, warnings));
                }
            }
            if (hasLayout) {
                applyLayoutTo(frame, node.layout!);
                // Bật layoutMode khiến Figma mặc định AUTO (hug) → frame co theo con.
                // Giữ FIXED rồi tái áp size đã khai báo để frame đúng kích thước.
                frame.primaryAxisSizingMode = 'FIXED';
                frame.counterAxisSizingMode = 'FIXED';
                frame.resize(place.w, place.h);
            }
            scene = frame;
            break;
        }
        case 'text': {
            const t = figma.createText();
            const family = node.text.fontFamily || DEFAULT_FONT.family;
            const style = node.text.fontStyle || DEFAULT_FONT.style;
            t.fontName = isFontLoadable(warnings, family, style)
                ? { family, style }
                : { family: DEFAULT_FONT.family, style: DEFAULT_FONT.style };
            t.characters = node.text.content;
            t.fontSize = node.text.fontSize;
            t.fills = toFigmaPaints({ type: 'solid', color: node.text.color });
            t.textAlignHorizontal =
                node.text.align === 'center' ? 'CENTER' :
                node.text.align === 'right' ? 'RIGHT' : 'LEFT';
            if (node.text.lineHeight !== undefined) {
                t.lineHeight = { value: node.text.lineHeight, unit: 'PIXELS' };
            }
            if (node.text.letterSpacing !== undefined) {
                t.letterSpacing = { value: node.text.letterSpacing, unit: 'PIXELS' };
            }
            // Sizing: chỉ ép fixed-box khi contract khai báo TƯỜNG MINH w (và h).
            // Thiếu size → hug nội dung, tránh wrap giữa từ + tràn ra ngoài frame.
            const hasW = node.size?.w !== undefined || node.rect?.w !== undefined;
            const hasH = node.size?.h !== undefined || node.rect?.h !== undefined;
            if (hasW && hasH) {
                t.textAutoResize = 'NONE';
                t.resize(place.w, place.h);
            } else if (hasW) {
                t.textAutoResize = 'HEIGHT'; // cố định bề rộng, cao tự co
                t.resize(place.w, t.height);
            } else {
                t.textAutoResize = 'WIDTH_AND_HEIGHT'; // hug cả hai chiều
            }
            parent.appendChild(t);
            scene = t;
            break;
        }
        case 'rect': {
            const r = figma.createRectangle();
            r.resize(place.w, place.h);
            r.fills = toFigmaPaints(node.fill);
            applyStroke(r, node.stroke);
            if (node.cornerRadius !== undefined) r.cornerRadius = node.cornerRadius;
            parent.appendChild(r);
            scene = r;
            break;
        }
        case 'ellipse': {
            const el = figma.createEllipse();
            el.resize(place.w, place.h);
            el.fills = toFigmaPaints(node.fill);
            applyStroke(el, node.stroke);
            parent.appendChild(el);
            scene = el;
            break;
        }
        case 'line': {
            // v1: ngang (w>=h) hoặc dọc (h>w, xoay -90). Xiên → dùng type vector.
            const ln = figma.createLine();
            const vertical = place.h > place.w;
            ln.resize(vertical ? place.h : place.w, 0);
            if (vertical) ln.rotation = -90;
            applyStroke(ln, node.stroke);
            parent.appendChild(ln);
            scene = ln;
            break;
        }
        case 'polygon': {
            const poly = figma.createPolygon();
            poly.pointCount = node.pointCount ?? 3;
            poly.resize(place.w, place.h);
            poly.fills = toFigmaPaints(node.fill);
            applyStroke(poly, node.stroke);
            parent.appendChild(poly);
            scene = poly;
            break;
        }
        case 'vector': {
            // createNodeFromSvg trả FrameNode bọc — dùng luôn frame đó làm node.
            const v = figma.createNodeFromSvg(normalizeSvg(node.svg));
            v.resize(place.w, place.h);
            if (node.fill) recolorDescendants(v, toFigmaPaints(node.fill));
            parent.appendChild(v);
            scene = v;
            break;
        }
        case 'asset': {
            scene = await createAssetNode(node.name, node.source, place, parent, warnings);
            break;
        }
    }

    // Common props + placement
    scene.name = node.name;
    if (node.opacity !== undefined) (scene as BlendMixin).opacity = node.opacity;
    if (node.visible === false) scene.visible = false;
    if (node.effects && 'effects' in scene) {
        (scene as BlendMixin).effects = toFigmaEffects(node.effects);
    }
    if (!parentHasAutoLayout) {
        // Assets are fit-resized to their native aspect (≤ place box) → center in the box.
        const cx = node.type === 'asset' ? (place.w - scene.width) / 2 : 0;
        const cy = node.type === 'asset' ? (place.h - scene.height) / 2 : 0;
        scene.x = place.x + cx;
        scene.y = place.y + cy;
    }

    return { id: scene.id, name: scene.name, type: node.type, children: childInfos };
}

function applyStroke(node: GeometryMixin & MinimalStrokesMixin, stroke?: ContractStroke): void {
    if (!stroke) return;
    node.strokes = toFigmaPaints({ type: 'solid', color: stroke.color });
    node.strokeWeight = stroke.weight;
    (node as MinimalStrokesMixin).strokeAlign = toStrokeAlign(stroke.align);
}

function applyLayoutTo(frame: FrameNode, layout: ContractAutoLayout): void {
    frame.layoutMode = layout.mode === 'horizontal' ? 'HORIZONTAL' : 'VERTICAL';
    frame.itemSpacing = layout.gap ?? 0;
    const p = layout.padding;
    frame.paddingTop = p ? p.t : 0;
    frame.paddingRight = p ? p.r : 0;
    frame.paddingBottom = p ? p.b : 0;
    frame.paddingLeft = p ? p.l : 0;
    frame.primaryAxisAlignItems =
        layout.primaryAlign === 'center' ? 'CENTER' :
        layout.primaryAlign === 'max' ? 'MAX' :
        layout.primaryAlign === 'space-between' ? 'SPACE_BETWEEN' : 'MIN';
    frame.counterAxisAlignItems =
        layout.counterAlign === 'center' ? 'CENTER' :
        layout.counterAlign === 'max' ? 'MAX' : 'MIN';
}

function recolorDescendants(root: ChildrenMixin & SceneNode, paints: Paint[]): void {
    // Container nodes (incl. the SVG wrapper frame from createNodeFromSvg) carry a
    // default invisible white fill — painting them would cover the icon vectors,
    // so only geometry leaves get recolored.
    const CONTAINER_TYPES = ['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SECTION'];
    const stack: SceneNode[] = [root as SceneNode];
    while (stack.length > 0) {
        const n = stack.pop()!;
        if (!CONTAINER_TYPES.includes(n.type) &&
            'fills' in n && Array.isArray((n as GeometryMixin).fills) &&
            ((n as GeometryMixin).fills as Paint[]).length > 0) {
            (n as GeometryMixin).fills = paints;
        }
        if ('children' in n) {
            for (const c of (n as ChildrenMixin).children) stack.push(c);
        }
    }
}

// ---------------------------------------------------------------------------
// Asset (custom → iconify → placeholder)
// ---------------------------------------------------------------------------

async function createAssetNode(
    name: string,
    source: AssetSource | undefined,
    place: { x: number; y: number; w: number; h: number },
    parent: BaseNode & ChildrenMixin,
    warnings: string[]
): Promise<SceneNode> {
    if (source && source.kind === 'custom') {
        try {
            const bytes = Uint8Array.from(source.data);
            // Byte đầu '<' (0x3C) → SVG text; ngược lại → ảnh raster (PNG/JPG/GIF)
            if (bytes.length > 0 && bytes[0] === 0x3c) {
                let text = '';
                for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
                const svgNode = figma.createNodeFromSvg(normalizeSvg(text));
                svgNode.resize(place.w, place.h);
                parent.appendChild(svgNode);
                return svgNode;
            }
            const image = figma.createImage(bytes);
            const rect = figma.createRectangle();
            // Fit the box to the image's native aspect ratio (contained inside the
            // requested place box) so the art is never cropped and never letterboxed.
            const dims = await image.getSizeAsync();
            const scale = Math.min(place.w / dims.width, place.h / dims.height);
            rect.resize(dims.width * scale, dims.height * scale);
            // FIT (not FILL) guarantees the whole image shows even if the box aspect drifts.
            rect.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FIT' } as ImagePaint];
            parent.appendChild(rect);
            return rect;
        } catch (e) {
            warnings.push('custom asset failed for "' + name + '": ' + String(e) + ' → placeholder');
        }
    } else if (source && source.kind === 'iconify') {
        try {
            const resp = await fetch('https://api.iconify.design/' + source.icon + '.svg');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const svgText = await resp.text();
            if (svgText.indexOf('<svg') === -1) throw new Error('not an SVG response');
            const iconNode = figma.createNodeFromSvg(svgText);
            iconNode.resize(place.w, place.h);
            if (source.color) recolorDescendants(iconNode, toFigmaPaints({ type: 'solid', color: source.color }));
            parent.appendChild(iconNode);
            return iconNode;
        } catch (e) {
            warnings.push('iconify "' + source.icon + '" failed for "' + name + '": ' + String(e) + ' → placeholder');
        }
    } else {
        warnings.push('asset "' + name + '" has no source → placeholder');
    }

    // Placeholder: rect xám giữ tên
    const ph = figma.createRectangle();
    ph.resize(place.w, place.h);
    ph.fills = toFigmaPaints({ type: 'solid', color: [0.8, 0.8, 0.8, 1] });
    parent.appendChild(ph);
    return ph;
}

// ---------------------------------------------------------------------------
// Mutate helpers — mỗi hàm trả { nodeId } hoặc throw (catch ở handleMcpRequest)
// ---------------------------------------------------------------------------

function mustGetNode(nodeId: string): SceneNode {
    const n = figma.getNodeById(nodeId);
    if (!n || n.type === 'PAGE' || n.type === 'DOCUMENT') {
        throw new Error('node not found: ' + nodeId);
    }
    return n as SceneNode;
}

export function setFill(nodeId: string, paint: unknown): { nodeId: string } {
    const n = mustGetNode(nodeId);
    if (!('fills' in n)) throw new Error('node has no fills: ' + nodeId);
    (n as GeometryMixin).fills = toFigmaPaints(paint as any);
    return { nodeId };
}

export function setStroke(nodeId: string, stroke: ContractStroke): { nodeId: string } {
    const n = mustGetNode(nodeId);
    if (!('strokes' in n)) throw new Error('node has no strokes: ' + nodeId);
    applyStroke(n as GeometryMixin & MinimalStrokesMixin, stroke);
    return { nodeId };
}

export async function setText(
    nodeId: string,
    patch: Partial<ContractTextProps>
): Promise<{ nodeId: string }> {
    const n = mustGetNode(nodeId);
    if (n.type !== 'TEXT') throw new Error('node is not TEXT: ' + nodeId);
    const t = n as TextNode;

    // Load font hiện tại (bắt buộc trước khi sửa characters) + font mới nếu đổi
    if (t.fontName !== figma.mixed) await figma.loadFontAsync(t.fontName as FontName);
    if (patch.fontFamily || patch.fontStyle) {
        const current = t.fontName === figma.mixed ? DEFAULT_FONT : (t.fontName as FontName);
        const next = {
            family: patch.fontFamily || current.family,
            style: patch.fontStyle || current.style,
        };
        await figma.loadFontAsync(next);
        t.fontName = next;
    }
    if (patch.content !== undefined) t.characters = patch.content;
    if (patch.fontSize !== undefined) t.fontSize = patch.fontSize;
    if (patch.color !== undefined) t.fills = toFigmaPaints({ type: 'solid', color: patch.color });
    if (patch.align !== undefined) {
        t.textAlignHorizontal =
            patch.align === 'center' ? 'CENTER' : patch.align === 'right' ? 'RIGHT' : 'LEFT';
    }
    if (patch.lineHeight !== undefined) t.lineHeight = { value: patch.lineHeight, unit: 'PIXELS' };
    if (patch.letterSpacing !== undefined) t.letterSpacing = { value: patch.letterSpacing, unit: 'PIXELS' };
    return { nodeId };
}

export function setEffects(nodeId: string, effects: unknown): { nodeId: string } {
    const n = mustGetNode(nodeId);
    if (!('effects' in n)) throw new Error('node has no effects: ' + nodeId);
    (n as BlendMixin).effects = toFigmaEffects(effects as any);
    return { nodeId };
}

export function setLayout(nodeId: string, layout: ContractAutoLayout): { nodeId: string } {
    const n = mustGetNode(nodeId);
    if (n.type !== 'FRAME') throw new Error('node is not FRAME: ' + nodeId);
    if (layout.mode === 'none') {
        (n as FrameNode).layoutMode = 'NONE';
    } else {
        applyLayoutTo(n as FrameNode, layout);
    }
    return { nodeId };
}

export function moveResize(
    nodeId: string,
    rect: { x: number; y: number; w: number; h: number }
): { nodeId: string } {
    const n = mustGetNode(nodeId);
    if ('resize' in n) (n as LayoutMixin).resize(rect.w, rect.h);
    n.x = rect.x;
    n.y = rect.y;
    return { nodeId };
}

export async function placeAsset(nodeId: string, source: AssetSource): Promise<{ nodeId: string }> {
    const n = mustGetNode(nodeId);
    const parent = n.parent;
    if (!parent || !('appendChild' in parent)) throw new Error('node has no parent: ' + nodeId);
    const warnings: string[] = [];
    const place = { x: n.x, y: n.y, w: n.width, h: n.height };
    const index = parent.children.indexOf(n);
    const replacement = await createAssetNode(n.name, source, place, parent, warnings);
    if (warnings.length > 0) throw new Error(warnings.join('; '));
    replacement.name = n.name;
    // Center the fit-resized asset within the original placeholder box (it may be
    // smaller than the box on one axis after aspect-fit), so the swap stays put.
    replacement.x = place.x + (place.w - replacement.width) / 2;
    replacement.y = place.y + (place.h - replacement.height) / 2;
    parent.insertChild(index, replacement);
    n.remove();
    return { nodeId: replacement.id };
}

export async function createNodeUnder(
    parentId: string,
    node: ContractNode,
    index?: number
): Promise<BuildResult> {
    const parent = figma.getNodeById(parentId);
    if (!parent || !('appendChild' in parent)) {
        throw new Error('parent node not found or cannot hold children: ' + parentId);
    }
    const warnings: string[] = [];
    await loadFonts(node, warnings);
    const parentAuto = parent.type === 'FRAME' && (parent as FrameNode).layoutMode !== 'NONE';
    const info = await createNode(node, parent as BaseNode & ChildrenMixin, parentAuto, warnings);
    if (index !== undefined) {
        const created = figma.getNodeById(info.id) as SceneNode;
        (parent as BaseNode & ChildrenMixin).insertChild(index, created);
    }
    return { tree: info, warnings };
}

export function deleteNode(nodeId: string): { ok: true } {
    mustGetNode(nodeId).remove();
    return { ok: true };
}

export function renameNode(nodeId: string, name: string): { nodeId: string } {
    const n = mustGetNode(nodeId);
    n.name = name;
    return { nodeId };
}

// ---------------------------------------------------------------------------
// Library helpers — components + variables (design tokens)
// ---------------------------------------------------------------------------

export interface CreateComponentsResult {
    components: { id: string; name: string }[];
    componentSetId?: string;
}

export function createComponents(
    nodeIds: string[],
    combineAsVariants?: boolean,
    name?: string
): CreateComponentsResult {
    const components: ComponentNode[] = [];
    for (const id of nodeIds) {
        const n = mustGetNode(id);
        if (n.type === 'COMPONENT') {
            components.push(n as ComponentNode);
        } else {
            components.push(figma.createComponentFromNode(n as FrameNode));
        }
    }

    const result: CreateComponentsResult = {
        components: components.map(function (c) { return { id: c.id, name: c.name }; }),
    };

    if (combineAsVariants && components.length > 1) {
        const parent = components[0].parent;
        if (!parent || !('appendChild' in parent)) {
            throw new Error('cannot combine as variants: first component has no container parent');
        }
        const set = figma.combineAsVariants(components, parent as BaseNode & ChildrenMixin);
        if (name) set.name = name;
        result.componentSetId = set.id;
        // combineAsVariants rewrites child names to variant syntax — re-read them
        result.components = components.map(function (c) { return { id: c.id, name: c.name }; });
    }
    return result;
}

type VariableTypeInput = 'color' | 'number' | 'string' | 'boolean';

export interface VariableDefInput {
    name: string;
    type: VariableTypeInput;
    valuesByMode: Record<string, unknown>;
}

const VARIABLE_TYPE_MAP: Record<VariableTypeInput, VariableResolvedDataType> = {
    color: 'COLOR', number: 'FLOAT', string: 'STRING', boolean: 'BOOLEAN',
};

function rgbaArrayToColor(value: unknown): RGBA {
    if (!Array.isArray(value) || value.length !== 4) {
        throw new Error('color variable value must be an RGBA array [r,g,b,a] with 0-1 channels');
    }
    return { r: value[0], g: value[1], b: value[2], a: value[3] };
}

export interface CreateVariableCollectionResult {
    collectionId: string;
    name: string;
    modes: { modeId: string; name: string }[];
    variables: { id: string; name: string; resolvedType: string }[];
    warnings: string[];
}

export function createVariableCollection(
    name: string,
    modes?: string[],
    variables?: VariableDefInput[]
): CreateVariableCollectionResult {
    const collection = figma.variables.createVariableCollection(name);
    const warnings: string[] = [];

    // A new collection starts with one default mode — rename it to modes[0]
    const modeIdByName: Record<string, string> = {};
    if (modes && modes.length > 0) {
        collection.renameMode(collection.modes[0].modeId, modes[0]);
        modeIdByName[modes[0]] = collection.modes[0].modeId;
        for (let i = 1; i < modes.length; i++) {
            modeIdByName[modes[i]] = collection.addMode(modes[i]);
        }
    } else {
        modeIdByName[collection.modes[0].name] = collection.modes[0].modeId;
    }

    const created: { id: string; name: string; resolvedType: string }[] = [];
    for (const def of variables || []) {
        const v = figma.variables.createVariable(def.name, collection, VARIABLE_TYPE_MAP[def.type]);
        for (const modeName of Object.keys(def.valuesByMode)) {
            const modeId = modeIdByName[modeName];
            if (!modeId) {
                warnings.push('variable "' + def.name + '": unknown mode "' + modeName + '" → value skipped');
                continue;
            }
            const raw = def.valuesByMode[modeName];
            v.setValueForMode(modeId, def.type === 'color' ? rgbaArrayToColor(raw) : (raw as VariableValue));
        }
        created.push({ id: v.id, name: v.name, resolvedType: v.resolvedType });
    }

    return {
        collectionId: collection.id,
        name: collection.name,
        modes: collection.modes.map(function (m) { return { modeId: m.modeId, name: m.name }; }),
        variables: created,
        warnings,
    };
}

export type BindableField = 'fill' | 'stroke' | 'cornerRadius' | 'gap' | 'padding';

// cornerRadius/padding bind every sub-field to the same variable
const BIND_FIELD_MAP: Record<'cornerRadius' | 'gap' | 'padding', string[]> = {
    cornerRadius: ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'],
    gap: ['itemSpacing'],
    padding: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
};

export async function bindVariable(
    nodeId: string,
    field: BindableField,
    variableId: string
): Promise<{ nodeId: string }> {
    const n = mustGetNode(nodeId);
    const variable = await figma.variables.getVariableByIdAsync(variableId);
    if (!variable) throw new Error('variable not found: ' + variableId);

    if (field === 'fill' || field === 'stroke') {
        if (variable.resolvedType !== 'COLOR') {
            throw new Error(field + ' needs a COLOR variable, got ' + variable.resolvedType);
        }
        const prop = field === 'fill' ? 'fills' : 'strokes';
        if (!(prop in n)) throw new Error('node has no ' + prop + ': ' + nodeId);
        const paints = (n as any)[prop];
        const base: SolidPaint =
            typeof paints !== 'symbol' && paints.length > 0 && paints[0].type === 'SOLID'
                ? (paints[0] as SolidPaint)
                : { type: 'SOLID', color: { r: 0, g: 0, b: 0 } };
        (n as any)[prop] = [figma.variables.setBoundVariableForPaint(base, 'color', variable)];
        return { nodeId };
    }

    if (variable.resolvedType !== 'FLOAT') {
        throw new Error(field + ' needs a FLOAT (number) variable, got ' + variable.resolvedType);
    }
    for (const sub of BIND_FIELD_MAP[field]) {
        if (!(sub in n)) throw new Error("node does not support '" + field + "': " + nodeId);
        (n as any).setBoundVariable(sub, variable);
    }
    return { nodeId };
}
