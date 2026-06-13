// =============================================================================
// Main — Figma Plugin Entry Point
// Sends layer tree on selection, handles merge + per-element exclude on export
// =============================================================================

import { exportDesign } from './exporter';
import type {
    UIToMainMessage, MainToUIMessage,
    ExportOptions, ExportScale, ElementConfig, TreeElement,
} from './types';
import { DEFAULT_EXPORT_OPTIONS, DEFAULT_EXPORT_SCALE } from './types';
import { traverseNode } from './traverser';
import {
    buildContract, setFill, setStroke, setText, setEffects, setLayout,
    moveResize, placeAsset, createNodeUnder, deleteNode, renameNode,
    createComponents, createVariableCollection, bindVariable,
} from './builder';

// Show the plugin UI
// Mở ở kích thước thu nhỏ (khớp body.minimized trong ui.html); doRestore phóng lại 600x750.
figma.showUI(__html__, { width: 250, height: 36, themeColors: true });

// Flag to suppress selectionchange when we programmatically select a node
var suppressSelectionChange = false;
var suppressDocumentChange = false;
var currentRootNodeId: string | null = null;
var canvasLocked = true;

// ---------------------------------------------------------------------------
// Selection change → send tree data to UI
// ---------------------------------------------------------------------------

function sendSelectionInfo(): void {
    const selection = figma.currentPage.selection;

    if (selection.length === 0) {
        currentRootNodeId = null;
        postToUI({ type: 'no-selection' });
        return;
    }

    var rootNode: SceneNode = selection[0];
    var clickedNodeId: string | null = rootNode.id; // Track originally clicked node

    // Validate type — if invalid, walk up to nearest valid parent
    const validTypes = ['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'];
    while (!validTypes.includes(rootNode.type) && rootNode.parent && rootNode.parent.type !== 'PAGE') {
        rootNode = rootNode.parent as SceneNode;
    }
    if (!validTypes.includes(rootNode.type)) {
        postToUI({ type: 'no-selection' });
        return;
    }

    // If the originally clicked node IS the root, no child to highlight
    if (clickedNodeId === rootNode.id) {
        clickedNodeId = null;
    }

    currentRootNodeId = rootNode.id;

    // Traverse to build tree data
    const elements = traverseNode(rootNode);
    if (elements.length === 0) {
        postToUI({ type: 'no-selection' });
        return;
    }

    // Build depth map using parent hierarchy
    const depthMap = new Map<string, number>();
    depthMap.set(elements[0].id, 0);
    for (const el of elements) {
        if (el.parentId && depthMap.has(el.parentId)) {
            depthMap.set(el.id, (depthMap.get(el.parentId) || 0) + 1);
        } else if (!depthMap.has(el.id)) {
            depthMap.set(el.id, 0);
        }
    }

    // Build lightweight tree for UI
    const tree: TreeElement[] = elements.map(function (el) {
        // Check locked status from Figma node
        var figmaNode = figma.getNodeById(el.id) as SceneNode | null;
        var isLocked = figmaNode && 'locked' in figmaNode ? (figmaNode as any).locked : false;
        // Check if element has gradient or image fills (not suitable for 9-slice)
        var hasGradient = false;
        var fills = el.fills;
        // figma.mixed is a symbol, not an array — treat as complex fill
        if (typeof fills === 'symbol') {
            hasGradient = true;
        } else if (Array.isArray(fills)) {
            for (var f = 0; f < fills.length; f++) {
                if ((fills[f] as any).visible === false) continue; // Skip hidden fills
                var fillType = (fills[f] as any).type;
                if (fillType && (fillType.indexOf('GRADIENT') === 0 || fillType === 'IMAGE')) {
                    hasGradient = true;
                    break;
                }
            }
        }
        return {
            id: el.id,
            name: el.name,
            figmaType: el.type,
            depth: depthMap.get(el.id) || 0,
            size: { w: el.rect.w, h: el.rect.h },
            cornerRadius: el.cornerRadius,
            hasAsset: el.exportable,
            hasChildren: el.children.length > 0,
            hasGradient: hasGradient,
            locked: isLocked,
            visible: el.visible,
        };
    });

    postToUI({
        type: 'selection-info',
        name: rootNode.name,
        elementCount: elements.length,
        tree: tree,
        selectedChildId: clickedNodeId,
    });
}

// Send initial selection info
sendSelectionInfo();

// Listen for selection changes
figma.on('selectionchange', function () {
    try {
        if (suppressSelectionChange) return;
        if (canvasLocked && currentRootNodeId) {
            // When locked, check if selected node is descendant of root
            var sel = figma.currentPage.selection;
            if (sel.length === 1) {
                var node = sel[0];
                if (!node) return;
                var p: BaseNode | null = node;
                while (p) {
                    if (p.id === currentRootNodeId) {
                        // Descendant — just tell UI to highlight in tree, no preview reload
                        postToUI({ type: 'highlight-tree-element', nodeId: node.id });
                        return;
                    }
                    p = p.parent;
                }
            }
            return; // Not a descendant — ignore
        }
        sendSelectionInfo();
    } catch (e) {
        // Silently ignore to prevent plugin crash
    }
});

// ---------------------------------------------------------------------------
// Message handler: UI → Main
// ---------------------------------------------------------------------------

figma.ui.onmessage = async function (msg: UIToMainMessage) {
    switch (msg.type) {
        case 'export':
            await handleExport(
                msg.scale || DEFAULT_EXPORT_SCALE,
                msg.options || DEFAULT_EXPORT_OPTIONS,
                msg.elementConfigs || [],
            );
            break;

        case 'preview-element':
            await handlePreviewElement(msg.nodeId, msg.excludedIds || []);
            break;

        case 'export-single-png': {
            var spNode = figma.getNodeById(msg.nodeId) as SceneNode;
            if (spNode && 'exportAsync' in spNode) {
                var spScale = msg.scale || DEFAULT_EXPORT_SCALE;
                var spBytes = await (spNode as ExportMixin).exportAsync({
                    format: 'PNG',
                    constraint: { type: spScale.type, value: spScale.value },
                });
                var spName = spNode.name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.png';
                postToUI({ type: 'single-png-ready', name: spName, data: Array.from(spBytes) });
            }
            break;
        }

        case 'highlight-element': {
            var hNode = figma.getNodeById(msg.nodeId) as SceneNode;
            if (hNode) {
                suppressSelectionChange = true;
                figma.currentPage.selection = [hNode];
                setTimeout(function () { suppressSelectionChange = false; }, 100);
            }
            break;
        }

        case 'lock-canvas':
            canvasLocked = msg.locked;
            break;

        case 'toggle-visibility': {
            suppressDocumentChange = true;
            var tvNode = figma.getNodeById(msg.nodeId) as SceneNode;
            if (tvNode && 'visible' in tvNode) {
                tvNode.visible = msg.visible;
            }
            setTimeout(function () { suppressDocumentChange = false; }, 200);
            break;
        }

        case 'reset-all-visibility': {
            suppressDocumentChange = true;
            for (var ri = 0; ri < msg.nodeIds.length; ri++) {
                var rNode = figma.getNodeById(msg.nodeIds[ri]) as SceneNode;
                if (rNode && 'visible' in rNode) {
                    rNode.visible = true;
                }
            }
            setTimeout(function () { suppressDocumentChange = false; }, 200);
            break;
        }

        case 'resize-ui':
            figma.ui.resize(msg.width, msg.height);
            break;

        case 'rename-elements':
            suppressDocumentChange = true;
            var renameList = msg.renames as { nodeId: string; newName: string }[];
            for (var ri = 0; ri < renameList.length; ri++) {
                var rNode = figma.getNodeById(renameList[ri].nodeId);
                if (rNode) {
                    rNode.name = renameList[ri].newName;
                }
            }
            setTimeout(function () { suppressDocumentChange = false; }, 200);
            break;

        case 'reload':
            sendSelectionInfo();
            break;

        case 'toggle-lock':
            var lockNode = figma.getNodeById(msg.nodeId) as SceneNode | null;
            if (lockNode && 'locked' in lockNode) {
                (lockNode as any).locked = msg.locked;
            }
            break;

        case 'cancel':
            figma.closePlugin();
            break;

        case 'mcp-request':
            handleMcpRequest(msg.payload).catch(function (err: any) {
                console.error('[MCP] Request handler error:', err);
            });
            break;
    }
};

// ---------------------------------------------------------------------------
// Document changes: sync visibility to UI
// ---------------------------------------------------------------------------

figma.on('documentchange', function (event: any) {
    try {
        if (!currentRootNodeId || suppressDocumentChange) return;
        var visChanges: { nodeId: string; visible: boolean }[] = [];
        var lockChanges: { nodeId: string; locked: boolean }[] = [];
        for (var i = 0; i < event.documentChanges.length; i++) {
            var change = event.documentChanges[i];
            if (change.type === 'PROPERTY_CHANGE' && change.properties) {
                var node = change.node;
                if (node && node.id) {
                    if (change.properties.indexOf('visible') >= 0 && 'visible' in node) {
                        visChanges.push({ nodeId: node.id, visible: (node as SceneNode).visible });
                    }
                    if (change.properties.indexOf('locked') >= 0 && 'locked' in node) {
                        lockChanges.push({ nodeId: node.id, locked: (node as any).locked });
                    }
                }
            }
        }
        if (visChanges.length > 0) {
            postToUI({ type: 'visibility-changed', changes: visChanges });
        }
        if (lockChanges.length > 0) {
            postToUI({ type: 'lock-changed', changes: lockChanges });
        }
    } catch (e) {
        // Silently ignore to prevent plugin crash
    }
});

// ---------------------------------------------------------------------------
// Export handler with merge + exclude support
// ---------------------------------------------------------------------------

async function handleExport(
    scale: ExportScale,
    options: ExportOptions,
    configs: ElementConfig[],
): Promise<void> {
    // Always export from the root node, not the current selection
    // (user may have clicked a child element in Figma)
    if (!currentRootNodeId) {
        postToUI({ type: 'export-error', message: 'No frame selected.' });
        return;
    }

    var rootNode = figma.getNodeById(currentRootNodeId) as SceneNode | null;
    if (!rootNode) {
        postToUI({ type: 'export-error', message: 'Root node not found. Please re-select a frame.' });
        return;
    }

    // Walk up to nearest valid parent if selection is an invalid type
    const validTypes = ['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'];
    while (!validTypes.includes(rootNode.type) && rootNode.parent && rootNode.parent.type !== 'PAGE') {
        rootNode = rootNode.parent as SceneNode;
    }
    if (!validTypes.includes(rootNode.type)) {
        postToUI({
            type: 'export-error',
            message: 'Selected node "' + rootNode.name + '" is a ' + rootNode.type + '. Please select a Frame or Component.',
        });
        return;
    }

    // Suppress documentchange events during export to prevent the UI
    // from caching temporary visibility changes (hideExportableDescendants)
    // as permanent state changes. This is the same pattern used in handlePreviewElement.
    suppressDocumentChange = true;
    try {
        // Export with merge + exclude support
        const result = await exportDesign(
            rootNode,
            scale,
            function (current, total, label) {
                postToUI({ type: 'progress', current: current, total: total, label: label });
            },
            options,
            configs,
        );

        postToUI({
            type: 'export-complete',
            manifest: JSON.stringify(result.manifest, null, 2),
            assets: result.assets,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        postToUI({ type: 'export-error', message: 'Export failed: ' + message });
    } finally {
        // Delay flag reset — documentchange fires async after visibility restore
        setTimeout(function () { suppressDocumentChange = false; }, 300);
    }
}

// ---------------------------------------------------------------------------
// Preview element handler
// ---------------------------------------------------------------------------

async function handlePreviewElement(nodeId: string, excludedIds: string[]): Promise<void> {
    try {
        var node = figma.getNodeById(nodeId) as SceneNode;
        if (!node) {
            postToUI({ type: 'export-error', message: 'Node not found.' });
            return;
        }

        if (!('exportAsync' in node)) {
            postToUI({ type: 'export-error', message: 'Cannot preview this element.' });
            return;
        }

        // Note: we don't change figma.currentPage.selection here.
        // Selection is handled separately via 'highlight-element' message.

        // Temporarily hide excluded nodes for accurate preview
        suppressDocumentChange = true;
        var hiddenNodes: { node: SceneNode; wasVisible: boolean }[] = [];
        for (var i = 0; i < excludedIds.length; i++) {
            var exNode = figma.getNodeById(excludedIds[i]) as SceneNode;
            if (exNode && 'visible' in exNode) {
                hiddenNodes.push({ node: exNode, wasVisible: exNode.visible });
                exNode.visible = false;
            }
        }

        var bytes: Uint8Array;
        try {
            bytes = await (node as ExportMixin).exportAsync({
                format: 'PNG',
                constraint: { type: 'WIDTH', value: 400 },
            });
        } finally {
            // Restore visibility
            for (var j = 0; j < hiddenNodes.length; j++) {
                hiddenNodes[j].node.visible = hiddenNodes[j].wasVisible;
            }
            // Delay flag reset — documentchange fires async after visibility restore
            setTimeout(function () { suppressDocumentChange = false; }, 200);
        }

        postToUI({
            type: 'element-preview',
            nodeId: nodeId,
            name: node.name,
            figmaType: node.type,
            size: { w: node.width, h: node.height },
            imageData: Array.from(bytes),
        });
    } catch (err) {
        var message = err instanceof Error ? err.message : String(err);
        postToUI({ type: 'export-error', message: 'Preview failed: ' + message });
    }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function postToUI(msg: MainToUIMessage): void {
    figma.ui.postMessage(msg);
}

// =============================================================================
// MCP Bridge — Serializer & Request Handler
// =============================================================================

function serializeNode(node: BaseNode, depth: number = 1): any {
    var result: any = {
        id: node.id,
        name: node.name,
        type: node.type,
    };
    if ('visible' in node) result.visible = (node as SceneNode).visible;
    if ('locked' in node) result.locked = (node as any).locked;
    if ('opacity' in node) result.opacity = (node as any).opacity;
    if ('width' in node && 'height' in node) {
        result.width = (node as SceneNode).width;
        result.height = (node as SceneNode).height;
    }
    if ('x' in node && 'y' in node) {
        result.x = (node as SceneNode).x;
        result.y = (node as SceneNode).y;
    }
    if ('fills' in node) {
        var fills = (node as any).fills;
        if (typeof fills !== 'symbol') result.fills = fills;
    }
    if ('strokes' in node) result.strokes = (node as any).strokes;
    if ('cornerRadius' in node) {
        var cr = (node as any).cornerRadius;
        if (typeof cr !== 'symbol') result.cornerRadius = cr;
    }
    if ('characters' in node) {
        result.characters = (node as any).characters;
        if ('fontSize' in node) {
            var fs = (node as any).fontSize;
            if (typeof fs !== 'symbol') result.fontSize = fs;
        }
    }
    if ('layoutMode' in node) {
        var lm = (node as any).layoutMode;
        if (lm && lm !== 'NONE') {
            result.layoutMode = lm;
            result.itemSpacing = (node as any).itemSpacing;
            result.paddingLeft = (node as any).paddingLeft;
            result.paddingRight = (node as any).paddingRight;
            result.paddingTop = (node as any).paddingTop;
            result.paddingBottom = (node as any).paddingBottom;
        }
    }
    if ('constraints' in node) result.constraints = (node as any).constraints;
    if ('effects' in node) result.effects = (node as any).effects;

    // Recurse into children
    if (depth > 0 && 'children' in node) {
        result.children = (node as any).children.map(function (child: BaseNode) {
            return serializeNode(child, depth - 1);
        });
    } else if ('children' in node) {
        result.childCount = (node as any).children.length;
    }

    return result;
}

function firstNodeId(req: any): string {
    var ids = req.nodeIds || [];
    if (ids.length === 0) throw new Error(req.type + ': missing nodeIds[0]');
    return ids[0];
}

async function handleMcpRequest(req: any): Promise<void> {
    var response: any = { type: req.type, requestId: req.requestId };

    try {
        switch (req.type) {
            case 'get_document': {
                var pages = figma.root.children.map(function (page: PageNode) {
                    return {
                        id: page.id,
                        name: page.name,
                        childCount: page.children.length,
                    };
                });
                response.data = {
                    name: figma.root.name,
                    currentPage: {
                        id: figma.currentPage.id,
                        name: figma.currentPage.name,
                    },
                    pages: pages,
                };
                break;
            }

            case 'get_selection': {
                var sel = figma.currentPage.selection;
                response.data = sel.map(function (node: SceneNode) {
                    return serializeNode(node, 2);
                });
                break;
            }

            case 'get_node': {
                var nodeIds = req.nodeIds || [];
                var nodes: any[] = [];
                for (var ni = 0; ni < nodeIds.length; ni++) {
                    var n = figma.getNodeById(nodeIds[ni]);
                    if (n) nodes.push(serializeNode(n, 2));
                }
                response.data = nodes;
                break;
            }

            case 'get_styles': {
                var paintStyles = figma.getLocalPaintStyles().map(function (s: PaintStyle) {
                    return { id: s.id, name: s.name, type: 'PAINT', paints: s.paints };
                });
                var textStyles = figma.getLocalTextStyles().map(function (s: TextStyle) {
                    return {
                        id: s.id, name: s.name, type: 'TEXT',
                        fontSize: s.fontSize, fontName: s.fontName,
                        lineHeight: s.lineHeight, letterSpacing: s.letterSpacing,
                    };
                });
                var effectStyles = figma.getLocalEffectStyles().map(function (s: EffectStyle) {
                    return { id: s.id, name: s.name, type: 'EFFECT', effects: s.effects };
                });
                response.data = { paintStyles, textStyles, effectStyles };
                break;
            }

            case 'get_metadata': {
                response.data = {
                    fileName: figma.root.name,
                    fileKey: figma.fileKey ?? null,
                    currentPage: {
                        id: figma.currentPage.id,
                        name: figma.currentPage.name,
                    },
                    pageCount: figma.root.children.length,
                    pages: figma.root.children.map(function (p: PageNode) {
                        return { id: p.id, name: p.name };
                    }),
                };
                break;
            }

            case 'get_design_context': {
                var contextDepth = (req.params && req.params.depth) || 2;
                var ctxSel = figma.currentPage.selection;
                if (ctxSel.length > 0) {
                    response.data = ctxSel.map(function (node: SceneNode) {
                        return serializeNode(node, contextDepth);
                    });
                } else {
                    response.data = figma.currentPage.children.map(function (node: SceneNode) {
                        return serializeNode(node, contextDepth);
                    });
                }
                break;
            }

            case 'get_variable_defs': {
                try {
                    var collections = await figma.variables.getLocalVariableCollectionsAsync();
                    var result: any[] = [];
                    for (var ci = 0; ci < collections.length; ci++) {
                        var col = collections[ci];
                        var vars: any[] = [];
                        for (var vi = 0; vi < col.variableIds.length; vi++) {
                            var v = await figma.variables.getVariableByIdAsync(col.variableIds[vi]);
                            if (v) {
                                vars.push({
                                    id: v.id, name: v.name,
                                    resolvedType: v.resolvedType,
                                    valuesByMode: v.valuesByMode,
                                });
                            }
                        }
                        result.push({
                            id: col.id, name: col.name,
                            modes: col.modes, variables: vars,
                        });
                    }
                    response.data = result;
                } catch (e) {
                    response.data = [];
                }
                break;
            }

            case 'get_screenshot': {
                var ssNodeIds = req.nodeIds || [];
                var ssFormat = (req.params && req.params.format) || 'PNG';
                var ssScale = (req.params && req.params.scale) || 2;
                var screenshots: any[] = [];
                var targetNodes: SceneNode[] = [];

                if (ssNodeIds.length > 0) {
                    for (var si = 0; si < ssNodeIds.length; si++) {
                        var sn = figma.getNodeById(ssNodeIds[si]) as SceneNode;
                        if (sn && 'exportAsync' in sn) targetNodes.push(sn);
                    }
                } else {
                    targetNodes = figma.currentPage.selection.filter(function (n: SceneNode) {
                        return 'exportAsync' in n;
                    });
                }

                for (var ti = 0; ti < targetNodes.length; ti++) {
                    var tn = targetNodes[ti];
                    var exportSettings: ExportSettings = ssFormat === 'SVG'
                        ? { format: 'SVG' }
                        : { format: ssFormat as 'PNG' | 'JPG' | 'PDF', constraint: { type: 'SCALE', value: ssScale } };
                    var imgBytes = await (tn as ExportMixin).exportAsync(exportSettings);
                    screenshots.push({
                        nodeId: tn.id,
                        name: tn.name,
                        format: ssFormat,
                        data: Array.from(imgBytes),
                    });
                }
                response.data = screenshots;
                break;
            }

            case 'export_element': {
                var exNodeId = (req.nodeIds && req.nodeIds[0]) || '';
                var exScale = (req.params && req.params.scale) || 2;
                var exNode = figma.getNodeById(exNodeId) as SceneNode | null;
                if (!exNode) {
                    response.error = 'Node not found: ' + exNodeId;
                    break;
                }

                // Walk up to nearest valid parent — same rule as handleExport()
                var exValidTypes = ['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'];
                while (!exValidTypes.includes(exNode.type) && exNode.parent && exNode.parent.type !== 'PAGE') {
                    exNode = exNode.parent as SceneNode;
                }
                if (!exValidTypes.includes(exNode.type)) {
                    response.error = 'Node "' + exNode.name + '" is a ' + exNode.type
                        + '. Provide a Frame, Group, Component, or Instance.';
                    break;
                }

                // Suppress documentchange while exportDesign toggles visibility/clipping
                suppressDocumentChange = true;
                try {
                    var exResult = await exportDesign(exNode, { type: 'SCALE', value: exScale });
                    response.data = {
                        manifest: exResult.manifest,
                        assets: exResult.assets,
                    };
                } finally {
                    setTimeout(function () { suppressDocumentChange = false; }, 300);
                }
                break;
            }

            case 'select_node': {
                var selNodeId = (req.nodeIds && req.nodeIds[0]) || '';
                var selNode = figma.getNodeById(selNodeId) as SceneNode | null;
                if (!selNode) { response.error = 'Node not found: ' + selNodeId; break; }
                // Switch to the node's page if it lives on another page.
                var selPage = selNode as BaseNode;
                while (selPage.parent && selPage.type !== 'PAGE') selPage = selPage.parent;
                if (selPage.type === 'PAGE' && selPage.id !== figma.currentPage.id) {
                    figma.currentPage = selPage as PageNode;
                }
                figma.currentPage.selection = [selNode];
                figma.viewport.scrollAndZoomIntoView([selNode]);
                response.data = { id: selNode.id, name: selNode.name };
                break;
            }

            case 'rename_node': {
                var rnNodeId = (req.nodeIds && req.nodeIds[0]) || '';
                var rnName = (req.params && req.params.name) || '';
                var rnNode = figma.getNodeById(rnNodeId) as SceneNode | null;
                if (!rnNode) { response.error = 'Node not found: ' + rnNodeId; break; }
                if (!rnName) { response.error = 'Empty name'; break; }
                rnNode.name = String(rnName);
                response.data = { id: rnNode.id, name: rnNode.name };
                break;
            }

            case 'reparent_node': {
                var rpNodeId = (req.nodeIds && req.nodeIds[0]) || '';
                var rpParentId = (req.params && req.params.newParentId) || '';
                var rpNode = figma.getNodeById(rpNodeId) as SceneNode | null;
                var rpParent = figma.getNodeById(rpParentId) as BaseNode | null;
                if (!rpNode) { response.error = 'Node not found: ' + rpNodeId; break; }
                if (!rpParent) { response.error = 'Parent not found: ' + rpParentId; break; }
                if (!('appendChild' in rpParent)) {
                    response.error = 'Target "' + (rpParent as SceneNode).name + '" (' + rpParent.type + ') cannot contain children.';
                    break;
                }
                // Guard against cycles: parent must not be the node itself or a descendant.
                var rpCursor: BaseNode | null = rpParent;
                var rpCycle = false;
                while (rpCursor) {
                    if (rpCursor.id === rpNode.id) { rpCycle = true; break; }
                    rpCursor = rpCursor.parent;
                }
                if (rpCycle) { response.error = 'Cannot move a node into itself or its own descendant.'; break; }

                var rpContainer = rpParent as BaseNode & ChildrenMixin;
                var rpIndex = (req.params && typeof req.params.index === 'number') ? req.params.index : -1;
                if (rpIndex >= 0 && rpIndex <= rpContainer.children.length) {
                    rpContainer.insertChild(rpIndex, rpNode);
                } else {
                    rpContainer.appendChild(rpNode);
                }
                response.data = { id: rpNode.id, parentId: rpContainer.id };
                break;
            }

            case 'delete_node': {
                var delNodeId = (req.nodeIds && req.nodeIds[0]) || '';
                var delNode = figma.getNodeById(delNodeId) as SceneNode | null;
                if (!delNode) { response.error = 'Node not found: ' + delNodeId; break; }
                var delName = delNode.name;
                delNode.remove();
                response.data = { id: delNodeId, name: delName, deleted: true };
                break;
            }

            case 'list_nodes': {
                var lnMaxDepth = (req.params && typeof req.params.maxDepth === 'number')
                    ? req.params.maxDepth : 2;
                // Optional: list the children of a specific node instead of the page
                // root. Depths are relative to those children (1-based); the Unity
                // side offsets them by the parent's depth. Enables lazy expansion.
                var lnFromId = (req.params && typeof req.params.fromId === 'string')
                    ? req.params.fromId : null;
                var lnCap = 800; // safety limit to avoid overloading the UI
                var lnOut: Array<{ id: string; name: string; type: string; depth: number; hasChildren: boolean }> = [];
                var lnWalk = function (nodes: ReadonlyArray<SceneNode>, depth: number) {
                    for (var i = 0; i < nodes.length; i++) {
                        if (lnOut.length >= lnCap) return;
                        var n = nodes[i];
                        var kids = ('children' in n) ? (n as ChildrenMixin).children : [];
                        lnOut.push({
                            id: n.id,
                            name: n.name,
                            type: n.type,
                            depth: depth,
                            hasChildren: kids.length > 0,
                        });
                        if (depth < lnMaxDepth && kids.length > 0)
                            lnWalk(kids as ReadonlyArray<SceneNode>, depth + 1);
                    }
                };
                var lnRoots: ReadonlyArray<SceneNode>;
                if (lnFromId) {
                    var lnNode = figma.getNodeById(lnFromId);
                    lnRoots = (lnNode && 'children' in lnNode)
                        ? (lnNode as ChildrenMixin).children as ReadonlyArray<SceneNode>
                        : [];
                } else {
                    lnRoots = figma.currentPage.children;
                }
                lnWalk(lnRoots, 1);
                response.data = { nodes: lnOut, page: figma.currentPage.name, truncated: lnOut.length >= lnCap };
                break;
            }

            case 'figma_build': {
                var bp: any = req.params || {};
                if (!bp.contract) throw new Error('figma_build: missing params.contract');
                response.data = await buildContract(bp.contract, bp.parentId);
                break;
            }

            case 'figma_set_fill': {
                response.data = setFill(firstNodeId(req), ((req.params || {}) as any).paint);
                break;
            }

            case 'figma_set_stroke': {
                response.data = setStroke(firstNodeId(req), ((req.params || {}) as any).stroke);
                break;
            }

            case 'figma_set_text': {
                response.data = await setText(firstNodeId(req), ((req.params || {}) as any).text || {});
                break;
            }

            case 'figma_set_effects': {
                response.data = setEffects(firstNodeId(req), ((req.params || {}) as any).effects);
                break;
            }

            case 'figma_set_layout': {
                response.data = setLayout(firstNodeId(req), ((req.params || {}) as any).layout);
                break;
            }

            case 'figma_move_resize': {
                response.data = moveResize(firstNodeId(req), ((req.params || {}) as any).rect);
                break;
            }

            case 'figma_place_asset': {
                response.data = await placeAsset(firstNodeId(req), ((req.params || {}) as any).source);
                break;
            }

            case 'figma_create_node': {
                var cp: any = req.params || {};
                if (!cp.parentId || !cp.node) throw new Error('figma_create_node: missing parentId or node');
                response.data = await createNodeUnder(cp.parentId, cp.node, cp.index);
                break;
            }

            case 'figma_delete_node': {
                response.data = deleteNode(firstNodeId(req));
                break;
            }

            case 'figma_rename_node': {
                var rp: any = req.params || {};
                if (!rp.name) throw new Error('figma_rename_node: missing name');
                response.data = renameNode(firstNodeId(req), rp.name);
                break;
            }

            case 'figma_create_component': {
                var ccp: any = req.params || {};
                var ccIds: string[] = req.nodeIds || [];
                if (ccIds.length === 0) throw new Error('figma_create_component: missing nodeIds');
                response.data = createComponents(ccIds, ccp.combineAsVariants, ccp.name);
                break;
            }

            case 'figma_create_variable_collection': {
                var cvp: any = req.params || {};
                if (!cvp.name) throw new Error('figma_create_variable_collection: missing name');
                response.data = createVariableCollection(cvp.name, cvp.modes, cvp.variables);
                break;
            }

            case 'figma_bind_variable': {
                var bvp: any = req.params || {};
                if (!bvp.field || !bvp.variableId) {
                    throw new Error('figma_bind_variable: missing field or variableId');
                }
                response.data = await bindVariable(firstNodeId(req), bvp.field, bvp.variableId);
                break;
            }

            default:
                response.error = 'Unknown MCP request type: ' + req.type;
        }
    } catch (err) {
        response.error = err instanceof Error ? err.message : String(err);
    }

    postToUI({ type: 'mcp-response', payload: response });
}
