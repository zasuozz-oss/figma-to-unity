// =============================================================================
// UI Logic — Plugin Panel
// Layer tree with expand/collapse, per-element checkbox, merge, click-to-preview
// =============================================================================

declare const JSZip: any;
declare const __BUILD_VERSION__: string;
declare const __BUILD_NUMBER__: string;

// Show version in UI footer
(function () {
    var versionEl = document.getElementById('version-label');
    if (versionEl) versionEl.textContent = 'v' + __BUILD_VERSION__ + ' build ' + __BUILD_NUMBER__;
})();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

var isExporting = false;
var selectedNodeId: string | null = null;

interface TreeNodeState {
    id: string;
    excluded: boolean;
    merge: boolean;
    exportAsPng: boolean;
    nineSlice: boolean;
    nineSliceAutoDetected: boolean;
    collapsed: boolean;
    hasChildren: boolean;
    parentId: string | null;
    depth: number;
}

var treeState: TreeNodeState[] = [];
var mergedChildIds = new Set<string>();
var currentTree: any[] = [];
var filters = { images: true, icons: true, containers: true };
var previewLocked = true;
var rootNodeId: string | null = null;
var originalNames: { nodeId: string; name: string }[] = [];
var nineSliceEnabled = true;

// parent-children map for collapse
var childrenOf = new Map<string, string[]>();

// ---------------------------------------------------------------------------
// DOM Elements
// ---------------------------------------------------------------------------

var noSelectionEl = document.getElementById('no-selection')!;
var optionsBarEl = document.getElementById('options-bar')!;
var contentEl = document.getElementById('content')!;
var treePanelEl = document.getElementById('tree-panel')!;
var treeSearchInput = document.getElementById('tree-search-input') as HTMLInputElement;
var scaleSelectEl = document.getElementById('scale-select') as HTMLSelectElement;
var exportBtnEl = document.getElementById('export-btn') as HTMLButtonElement;
var selInfoEl = document.getElementById('sel-info')!;
var progressAreaEl = document.getElementById('progress-area')!;
var progressBarEl = document.getElementById('progress-bar')!;
var progressLabelEl = document.getElementById('progress-label')!;
var errorMsgEl = document.getElementById('error-msg')!;
var logAreaEl = document.getElementById('log-area')!;
var logEl = document.getElementById('log')!;

// Search filter
var treeSearchTerm = '';
var filter9sActive = false;
treeSearchInput.addEventListener('input', function () {
    treeSearchTerm = treeSearchInput.value.trim().toLowerCase();
    renderTree();
});

// Preview panel
var previewPanelEl = document.getElementById('preview-panel')!;
var previewTitleEl = document.getElementById('preview-title')!;
var previewImageWrapEl = document.getElementById('preview-image-wrap')!;
var previewInfoEl = document.getElementById('preview-info')!;



// Preview is always visible — no close needed

// Lock preview button
var previewLockBtn = document.getElementById('preview-lock')!;
previewLockBtn.textContent = '🔒';
previewLockBtn.classList.add('locked');
previewLockBtn.title = 'Locked (canvas & preview)';
// Send initial lock state to main
parent.postMessage({
    pluginMessage: { type: 'lock-canvas', locked: true },
}, '*');
previewLockBtn.addEventListener('click', function () {
    previewLocked = !previewLocked;
    previewLockBtn.textContent = previewLocked ? '🔒' : '🔓';
    previewLockBtn.classList.toggle('locked', previewLocked);
    previewLockBtn.title = previewLocked ? 'Locked (canvas & preview)' : 'Lock canvas & preview';
    // Tell main thread about lock state
    parent.postMessage({
        pluginMessage: { type: 'lock-canvas', locked: previewLocked },
    }, '*');
    if (previewLocked) {
        requestPreviewRefresh();
    }
});

// 9-Slice global toggle (also triggers re-detect)
var nineSliceToggleBtn = document.getElementById('nine-slice-toggle')!;
nineSliceToggleBtn.addEventListener('click', function () {
    toggleGlobalNineSlice();
});

// 9S filter button in search bar
var filter9sBtn = document.getElementById('filter-9s-btn')!;
filter9sBtn.addEventListener('click', function () {
    filter9sActive = !filter9sActive;
    if (filter9sActive) filter9sBtn.classList.add('active');
    else filter9sBtn.classList.remove('active');
    renderTree();
});

// Reload button
var reloadBtn = document.getElementById('reload-btn')!;
reloadBtn.addEventListener('click', function () {
    parent.postMessage({ pluginMessage: { type: 'reload' } }, '*');
});

// Rename prefix input
var renamePrefixInput = document.getElementById('rename-prefix')! as any;
var undoRenameBtn = document.getElementById('undo-rename')!;

// Rename all button
var renameAllBtn = document.getElementById('rename-all')!;
renameAllBtn.addEventListener('click', function () {
    renameAllElements();
});

// Undo rename button
undoRenameBtn.addEventListener('click', function () {
    undoRename();
});

// Size buttons: S / M / L
var SIZE_PRESETS: Record<string, { w: number; h: number }> = {
    's': { w: 480, h: 600 },
    'm': { w: 600, h: 750 },
    'l': { w: 800, h: 900 },
};
document.querySelectorAll('.size-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
        var el = this as HTMLElement;
        var sizeKey = el.getAttribute('data-size') || 'm';
        var preset = SIZE_PRESETS[sizeKey] || SIZE_PRESETS['m'];
        // Update active state
        document.querySelectorAll('.size-btn').forEach(function (b) {
            (b as HTMLElement).classList.remove('active');
        });
        el.classList.add('active');
        // Ask main thread to resize
        parent.postMessage({
            pluginMessage: { type: 'resize-ui', width: preset.w, height: preset.h },
        }, '*');
    });
});

// ---------------------------------------------------------------------------
// Scale parsing
// ---------------------------------------------------------------------------

function getSelectedScale() {
    var raw = scaleSelectEl.value;
    var parts = raw.split(':');
    var prefix = parts[0];
    var value = parseFloat(parts[1]);
    if (prefix === 'w') return { type: 'WIDTH' as const, value: value };
    if (prefix === 'h') return { type: 'HEIGHT' as const, value: value };
    return { type: 'SCALE' as const, value: value };
}

// ---------------------------------------------------------------------------
// Export button
// ---------------------------------------------------------------------------

exportBtnEl.addEventListener('click', function () {
    if (isExporting) return;
    isExporting = true;
    exportBtnEl.disabled = true;
    exportBtnEl.textContent = '⏳ Exporting...';
    errorMsgEl.classList.remove('visible');
    progressAreaEl.classList.add('visible');
    logAreaEl.classList.remove('visible');
    logEl.textContent = '';

    var configs = treeState.map(function (s) {
        return { id: s.id, excluded: s.excluded, merge: s.merge, exportAsPng: s.exportAsPng, nineSlice: s.nineSlice, nineSliceAutoDetected: s.nineSliceAutoDetected };
    });

    parent.postMessage({
        pluginMessage: {
            type: 'export',
            scale: getSelectedScale(),
            options: {
                includeText: true,
                includeImages: filters.images,
                includeIcons: filters.icons,
                includeContainers: filters.containers,
            },
            elementConfigs: configs,
        },
    }, '*');
});

// ---------------------------------------------------------------------------
// Tree panel expand/collapse toggle
// ---------------------------------------------------------------------------

var treeResizeBtn = document.getElementById('tree-resize-btn')!;
var treeViewMode = 0; // 0=normal, 1=expanded, 2=full
var contentEl = document.getElementById('content')!;

treeResizeBtn.addEventListener('click', function () {
    treeViewMode = (treeViewMode + 1) % 3;
    contentEl.classList.remove('tree-expanded', 'tree-full');
    if (treeViewMode === 1) {
        contentEl.classList.add('tree-expanded');
        treeResizeBtn.textContent = '◁';
        treeResizeBtn.title = 'Show tree only';
    } else if (treeViewMode === 2) {
        contentEl.classList.add('tree-full');
        treeResizeBtn.textContent = '▷';
        treeResizeBtn.title = 'Reset to normal view';
    } else {
        treeResizeBtn.textContent = '◀';
        treeResizeBtn.title = 'Expand tree panel';
    }
});

// ---------------------------------------------------------------------------
// Import settings
// ---------------------------------------------------------------------------

var importSettingsBtn = document.getElementById('import-settings-btn')!;
var importSettingsFile = document.getElementById('import-settings-file') as HTMLInputElement;

importSettingsBtn.addEventListener('click', function () {
    importSettingsFile.click();
});

importSettingsFile.addEventListener('change', function () {
    var file = importSettingsFile.files && importSettingsFile.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function () {
        try {
            var data = JSON.parse(reader.result as string);
            if (!data.elements || !Array.isArray(data.elements)) {
                alert('Invalid settings file: missing elements array');
                return;
            }
            applyImportedSettings(data);
        } catch (e) {
            alert('Failed to parse settings file');
        }
    };
    reader.readAsText(file);
    // Reset so same file can be imported again
    importSettingsFile.value = '';
});

function applyImportedSettings(data: any) {
    var imported = data.elements as { id: string; name: string; excluded: boolean; merge: boolean }[];

    // Build lookup by name (primary) and id (fallback)
    var byName = new Map<string, { excluded: boolean; merge: boolean }>();
    var byId = new Map<string, { excluded: boolean; merge: boolean }>();
    for (var i = 0; i < imported.length; i++) {
        var entry = imported[i];
        if (entry.name) byName.set(entry.name, { excluded: entry.excluded, merge: entry.merge });
        if (entry.id) byId.set(entry.id, { excluded: entry.excluded, merge: entry.merge });
    }

    // Apply to treeState — match by name first (more stable across sessions), fallback to id
    var applied = 0;
    for (var j = 0; j < treeState.length; j++) {
        var name = currentTree[j] ? currentTree[j].name : '';
        var match = byName.get(name) || byId.get(treeState[j].id);
        if (match) {
            treeState[j].excluded = match.excluded;
            treeState[j].merge = match.merge;
            applied++;
        }
    }

    // Apply filters if present
    if (data.filters) {

        if (typeof data.filters.images === 'boolean') filters.images = data.filters.images;
        if (typeof data.filters.icons === 'boolean') filters.icons = data.filters.icons;
        if (typeof data.filters.containers === 'boolean') filters.containers = data.filters.containers;

        // Update filter chips UI
        document.querySelectorAll('.filter-chip').forEach(function (chip: any) {
            var key = (chip as HTMLElement).getAttribute('data-filter');
            if (key && key in filters) {
                if ((filters as any)[key]) {
                    (chip as HTMLElement).classList.add('active');
                } else {
                    (chip as HTMLElement).classList.remove('active');
                }
            }
        });
    }

    // Re-render tree
    renderTree();
    alert('Settings imported! ' + applied + '/' + treeState.length + ' elements matched.');
}
// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

window.onmessage = function (event) {
    var msg = event.data.pluginMessage;
    if (!msg) return;

    switch (msg.type) {
        case 'no-selection':
            showNoSelection();
            break;
        case 'selection-info':
            showSelection(msg.name, msg.elementCount, msg.tree);
            // Auto-highlight child if clicked in Figma
            if (msg.selectedChildId) {
                // Find the child in treeState (it may be the exact ID or a parent of the clicked node)
                var foundIdx = -1;
                for (var fi = 0; fi < treeState.length; fi++) {
                    if (treeState[fi].id === msg.selectedChildId) {
                        foundIdx = fi;
                        break;
                    }
                }
                if (foundIdx >= 0) {
                    selectedNodeId = treeState[foundIdx].id;
                    // Expand all ancestors: walk backwards from foundIdx, uncollapse any node with smaller depth
                    var targetDepth = treeState[foundIdx].depth;
                    for (var ei = foundIdx - 1; ei >= 0; ei--) {
                        if (treeState[ei].depth < targetDepth) {
                            treeState[ei].collapsed = false;
                            targetDepth = treeState[ei].depth;
                        }
                        if (targetDepth <= 0) break;
                    }
                    renderTree();
                    // Scroll to the highlighted element
                    var highlightedRow = document.querySelector('.tree-row.selected');
                    if (highlightedRow) highlightedRow.scrollIntoView({ block: 'nearest' });
                }
            }
            break;
        case 'progress':
            updateProgress(msg.current, msg.total, msg.label);
            break;
        case 'export-complete':
            handleExportComplete(msg.manifest, msg.assets);
            break;
        case 'export-error':
            showError(msg.message);
            break;
        case 'element-preview':
            showElementPreview(msg);
            break;
        case 'visibility-changed':
            handleVisibilityChanged(msg.changes);
            break;
        case 'lock-changed':
            handleLockChanged(msg.changes);
            break;
        case 'highlight-tree-element':
            // Figma selection changed while locked — highlight in tree and expand parents
            selectedNodeId = msg.nodeId;
            // Expand collapsed ancestors so the element is visible
            for (var hIdx = 0; hIdx < treeState.length; hIdx++) {
                if (treeState[hIdx].id === msg.nodeId) {
                    var hDepth = treeState[hIdx].depth;
                    for (var hPi = hIdx - 1; hPi >= 0; hPi--) {
                        if (treeState[hPi].depth < hDepth) {
                            treeState[hPi].collapsed = false;
                            hDepth = treeState[hPi].depth;
                        }
                        if (hDepth <= 0) break;
                    }
                    break;
                }
            }
            renderTree();
            var hRow = document.querySelector('.tree-row.selected');
            if (hRow) hRow.scrollIntoView({ block: 'nearest' });
            break;
        case 'single-png-ready': {
            var uint8 = new Uint8Array(msg.data);
            var blob = new Blob([uint8], { type: 'image/png' });
            downloadBlob(blob, msg.name);
            break;
        }
        case 'mcp-response':
            mcpSendToServer(msg.payload);
            break;
    }
};

// ---------------------------------------------------------------------------
// UI updates
// ---------------------------------------------------------------------------

function showNoSelection() {
    noSelectionEl.style.display = 'flex';
    optionsBarEl.classList.remove('visible');
    contentEl.classList.remove('visible');
    exportBtnEl.disabled = true;
    selInfoEl.textContent = '';
}

function showSelection(name: string, count: number, tree: any[]) {
    noSelectionEl.style.display = 'none';
    optionsBarEl.classList.add('visible');
    contentEl.classList.add('visible');
    exportBtnEl.disabled = false;
    selInfoEl.textContent = name + ' · ' + count;
    currentTree = tree;
    initTreeState(tree);
    renderTree();

    // Auto-preview root element
    if (tree.length > 0) {
        rootNodeId = tree[0].id;
        selectedNodeId = tree[0].id;
        requestPreviewRefresh();
    }
}

function updateProgress(current: number, total: number, label: string) {
    var pct = total > 0 ? Math.round((current / total) * 100) : 0;
    progressBarEl.style.width = pct + '%';
    progressLabelEl.textContent = label + ' (' + current + '/' + total + ')';
    appendLog('  ✅ ' + label);
}

function showError(message: string) {
    isExporting = false;
    exportBtnEl.disabled = false;
    exportBtnEl.textContent = '▶ Export for Unity';
    progressAreaEl.classList.remove('visible');
    errorMsgEl.textContent = '❌ ' + message;
    errorMsgEl.classList.add('visible');
}

function appendLog(line: string) {
    logAreaEl.classList.add('visible');
    logEl.textContent += line + '\n';
    logEl.scrollTop = logEl.scrollHeight;
}

// ---------------------------------------------------------------------------
// Tree state management
// ---------------------------------------------------------------------------

function initTreeState(tree: any[]) {
    var parentStack: string[] = [];
    treeState = [];
    childrenOf = new Map();

    for (var i = 0; i < tree.length; i++) {
        var el = tree[i];
        while (parentStack.length > el.depth) {
            parentStack.pop();
        }
        var parentId = parentStack.length > 0 ? parentStack[parentStack.length - 1] : null;

        // Root (depth 0) expanded, all other containers collapsed by default
        var defaultCollapsed = el.hasChildren && el.depth > 0;

        // Auto-detect 9-slice candidates (only when global 9S is enabled):
        // Leaf elements (no children) that are shape types with size > 32px
        // or any leaf element with cornerRadius > 0
        // Elements WITH children are containers (bg, frame) — NOT 9S candidates
        var candidateTypes = ['FRAME', 'GROUP', 'RECTANGLE', 'COMPONENT', 'INSTANCE', 'VECTOR', 'ELLIPSE', 'LINE', 'STAR', 'POLYGON', 'BOOLEAN_OPERATION'];
        // DEBUG: trace 9S detection for specific elements
        if (el.name === 'rect_14' || el.name === 'mask' || el.name === 'rect_3' || el.name === 'rect') {
            console.log('[9S-DEBUG] ' + el.name + ': type=' + el.figmaType
                + ' depth=' + el.depth
                + ' hasChildren=' + el.hasChildren
                + ' hasGradient=' + el.hasGradient
                + ' w=' + el.size.w + ' h=' + el.size.h
                + ' cornerRadius=' + el.cornerRadius
                + ' nineSliceEnabled=' + nineSliceEnabled
                + ' inCandidateTypes=' + (candidateTypes.indexOf(el.figmaType) >= 0));
        }
        var isCandidate = nineSliceEnabled
            && el.depth > 0
            && !el.hasChildren
            && !el.hasGradient
            && el.size.w > 32 && el.size.h > 32
            && (candidateTypes.indexOf(el.figmaType) >= 0 || el.cornerRadius > 0);

        treeState.push({
            id: el.id,
            excluded: !el.visible, // Auto-exclude hidden elements
            merge: !!el.locked,
            exportAsPng: false,
            nineSlice: isCandidate,
            nineSliceAutoDetected: isCandidate,
            collapsed: defaultCollapsed,
            hasChildren: el.hasChildren,
            parentId: parentId,
            depth: el.depth,
        });

        // Build children map
        if (parentId) {
            if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
            childrenOf.get(parentId)!.push(el.id);
        }

        if (el.hasChildren) {
            parentStack.push(el.id);
        }
    }

    updateMergedChildren();
}

function updateMergedChildren() {
    mergedChildIds = new Set();
    var mergedParents = new Set<string>();
    for (var i = 0; i < treeState.length; i++) {
        if (treeState[i].merge) mergedParents.add(treeState[i].id);
    }
    for (var i = 0; i < treeState.length; i++) {
        var s = treeState[i];
        if (s.parentId && (mergedParents.has(s.parentId) || mergedChildIds.has(s.parentId))) {
            mergedChildIds.add(s.id);
        }
    }
}

function isHiddenByCollapse(index: number): boolean {
    // Check if any ancestor is collapsed
    var s = treeState[index];
    var currentParentId = s.parentId;
    while (currentParentId) {
        for (var j = 0; j < treeState.length; j++) {
            if (treeState[j].id === currentParentId) {
                if (treeState[j].collapsed) return true;
                currentParentId = treeState[j].parentId;
                break;
            }
        }
        if (j >= treeState.length) break;
    }
    return false;
}

function getAllDescendants(id: string): string[] {
    var result: string[] = [];
    var children = childrenOf.get(id) || [];
    for (var i = 0; i < children.length; i++) {
        result.push(children[i]);
        result = result.concat(getAllDescendants(children[i]));
    }
    return result;
}

function toggleCollapse(id: string) {
    for (var i = 0; i < treeState.length; i++) {
        if (treeState[i].id === id) {
            treeState[i].collapsed = !treeState[i].collapsed;
            break;
        }
    }
    renderTree();
}

function toggleExclude(id: string) {
    for (var i = 0; i < treeState.length; i++) {
        if (treeState[i].id === id) {
            treeState[i].excluded = !treeState[i].excluded;
            // Sync visibility to Figma: excluded = hidden
            parent.postMessage({
                pluginMessage: { type: 'toggle-visibility', nodeId: id, visible: !treeState[i].excluded },
            }, '*');
            break;
        }
    }
    renderTree();
    requestPreviewRefresh();
}

function resetAll() {
    var nodeIds: string[] = [];
    for (var i = 0; i < treeState.length; i++) {
        if (treeState[i].excluded) {
            nodeIds.push(treeState[i].id);
        }
        treeState[i].excluded = false;
        treeState[i].merge = false;
        treeState[i].nineSlice = treeState[i].nineSliceAutoDetected;
        if (i > 0) treeState[i].collapsed = true;
    }
    updateMergedChildren();
    // Reset visibility on Figma for all previously excluded nodes
    if (nodeIds.length > 0) {
        parent.postMessage({
            pluginMessage: { type: 'reset-all-visibility', nodeIds: nodeIds },
        }, '*');
    }
    renderTree();
    requestPreviewRefresh();
}

function toSnakeCase(str: string): string {
    return str
        .replace(/([a-z])([A-Z])/g, '$1_$2')   // camelCase → camel_case
        .replace(/[^a-zA-Z0-9]+/g, '_')         // special chars → _
        .replace(/_{2,}/g, '_')                  // collapse __
        .replace(/^_|_$/g, '')                   // trim leading/trailing _
        .toLowerCase();
}

function simplifyName(name: string, figmaType: string): string {
    var sn = toSnakeCase(name);
    // If name is generic (Frame 1, Rectangle 2, etc.), use type-based name
    if (/^(frame|rectangle|ellipse|vector|group|component|instance|text|line|polygon|star|boolean)_?\d*$/.test(sn)) {
        var typeMap: Record<string, string> = {
            'FRAME': 'frame', 'GROUP': 'group', 'RECTANGLE': 'rect',
            'ELLIPSE': 'ellipse', 'TEXT': 'txt', 'VECTOR': 'vec',
            'COMPONENT': 'comp', 'INSTANCE': 'inst', 'LINE': 'line',
            'POLYGON': 'polygon', 'STAR': 'star', 'BOOLEAN_OPERATION': 'bool',
        };
        sn = typeMap[figmaType] || sn;
    }
    return sn;
}

function renameAllElements() {
    if (currentTree.length === 0) return;

    // Save original names if not already saved
    if (originalNames.length === 0) {
        for (var s = 0; s < currentTree.length; s++) {
            originalNames.push({ nodeId: currentTree[s].id, name: currentTree[s].name });
        }
    }

    // Get prefix from input or auto-detect from root name
    var inputPrefix = renamePrefixInput.value.trim();
    var prefix: string;
    if (inputPrefix) {
        prefix = toSnakeCase(inputPrefix);
    } else {
        prefix = toSnakeCase(currentTree[0].name);
        renamePrefixInput.value = prefix;
    }

    var figmaRenames: { nodeId: string; newName: string }[] = [];
    var localNames: { nodeId: string; newName: string }[] = [];
    var usedNames: Record<string, number> = {};

    // Root element: Figma gets short name (prefix itself), local gets prefix
    var rootShortName = prefix;
    figmaRenames.push({ nodeId: currentTree[0].id, newName: rootShortName });
    localNames.push({ nodeId: currentTree[0].id, newName: prefix });
    usedNames[prefix] = 1;

    // Children: Figma gets short name, local gets prefix + short name
    for (var i = 1; i < currentTree.length; i++) {
        var el = currentTree[i];
        // Strip existing prefix from name if present (for re-rename sync)
        var baseName = el.name;
        if (prefix && baseName.indexOf(prefix) === 0) {
            baseName = baseName.substring(prefix.length);
            if (baseName.charAt(0) === '_') baseName = baseName.substring(1);
            if (!baseName) baseName = el.name; // fallback if name IS the prefix
        }
        var childPart = simplifyName(baseName, el.figmaType);
        var fullName = prefix + '_' + childPart;

        // Handle duplicates with numeric suffix
        if (usedNames[fullName]) {
            usedNames[fullName]++;
            childPart = childPart + '_' + usedNames[fullName];
            fullName = prefix + '_' + childPart;
        } else {
            usedNames[fullName] = 1;
        }

        // Figma: only short name (no prefix)
        figmaRenames.push({ nodeId: el.id, newName: childPart });
        // Local tree: full name with prefix (for export)
        localNames.push({ nodeId: el.id, newName: fullName });
    }

    // Send short names to Figma (no prefix applied)
    parent.postMessage({
        pluginMessage: { type: 'rename-elements', renames: figmaRenames },
    }, '*');

    // Update local tree with full prefixed names (for export)
    for (var j = 0; j < localNames.length; j++) {
        for (var k = 0; k < currentTree.length; k++) {
            if (currentTree[k].id === localNames[j].nodeId) {
                currentTree[k].name = localNames[j].newName;
                break;
            }
        }
    }

    // Show undo button
    undoRenameBtn.style.display = '';
    renderTree();
    requestPreviewRefresh();
}

function undoRename() {
    if (originalNames.length === 0) return;

    // Restore names locally
    for (var i = 0; i < originalNames.length; i++) {
        for (var k = 0; k < currentTree.length; k++) {
            if (currentTree[k].id === originalNames[i].nodeId) {
                currentTree[k].name = originalNames[i].name;
                break;
            }
        }
    }

    // Send restore to Figma
    var renames: { nodeId: string; newName: string }[] = [];
    for (var j = 0; j < originalNames.length; j++) {
        renames.push({ nodeId: originalNames[j].nodeId, newName: originalNames[j].name });
    }
    parent.postMessage({
        pluginMessage: { type: 'rename-elements', renames: renames },
    }, '*');

    // Clear backup and hide undo button
    originalNames = [];
    undoRenameBtn.style.display = 'none';
    renamePrefixInput.value = '';
    renderTree();
    requestPreviewRefresh();
}
function toggleMerge(id: string) {
    for (var i = 0; i < treeState.length; i++) {
        if (treeState[i].id === id) {
            treeState[i].merge = !treeState[i].merge;
            // Sync lock state on Figma
            parent.postMessage({
                pluginMessage: {
                    type: 'toggle-lock',
                    nodeId: id,
                    locked: treeState[i].merge,
                },
            }, '*');
            break;
        }
    }
    updateMergedChildren();
    renderTree();
    requestPreviewRefresh();
}

function toggleExportAsPng(id: string) {
    for (var i = 0; i < treeState.length; i++) {
        if (treeState[i].id === id) {
            treeState[i].exportAsPng = !treeState[i].exportAsPng;
            break;
        }
    }
    renderTree();
}

function toggleNineSlice(id: string) {
    for (var i = 0; i < treeState.length; i++) {
        if (treeState[i].id === id) {
            treeState[i].nineSlice = !treeState[i].nineSlice;
            break;
        }
    }
    renderTree();
}

function toggleGlobalNineSlice() {
    nineSliceEnabled = !nineSliceEnabled;
    var toggleBtn = document.getElementById('nine-slice-toggle');
    if (toggleBtn) {
        if (nineSliceEnabled) toggleBtn.classList.add('active');
        else toggleBtn.classList.remove('active');
    }
    // When toggling off: clear all 9-slice flags
    // When toggling on: re-run auto-detect
    if (!nineSliceEnabled) {
        for (var i = 0; i < treeState.length; i++) {
            treeState[i].nineSlice = false;
            treeState[i].nineSliceAutoDetected = false;
        }
    } else {
        reDetectNineSlice();
    }
    renderTree();
}

function reDetectNineSlice() {
    // Same logic as initTreeState — only leaf elements without children
    var candidateTypes = ['FRAME', 'GROUP', 'RECTANGLE', 'COMPONENT', 'INSTANCE', 'VECTOR', 'ELLIPSE', 'LINE', 'STAR', 'POLYGON', 'BOOLEAN_OPERATION'];
    for (var i = 0; i < currentTree.length; i++) {
        var el = currentTree[i];
        var isCandidate = el.depth > 0
            && !el.hasChildren
            && !el.hasGradient
            && el.size.w > 32 && el.size.h > 32
            && (candidateTypes.indexOf(el.figmaType) >= 0 || el.cornerRadius > 0);
        treeState[i].nineSlice = isCandidate;
        treeState[i].nineSliceAutoDetected = isCandidate;
    }
    renderTree();
}

function selectElement(id: string) {
    selectedNodeId = id;
    // Auto-expand: if the element has children and is collapsed, expand it
    for (var i = 0; i < treeState.length; i++) {
        if (treeState[i].id === id) {
            if (treeState[i].collapsed && currentTree[i] && currentTree[i].hasChildren) {
                treeState[i].collapsed = false;
            }
            // Also expand all ancestors so selected element is visible
            var parentId = currentTree[i] ? currentTree[i].parentId : null;
            while (parentId) {
                for (var j = 0; j < treeState.length; j++) {
                    if (treeState[j].id === parentId) {
                        treeState[j].collapsed = false;
                        parentId = currentTree[j] ? currentTree[j].parentId : null;
                        break;
                    }
                }
                if (j >= treeState.length) break;
            }
            break;
        }
    }
    renderTree();
    // Always highlight on Figma canvas
    parent.postMessage({
        pluginMessage: { type: 'highlight-element', nodeId: id },
    }, '*');
    // Only reload preview when not locked
    if (!previewLocked) {
        requestPreviewRefresh();
    }
}

// Handle visibility changes from Figma (eye icon toggled)
function handleVisibilityChanged(changes: { nodeId: string; visible: boolean }[]) {
    var anyChanged = false;
    for (var c = 0; c < changes.length; c++) {
        var change = changes[c];
        for (var i = 0; i < treeState.length; i++) {
            if (treeState[i].id === change.nodeId) {
                // hidden in Figma = excluded in plugin
                var newExcluded = !change.visible;
                if (treeState[i].excluded !== newExcluded) {
                    treeState[i].excluded = newExcluded;
                    anyChanged = true;
                }
                break;
            }
        }
    }
    if (anyChanged) {
        renderTree();
        requestPreviewRefresh();
    }
}

function handleLockChanged(changes: { nodeId: string; locked: boolean }[]) {
    var anyChanged = false;
    for (var c = 0; c < changes.length; c++) {
        var change = changes[c];
        for (var i = 0; i < treeState.length; i++) {
            if (treeState[i].id === change.nodeId) {
                // locked in Figma = merge in plugin
                if (treeState[i].merge !== change.locked) {
                    treeState[i].merge = change.locked;
                    anyChanged = true;
                }
                break;
            }
        }
    }
    if (anyChanged) {
        renderTree();
        requestPreviewRefresh();
    }
}

// Collect all excluded IDs (merged children stay visible — they're part of parent)
function getExcludedIds(): string[] {
    var ids: string[] = [];
    for (var i = 0; i < treeState.length; i++) {
        if (treeState[i].excluded) {
            ids.push(treeState[i].id);
        }
    }
    return ids;
}

// Send preview request with current excluded IDs
function requestPreviewRefresh() {
    // When locked, always show root; otherwise show selected
    var previewNodeId = previewLocked ? rootNodeId : selectedNodeId;
    if (!previewNodeId) return;
    previewImageWrapEl.innerHTML = '<span class="preview-loading">⏳ Loading...</span>';
    previewInfoEl.textContent = '';

    parent.postMessage({
        pluginMessage: {
            type: 'preview-element',
            nodeId: previewNodeId,
            excludedIds: getExcludedIds(),
        },
    }, '*');
}

// ---------------------------------------------------------------------------
// Preview rendering
// ---------------------------------------------------------------------------

function showElementPreview(msg: any) {
    previewTitleEl.textContent = msg.name;
    previewInfoEl.textContent = msg.figmaType + ' · ' + Math.round(msg.size.w) + '×' + Math.round(msg.size.h);

    if (msg.imageData && msg.imageData.length > 0) {
        var blob = new Blob([new Uint8Array(msg.imageData)], { type: 'image/png' });
        var url = URL.createObjectURL(blob);
        previewImageWrapEl.innerHTML = '<img src="' + url + '" alt="' + msg.name + '">';
    } else {
        previewImageWrapEl.innerHTML = '<span class="preview-loading">No preview</span>';
    }
}

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

function getCategory(figmaType: string, hasAsset: boolean, hasChildren: boolean): string {
    if (figmaType === 'TEXT') return 'text';
    if (figmaType === 'VECTOR' || figmaType === 'BOOLEAN_OPERATION') return 'icons';
    var containerTypes = ['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'];
    if (containerTypes.indexOf(figmaType) >= 0 && !hasAsset) return 'containers';
    return 'images';
}

var TYPE_ICONS: Record<string, string> = {
    'FRAME': '▣', 'GROUP': '◫', 'TEXT': 'T', 'RECTANGLE': '▬',
    'VECTOR': '◇', 'BOOLEAN_OPERATION': '◈', 'COMPONENT': '◆',
    'COMPONENT_SET': '▦', 'INSTANCE': '◇', 'ELLIPSE': '○', 'LINE': '—',
};
var TYPE_COLORS: Record<string, string> = {
    'FRAME': '#7b61ff', 'GROUP': '#7b61ff', 'TEXT': '#e06666',
    'RECTANGLE': '#6aa84f', 'VECTOR': '#93c47d', 'BOOLEAN_OPERATION': '#e69138',
    'COMPONENT': '#6fa8dc', 'COMPONENT_SET': '#6fa8dc', 'INSTANCE': '#6fa8dc',
    'ELLIPSE': '#6aa84f', 'LINE': '#999',
};

// ---------------------------------------------------------------------------
// Tree rendering
// ---------------------------------------------------------------------------

function renderTree() {
    treePanelEl.innerHTML = '';

    for (var i = 0; i < currentTree.length; i++) {
        var el = currentTree[i];
        var state = treeState[i];
        if (!state) continue;

        // Skip if hidden by collapsed parent (but not when searching)
        // During 9S filter, still respect collapse so expand/collapse works
        if (!treeSearchTerm && i > 0 && isHiddenByCollapse(i)) continue;

        // Search filter — skip if name doesn't match search term
        if (treeSearchTerm && el.name.toLowerCase().indexOf(treeSearchTerm) < 0) continue;

        // 9S filter — show visible (not excluded) elements that are 9-slice candidates
        if (filter9sActive) {
            var is9sCandidate = !state.excluded
                && !el.hasGradient
                && el.size.w > 32 && el.size.h > 32
                && (['FRAME', 'GROUP', 'RECTANGLE', 'COMPONENT', 'INSTANCE', 'VECTOR', 'ELLIPSE', 'LINE', 'STAR', 'POLYGON', 'BOOLEAN_OPERATION'].indexOf(el.figmaType) >= 0 || el.cornerRadius > 0);
            if (!is9sCandidate) continue;
        }

        var isMergedChild = mergedChildIds.has(el.id);
        var isSelected = selectedNodeId === el.id;

        var row = document.createElement('div');
        row.className = 'tree-item';
        if (state.excluded) row.className += ' excluded';
        if (isMergedChild) row.className += ' merged-child';
        if (isSelected) row.className += ' selected';
        row.setAttribute('data-id', el.id);

        var html = '';

        // Indent
        for (var d = 0; d < el.depth; d++) {
            html += '<span class="tree-indent"></span>';
        }

        // Expand/collapse toggle
        if (el.hasChildren) {
            var toggleClass = 'tree-toggle' + (state.collapsed ? '' : ' expanded');
            html += '<button class="' + toggleClass + '" data-toggle-id="' + el.id + '">▶</button>';
        } else {
            html += '<span class="tree-toggle hidden"></span>';
        }

        // Checkbox
        var cbChecked = !state.excluded && !isMergedChild ? ' checked' : '';
        var cbDisabled = isMergedChild ? ' disabled' : '';
        html += '<input type="checkbox" class="tree-cb" data-cb-id="' + el.id + '"' + cbChecked + cbDisabled + '>';

        // Type icon
        var icon = TYPE_ICONS[el.figmaType] || '□';
        var iconColor = TYPE_COLORS[el.figmaType] || '#999';
        html += '<span class="tree-icon" style="color:' + iconColor + '">' + icon + '</span>';

        // Name — show short version (strip prefix, replace with _)
        var nameText = el.name;
        var prefix = renamePrefixInput.value || '';
        // Auto-detect prefix from root element if input is empty
        if (!prefix && currentTree.length > 0) {
            prefix = currentTree[0].name;
        }
        if (prefix && nameText.indexOf(prefix) === 0 && nameText.length > prefix.length) {
            var rest = nameText.substring(prefix.length);
            // Skip leading _ separator if present
            if (rest.charAt(0) === '_') rest = rest.substring(1);
            nameText = '_' + rest;
        }
        if (state.merge) nameText = '🔗 ' + nameText;
        html += '<span class="tree-name" data-click-id="' + el.id + '" title="' + el.name + '">' + nameText + '</span>';


        // PNG button for TEXT elements (next to merge button area)
        if (el.figmaType === 'TEXT') {
            var pngClass = 'tree-png-btn';
            if (state.exportAsPng) pngClass += ' active';
            html += '<button class="' + pngClass + '" data-png-id="' + el.id + '" title="Export as PNG image">';
            html += 'PNG';
            html += '</button>';
        }

        // 9S button for non-TEXT elements that are candidates (container types > 64px or cornerRadius > 0 or already active)
        if (el.figmaType !== 'TEXT') {
            var isNsCandidate = !el.hasGradient
                && ((el.size.w > 32 && el.size.h > 32
                    && ['FRAME', 'GROUP', 'RECTANGLE', 'COMPONENT', 'INSTANCE', 'VECTOR', 'ELLIPSE', 'LINE', 'STAR', 'POLYGON', 'BOOLEAN_OPERATION'].indexOf(el.figmaType) >= 0)
                    || el.cornerRadius > 0)
                || state.nineSlice;
            if (isNsCandidate) {
                var nsClass = 'tree-9s-btn';
                if (state.nineSlice) nsClass += ' active';
                if (state.nineSliceAutoDetected && state.nineSlice) nsClass += ' auto';
                html += '<button class="' + nsClass + '" data-9s-id="' + el.id + '" title="9-Slice: export @1x + apply border">';
                html += '9S';
                html += '</button>';
            }
        }

        // Merge button
        var mergeClass = 'tree-merge-btn';
        if (el.hasChildren) mergeClass += ' show';
        if (state.merge) mergeClass += ' active';
        html += '<button class="' + mergeClass + '" data-merge-id="' + el.id + '">';
        html += state.merge ? '⊞' : '⊞';
        html += '</button>';

        row.innerHTML = html;
        treePanelEl.appendChild(row);
    }

    // Bind events
    treePanelEl.querySelectorAll('[data-toggle-id]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleCollapse((this as HTMLElement).getAttribute('data-toggle-id')!);
        });
    });

    treePanelEl.querySelectorAll('[data-cb-id]').forEach(function (cb) {
        cb.addEventListener('change', function (e) {
            e.stopPropagation();
            toggleExclude((this as HTMLElement).getAttribute('data-cb-id')!);
        });
    });

    treePanelEl.querySelectorAll('[data-merge-id]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleMerge((this as HTMLElement).getAttribute('data-merge-id')!);
        });
    });

    treePanelEl.querySelectorAll('[data-png-id]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleExportAsPng((this as HTMLElement).getAttribute('data-png-id')!);
        });
    });

    treePanelEl.querySelectorAll('[data-9s-id]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleNineSlice((this as HTMLElement).getAttribute('data-9s-id')!);
        });
    });

    treePanelEl.querySelectorAll('[data-click-id]').forEach(function (nameEl) {
        nameEl.addEventListener('click', function (e) {
            e.stopPropagation();
            selectElement((this as HTMLElement).getAttribute('data-click-id')!);
        });

        // Double-click to inline rename
        nameEl.addEventListener('dblclick', function (e) {
            e.stopPropagation();
            e.preventDefault();
            startInlineRename((this as HTMLElement).getAttribute('data-click-id')!, this as HTMLElement);
        });
    });

    // Right-click context menu on tree rows
    treePanelEl.querySelectorAll('.tree-item').forEach(function (row) {
        row.addEventListener('contextmenu', function (e: any) {
            e.preventDefault();
            e.stopPropagation();
            var nodeId = (this as HTMLElement).getAttribute('data-id');
            if (!nodeId) return;
            ctxTargetNodeId = nodeId;
            ctxMenuEl.style.left = e.clientX + 'px';
            ctxMenuEl.style.top = e.clientY + 'px';
            ctxMenuEl.classList.add('visible');
        });
    });
}

// ---------------------------------------------------------------------------
// Inline rename (used by dblclick + context menu)
// ---------------------------------------------------------------------------

function startInlineRename(nodeId: string, nameSpan?: HTMLElement) {
    // Find tree index
    var treeIdx = -1;
    for (var ti = 0; ti < currentTree.length; ti++) {
        if (currentTree[ti].id === nodeId) { treeIdx = ti; break; }
    }
    if (treeIdx < 0) return;

    // Find or locate the name span
    var el = nameSpan;
    if (!el) {
        el = treePanelEl.querySelector('[data-click-id="' + nodeId + '"]') as HTMLElement;
        if (!el) return;
    }

    var fullName = currentTree[treeIdx].name;

    // Determine prefix
    var prefix = renamePrefixInput.value || '';
    if (!prefix && currentTree.length > 0) {
        prefix = currentTree[0].name;
    }

    var editName = fullName;
    var hasPrefix = false;
    if (prefix && fullName.indexOf(prefix) === 0 && fullName.length > prefix.length) {
        var rest = fullName.substring(prefix.length);
        if (rest.charAt(0) === '_') rest = rest.substring(1);
        editName = rest;
        hasPrefix = true;
    }

    // Create input
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'tree-name-input';
    input.value = editName;
    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.select();

    var committed = false;

    function commitRename() {
        if (committed) return;
        committed = true;
        var newShortName = input.value.trim();
        if (!newShortName) {
            renderTree();
            return;
        }

        var newFullName: string;
        var figmaName: string;
        if (hasPrefix && prefix) {
            newFullName = prefix + '_' + newShortName;
            figmaName = newShortName; // Don't apply prefix to Figma
        } else {
            newFullName = newShortName;
            figmaName = newShortName;
        }

        currentTree[treeIdx].name = newFullName;

        parent.postMessage({
            pluginMessage: {
                type: 'rename-elements',
                renames: [{ nodeId: nodeId, newName: figmaName }],
            },
        }, '*');

        renderTree();
        requestPreviewRefresh();
    }

    input.addEventListener('keydown', function (ke: any) {
        if (ke.key === 'Enter') {
            ke.preventDefault();
            commitRename();
        } else if (ke.key === 'Escape') {
            committed = true;
            renderTree();
        }
    });

    input.addEventListener('blur', function () {
        commitRename();
    });
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

var ctxMenuEl = document.getElementById('ctx-menu')!;
var ctxTargetNodeId = '';

// Close menu on click anywhere
document.addEventListener('click', function () {
    ctxMenuEl.classList.remove('visible');
});

// Rename
document.getElementById('ctx-rename')!.addEventListener('click', function () {
    ctxMenuEl.classList.remove('visible');
    if (ctxTargetNodeId) startInlineRename(ctxTargetNodeId);
});

// Toggle visibility
document.getElementById('ctx-toggle')!.addEventListener('click', function () {
    ctxMenuEl.classList.remove('visible');
    if (ctxTargetNodeId) toggleExclude(ctxTargetNodeId);
});

// Toggle merge
document.getElementById('ctx-merge')!.addEventListener('click', function () {
    ctxMenuEl.classList.remove('visible');
    if (ctxTargetNodeId) toggleMerge(ctxTargetNodeId);
});

// Export this element (single PNG download)
document.getElementById('ctx-export')!.addEventListener('click', function () {
    ctxMenuEl.classList.remove('visible');
    if (!ctxTargetNodeId) return;

    parent.postMessage({
        pluginMessage: {
            type: 'export-single-png',
            nodeId: ctxTargetNodeId,
            scale: getSelectedScale(),
        },
    }, '*');
});

// ---------------------------------------------------------------------------
// ZIP assembly + download
// ---------------------------------------------------------------------------

function handleExportComplete(manifestJson: string, assets: any[]) {
    appendLog('\n📦 Packing ZIP...');
    appendLog('  📄 manifest.json');

    // Generate settings.json for re-import
    var settingsData = {
        version: '1.0',
        elements: treeState.map(function (s, idx) {
            var name = currentTree[idx] ? currentTree[idx].name : '';
            return { id: s.id, name: name, excluded: s.excluded, merge: s.merge };
        }),
        filters: filters,
    };
    var settingsJson = JSON.stringify(settingsData, null, 2);

    loadJSZip().then(function () {
        var zip = new JSZip();
        zip.file('manifest.json', manifestJson);
        zip.file('settings.json', settingsJson);
        appendLog('  ⚙️ settings.json');
        for (var i = 0; i < assets.length; i++) {
            var uint8 = new Uint8Array(assets[i].data);
            zip.file(assets[i].name, uint8);
            appendLog('  🖼️ ' + assets[i].name);
        }
        return zip.generateAsync({
            type: 'blob', compression: 'DEFLATE',
            compressionOptions: { level: 6 },
        });
    }).then(function (blob: Blob) {
        var rootName = currentTree.length > 0 ? currentTree[0].name : 'export';
        var zipFileName = rootName.replace(/[^a-zA-Z0-9_-]/g, '_') + '.zip';
        downloadBlob(blob, zipFileName);
        appendLog('\n✅ Export complete!');
        isExporting = false;
        exportBtnEl.disabled = false;
        exportBtnEl.textContent = '▶ Export for Unity';
        progressBarEl.style.width = '100%';
        progressLabelEl.textContent = 'Done!';

        // Success popup removed — save file dialog is sufficient
    }).catch(function (err: Error) {
        showError('ZIP failed: ' + err.message);
    });
}

function showExportSuccessPopup(fileName: string, assetCount: number) {
    var popup = document.getElementById('export-success-popup')!;
    var detail = document.getElementById('export-success-detail')!;
    var closeBtn = document.getElementById('export-success-close')!;

    detail.textContent = fileName + '\n' + assetCount + ' assets exported';
    popup.style.display = 'flex';

    function closePopup() {
        popup.style.display = 'none';
        closeBtn.removeEventListener('click', closePopup);
        popup.removeEventListener('click', onOverlayClick);
    }
    function onOverlayClick(e: any) {
        if (e.target === popup) closePopup();
    }
    closeBtn.addEventListener('click', closePopup);
    popup.addEventListener('click', onOverlayClick);
}

var jsZipLoaded = false;
function loadJSZip(): Promise<void> {
    if (jsZipLoaded && typeof JSZip !== 'undefined') return Promise.resolve();
    return new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        script.onload = function () { jsZipLoaded = true; resolve(); };
        script.onerror = function () { reject(new Error('Failed to load JSZip')); };
        document.head.appendChild(script);
    });
}

function downloadBlob(blob: Blob, fileName: string) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

// =============================================================================
// Minimize / Restore
// =============================================================================

var isMinimized = false;
var savedWidth = 600;
var savedHeight = 750;
var minimizeBtn = document.getElementById('minimize-btn')!;
var minimizedBar = document.getElementById('minimized-bar')!;

function doMinimize() {
    isMinimized = true;
    document.body.classList.add('minimized');
    parent.postMessage({ pluginMessage: { type: 'resize-ui', width: 250, height: 36 } }, '*');
}
function doRestore() {
    isMinimized = false;
    document.body.classList.remove('minimized');
    parent.postMessage({ pluginMessage: { type: 'resize-ui', width: savedWidth, height: savedHeight } }, '*');
}
minimizeBtn.addEventListener('click', doMinimize);
minimizedBar.addEventListener('click', doRestore);

// =============================================================================
// Mode Tabs — Export / MCP
// =============================================================================

document.querySelectorAll('.mode-tab').forEach(function (tab: any) {
    tab.addEventListener('click', function () {
        var mode = tab.getAttribute('data-mode'); // 'export' or 'mcp'
        document.body.className = 'mode-' + mode;
        document.querySelectorAll('.mode-tab').forEach(function (t: any) { t.classList.remove('active'); });
        tab.classList.add('active');
    });
});

// =============================================================================
// MCP Bridge — WebSocket Client
// =============================================================================

var mcpSocket: WebSocket | null = null;
var mcpReconnectTimer: number | null = null;
var mcpIconEl = document.getElementById('mcp-icon')!;

function mcpSetState(state: 'connected' | 'disconnected' | 'reconnecting') {
    mcpIconEl.className = 'mcp-icon ' + state;
    var labels: Record<string, string> = {
        connected: 'MCP Bridge: Connected',
        disconnected: 'MCP Bridge: Disconnected',
        reconnecting: 'MCP Bridge: Reconnecting...',
    };
    mcpIconEl.title = labels[state] || '';

    // Sync MCP panel
    var panelIcon = document.getElementById('mcp-panel-icon');
    var panelStatus = document.getElementById('mcp-panel-status');
    if (panelIcon) panelIcon.className = 'mcp-panel-icon ' + state;
    if (panelStatus) panelStatus.textContent = labels[state] || '';

    // Sync minimized bar
    var miniDot = document.getElementById('mini-dot');
    var miniLabel = document.getElementById('mini-label');
    var shortLabels: Record<string, string> = {
        connected: 'MCP: Connected',
        disconnected: 'MCP: Disconnected',
        reconnecting: 'MCP: Reconnecting...',
    };
    if (miniDot) miniDot.className = 'mini-dot ' + state;
    if (miniLabel) miniLabel.textContent = shortLabels[state] || '';
}

function mcpConnect() {
    if (mcpSocket) mcpSocket.close();
    mcpSetState('reconnecting');

    var ws = new WebSocket('ws://localhost:1994/ws');
    mcpSocket = ws;

    ws.onopen = function () { mcpSetState('connected'); };
    ws.onclose = function () {
        mcpSetState('disconnected');
        if (mcpReconnectTimer === null) {
            mcpReconnectTimer = window.setTimeout(function () {
                mcpReconnectTimer = null;
                mcpConnect();
            }, 3000);
        }
    };
    ws.onerror = function () { /* onclose will fire */ };
    ws.onmessage = function (event) {
        try {
            var payload = JSON.parse(event.data);
            parent.postMessage({ pluginMessage: { type: 'mcp-request', payload: payload } }, '*');
        } catch (e) {
            console.error('[MCP] Invalid message from server');
        }
    };
}

function mcpSendToServer(payload: any) {
    if (mcpSocket && mcpSocket.readyState === WebSocket.OPEN) {
        mcpSocket.send(JSON.stringify(payload));
    }
}

// Start MCP connection
mcpConnect();
