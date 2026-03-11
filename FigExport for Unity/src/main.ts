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

// Show the plugin UI
figma.showUI(__html__, { width: 600, height: 750, themeColors: true });

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

    // Validate type — if invalid (e.g. GROUP), walk up to nearest valid parent
    const validTypes = ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'];
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

    // Walk up to nearest valid parent if selection is a GROUP or other invalid type
    const validTypes = ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'];
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
