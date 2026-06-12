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

        int _port = 1994;
        string _figmaUrl = "";
        string _selectionName = "";
        OutputMode _outputMode = OutputMode.Both;
        string _prefabSavePath = "Assets/Prefabs/UI/";
        string _spriteOutputFolder = "";

        FigmaBridgeClient.HealthInfo _health;
        string _status = "";
        bool _statusIsError;

        ImportDescriptor.Data _lastImport;
        Texture2D _previewTex;

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
        }

        FigmaBridgeClient Client => new FigmaBridgeClient(_port);

        void OnGUI()
        {
            EditorGUILayout.LabelField("Figma -> Unity Sync", EditorStyles.boldLabel);
            EditorGUILayout.Space(6);

            DrawConnection();
            EditorGUILayout.Space(6);
            DrawSource();
            EditorGUILayout.Space(6);
            DrawOptions();
            EditorGUILayout.Space(6);
            DrawSyncButton();
            EditorGUILayout.Space(6);
            DrawResult();
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

        void DrawSyncButton()
        {
            using (new EditorGUI.DisabledScope(string.IsNullOrWhiteSpace(_figmaUrl)))
            {
                if (GUILayout.Button("Sync", GUILayout.Height(32)))
                    DoSync();
            }
        }

        void DoSync()
        {
            var nodeId = FigmaSyncUrl.ExtractNodeId(_figmaUrl);
            var isUrl = nodeId == null && _figmaUrl.Contains("figma.com");
            if (nodeId == null && !isUrl)
            {
                SetStatus("Invalid Figma URL or node-id.", true);
                return;
            }

            EditorUtility.DisplayProgressBar("Figma Sync", "Exporting from Figma...", 0.3f);
            try
            {
                if (!Client.TryExportElement(nodeId, isUrl ? _figmaUrl : null, out var export, out var err))
                {
                    SetStatus(err, true);
                    return;
                }

                EditorUtility.DisplayProgressBar("Figma Sync", "Importing into Unity...", 0.7f);
                var request = new ImportRequest
                {
                    ExportFolder = export.outputDir,
                    OutputMode = _outputMode,
                    PrefabSavePath = _prefabSavePath,
                    SpriteOutputFolder = _spriteOutputFolder,
                };
                var result = FigmaImportRunner.Run(request);
                if (!result.Success)
                {
                    SetStatus("Import failed: " + string.Join(" | ", result.Log.ConvertAll(e => e.Message)), true);
                    return;
                }

                var prefabPath = Path.Combine(_prefabSavePath, result.RootName + ".prefab").Replace('\\', '/');
                _lastImport = new ImportDescriptor.Data
                {
                    name = export.name,
                    nodeId = export.nodeId,
                    canonicalUrl = _figmaUrl,
                    outputDir = export.outputDir,
                    prefabPath = prefabPath,
                };
                LoadPreview(prefabPath);
                SetStatus($"Done. Built {result.RootName} ({export.nodeCount} nodes).", false);
            }
            finally
            {
                EditorUtility.ClearProgressBar();
            }
        }

        void LoadPreview(string prefabPath)
        {
            var go = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            _previewTex = go != null ? AssetPreview.GetAssetPreview(go) : null;
        }

        void DrawResult()
        {
            if (!string.IsNullOrEmpty(_status))
                EditorGUILayout.HelpBox(_status, _statusIsError ? MessageType.Error : MessageType.Info);

            if (_previewTex != null)
            {
                var rect = GUILayoutUtility.GetRect(256, 256, GUILayout.ExpandWidth(false));
                GUI.DrawTexture(rect, _previewTex, ScaleMode.ScaleToFit);
            }

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
