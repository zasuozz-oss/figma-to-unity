using System.Collections.Generic;
using System.IO;
using FigmaImporter;
using UnityEditor;
using UnityEngine;

namespace FigmaImporter.Sync
{
    public class FigmaSyncWindow : EditorWindow
    {
        const string PREF_PORT = "FigmaSync_Port";
        const string PREF_SPRITE_FOLDER = "FigmaImporter_SpriteFolder";

        static readonly string[] PreviewSources = { "Unity build", "Figma" };

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
        int _previewSource;
        float _zoom = 1f;
        bool _fitZoom = true;
        Vector2 _listScroll, _previewScroll;

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
            DrawTopBar();
            DrawSettings();
            EditorGUILayout.Space(4);
            EditorGUILayout.BeginHorizontal();
            DrawLibraryList();
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
            _previewSource = entry != null && entry.UnityPreviewPath != null ? 0 : 1;
            LoadSelectedPreview();
            _fitZoom = true;
            Repaint();
        }

        void LoadSelectedPreview()
        {
            _selectedPreview = null;
            if (_selected == null) return;
            var path = _previewSource == 0 ? _selected.UnityPreviewPath : _selected.PreviewPath;
            _selectedPreview = SyncLibrary.LoadTexture(path);
        }

        void DrawDetail()
        {
            EditorGUILayout.BeginVertical();
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
            if (_selected.UnityPreviewPath != null)
            {
                int newSource = GUILayout.Toolbar(_previewSource, PreviewSources, GUILayout.Width(180));
                if (newSource != _previewSource)
                {
                    _previewSource = newSource;
                    LoadSelectedPreview();
                    _fitZoom = true;
                }
            }
            else
            {
                _previewSource = 1;
                GUILayout.Label("No Unity preview yet - press Sync to generate.", EditorStyles.miniLabel);
            }
            GUILayout.FlexibleSpace();
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.BeginHorizontal();
            var newZoom = EditorGUILayout.Slider($"Zoom: {(int)(_zoom * 100)}%", _zoom, 0.1f, 2f);
            if (!Mathf.Approximately(newZoom, _zoom)) { _zoom = newZoom; _fitZoom = false; }
            if (GUILayout.Button("Fit", GUILayout.Width(40))) _fitZoom = true;
            if (GUILayout.Button("1:1", GUILayout.Width(40))) { _zoom = 1f; _fitZoom = false; }
            GUILayout.Label("Scroll wheel to zoom", EditorStyles.miniLabel);
            EditorGUILayout.EndHorizontal();

            DrawZoomPreview();
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
            GUI.EndScrollView();
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
