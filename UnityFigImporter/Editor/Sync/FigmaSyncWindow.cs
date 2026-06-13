using System.Collections.Generic;
using System.IO;
using FigmaImporter;
using FigmaImporter.Data;
using Newtonsoft.Json.Linq;
using TMPro;
using UnityEditor;
using UnityEditor.IMGUI.Controls;
using UnityEngine;

namespace FigmaImporter.Sync
{
    public class FigmaSyncWindow : EditorWindow
    {
        const string PREF_PORT = "FigmaSync_Port";
        const string PREF_SPRITE_FOLDER = "FigmaImporter_SpriteFolder";
        const string PREF_LIB_W = "FigmaSync_LibWidth";
        const string PREF_NODE_W = "FigmaSync_NodeWidth";
        const string PREF_LOG_H = "FigmaSync_LogHeight";
        const string PREF_SCALE = "FigmaSync_ExportScale";
        const string PREF_PIPELINE = "FigmaSync_RenderPipeline";

        // Resizable pane sizes (persisted via EditorPrefs).
        float _libraryWidth = 200f;
        float _nodeTreeWidth = 240f;
        float _logHeight = 60f;

        int _port = 1994;
        string _figmaUrl = "";
        string _selectionName = "";
        bool _showSettings = true;
        OutputMode _outputMode = OutputMode.Both;
        string _prefabSavePath = "Assets/Prefabs/UI/";
        string _spriteOutputFolder = "";

        // Build options ported from the legacy importer window.
        float _exportScale = 2f;                       // Figma PNG export scale (sprite quality).
        RenderPipeline _renderPipeline = RenderPipeline.UGUI; // UGUI Canvas vs 2D GameObject (SpriteRenderer).
        readonly BuildOptions _buildOptions = new BuildOptions();
        readonly CanvasSettings _canvasSettings = new CanvasSettings();
        CanvasScalePreset _canvasScalePreset = CanvasScalePreset.Scale2x;
        bool _showCanvasSettings = true;
        Canvas[] _sceneCanvases;
        string[] _sceneCanvasNames;
        int _selectedCanvasIndex;

        enum CanvasScalePreset { Auto, Scale1x, Scale1_5x, Scale2x, Scale3x, Scale4x, Custom }

        FigmaBridgeClient.HealthInfo _health;
        string _status = "";
        bool _statusIsError;

        string _syncedFolder;
        string _syncedUrl;
        List<BuildLogEntry> _lastLog;
        ImportDescriptor.Data _lastImport;

        List<SyncLibrary.Entry> _entries = new List<SyncLibrary.Entry>();
        string _search = "";
        SyncLibrary.Entry _selected;
        Texture2D _selectedPreview;
        float _zoom = 1f;
        bool _fitZoom = true;
        Vector2 _listScroll, _previewScroll, _logScroll;

        ManifestData _manifest;
        readonly Dictionary<string, ElementData> _elementsById = new Dictionary<string, ElementData>();
        TreeViewState _treeState;
        FigmaNodeTreeView _treeView;
        string _highlightElementId;

        // Staged tree edits: renames/reorders are applied locally only and pushed to
        // Figma on demand via "Sync to Figma" (no per-edit hot reload). "Sync from
        // Figma" re-pulls the live document and discards anything still staged here.
        readonly Dictionary<string, string> _pendingRenames = new Dictionary<string, string>();
        readonly List<(string child, string parent, int index)> _pendingMoves =
            new List<(string, string, int)>();
        bool HasPendingEdits => _pendingRenames.Count > 0 || _pendingMoves.Count > 0;

        // Browse Figma: lazy tree of the current page. Scan loads only the top level
        // (so it matches the Figma Layers panel exactly, no truncation); a node's
        // children are fetched on demand when it is expanded.
        bool _showBrowse;
        int _browseMaxDepth = 1;           // how many levels to auto-expand when a node is clicked (1..3).
        string _browseSearch = "";
        Vector2 _browseScroll;
        readonly List<FigmaBridgeClient.NodeBrief> _browseRows = new List<FigmaBridgeClient.NodeBrief>();
        bool _browseLoadedOnce;            // whether Scan has run at least once.
        string _browseSelectedId;          // node id of the highlighted Browse row.
        readonly HashSet<string> _browseExpanded = new HashSet<string>(); // expanded node ids.
        readonly HashSet<string> _browseChildrenLoaded = new HashSet<string>(); // ids whose children are in _browseRows.
        static readonly string[] DepthLabels = { "1", "2", "3" };

        // Detail tabs: 0 = Preview (node tree + render), 1 = Fonts.
        int _detailTab;
        static readonly string[] DetailTabs = { "Preview", "Fonts" };

        // Font mapping: "family|style" → TMP_FontAsset (null = missing in project).
        Dictionary<string, TMP_FontAsset> _fontMapping;
        TMP_FontAsset _fallbackFont;
        GUIStyle _missingFontStyle;

        [MenuItem("Window/Figma/Dashboard")]
        public static void Open()
        {
            GetWindow<FigmaSyncWindow>("Figma Dashboard");
        }

        void OnEnable()
        {
            _port = EditorPrefs.GetInt(PREF_PORT, 1994);
            _spriteOutputFolder = EditorPrefs.GetString(
                PREF_SPRITE_FOLDER,
                Path.Combine(Application.dataPath, "FigmaImport").Replace('\\', '/'));
            if (string.IsNullOrEmpty(_spriteOutputFolder))
                _spriteOutputFolder = Path.Combine(Application.dataPath, "FigmaImport").Replace('\\', '/');
            _libraryWidth = EditorPrefs.GetFloat(PREF_LIB_W, 200f);
            _nodeTreeWidth = EditorPrefs.GetFloat(PREF_NODE_W, 240f);
            _logHeight = EditorPrefs.GetFloat(PREF_LOG_H, 60f);
            _exportScale = EditorPrefs.GetFloat(PREF_SCALE, 2f);
            _renderPipeline = (RenderPipeline)EditorPrefs.GetInt(PREF_PIPELINE, (int)RenderPipeline.UGUI);
            RefreshLibrary();
        }

        FigmaBridgeClient Client => new FigmaBridgeClient(_port);

        void OnGUI()
        {
            DrawSettings();
            EditorGUILayout.Space(4);
            EditorGUILayout.BeginHorizontal();
            DrawLibraryList();
            _libraryWidth = VerticalSplitter(_libraryWidth, 120f, 400f, PREF_LIB_W);
            DrawDetail();
            EditorGUILayout.EndHorizontal();
            EditorGUILayout.Space(4);
            DrawStatus();
        }

        void DrawTopBar()
        {
            EditorGUILayout.BeginHorizontal();
            if (GUILayout.Button("Use current Figma selection", GUILayout.Width(190)))
            {
                if (Client.TryGetSelection(out var sel, out var err))
                {
                    _figmaUrl = !string.IsNullOrEmpty(sel.url) ? sel.url : sel.nodeId;
                    _selectionName = sel.name;
                    SetStatus($"Selected: {sel.name} ({sel.nodeId})", false);
                }
                else SetStatus(err, true);
            }
            _figmaUrl = EditorGUILayout.TextField(_figmaUrl);
            using (new EditorGUI.DisabledScope(string.IsNullOrWhiteSpace(_figmaUrl)))
            {
                if (GUILayout.Button("Preview", GUILayout.Width(60)))
                    DoSync();
            }
            EditorGUILayout.EndHorizontal();
            if (!string.IsNullOrEmpty(_selectionName))
                EditorGUILayout.LabelField("Selection", _selectionName);
        }

        /// <summary>
        /// Header "Browse Figma" foldout: a live, depth-limited (2-3) flat list of
        /// the current Figma page's nodes. Search filters this list only. Click a
        /// name to select it on Figma; press Sync to run the normal sync pipeline.
        /// </summary>
        void DrawBrowseFigma()
        {
            _showBrowse = EditorGUILayout.Foldout(_showBrowse, "Browse Figma (current page)", true);
            if (!_showBrowse) return;

            EditorGUILayout.BeginHorizontal();
            if (GUILayout.Button("Scan", GUILayout.Width(70))) RefreshFigmaNodes();
            GUILayout.Label("Depth", GUILayout.Width(40));
            // 1/2/3 = how many levels to auto-expand when you click a node.
            _browseMaxDepth = GUILayout.Toolbar(_browseMaxDepth - 1, DepthLabels, GUILayout.Width(96)) + 1;
            GUILayout.FlexibleSpace();
            EditorGUILayout.EndHorizontal();

            _browseSearch = EditorGUILayout.TextField(_browseSearch, EditorStyles.toolbarSearchField);

            if (!_browseLoadedOnce)
            {
                GUILayout.Label("Press Scan to load nodes from the open Figma page.", EditorStyles.miniLabel);
                return;
            }

            if (!string.IsNullOrEmpty(_browseSelectedId))
                EditorGUILayout.LabelField("Selected", $"{_selectionName}  ({_browseSelectedId})", EditorStyles.miniLabel);

            bool searching = !string.IsNullOrEmpty(_browseSearch);
            _browseScroll = EditorGUILayout.BeginScrollView(_browseScroll, GUILayout.Height(160));
            // _browseRows is a pre-order DFS list (children are inserted right after
            // their parent). A collapsed node hides every deeper row until depth
            // returns to its level. Mutations are deferred until after the loop so we
            // never modify the list mid-iteration. Search shows a flat filtered list.
            FigmaBridgeClient.NodeBrief toToggle = null, toSelect = null;
            string toSync = null;
            int hideBelow = int.MaxValue;
            foreach (var n in _browseRows)
            {
                if (searching)
                {
                    if (n.name.IndexOf(_browseSearch, System.StringComparison.OrdinalIgnoreCase) < 0)
                        continue;
                }
                else
                {
                    if (n.depth > hideBelow) continue; // inside a collapsed subtree
                    hideBelow = int.MaxValue;
                }

                bool isSel = n.id == _browseSelectedId;
                bool expanded = _browseExpanded.Contains(n.id);
                var prevBg = GUI.backgroundColor;
                if (isSel) GUI.backgroundColor = new Color(0.4f, 0.7f, 1f, 0.6f);
                EditorGUILayout.BeginHorizontal(isSel ? EditorStyles.helpBox : GUIStyle.none);
                GUI.backgroundColor = prevBg;
                GUILayout.Space((n.depth - 1) * 14);

                // Any node with children can be expanded — children load on demand.
                if (!searching && n.hasChildren)
                {
                    if (GUILayout.Button(expanded ? "▼" : "▶", EditorStyles.label, GUILayout.Width(16)))
                        toToggle = n;
                }
                else GUILayout.Space(16);

                var nameStyle = isSel ? EditorStyles.boldLabel : EditorStyles.label;
                if (GUILayout.Button((isSel ? "▸ " : "") + n.name, nameStyle)) toSelect = n;
                GUILayout.Label(n.type, EditorStyles.centeredGreyMiniLabel, GUILayout.Width(72));
                if (GUILayout.Button("Sync", EditorStyles.miniButton, GUILayout.Width(48)))
                    toSync = n.id;
                EditorGUILayout.EndHorizontal();

                // Collapsed node with children → hide its subtree below this depth.
                if (!searching && n.hasChildren && !expanded) hideBelow = n.depth;
            }
            EditorGUILayout.EndScrollView();

            // Apply deferred row actions now that iteration is finished.
            if (toToggle != null) ToggleExpand(toToggle);
            if (toSelect != null) SelectBrowseNode(toSelect);
            if (toSync != null) DoSyncNode(toSync, toSync);
        }

        void ToggleExpand(FigmaBridgeClient.NodeBrief n)
        {
            if (_browseExpanded.Remove(n.id)) return; // was expanded → collapse
            EnsureChildren(n);
            _browseExpanded.Add(n.id);
        }

        /// <summary>
        /// Click a Browse row: mark it selected, auto-expand its subtree to the chosen
        /// Depth (lazy-loading each level), auto-fill the node id + selection name into
        /// the top bar (so Preview works), and select it on Figma.
        /// </summary>
        void SelectBrowseNode(FigmaBridgeClient.NodeBrief n)
        {
            _browseSelectedId = n.id;
            _figmaUrl = n.id;
            _selectionName = n.name;
            ExpandTo(n, _browseMaxDepth);
            SelectOnFigma(n.id, verbose: true);
        }

        void RefreshFigmaNodes()
        {
            // Load only the page's top level so the list matches Figma's Layers panel
            // exactly. Children are fetched on demand as nodes are expanded.
            _browseExpanded.Clear();
            _browseChildrenLoaded.Clear();
            _browseRows.Clear();
            if (Client.TryListNodes(1, out var res, out var err))
            {
                _browseLoadedOnce = true;
                if (res.nodes != null) _browseRows.AddRange(res.nodes);
                SetStatus($"Loaded {_browseRows.Count} top-level node(s) from \"{res.page}\".", false);
            }
            else { _browseLoadedOnce = false; SetStatus("Browse Figma failed: " + err, true); }
        }

        /// <summary>Fetch a node's direct children (once) and insert them right after it.</summary>
        void EnsureChildren(FigmaBridgeClient.NodeBrief n)
        {
            if (!n.hasChildren || _browseChildrenLoaded.Contains(n.id)) return;
            if (!Client.TryListNodes(1, out var res, out var err, fromId: n.id))
            {
                SetStatus("Load children failed: " + err, true);
                return;
            }
            _browseChildrenLoaded.Add(n.id);
            int idx = _browseRows.IndexOf(n);
            if (idx < 0 || res.nodes == null) return;
            int insertAt = idx + 1;
            foreach (var c in res.nodes)
            {
                c.depth = n.depth + 1; // plugin returns relative depth; offset to absolute.
                _browseRows.Insert(insertAt++, c);
            }
        }

        /// <summary>Auto-expand a node's subtree to the given number of levels (lazy-loading each).</summary>
        void ExpandTo(FigmaBridgeClient.NodeBrief root, int levels)
        {
            if (!root.hasChildren) return;
            EnsureChildren(root);
            _browseExpanded.Add(root.id);
            var frontier = new List<FigmaBridgeClient.NodeBrief> { root };
            for (int level = 1; level < levels; level++)
            {
                var next = new List<FigmaBridgeClient.NodeBrief>();
                foreach (var parent in frontier)
                    foreach (var child in DirectChildren(parent))
                        if (child.hasChildren)
                        {
                            EnsureChildren(child);
                            _browseExpanded.Add(child.id);
                            next.Add(child);
                        }
                if (next.Count == 0) break;
                frontier = next;
            }
        }

        /// <summary>The direct children of a node currently present in _browseRows.</summary>
        List<FigmaBridgeClient.NodeBrief> DirectChildren(FigmaBridgeClient.NodeBrief parent)
        {
            var result = new List<FigmaBridgeClient.NodeBrief>();
            int idx = _browseRows.IndexOf(parent);
            if (idx < 0) return result;
            for (int i = idx + 1; i < _browseRows.Count; i++)
            {
                var c = _browseRows[i];
                if (c.depth <= parent.depth) break;
                if (c.depth == parent.depth + 1) result.Add(c);
            }
            return result;
        }

        void DrawSettings()
        {
            _showSettings = EditorGUILayout.Foldout(_showSettings, "Settings", true);
            if (!_showSettings) return;
            using (new EditorGUI.IndentLevelScope())
            {
                DrawConnection();
                DrawOptions();
                if (GUILayout.Button("Reset layout", GUILayout.Width(120)))
                    ResetLayout();
            }
        }

        void ResetLayout()
        {
            _libraryWidth = 200f;
            _nodeTreeWidth = 240f;
            _logHeight = 60f;
            EditorPrefs.DeleteKey(PREF_LIB_W);
            EditorPrefs.DeleteKey(PREF_NODE_W);
            EditorPrefs.DeleteKey(PREF_LOG_H);
            Repaint();
        }

        void DrawConnection()
        {
            EditorGUILayout.BeginHorizontal();
            int newPort = EditorGUILayout.IntField("Port", _port);
            if (newPort != _port) { _port = newPort; EditorPrefs.SetInt(PREF_PORT, _port); }
            if (GUILayout.Button("Check", GUILayout.Width(60)))
            {
                if (Client.TryHealth(out _health, out var err))
                    SetStatus($"Bridge OK (plugin {(_health.pluginConnected ? "connected" : "NOT connected")})", !_health.pluginConnected);
                else { _health = null; SetStatus(err, true); }
            }
            EditorGUILayout.EndHorizontal();

            if (_health == null)
            {
                EditorGUILayout.HelpBox("Bridge offline. Open Figma Desktop + plugin, or spawn standalone.", MessageType.Warning);
                BridgeLauncher.BridgeDir = EditorGUILayout.TextField("Bridge dir", BridgeLauncher.BridgeDir);
                BridgeLauncher.NodePath = EditorGUILayout.TextField("node path", BridgeLauncher.NodePath);
                if (GUILayout.Button("Spawn standalone bridge"))
                {
                    if (BridgeLauncher.TrySpawn(_port, out var err)) SetStatus("Spawned bridge - press Check in ~2s.", false);
                    else SetStatus(err, true);
                }
            }
        }

        void DrawOptions()
        {
            // Render pipeline: UGUI Canvas vs 2D GameObject (SpriteRenderer).
            var newPipeline = (RenderPipeline)EditorGUILayout.EnumPopup("Build As", _renderPipeline);
            if (newPipeline != _renderPipeline)
            {
                _renderPipeline = newPipeline;
                EditorPrefs.SetInt(PREF_PIPELINE, (int)_renderPipeline);
            }
            if (_renderPipeline == RenderPipeline.Object2D)
                EditorGUILayout.HelpBox(
                    "2D Object mode: SpriteRenderer in world space, no UGUI Canvas.",
                    MessageType.Info);

            _outputMode = (OutputMode)EditorGUILayout.EnumPopup("Output Mode", _outputMode);
            if (_outputMode == OutputMode.Prefab || _outputMode == OutputMode.Both)
                _prefabSavePath = EditorGUILayout.TextField("Prefab Save Path", _prefabSavePath);

            // Figma export scale (sprite/PNG quality). Default 2x.
            var newScale = EditorGUILayout.Slider("Export Scale", _exportScale, 1f, 4f);
            if (!Mathf.Approximately(newScale, _exportScale))
            {
                _exportScale = newScale;
                EditorPrefs.SetFloat(PREF_SCALE, _exportScale);
            }

            var newSpriteFolder = EditorGUILayout.TextField("Sprite Folder", _spriteOutputFolder);
            if (newSpriteFolder != _spriteOutputFolder)
            {
                _spriteOutputFolder = newSpriteFolder;
                EditorPrefs.SetString(PREF_SPRITE_FOLDER, _spriteOutputFolder);
            }

            // Build options.
            _buildOptions.ImportTextures = EditorGUILayout.Toggle("Import Textures", _buildOptions.ImportTextures);
            _buildOptions.DisableRaycastTarget = EditorGUILayout.Toggle("Disable Raycast Target", _buildOptions.DisableRaycastTarget);
            _buildOptions.ScaleToUnityResolution = EditorGUILayout.Toggle("Scale To Unity Resolution", _buildOptions.ScaleToUnityResolution);

            // Canvas settings only apply to UGUI builds.
            if (_renderPipeline == RenderPipeline.UGUI)
                DrawCanvasSettings();
        }

        /// <summary>
        /// Canvas options ported from the legacy importer: choose an existing scene
        /// Canvas or create a new one (render mode, scale preset, reference resolution,
        /// match width/height).
        /// </summary>
        void DrawCanvasSettings()
        {
            _showCanvasSettings = EditorGUILayout.Foldout(_showCanvasSettings, "Canvas Settings", true);
            if (!_showCanvasSettings) return;
            using (new EditorGUI.IndentLevelScope())
            {
                _canvasSettings.Target = (CanvasSettings.CanvasTarget)EditorGUILayout.EnumPopup(
                    "Canvas Target", _canvasSettings.Target);

                if (_canvasSettings.Target == CanvasSettings.CanvasTarget.UseExisting)
                {
                    RefreshSceneCanvases();
                    if (_sceneCanvasNames != null && _sceneCanvasNames.Length > 0)
                    {
                        _selectedCanvasIndex = EditorGUILayout.Popup("Canvas", _selectedCanvasIndex, _sceneCanvasNames);
                        if (_selectedCanvasIndex >= 0 && _selectedCanvasIndex < _sceneCanvases.Length)
                            _canvasSettings.ExistingCanvas = _sceneCanvases[_selectedCanvasIndex];
                    }
                    else
                        EditorGUILayout.HelpBox("No Canvas found in scene. Switch to 'Create New'.", MessageType.Warning);
                }
                else
                {
                    _canvasSettings.RenderMode = (RenderMode)EditorGUILayout.EnumPopup("Render Mode", _canvasSettings.RenderMode);

                    var newPreset = (CanvasScalePreset)EditorGUILayout.EnumPopup("Canvas Scale", _canvasScalePreset);
                    if (newPreset != _canvasScalePreset) { _canvasScalePreset = newPreset; ApplyCanvasScalePreset(); }

                    if (_canvasScalePreset == CanvasScalePreset.Custom)
                        _canvasSettings.ReferenceResolution = EditorGUILayout.Vector2Field(
                            "Reference Resolution", _canvasSettings.ReferenceResolution);
                    else
                        EditorGUILayout.LabelField("Reference Resolution",
                            $"{_canvasSettings.ReferenceResolution.x:F0}×{_canvasSettings.ReferenceResolution.y:F0}");

                    _canvasSettings.MatchWidthOrHeight = EditorGUILayout.Slider(
                        "Match Width/Height", _canvasSettings.MatchWidthOrHeight, 0f, 1f);
                }
            }
        }

        void RefreshSceneCanvases()
        {
            _sceneCanvases = Object.FindObjectsOfType<Canvas>();
            _sceneCanvasNames = new string[_sceneCanvases.Length];
            for (int i = 0; i < _sceneCanvases.Length; i++)
                _sceneCanvasNames[i] = _sceneCanvases[i].gameObject.name;
            if (_selectedCanvasIndex >= _sceneCanvases.Length) _selectedCanvasIndex = 0;
        }

        // Map the scale preset to a multiplier (Auto derives from the manifest).
        float GetPresetScaleValue()
        {
            switch (_canvasScalePreset)
            {
                case CanvasScalePreset.Scale1x: return 1f;
                case CanvasScalePreset.Scale1_5x: return 1.5f;
                case CanvasScalePreset.Scale2x: return 2f;
                case CanvasScalePreset.Scale3x: return 3f;
                case CanvasScalePreset.Scale4x: return 4f;
                case CanvasScalePreset.Auto: return GetManifestCanvasScale();
                default: return 1f;
            }
        }

        // Derive canvas scale from manifest's unityRefResolution / figmaSize (match height).
        float GetManifestCanvasScale()
        {
            if (_manifest?.Screen == null) return 1f;
            if (_manifest.Screen.UnityRefResolution != null && _manifest.Screen.FigmaSize != null
                && _manifest.Screen.FigmaSize.H > 0)
            {
                float derived = _manifest.Screen.UnityRefResolution.H / _manifest.Screen.FigmaSize.H;
                if (derived > 0.1f) return derived;
            }
            return 1f;
        }

        // Fill reference resolution from the active preset and the selected manifest.
        void ApplyCanvasScalePreset()
        {
            if (_manifest?.Screen?.FigmaSize == null) return;
            if (_canvasScalePreset == CanvasScalePreset.Custom) return;
            float scale = GetPresetScaleValue();
            _canvasSettings.ReferenceResolution = new Vector2(
                _manifest.Screen.FigmaSize.W * scale,
                _manifest.Screen.FigmaSize.H * scale);
        }

        void DoSync()
        {
            var nodeId = FigmaSyncUrl.ExtractNodeId(_figmaUrl);
            if (nodeId == null)
            {
                SetStatus("Invalid Figma URL or node-id.", true);
                return;
            }
            DoSyncNode(nodeId, _figmaUrl);
        }

        /// <summary>
        /// Export a Figma node into the library, render the Unity preview, and
        /// select it. Shared by the URL "Preview" button and the Browse list's
        /// per-node "Sync" button (same pipeline as syncing the current node).
        /// </summary>
        void DoSyncNode(string nodeId, string sourceUrl)
        {
            try
            {
                EditorUtility.DisplayProgressBar("Figma Sync", "Exporting from Figma...", 0.3f);
                var outputDir = SyncLibrary.FolderFor(nodeId);
                if (!Client.TryExportElement(nodeId, outputDir, out var export, out var err, _exportScale))
                {
                    SetStatus(err, true);
                    return;
                }

                EditorUtility.DisplayProgressBar("Figma Sync", "Importing into Unity preview...", 0.6f);
                var request = new ImportRequest
                {
                    ExportFolder = export.outputDir,
                    SpriteOutputFolder = _spriteOutputFolder,
                };
                var preview = FigmaPreviewRenderer.ImportAndRender(
                    request, Path.Combine(export.outputDir, "unity-preview.png"));
                _lastLog = preview.Log;
                _lastImport = null;
                _syncedFolder = export.outputDir;
                _syncedUrl = sourceUrl;

                RefreshLibrary();
                Select(_entries.Find(e => e.Folder == export.outputDir)
                       ?? SyncLibrary.Load(export.outputDir));

                if (preview.Success)
                    SetStatus($"Synced {export.name} ({export.nodeCount} nodes). Unity preview ready.", false);
                else
                    SetStatus($"Synced {export.name} but Unity import failed. See log below.", true);
            }
            finally
            {
                EditorUtility.ClearProgressBar();
            }
        }

        void DoBuild(SyncLibrary.Entry entry)
        {
            if (entry == null) return;
            EditorUtility.DisplayProgressBar("Figma Sync", "Building...", 0.5f);
            try
            {
                // Refresh the reference resolution from the selected manifest before building.
                if (_renderPipeline == RenderPipeline.UGUI
                    && _canvasSettings.Target == CanvasSettings.CanvasTarget.CreateNew)
                    ApplyCanvasScalePreset();

                var request = new ImportRequest
                {
                    ExportFolder = entry.Folder,
                    OutputMode = _outputMode,
                    RenderPipeline = _renderPipeline,
                    PrefabSavePath = _prefabSavePath,
                    SpriteOutputFolder = _spriteOutputFolder,
                    BuildOptions = _buildOptions,
                    CanvasSettings = _renderPipeline == RenderPipeline.UGUI ? _canvasSettings : null,
                    // Honor the Font detect tab's mapping (user picks + fallback);
                    // null lets the runner auto-match by itself.
                    FontMapping = _fontMapping,
                };
                var result = FigmaImportRunner.Run(request);
                if (_outputMode == OutputMode.None && result.Root != null)
                {
                    Object.DestroyImmediate(result.Root);
                    result.Root = null;
                }
                _lastLog = result.Log;
                if (!result.Success)
                {
                    SetStatus("Build failed: " + string.Join(" | ", result.Log.ConvertAll(e => e.Message)), true);
                    return;
                }

                bool createsPrefab = _outputMode == OutputMode.Prefab || _outputMode == OutputMode.Both;
                string prefabPath = createsPrefab
                    ? ResolvePrefabAssetPath(_prefabSavePath, result.RootName)
                    : null;
                GameObject prefab = null;
                if (createsPrefab)
                {
                    prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
                    if (prefab != null) EditorGUIUtility.PingObject(prefab);
                }
                _lastImport = prefab != null
                    ? new ImportDescriptor.Data
                    {
                        name = entry.Name,
                        nodeId = entry.NodeId,
                        canonicalUrl = entry.Folder == _syncedFolder && !string.IsNullOrEmpty(_syncedUrl)
                            ? _syncedUrl : entry.NodeId,
                        outputDir = entry.Folder,
                        prefabPath = prefabPath,
                    }
                    : null;
                var suffix = prefab != null
                    ? $" -> {prefabPath}"
                    : createsPrefab
                        ? $" but prefab was not found at {prefabPath}"
                    : $" with Output Mode {_outputMode}; no prefab was created.";
                SetStatus($"Built {result.RootName} ({entry.NodeCount} nodes){suffix}", prefab == null && createsPrefab);
            }
            finally
            {
                EditorUtility.ClearProgressBar();
            }
        }

        static string ResolvePrefabAssetPath(string savePath, string rootName)
        {
            if (string.IsNullOrEmpty(savePath))
                savePath = "Assets/Prefabs/UI/";
            savePath = savePath.Replace('\\', '/');
            if (AssetDatabase.IsValidFolder(savePath) || savePath.EndsWith("/"))
                return Path.Combine(savePath, rootName + ".prefab").Replace('\\', '/');
            return savePath.EndsWith(".prefab") ? savePath : savePath + ".prefab";
        }

        void RefreshLibrary()
        {
            _entries = SyncLibrary.List();
            if (_selected != null)
            {
                _selected = _entries.Find(e => e.Folder == _selected.Folder);
                if (_selected == null) _selectedPreview = null;
                else LoadSelectedPreview();
                BuildNodeTree();
            }
        }

        void DrawLibraryList()
        {
            EditorGUILayout.BeginVertical(GUILayout.Width(_libraryWidth));
            if (GUILayout.Button("Refresh")) RefreshLibrary();
            _search = EditorGUILayout.TextField(_search, EditorStyles.toolbarSearchField);
            _listScroll = EditorGUILayout.BeginScrollView(_listScroll);
            foreach (var entry in _entries)
            {
                if (!string.IsNullOrEmpty(_search) &&
                    entry.Name.IndexOf(_search, System.StringComparison.OrdinalIgnoreCase) < 0)
                    continue;
                EditorGUILayout.BeginHorizontal();
                var style = entry == _selected ? EditorStyles.boldLabel : EditorStyles.label;
                if (GUILayout.Button(entry.Name, style)) Select(entry);
                GUILayout.Label(SyncLibrary.FormatAge(entry.SyncedAtUtc), EditorStyles.miniLabel, GUILayout.Width(36));
                EditorGUILayout.EndHorizontal();
            }
            EditorGUILayout.EndScrollView();
            EditorGUILayout.EndVertical();
        }

        void Select(SyncLibrary.Entry entry)
        {
            _selected = entry;
            LoadSelectedPreview();
            BuildNodeTree();
            _fitZoom = true;
            Repaint();
        }

        void BuildNodeTree()
        {
            _manifest = null;
            _fontMapping = null;
            _elementsById.Clear();
            _highlightElementId = null;
            _pendingRenames.Clear();
            _pendingMoves.Clear();

            if (_treeView == null)
            {
                _treeState = new TreeViewState();
                _treeView = new FigmaNodeTreeView(_treeState)
                {
                    ElementSelected = OnNodeSelected,
                    ElementRenamed = OnNodeRenamed,
                    ElementSelectOnFigma = id => SelectOnFigma(id, verbose: true),
                    ElementReparented = OnNodeReparented,
                };
            }

            if (_selected == null || string.IsNullOrEmpty(_selected.ManifestPath)
                || !File.Exists(_selected.ManifestPath))
            {
                _treeView.SetData(null);
                return;
            }

            _manifest = ManifestParser.ParseFromFile(_selected.ManifestPath);
            if (_manifest?.Elements == null)
            {
                _treeView.SetData(null);
                return;
            }

            var nodes = new Dictionary<string, FigmaNodeTreeView.Node>();
            foreach (var element in _manifest.Elements)
            {
                if (string.IsNullOrEmpty(element.Id) || nodes.ContainsKey(element.Id)) continue;
                _elementsById[element.Id] = element;
                nodes[element.Id] = new FigmaNodeTreeView.Node
                {
                    ElementId = element.Id,
                    Name = element.Name,
                    FigmaType = element.FigmaType,
                };
            }

            var roots = new List<FigmaNodeTreeView.Node>();
            foreach (var element in _manifest.Elements)
            {
                if (string.IsNullOrEmpty(element.Id) || !nodes.TryGetValue(element.Id, out var node)) continue;
                if (!string.IsNullOrEmpty(element.ParentId)
                    && element.ParentId != element.Id
                    && nodes.TryGetValue(element.ParentId, out var parent))
                    parent.Children.Add(node);
                else
                    roots.Add(node);
            }
            _treeView.SetData(roots);
        }

        /// <summary>Single-click in the tree: highlight on the preview and mirror
        /// the selection onto Figma (one-way, silent if the bridge is offline).</summary>
        void OnNodeSelected(string elementId)
        {
            _highlightElementId = elementId;
            Repaint();
            if (!string.IsNullOrEmpty(elementId))
                SelectOnFigma(elementId, verbose: false);
        }

        /// <summary>Select a node on Figma via the bridge. When verbose, report
        /// success/failure in the status bar; otherwise stay silent (auto-sync).</summary>
        void SelectOnFigma(string elementId, bool verbose)
        {
            if (string.IsNullOrEmpty(elementId)) return;
            if (Client.TrySelectNode(elementId, out var err))
            {
                if (verbose) SetStatus("Selected on Figma.", false);
            }
            else if (verbose)
                SetStatus("Select on Figma failed: " + err, true);
        }

        /// <summary>
        /// Rename: persist locally (so Build works offline) and stage the change.
        /// Nothing is pushed to Figma until "Sync to Figma".
        /// </summary>
        void OnNodeRenamed(string elementId, string newName)
        {
            if (_selected == null || string.IsNullOrEmpty(_selected.ManifestPath)) return;
            try
            {
                var json = JObject.Parse(File.ReadAllText(_selected.ManifestPath));
                if (json["elements"] is JArray elements)
                {
                    foreach (var token in elements)
                    {
                        if ((string)token["id"] == elementId)
                        {
                            token["name"] = newName;
                            break;
                        }
                    }
                }
                File.WriteAllText(_selected.ManifestPath, json.ToString());
                if (_elementsById.TryGetValue(elementId, out var element))
                    element.Name = newName;
            }
            catch (System.Exception ex)
            {
                SetStatus("Rename failed: " + ex.Message, true);
                return;
            }

            _pendingRenames[elementId] = newName;
            SetStatus($"Renamed to \"{newName}\" (staged - press Sync to Figma to apply).", false);
        }

        /// <summary>Drag-drop reorder/reparent: applied to the local tree by the
        /// TreeView; here we just stage it for the next "Sync to Figma".</summary>
        void OnNodeReparented(string childId, string newParentId, int index)
        {
            _pendingMoves.Add((childId, newParentId, index));
            SetStatus("Reordered (staged - press Sync to Figma to apply).", false);
        }

        /// <summary>Push every staged rename/reorder to the live Figma document in
        /// order, then clear the staging buffers. Stops on the first error.</summary>
        void SyncToFigma()
        {
            if (!HasPendingEdits)
            {
                SetStatus("Nothing to sync - no staged edits.", false);
                return;
            }
            foreach (var kv in _pendingRenames)
            {
                if (!Client.TryRenameNode(kv.Key, kv.Value, out var err))
                {
                    SetStatus("Sync to Figma failed (rename): " + err, true);
                    return;
                }
            }
            foreach (var move in _pendingMoves)
            {
                if (!Client.TryReparentNode(move.child, move.parent, move.index, out var err))
                {
                    SetStatus("Sync to Figma failed (reorder): " + err, true);
                    return;
                }
            }
            int n = _pendingRenames.Count + _pendingMoves.Count;
            _pendingRenames.Clear();
            _pendingMoves.Clear();
            SetStatus($"Synced {n} edit(s) to Figma.", false);
        }

        /// <summary>
        /// Re-export the currently selected element from Figma into its existing
        /// folder, re-render the Unity preview, and rebuild the node tree so the
        /// dashboard reflects the live Figma state. Backs "Sync from Figma" / refresh.
        /// </summary>
        void ResyncSelected()
        {
            if (_selected == null || string.IsNullOrEmpty(_selected.NodeId)) return;
            var outputDir = _selected.Folder;
            try
            {
                EditorUtility.DisplayProgressBar("Figma Sync", "Re-syncing from Figma...", 0.4f);
                if (!Client.TryExportElement(_selected.NodeId, outputDir, out var export, out var err, _exportScale))
                {
                    SetStatus("Re-sync failed: " + err, true);
                    return;
                }
                var request = new ImportRequest
                {
                    ExportFolder = export.outputDir,
                    SpriteOutputFolder = _spriteOutputFolder,
                };
                var preview = FigmaPreviewRenderer.ImportAndRender(
                    request, Path.Combine(export.outputDir, "unity-preview.png"));
                _lastLog = preview.Log;
                RefreshLibrary();
                Select(_entries.Find(e => e.Folder == outputDir) ?? SyncLibrary.Load(outputDir));
            }
            finally
            {
                EditorUtility.ClearProgressBar();
            }
        }

        /// <summary>
        /// Absolute rect of an element in Figma units relative to the synced
        /// root (manifest rects are parent-relative; the root's own offset is
        /// its position on the Figma page, so it is excluded).
        /// </summary>
        bool TryGetElementRect(string elementId, out Rect rect)
        {
            rect = default;
            if (string.IsNullOrEmpty(elementId)
                || !_elementsById.TryGetValue(elementId, out var element)
                || element.Rect == null)
                return false;

            if (string.IsNullOrEmpty(element.ParentId))
            {
                rect = new Rect(0, 0, element.Rect.W, element.Rect.H);
                return true;
            }

            float x = element.Rect.X, y = element.Rect.Y;
            var cur = element;
            for (int guard = 0; guard < 100; guard++)
            {
                if (string.IsNullOrEmpty(cur.ParentId)
                    || !_elementsById.TryGetValue(cur.ParentId, out var parent))
                    break;
                if (string.IsNullOrEmpty(parent.ParentId)) break; // root: page offset excluded
                if (parent.Rect != null) { x += parent.Rect.X; y += parent.Rect.Y; }
                cur = parent;
            }
            rect = new Rect(x, y, element.Rect.W, element.Rect.H);
            return true;
        }

        void LoadSelectedPreview()
        {
            _selectedPreview = null;
            if (_selected == null) return;
            _selectedPreview = SyncLibrary.LoadTexture(
                _selected.UnityPreviewPath ?? _selected.PreviewPath);
        }

        void DrawDetail()
        {
            EditorGUILayout.BeginVertical();
            DrawTopBar();
            DrawBrowseFigma();
            if (_selected == null)
            {
                EditorGUILayout.HelpBox("Sync an element or select one on the left.", MessageType.Info);
                EditorGUILayout.EndVertical();
                return;
            }

            EnsureFontStyle();
            if (_fontMapping == null && _manifest?.Fonts != null) ScanFonts();

            // Compact header: name + age, with an always-visible font status badge.
            EditorGUILayout.BeginHorizontal(EditorStyles.toolbar);
            GUILayout.Label(_selected.Name, EditorStyles.boldLabel);
            GUILayout.Label($"· synced {_selected.SyncedAtUtc.ToLocalTime():MM-dd HH:mm}", EditorStyles.miniLabel);
            GUILayout.FlexibleSpace();
            DrawFontBadge();
            EditorGUILayout.EndHorizontal();

            // Tabs: Preview vs Fonts.
            _detailTab = GUILayout.Toolbar(_detailTab, DetailTabs);
            if (_detailTab == 0) DrawPreviewTab();
            else DrawFontsTab();

            EditorGUILayout.BeginHorizontal();
            if (GUILayout.Button("Build", GUILayout.Height(26))) DoBuild(_selected);
            if (GUILayout.Button("Delete", GUILayout.Height(26)))
            {
                if (EditorUtility.DisplayDialog(
                        "Delete synced data",
                        $"Delete {_selected.Name} from .unity-figma?\n{_selected.Folder}",
                        "Delete", "Cancel"))
                {
                    SyncLibrary.Delete(_selected);
                    _selected = null;
                    _selectedPreview = null;
                    RefreshLibrary();
                }
            }
            EditorGUILayout.EndHorizontal();
            EditorGUILayout.EndVertical();
        }

        // Preview tab: node tree | Unity render + build log.
        void DrawPreviewTab()
        {
            EditorGUILayout.BeginHorizontal();
            DrawNodeTree();
            _nodeTreeWidth = VerticalSplitter(_nodeTreeWidth, 140f, 500f, PREF_NODE_W);
            // Preview column must always claim the remaining width, otherwise resizing
            // the tree column leaves a gray gap between the two panes.
            EditorGUILayout.BeginVertical(GUILayout.ExpandWidth(true));

            if (_selected.UnityPreviewPath == null)
                GUILayout.Label("Showing Figma render - press Preview to generate the Unity preview.", EditorStyles.miniLabel);

            EditorGUILayout.BeginHorizontal();
            var newZoom = EditorGUILayout.Slider($"Zoom: {(int)(_zoom * 100)}%", _zoom, 0.1f, 2f);
            if (!Mathf.Approximately(newZoom, _zoom)) { _zoom = newZoom; _fitZoom = false; }
            if (GUILayout.Button("Fit", GUILayout.Width(40))) _fitZoom = true;
            if (GUILayout.Button("1:1", GUILayout.Width(40))) { _zoom = 1f; _fitZoom = false; }
            GUILayout.Label("Scroll wheel to zoom", EditorStyles.miniLabel);
            EditorGUILayout.EndHorizontal();

            DrawZoomPreview();

            EditorGUILayout.EndVertical();
            EditorGUILayout.EndHorizontal();

            DrawLog();
        }

        // Header status chip; click to jump to the Fonts tab.
        void DrawFontBadge()
        {
            if (_fontMapping == null || _fontMapping.Count == 0) return;
            int missing = CountMissingFonts();
            int matched = _fontMapping.Count - missing;
            string txt = missing > 0
                ? $"Fonts {matched}/{_fontMapping.Count} ⚠"
                : $"Fonts {matched}/{_fontMapping.Count} ✓";
            var style = missing > 0 ? _missingFontStyle : EditorStyles.miniLabel;
            if (GUILayout.Button(txt, style)) _detailTab = 1;
        }

        /// <summary>
        /// Fonts tab: auto-mapped Figma font (family|style) → project TMP_FontAsset.
        /// Missing fonts show a "missing" label; the user picks a per-font asset or
        /// a global fallback applied to all missing ones.
        /// </summary>
        void DrawFontsTab()
        {
            if (_manifest?.Fonts == null || _manifest.Fonts.Count == 0)
            {
                EditorGUILayout.HelpBox("This element has no text/fonts to map.", MessageType.Info);
                return;
            }
            if (_fontMapping == null) ScanFonts();
            int missing = CountMissingFonts();

            EditorGUILayout.BeginHorizontal();
            GUILayout.Label($"Fonts: {_fontMapping.Count - missing}/{_fontMapping.Count} matched",
                missing > 0 ? _missingFontStyle : EditorStyles.boldLabel);
            GUILayout.FlexibleSpace();
            if (GUILayout.Button("Re-detect", EditorStyles.miniButton, GUILayout.Width(80))) ScanFonts();
            GUILayout.Label("Fallback", EditorStyles.miniLabel);
            var newFallback = (TMP_FontAsset)EditorGUILayout.ObjectField(
                _fallbackFont, typeof(TMP_FontAsset), false, GUILayout.Width(160));
            if (newFallback != _fallbackFont)
            {
                _fallbackFont = newFallback;
                if (_fallbackFont != null) ApplyFallbackToMissing();
            }
            EditorGUILayout.EndHorizontal();

            if (missing > 0)
                EditorGUILayout.HelpBox(
                    $"{missing} font(s) not found in the project. Pick an asset per row or set a Fallback above.",
                    MessageType.Warning);

            var keys = new List<string>(_fontMapping.Keys);
            keys.Sort();
            foreach (var key in keys)
            {
                var cur = _fontMapping[key];
                bool isMissing = cur == null;
                EditorGUILayout.BeginHorizontal();
                GUILayout.Label(key.Replace("|", "  ·  "),
                    isMissing ? _missingFontStyle : EditorStyles.label, GUILayout.Width(220));
                var picked = (TMP_FontAsset)EditorGUILayout.ObjectField(cur, typeof(TMP_FontAsset), false);
                if (picked != cur) _fontMapping[key] = picked;
                if (isMissing)
                {
                    GUILayout.Label("missing", _missingFontStyle, GUILayout.Width(60));
                    using (new EditorGUI.DisabledScope(_fallbackFont == null))
                        if (GUILayout.Button("Use fallback", GUILayout.Width(90)))
                            _fontMapping[key] = _fallbackFont;
                }
                else GUILayout.Label("✓", EditorStyles.miniLabel, GUILayout.Width(90));
                EditorGUILayout.EndHorizontal();
            }
        }

        void EnsureFontStyle()
        {
            if (_missingFontStyle == null)
                _missingFontStyle = new GUIStyle(EditorStyles.miniBoldLabel)
                {
                    normal = { textColor = new Color(0.85f, 0.4f, 0.2f) },
                };
        }

        int CountMissingFonts()
        {
            if (_fontMapping == null) return 0;
            int n = 0;
            foreach (var v in _fontMapping.Values) if (v == null) n++;
            return n;
        }

        // Auto-match the current manifest's fonts against project TMP_FontAssets.
        void ScanFonts()
        {
            _fontMapping = _manifest != null
                ? FigmaImportRunner.AutoMatchFonts(_manifest)
                : new Dictionary<string, TMP_FontAsset>();
        }

        // Fill every still-missing font key with the chosen fallback asset.
        void ApplyFallbackToMissing()
        {
            if (_fontMapping == null) return;
            var keys = new List<string>(_fontMapping.Keys);
            foreach (var key in keys)
                if (_fontMapping[key] == null) _fontMapping[key] = _fallbackFont;
        }

        void DrawNodeTree()
        {
            EditorGUILayout.BeginVertical(GUILayout.Width(_nodeTreeWidth));

            // Header: title + refresh (re-pull the tree from the live Figma document
            // after it was edited externally, e.g. merged/deleted nodes).
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField("Child Nodes", EditorStyles.boldLabel);
            GUILayout.FlexibleSpace();
            using (new EditorGUI.DisabledScope(_selected == null || string.IsNullOrEmpty(_selected.NodeId)))
                if (GUILayout.Button("↻", EditorStyles.miniButton, GUILayout.Width(24)))
                    SyncFromFigma();
            EditorGUILayout.EndHorizontal();

            var rect = GUILayoutUtility.GetRect(
                100, 4000, 100, 4000, GUILayout.Width(_nodeTreeWidth), GUILayout.ExpandHeight(true));
            _treeView?.OnGUI(rect);

            // Two-way sync: pull the live document, or push staged rename/reorder edits.
            EditorGUILayout.BeginHorizontal();
            using (new EditorGUI.DisabledScope(_selected == null || string.IsNullOrEmpty(_selected.NodeId)))
                if (GUILayout.Button("Sync from Figma")) SyncFromFigma();
            using (new EditorGUI.DisabledScope(!HasPendingEdits))
                if (GUILayout.Button(HasPendingEdits
                        ? $"Sync to Figma ({_pendingRenames.Count + _pendingMoves.Count})"
                        : "Sync to Figma"))
                    SyncToFigma();
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.EndVertical();
        }

        /// <summary>Re-pull the selected element from the live Figma document, rebuilding
        /// the preview and node tree. Discards any staged (un-synced) edits.</summary>
        void SyncFromFigma()
        {
            if (HasPendingEdits && !EditorUtility.DisplayDialog(
                    "Sync from Figma",
                    "You have staged edits that haven't been pushed. Pulling from Figma will discard them. Continue?",
                    "Discard & Pull", "Cancel"))
                return;
            ResyncSelected();
        }

        void DrawZoomPreview()
        {
            var area = GUILayoutUtility.GetRect(100, 4000, 100, 4000, GUILayout.ExpandWidth(true), GUILayout.ExpandHeight(true));
            if (_selectedPreview == null)
            {
                GUI.Label(area, "No preview", EditorStyles.centeredGreyMiniLabel);
                return;
            }

            var evt = Event.current;
            if (evt.type == EventType.ScrollWheel && area.Contains(evt.mousePosition))
            {
                _zoom = Mathf.Clamp(_zoom * (evt.delta.y < 0 ? 1.1f : 0.9f), 0.1f, 2f);
                _fitZoom = false;
                evt.Use();
                Repaint();
            }

            if (_fitZoom)
                _zoom = Mathf.Clamp(
                    Mathf.Min(area.width / _selectedPreview.width, area.height / _selectedPreview.height),
                    0.1f, 2f);

            float w = _selectedPreview.width * _zoom;
            float h = _selectedPreview.height * _zoom;
            // Center the image inside the view when it is smaller than the area.
            var content = new Rect(0, 0, Mathf.Max(w, area.width), Mathf.Max(h, area.height));
            float ox = Mathf.Max(0, (content.width - w) * 0.5f);
            float oy = Mathf.Max(0, (content.height - h) * 0.5f);
            _previewScroll = GUI.BeginScrollView(area, _previewScroll, content);
            GUI.DrawTexture(new Rect(ox, oy, w, h), _selectedPreview, ScaleMode.StretchToFill);
            DrawNodeHighlight(new Rect(ox, oy, w, h));
            GUI.EndScrollView();
        }

        /// <summary>Outline the tree-selected element on the preview image.</summary>
        void DrawNodeHighlight(Rect texRect)
        {
            if (!TryGetElementRect(_highlightElementId, out var figmaRect)) return;
            float figmaW = _manifest?.Screen?.FigmaSize?.W ?? 0;
            if (figmaW <= 0) return;

            float s = texRect.width / figmaW; // figma units -> on-screen pixels
            var r = new Rect(
                texRect.x + figmaRect.x * s, texRect.y + figmaRect.y * s,
                Mathf.Max(2, figmaRect.width * s), Mathf.Max(2, figmaRect.height * s));
            var accent = new Color(0.2f, 0.75f, 1f, 1f);
            EditorGUI.DrawRect(r, new Color(accent.r, accent.g, accent.b, 0.15f));
            DrawFrame(r, accent);
        }

        static void DrawFrame(Rect r, Color color)
        {
            EditorGUI.DrawRect(new Rect(r.x, r.y, r.width, 2), color);
            EditorGUI.DrawRect(new Rect(r.x, r.yMax - 2, r.width, 2), color);
            EditorGUI.DrawRect(new Rect(r.x, r.y, 2, r.height), color);
            EditorGUI.DrawRect(new Rect(r.xMax - 2, r.y, 2, r.height), color);
        }

        const float SplitterThickness = 4f;
        static readonly Color SplitterColor = new Color(0f, 0f, 0f, 0.25f);

        // Vertical bar dragged left/right to resize the pane on its left. Returns new width.
        float VerticalSplitter(float width, float min, float max, string prefKey)
        {
            int id = GUIUtility.GetControlID(FocusType.Passive);
            var rect = GUILayoutUtility.GetRect(
                SplitterThickness, SplitterThickness,
                GUILayout.Width(SplitterThickness), GUILayout.ExpandHeight(true));
            EditorGUI.DrawRect(rect, SplitterColor);
            EditorGUIUtility.AddCursorRect(rect, MouseCursor.ResizeHorizontal);

            var e = Event.current;
            switch (e.GetTypeForControl(id))
            {
                case EventType.MouseDown:
                    if (rect.Contains(e.mousePosition)) { GUIUtility.hotControl = id; e.Use(); }
                    break;
                case EventType.MouseDrag:
                    if (GUIUtility.hotControl == id)
                    { width = Mathf.Clamp(width + e.delta.x, min, max); e.Use(); Repaint(); }
                    break;
                case EventType.MouseUp:
                    if (GUIUtility.hotControl == id)
                    { GUIUtility.hotControl = 0; EditorPrefs.SetFloat(prefKey, width); e.Use(); }
                    break;
            }
            return width;
        }

        // Horizontal bar dragged up/down to resize the pane below it. Returns new height.
        float HorizontalSplitter(float height, float min, float max, string prefKey)
        {
            int id = GUIUtility.GetControlID(FocusType.Passive);
            var rect = GUILayoutUtility.GetRect(
                SplitterThickness, SplitterThickness,
                GUILayout.ExpandWidth(true), GUILayout.Height(SplitterThickness));
            EditorGUI.DrawRect(rect, SplitterColor);
            EditorGUIUtility.AddCursorRect(rect, MouseCursor.ResizeVertical);

            var e = Event.current;
            switch (e.GetTypeForControl(id))
            {
                case EventType.MouseDown:
                    if (rect.Contains(e.mousePosition)) { GUIUtility.hotControl = id; e.Use(); }
                    break;
                case EventType.MouseDrag:
                    if (GUIUtility.hotControl == id)
                    { height = Mathf.Clamp(height - e.delta.y, min, max); e.Use(); Repaint(); }
                    break;
                case EventType.MouseUp:
                    if (GUIUtility.hotControl == id)
                    { GUIUtility.hotControl = 0; EditorPrefs.SetFloat(prefKey, height); e.Use(); }
                    break;
            }
            return height;
        }

        void DrawLog()
        {
            if (_lastLog == null) return;

            bool hasContent = false;
            foreach (var entry in _lastLog)
                if (entry.Level != BuildLogEntry.LogLevel.Success) { hasContent = true; break; }
            if (!hasContent) return;

            // Resizable scroll area pinned at the bottom (height persisted, drag the bar above).
            _logHeight = HorizontalSplitter(_logHeight, 30f, 300f, PREF_LOG_H);
            _logScroll = EditorGUILayout.BeginScrollView(_logScroll, GUILayout.Height(_logHeight));
            foreach (var entry in _lastLog)
            {
                if (entry.Level == BuildLogEntry.LogLevel.Success) continue;
                EditorGUILayout.HelpBox(entry.Message,
                    entry.Level == BuildLogEntry.LogLevel.Error ? MessageType.Error : MessageType.Warning);
            }
            EditorGUILayout.EndScrollView();
        }

        void DrawStatus()
        {
            if (!string.IsNullOrEmpty(_status))
                EditorGUILayout.HelpBox(_status, _statusIsError ? MessageType.Error : MessageType.Info);

            if (_lastImport != null && GUILayout.Button("Refine with AI (copy prompt + write descriptor)"))
            {
                var descPath = Path.Combine(Application.dataPath, "..", "Temp", "figma-last-import.json");
                ImportDescriptor.Write(Path.GetFullPath(descPath), _lastImport);
                EditorGUIUtility.systemCopyBuffer = ImportDescriptor.BuildPrompt(_lastImport);
                SetStatus($"Prompt copied. Descriptor: {Path.GetFullPath(descPath)}", false);
            }
        }

        void SetStatus(string msg, bool isError)
        {
            _status = msg;
            _statusIsError = isError;
            Repaint();
        }
    }
}
