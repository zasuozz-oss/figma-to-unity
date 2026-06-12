using System.Collections.Generic;
using System.IO;
using FigmaImporter;
using FigmaImporter.Data;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.IMGUI.Controls;
using UnityEngine;

namespace FigmaImporter.Sync
{
    public class FigmaSyncWindow : EditorWindow
    {
        const string PREF_PORT = "FigmaSync_Port";
        const string PREF_SPRITE_FOLDER = "FigmaImporter_SpriteFolder";

        int _port = 1994;
        string _figmaUrl = "";
        string _selectionName = "";
        bool _showSettings;
        OutputMode _outputMode = OutputMode.Both;
        string _prefabSavePath = "Assets/Prefabs/UI/";
        string _spriteOutputFolder = "";

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
        Vector2 _listScroll, _previewScroll;

        ManifestData _manifest;
        readonly Dictionary<string, ElementData> _elementsById = new Dictionary<string, ElementData>();
        TreeViewState _treeState;
        FigmaNodeTreeView _treeView;
        string _highlightElementId;
        GUIStyle _headerBrandStyle, _headerBrowseStyle;

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
            RefreshLibrary();
        }

        FigmaBridgeClient Client => new FigmaBridgeClient(_port);

        void OnGUI()
        {
            DrawHeader();
            DrawSettings();
            EditorGUILayout.Space(4);
            EditorGUILayout.BeginHorizontal();
            DrawLibraryList();
            DrawDetail();
            EditorGUILayout.EndHorizontal();
            EditorGUILayout.Space(4);
            DrawStatus();
        }

        void DrawHeader()
        {
            if (_headerBrandStyle == null)
            {
                _headerBrandStyle = new GUIStyle(EditorStyles.boldLabel)
                {
                    alignment = TextAnchor.MiddleCenter,
                    normal = { textColor = Color.white },
                };
                _headerBrowseStyle = new GUIStyle(EditorStyles.boldLabel)
                {
                    alignment = TextAnchor.MiddleCenter,
                    normal = { textColor = new Color(0.12f, 0.12f, 0.12f) },
                };
            }

            var rect = GUILayoutUtility.GetRect(0, 26, GUILayout.ExpandWidth(true));
            EditorGUI.DrawRect(rect, new Color(0.13f, 0.13f, 0.13f, 1f));
            var brand = new Rect(rect.x, rect.y, 150, rect.height);
            EditorGUI.DrawRect(brand, new Color(0.18f, 0.55f, 0.25f, 1f));
            GUI.Label(brand, "Figma Dashboard", _headerBrandStyle);
            var browse = new Rect(brand.xMax + 2, rect.y, rect.width - brand.width - 2, rect.height);
            EditorGUI.DrawRect(browse, new Color(0.95f, 0.62f, 0.12f, 1f));
            GUI.Label(browse, $"Browse ({_entries.Count})", _headerBrowseStyle);
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
                if (GUILayout.Button("Sync", GUILayout.Width(60)))
                    DoSync();
            }
            EditorGUILayout.EndHorizontal();
            if (!string.IsNullOrEmpty(_selectionName))
                EditorGUILayout.LabelField("Selection", _selectionName);
        }

        void DrawSettings()
        {
            _showSettings = EditorGUILayout.Foldout(_showSettings, "Settings", true);
            if (!_showSettings) return;
            using (new EditorGUI.IndentLevelScope())
            {
                DrawConnection();
                DrawOptions();
            }
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
            _outputMode = (OutputMode)EditorGUILayout.EnumPopup("Output Mode", _outputMode);
            if (_outputMode == OutputMode.Prefab || _outputMode == OutputMode.Both)
                _prefabSavePath = EditorGUILayout.TextField("Prefab Save Path", _prefabSavePath);
            var newSpriteFolder = EditorGUILayout.TextField("Sprite Folder", _spriteOutputFolder);
            if (newSpriteFolder != _spriteOutputFolder)
            {
                _spriteOutputFolder = newSpriteFolder;
                EditorPrefs.SetString(PREF_SPRITE_FOLDER, _spriteOutputFolder);
            }
        }

        void DoSync()
        {
            var nodeId = FigmaSyncUrl.ExtractNodeId(_figmaUrl);
            if (nodeId == null)
            {
                SetStatus("Invalid Figma URL or node-id.", true);
                return;
            }

            try
            {
                EditorUtility.DisplayProgressBar("Figma Sync", "Exporting from Figma...", 0.3f);
                var outputDir = SyncLibrary.FolderFor(nodeId);
                if (!Client.TryExportElement(nodeId, outputDir, out var export, out var err))
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
                _syncedUrl = _figmaUrl;

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
                var request = new ImportRequest
                {
                    ExportFolder = entry.Folder,
                    OutputMode = _outputMode,
                    PrefabSavePath = _prefabSavePath,
                    SpriteOutputFolder = _spriteOutputFolder,
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
            EditorGUILayout.BeginVertical(GUILayout.Width(200));
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
            _elementsById.Clear();
            _highlightElementId = null;

            if (_treeView == null)
            {
                _treeState = new TreeViewState();
                _treeView = new FigmaNodeTreeView(_treeState)
                {
                    ElementSelected = id => { _highlightElementId = id; Repaint(); },
                    ElementRenamed = OnNodeRenamed,
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

        /// <summary>
        /// Persist a tree rename into manifest.json so Build names the
        /// GameObject accordingly. The staging file is the single source of
        /// truth for the hierarchy.
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
                SetStatus($"Renamed node to \"{newName}\" - saved to manifest; Build will use it.", false);
            }
            catch (System.Exception ex)
            {
                SetStatus("Rename failed: " + ex.Message, true);
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
            EditorGUILayout.Space(4);
            if (_selected == null)
            {
                EditorGUILayout.HelpBox("Sync an element or select one on the left.", MessageType.Info);
                EditorGUILayout.EndVertical();
                return;
            }

            EditorGUILayout.LabelField(_selected.Name, EditorStyles.boldLabel);
            EditorGUILayout.LabelField(_selected.ManifestPath, EditorStyles.miniLabel);
            EditorGUILayout.LabelField($"Last synced: {_selected.SyncedAtUtc.ToLocalTime():yyyy-MM-dd HH:mm}", EditorStyles.miniLabel);

            EditorGUILayout.BeginHorizontal();
            DrawNodeTree();
            EditorGUILayout.BeginVertical();

            if (_selected.UnityPreviewPath == null)
                GUILayout.Label("Showing Figma render - press Sync to generate the Unity preview.", EditorStyles.miniLabel);

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

        void DrawNodeTree()
        {
            EditorGUILayout.BeginVertical(GUILayout.Width(240));
            EditorGUILayout.LabelField("Child Nodes", EditorStyles.boldLabel);
            GUILayout.Label("Click: highlight on preview · Double-click: rename", EditorStyles.miniLabel);
            var rect = GUILayoutUtility.GetRect(
                100, 4000, 100, 4000, GUILayout.Width(240), GUILayout.ExpandHeight(true));
            _treeView?.OnGUI(rect);
            EditorGUILayout.EndVertical();
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
            _previewScroll = GUI.BeginScrollView(area, _previewScroll, new Rect(0, 0, w, h));
            GUI.DrawTexture(new Rect(0, 0, w, h), _selectedPreview, ScaleMode.StretchToFill);
            DrawNodeHighlight(w);
            GUI.EndScrollView();
            DrawFrame(area, new Color(0.95f, 0.62f, 0.12f, 1f));
        }

        /// <summary>Outline the tree-selected element on the preview image.</summary>
        void DrawNodeHighlight(float zoomedTexWidth)
        {
            if (!TryGetElementRect(_highlightElementId, out var figmaRect)) return;
            float figmaW = _manifest?.Screen?.FigmaSize?.W ?? 0;
            if (figmaW <= 0) return;

            float s = zoomedTexWidth / figmaW; // figma units -> on-screen pixels
            var r = new Rect(
                figmaRect.x * s, figmaRect.y * s,
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

        void DrawLog()
        {
            if (_lastLog == null) return;
            foreach (var entry in _lastLog)
            {
                if (entry.Level == BuildLogEntry.LogLevel.Success) continue;
                EditorGUILayout.HelpBox(entry.Message,
                    entry.Level == BuildLogEntry.LogLevel.Error ? MessageType.Error : MessageType.Warning);
            }
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
