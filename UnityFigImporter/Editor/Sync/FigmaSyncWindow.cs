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

        static readonly string[] Tabs = { "Sync", "Library" };
        int _tab;

        int _port = 1994;
        string _figmaUrl = "";
        string _selectionName = "";
        OutputMode _outputMode = OutputMode.Both;
        string _prefabSavePath = "Assets/Prefabs/UI/";
        string _spriteOutputFolder = "";

        FigmaBridgeClient.HealthInfo _health;
        string _status = "";
        bool _statusIsError;

        SyncLibrary.Entry _staged;
        Texture2D _stagedPreview;
        ImportDescriptor.Data _lastImport;

        List<SyncLibrary.Entry> _entries = new List<SyncLibrary.Entry>();
        string _search = "";
        SyncLibrary.Entry _selected;
        Texture2D _selectedPreview;
        float _zoom = 1f;
        bool _fitZoom = true;
        Vector2 _listScroll, _previewScroll;

        [MenuItem("Window/Figma/Sync")]
        public static void Open()
        {
            GetWindow<FigmaSyncWindow>("Figma Sync");
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
            _tab = GUILayout.Toolbar(_tab, Tabs);
            EditorGUILayout.Space(6);
            if (_tab == 0) DrawSyncTab();
            else DrawLibraryTab();
        }

        void DrawSyncTab()
        {
            DrawConnection();
            EditorGUILayout.Space(6);
            DrawSource();
            EditorGUILayout.Space(6);
            using (new EditorGUI.DisabledScope(string.IsNullOrWhiteSpace(_figmaUrl)))
            {
                if (GUILayout.Button("Sync (export + preview)", GUILayout.Height(32)))
                    DoSync();
            }
            EditorGUILayout.Space(6);
            DrawStagedPreview();
            EditorGUILayout.Space(6);
            DrawOptions();
            using (new EditorGUI.DisabledScope(_staged == null))
            {
                if (GUILayout.Button("Build prefab", GUILayout.Height(32)))
                    DoBuild(_staged);
            }
            EditorGUILayout.Space(6);
            DrawStatus();
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

        void DrawSource()
        {
            _figmaUrl = EditorGUILayout.TextField("Figma URL / node-id", _figmaUrl);
            if (GUILayout.Button("Use current Figma selection"))
            {
                if (Client.TryGetSelection(out var sel, out var err))
                {
                    _figmaUrl = !string.IsNullOrEmpty(sel.url) ? sel.url : sel.nodeId;
                    _selectionName = sel.name;
                    SetStatus($"Selected: {sel.name} ({sel.nodeId})", false);
                }
                else SetStatus(err, true);
            }
            if (!string.IsNullOrEmpty(_selectionName))
                EditorGUILayout.LabelField("Selection", _selectionName);
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

            EditorUtility.DisplayProgressBar("Figma Sync", "Exporting from Figma...", 0.5f);
            try
            {
                var outputDir = SyncLibrary.FolderFor(nodeId);
                if (!Client.TryExportElement(nodeId, outputDir, out var export, out var err))
                {
                    SetStatus(err, true);
                    return;
                }

                _staged = SyncLibrary.Load(export.outputDir);
                _stagedPreview = SyncLibrary.LoadPreview(_staged);
                _lastImport = null;
                RefreshLibrary();
                SetStatus($"Synced {export.name} ({export.nodeCount} nodes) -> {export.outputDir}", false);
            }
            finally
            {
                EditorUtility.ClearProgressBar();
            }
        }

        void DoBuild(SyncLibrary.Entry entry)
        {
            if (entry == null) return;
            EditorUtility.DisplayProgressBar("Figma Sync", "Building prefab...", 0.5f);
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
                if (!result.Success)
                {
                    SetStatus("Build failed: " + string.Join(" | ", result.Log.ConvertAll(e => e.Message)), true);
                    return;
                }

                var prefabPath = Path.Combine(_prefabSavePath, result.RootName + ".prefab").Replace('\\', '/');
                _lastImport = new ImportDescriptor.Data
                {
                    name = entry.Name,
                    nodeId = entry.NodeId,
                    canonicalUrl = ReferenceEquals(entry, _staged) && !string.IsNullOrEmpty(_figmaUrl) ? _figmaUrl : entry.NodeId,
                    outputDir = entry.Folder,
                    prefabPath = prefabPath,
                };
                SetStatus($"Built {result.RootName} ({entry.NodeCount} nodes) -> {prefabPath}", false);
            }
            finally
            {
                EditorUtility.ClearProgressBar();
            }
        }

        void DrawStagedPreview()
        {
            if (_staged == null) return;
            EditorGUILayout.LabelField($"Staged: {_staged.Name} ({_staged.NodeCount} nodes)", EditorStyles.boldLabel);
            if (_stagedPreview != null)
            {
                var rect = GUILayoutUtility.GetRect(256, 256, GUILayout.ExpandWidth(false));
                GUI.DrawTexture(rect, _stagedPreview, ScaleMode.ScaleToFit);
            }
            else
                EditorGUILayout.LabelField("No preview", EditorStyles.centeredGreyMiniLabel);
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

        void RefreshLibrary()
        {
            _entries = SyncLibrary.List();
            if (_selected != null)
            {
                _selected = _entries.Find(e => e.Folder == _selected.Folder);
                if (_selected == null) _selectedPreview = null;
            }
            if (_staged != null && _entries.Find(e => e.Folder == _staged.Folder) == null)
            {
                _staged = null;
                _stagedPreview = null;
            }
        }

        void DrawLibraryTab()
        {
            EditorGUILayout.BeginHorizontal();
            DrawLibraryList();
            DrawLibraryDetail();
            EditorGUILayout.EndHorizontal();
            EditorGUILayout.Space(6);
            DrawStatus();
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
            _selectedPreview = SyncLibrary.LoadPreview(entry);
            _fitZoom = true;
            Repaint();
        }

        void DrawLibraryDetail()
        {
            EditorGUILayout.BeginVertical();
            if (_selected == null)
            {
                EditorGUILayout.HelpBox("Select a synced element on the left.", MessageType.Info);
                EditorGUILayout.EndVertical();
                return;
            }

            EditorGUILayout.LabelField(_selected.Name, EditorStyles.boldLabel);
            EditorGUILayout.LabelField(_selected.ManifestPath, EditorStyles.miniLabel);
            EditorGUILayout.LabelField($"Last synced: {_selected.SyncedAtUtc.ToLocalTime():yyyy-MM-dd HH:mm}", EditorStyles.miniLabel);

            EditorGUILayout.BeginHorizontal();
            var newZoom = EditorGUILayout.Slider($"Zoom: {(int)(_zoom * 100)}%", _zoom, 0.1f, 2f);
            if (!Mathf.Approximately(newZoom, _zoom)) { _zoom = newZoom; _fitZoom = false; }
            if (GUILayout.Button("Fit", GUILayout.Width(40))) _fitZoom = true;
            if (GUILayout.Button("1:1", GUILayout.Width(40))) { _zoom = 1f; _fitZoom = false; }
            GUILayout.Label("Scroll wheel to zoom", EditorStyles.miniLabel);
            EditorGUILayout.EndHorizontal();

            DrawZoomPreview();

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

        void SetStatus(string msg, bool isError)
        {
            _status = msg;
            _statusIsError = isError;
            Repaint();
        }
    }
}
