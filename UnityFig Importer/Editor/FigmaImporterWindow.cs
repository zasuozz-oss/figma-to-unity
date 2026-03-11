// =============================================================================
// FigmaImporterWindow — Main EditorWindow for Figma → Unity import
// =============================================================================

using System.Collections.Generic;
using System.IO;
using FigmaImporter.Data;
using TMPro;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace FigmaImporter
{
    public class FigmaImporterWindow : EditorWindow
    {
        // =====================================================================
        // State
        // =====================================================================

        string _exportFolderPath = "";
        const string PREF_EXPORT_FOLDER = "FigmaImporter_ExportFolder";
        ManifestData _manifest;

        // Auto-scan results
        List<string> _detectedFolders = new List<string>();
        string[] _detectedFolderNames;
        int _selectedFolderIndex = -1;
        string _manifestError;

        // Output settings
        RenderPipeline _renderPipeline = RenderPipeline.UGUI;
        OutputMode _outputMode = OutputMode.Scene;
        string _prefabSavePath = "Assets/Prefabs/UI/";

        // Canvas settings
        CanvasSettings _canvasSettings = new CanvasSettings();
        Canvas[] _sceneCanvases;
        string[] _sceneCanvasNames;
        int _selectedCanvasIndex;

        // Canvas scale preset
        enum CanvasScalePreset { Auto, Scale1x, Scale1_5x, Scale2x, Scale3x, Scale4x, Custom }
        CanvasScalePreset _canvasScalePreset = CanvasScalePreset.Auto;

        // Font mapping: "family|style" → TMP_FontAsset
        Dictionary<string, TMP_FontAsset> _fontMapping = new Dictionary<string, TMP_FontAsset>();
        TMP_FontAsset[] _allProjectFonts;
        string[] _allProjectFontNames;
        bool _showFontMapping = true;

        // Sprite output folder
        const string PREF_SPRITE_FOLDER = "FigmaImporter_SpriteFolder";
        string _spriteOutputFolder = "";

        // Build options
        BuildOptions _buildOptions = new BuildOptions();

        // Texture import settings (user-configurable)
        TextureImportSettings _textureSettings = new TextureImportSettings();
        bool _showTextureSettings;

        // Sprite Atlas settings
        SpriteAtlasSettings _atlasSettings = new SpriteAtlasSettings();
        bool _showAtlasSettings;

        // Hierarchy preview
        bool _showHierarchy = true;
        Vector2 _hierarchyScroll;
        Dictionary<string, bool> _foldoutStates = new Dictionary<string, bool>();

        // Collapsible sections (default collapsed)
        bool _showCanvasSettings;
        bool _showBuildOptions;

        // Build progress & log
        bool _isBuilding;
        float _buildProgress;
        string _buildProgressLabel = "";
        List<BuildLogEntry> _buildLog = new List<BuildLogEntry>();
        Vector2 _logScroll;

        // =====================================================================
        // Menu item
        // =====================================================================

        [MenuItem("Window/Figma/Import")]
        public static void ShowWindow()
        {
            var window = GetWindow<FigmaImporterWindow>("Figma → Unity");
            window.minSize = new Vector2(380, 600);
        }

        void OnEnable()
        {
            // Restore saved paths
            _spriteOutputFolder = EditorPrefs.GetString(PREF_SPRITE_FOLDER, "");
            _exportFolderPath = EditorPrefs.GetString(PREF_EXPORT_FOLDER, "");

            // Restore texture settings
            _textureSettings.LoadFromPrefs();
            _atlasSettings.LoadFromPrefs();

            if (string.IsNullOrEmpty(_spriteOutputFolder))
                _spriteOutputFolder = AutoDetectSpriteFolder();

            ScanForExportFolders();

            // Always reload manifest from disk (file may have been replaced)
            if (!string.IsNullOrEmpty(_exportFolderPath))
                LoadManifest();
        }

        /// <summary>
        /// Scan the entire Assets folder for directories containing manifest.json.
        /// </summary>
        void ScanForExportFolders()
        {
            _detectedFolders.Clear();

            string assetsPath = Application.dataPath; // .../Assets

            // Only search inside Assets/ — fast and no false positives
            SearchForManifests(assetsPath);

            // Remove duplicates
            var uniqueFolders = new HashSet<string>(_detectedFolders);
            _detectedFolders = new List<string>(uniqueFolders);
            _detectedFolders.Sort();

            // Build display names
            _detectedFolderNames = new string[_detectedFolders.Count];
            for (int i = 0; i < _detectedFolders.Count; i++)
            {
                string folderName = Path.GetFileName(_detectedFolders[i]);
                string parentName = Path.GetFileName(Path.GetDirectoryName(_detectedFolders[i]));
                _detectedFolderNames[i] = $"{parentName}/{folderName}";
            }

            // Auto-select first if available and nothing selected yet
            if (_detectedFolders.Count > 0 && string.IsNullOrEmpty(_exportFolderPath))
            {
                _selectedFolderIndex = 0;
                _exportFolderPath = _detectedFolders[0];
                EditorPrefs.SetString(PREF_EXPORT_FOLDER, _exportFolderPath);
                LoadManifest();
            }
            else if (_detectedFolders.Count > 0 && !string.IsNullOrEmpty(_exportFolderPath))
            {
                // Try to match current path
                _selectedFolderIndex = _detectedFolders.IndexOf(_exportFolderPath);
            }

            Repaint();
        }

        void SearchForManifests(string rootPath, int maxDepth = 5)
        {
            try
            {
                SearchForManifestsRecursive(rootPath, 0, maxDepth);
            }
            catch (System.UnauthorizedAccessException) { }
            catch (System.Exception ex)
            {
                Debug.LogWarning($"[FigmaImporter] Scan error in {rootPath}: {ex.Message}");
            }
        }

        void SearchForManifestsRecursive(string currentPath, int depth, int maxDepth)
        {
            if (depth > maxDepth) return;

            // Check if this folder has a manifest.json
            string manifestPath = Path.Combine(currentPath, "manifest.json");
            if (File.Exists(manifestPath))
            {
                // Quick check: is it a Figma export manifest?
                try
                {
                    string preview = File.ReadAllText(manifestPath);
                    if (preview.Contains("\"version\"") && preview.Contains("\"elements\""))
                    {
                        _detectedFolders.Add(currentPath);
                    }
                }
                catch { }
            }

            // Recurse into subdirectories
            try
            {
                foreach (string subDir in Directory.GetDirectories(currentPath))
                {
                    string dirName = Path.GetFileName(subDir);
                    // Skip hidden/system directories
                    if (dirName.StartsWith(".") || dirName == "Library" || dirName == "Temp" ||
                        dirName == "Logs" || dirName == "obj" || dirName == "node_modules")
                        continue;
                    SearchForManifestsRecursive(subDir, depth + 1, maxDepth);
                }
            }
            catch (System.UnauthorizedAccessException) { }
        }

        // =====================================================================
        // OnGUI
        // =====================================================================

        void OnGUI()
        {
            EditorGUILayout.Space(4);

            // Header
            DrawHeader();

            EditorGUILayout.Space(8);

            // Folder picker
            DrawFolderPicker();

            if (_manifest == null)
            {
                if (!string.IsNullOrEmpty(_manifestError))
                {
                    EditorGUILayout.HelpBox(_manifestError, MessageType.Error);
                }
                return;
            }

            EditorGUILayout.Space(8);

            // Screen info
            DrawScreenInfo();

            EditorGUILayout.Space(8);

            // Hierarchy preview
            DrawHierarchyPreview();

            EditorGUILayout.Space(8);

            // Output settings
            DrawOutputSettings();

            EditorGUILayout.Space(4);

            // Canvas settings (UGUI + Scene mode only)
            if (_renderPipeline == RenderPipeline.UGUI &&
                (_outputMode == OutputMode.Scene || _outputMode == OutputMode.Both))
            {
                DrawCanvasSettings();
                EditorGUILayout.Space(4);
            }

            // Sprite output folder
            DrawSpriteOutputFolder();

            EditorGUILayout.Space(4);

            // Font mapping
            DrawFontMapping();

            EditorGUILayout.Space(4);

            // Build options
            DrawBuildOptions();

            EditorGUILayout.Space(4);

            // Texture import settings
            DrawTextureSettings();

            EditorGUILayout.Space(4);

            // Sprite Atlas settings
            DrawSpriteAtlasSettings();

            EditorGUILayout.Space(8);

            // Build button
            DrawBuildButton();

            EditorGUILayout.Space(4);

            // Build log
            DrawBuildLog();
        }

        // =====================================================================
        // UI Sections
        // =====================================================================

        void DrawHeader()
        {
            EditorGUILayout.BeginHorizontal();
            GUILayout.Label("Figma → Unity Importer", EditorStyles.boldLabel);
            GUILayout.FlexibleSpace();
            GUILayout.Label("v1.0", EditorStyles.miniLabel);
            EditorGUILayout.EndHorizontal();

            Rect headerRect = GUILayoutUtility.GetLastRect();
            headerRect.y += headerRect.height + 2;
            headerRect.height = 1;
            EditorGUI.DrawRect(headerRect, new Color(0.3f, 0.3f, 0.3f));
            GUILayout.Space(4);
        }

        void DrawFolderPicker()
        {
            // Auto-detected folders dropdown
            if (_detectedFolders.Count > 0)
            {
                EditorGUILayout.BeginHorizontal();
                EditorGUILayout.PrefixLabel("📁 Detected Exports");

                int newIndex = EditorGUILayout.Popup(_selectedFolderIndex, _detectedFolderNames);
                if (newIndex != _selectedFolderIndex && newIndex >= 0 && newIndex < _detectedFolders.Count)
                {
                    _selectedFolderIndex = newIndex;
                    _exportFolderPath = _detectedFolders[newIndex];
                    EditorPrefs.SetString(PREF_EXPORT_FOLDER, _exportFolderPath);
                    LoadManifest();
                }

                if (GUILayout.Button("↻", GUILayout.Width(24)))
                {
                    ScanForExportFolders();
                    if (!string.IsNullOrEmpty(_exportFolderPath))
                        LoadManifest();
                }

                EditorGUILayout.EndHorizontal();
            }
            else
            {
                EditorGUILayout.HelpBox("No FigmaExport folders detected. Use Browse or click ↻ to rescan.", MessageType.Info);
            }

            // Manual browse fallback
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.PrefixLabel("📂 Manual");

            string displayPath = string.IsNullOrEmpty(_exportFolderPath)
                ? "(none selected)"
                : TruncatePath(_exportFolderPath, 35);
            EditorGUILayout.LabelField(displayPath, EditorStyles.miniLabel);

            if (GUILayout.Button("Browse", GUILayout.Width(60)))
            {
                string folder = EditorUtility.OpenFolderPanel("Select Figma Export Folder", "", "");
                if (!string.IsNullOrEmpty(folder))
                {
                    _exportFolderPath = folder;
                    EditorPrefs.SetString(PREF_EXPORT_FOLDER, _exportFolderPath);
                    _selectedFolderIndex = _detectedFolders.IndexOf(folder);
                    LoadManifest();
                }
            }

            if (GUILayout.Button("↻", GUILayout.Width(24)))
            {
                ScanForExportFolders();
            }

            EditorGUILayout.EndHorizontal();
        }

        void DrawScreenInfo()
        {
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);

            var screen = _manifest.Screen;
            EditorGUILayout.LabelField($"Screen: {screen.Name}", EditorStyles.boldLabel);
            EditorGUILayout.LabelField(
                $"Figma: {screen.FigmaSize.W}×{screen.FigmaSize.H}  →  " +
                $"Unity: {screen.UnityRefResolution.W}×{screen.UnityRefResolution.H}");

            int elemCount = _manifest.Elements?.Count ?? 0;
            int assetCount = _manifest.Assets?.Count ?? 0;
            int fontCount = _manifest.Fonts?.Count ?? 0;
            EditorGUILayout.LabelField($"Elements: {elemCount}  |  Assets: {assetCount}  |  Fonts: {fontCount}");

            EditorGUILayout.EndVertical();
        }

        void DrawHierarchyPreview()
        {
            _showHierarchy = EditorGUILayout.Foldout(_showHierarchy, "Hierarchy Preview", true);
            if (!_showHierarchy) return;

            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            _hierarchyScroll = EditorGUILayout.BeginScrollView(_hierarchyScroll, GUILayout.MaxHeight(200));

            var roots = ManifestParser.GetRootElements(_manifest);
            var lookup = ManifestParser.BuildElementLookup(_manifest);

            foreach (var root in roots)
            {
                DrawHierarchyNode(root, lookup, 0);
            }

            EditorGUILayout.EndScrollView();
            EditorGUILayout.EndVertical();
        }

        void DrawHierarchyNode(ElementData element, Dictionary<string, ElementData> lookup, int depth)
        {
            EditorGUILayout.BeginHorizontal();
            GUILayout.Space(depth * 16);

            bool hasChildren = element.Children != null && element.Children.Count > 0;
            string prefix = hasChildren ? "▼" : "•";
            string typeTag = "";

            switch (element.FigmaType)
            {
                case "TEXT": typeTag = " (TEXT)"; break;
                case "VECTOR": typeTag = " (VEC)"; break;
                case "GROUP": typeTag = " (GRP)"; break;
            }

            if (hasChildren)
            {
                if (!_foldoutStates.ContainsKey(element.Id))
                    _foldoutStates[element.Id] = true;

                _foldoutStates[element.Id] = EditorGUILayout.Foldout(
                    _foldoutStates[element.Id],
                    $"{element.Name}{typeTag}",
                    true);
            }
            else
            {
                GUILayout.Label($"  {prefix} {element.Name}{typeTag}", EditorStyles.miniLabel);
            }

            EditorGUILayout.EndHorizontal();

            // Draw children if expanded
            if (hasChildren && _foldoutStates.TryGetValue(element.Id, out bool expanded) && expanded)
            {
                foreach (string childId in element.Children)
                {
                    if (lookup.TryGetValue(childId, out ElementData child))
                        DrawHierarchyNode(child, lookup, depth + 1);
                }
            }
        }

        void DrawOutputSettings()
        {
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            EditorGUILayout.LabelField("Output Settings", EditorStyles.boldLabel);

            _renderPipeline = (RenderPipeline)EditorGUILayout.EnumPopup("Render Pipeline", _renderPipeline);

            if (_renderPipeline == RenderPipeline.Object2D)
            {
                EditorGUILayout.HelpBox(
                    "2D Object mode: Uses SpriteRenderer instead of UGUI Canvas. " +
                    "Elements are placed in world space. No Canvas required.",
                    MessageType.Info);
            }

            _outputMode = (OutputMode)EditorGUILayout.EnumPopup("Output Mode", _outputMode);

            if (_outputMode == OutputMode.Prefab || _outputMode == OutputMode.Both)
            {
                _prefabSavePath = EditorGUILayout.TextField("Prefab Save Path", _prefabSavePath);
            }

            EditorGUILayout.EndVertical();
        }

        void DrawCanvasSettings()
        {
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            _showCanvasSettings = EditorGUILayout.Foldout(_showCanvasSettings, "Canvas Settings", true);

            if (_showCanvasSettings)
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
                    {
                        EditorGUILayout.HelpBox("No Canvas found in scene. Switch to 'Create New'.", MessageType.Warning);
                    }
                }
                else
                {
                    _canvasSettings.RenderMode = (RenderMode)EditorGUILayout.EnumPopup(
                        "Render Mode", _canvasSettings.RenderMode);

                    // Canvas Scale Preset
                    var newPreset = (CanvasScalePreset)EditorGUILayout.EnumPopup(
                        "Canvas Scale", _canvasScalePreset);
                    if (newPreset != _canvasScalePreset)
                    {
                        _canvasScalePreset = newPreset;
                        ApplyCanvasScalePreset();
                    }

                    if (_canvasScalePreset == CanvasScalePreset.Custom)
                    {
                        _canvasSettings.ReferenceResolution = EditorGUILayout.Vector2Field(
                            "Reference Resolution", _canvasSettings.ReferenceResolution);
                    }
                    else
                    {
                        EditorGUILayout.LabelField("Reference Resolution",
                            $"{_canvasSettings.ReferenceResolution.x:F0}×{_canvasSettings.ReferenceResolution.y:F0}");
                    }

                    // Show Figma design size info
                    if (_manifest?.Screen?.FigmaSize != null)
                    {
                        float csf = GetCanvasScaleFactor();
                        EditorGUILayout.LabelField("",
                            $"Figma: {_manifest.Screen.FigmaSize.W}×{_manifest.Screen.FigmaSize.H}  |  " +
                            $"Export: {_manifest.Screen.ExportScale}x  |  Canvas factor: {csf:F2}x",
                            EditorStyles.miniLabel);
                    }

                    _canvasSettings.MatchWidthOrHeight = EditorGUILayout.Slider(
                        "Match Width/Height", _canvasSettings.MatchWidthOrHeight, 0f, 1f);
                }
            }

            EditorGUILayout.EndVertical();
        }

        void DrawSpriteOutputFolder()
        {
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            EditorGUILayout.LabelField("📁 Sprite Output", EditorStyles.boldLabel);

            EditorGUILayout.BeginHorizontal();
            string displayFolder = string.IsNullOrEmpty(_spriteOutputFolder)
                ? "(not set)"
                : TruncatePath(_spriteOutputFolder, 45);
            EditorGUILayout.LabelField(displayFolder, EditorStyles.miniLabel);

            if (GUILayout.Button("Browse", GUILayout.Width(60)))
            {
                // Default to Assets/ folder if current path is outside project
                string startPath = _spriteOutputFolder;
                if (string.IsNullOrEmpty(startPath) || !startPath.StartsWith(Application.dataPath))
                    startPath = Application.dataPath; // .../Assets

                string folder = EditorUtility.OpenFolderPanel(
                    "Select Sprite Output Folder (must be inside Assets/)", startPath, "");
                if (!string.IsNullOrEmpty(folder))
                {
                    if (folder.StartsWith(Application.dataPath))
                    {
                        _spriteOutputFolder = folder;
                        EditorPrefs.SetString(PREF_SPRITE_FOLDER, _spriteOutputFolder);
                    }
                    else
                    {
                        EditorUtility.DisplayDialog("Invalid Folder",
                            "Sprite Output folder must be inside the Unity project's Assets/ directory.",
                            "OK");
                    }
                }
            }

            if (GUILayout.Button("↻", GUILayout.Width(24)))
            {
                _spriteOutputFolder = AutoDetectSpriteFolder();
                EditorPrefs.SetString(PREF_SPRITE_FOLDER, _spriteOutputFolder);
            }

            EditorGUILayout.EndHorizontal();
            EditorGUILayout.EndVertical();
        }

        void DrawFontMapping()
        {
            if (_fontMapping == null || _fontMapping.Count == 0) return;

            _showFontMapping = EditorGUILayout.Foldout(_showFontMapping, "🔤 Font Mapping", true);
            if (!_showFontMapping) return;

            EditorGUILayout.BeginVertical(EditorStyles.helpBox);

            int matched = 0;
            var keys = new List<string>(_fontMapping.Keys);
            foreach (string key in keys)
            {
                EditorGUILayout.BeginHorizontal();

                // Label: "Family|Style"
                TMP_FontAsset current = _fontMapping[key];
                string status = current != null ? "✅" : "⚠️";
                EditorGUILayout.LabelField($"{status} {key}", GUILayout.Width(180));

                // Dropdown to pick font
                TMP_FontAsset newFont = (TMP_FontAsset)EditorGUILayout.ObjectField(
                    current, typeof(TMP_FontAsset), false);
                if (newFont != current)
                    _fontMapping[key] = newFont;

                if (current != null) matched++;

                EditorGUILayout.EndHorizontal();
            }

            int projectFontCount = _allProjectFonts?.Length ?? 0;
            EditorGUILayout.LabelField("",
                $"Matched: {matched}/{_fontMapping.Count}  |  Project fonts: {projectFontCount}",
                EditorStyles.miniLabel);

            EditorGUILayout.EndVertical();
        }

        void DrawBuildOptions()
        {
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            _showBuildOptions = EditorGUILayout.Foldout(_showBuildOptions, "Build Options", true);

            if (_showBuildOptions)
            {
                _buildOptions.ImportTextures = EditorGUILayout.Toggle("Import textures as Sprite", _buildOptions.ImportTextures);
                _buildOptions.ApplyNineSlice = EditorGUILayout.Toggle("Apply 9-slice (corner radius)", _buildOptions.ApplyNineSlice);
                _buildOptions.DisableRaycastTarget = EditorGUILayout.Toggle("Disable raycastTarget (non-interactive)", _buildOptions.DisableRaycastTarget);
                _buildOptions.ScaleToUnityResolution = EditorGUILayout.Toggle("Scale to Unity resolution", _buildOptions.ScaleToUnityResolution);
            }

            EditorGUILayout.EndVertical();
        }

        void DrawTextureSettings()
        {
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            _showTextureSettings = EditorGUILayout.Foldout(_showTextureSettings, "🖼 Texture Import Settings", true);

            if (_showTextureSettings)
            {
                EditorGUI.indentLevel++;

                // General
                EditorGUILayout.LabelField("General", EditorStyles.miniBoldLabel);
                _textureSettings.AutoDetectMaxSize = EditorGUILayout.Toggle(
                    "Auto-detect Max Size", _textureSettings.AutoDetectMaxSize);

                if (!_textureSettings.AutoDetectMaxSize)
                {
                    _textureSettings.MaxTextureSize = EditorGUILayout.IntPopup(
                        "Max Texture Size", _textureSettings.MaxTextureSize,
                        new[] { "64", "128", "256", "512", "1024", "2048", "4096" },
                        new[] { 64, 128, 256, 512, 1024, 2048, 4096 });
                }
                else
                {
                    EditorGUILayout.LabelField("Max Size", "Auto (based on PNG dimensions)",
                        EditorStyles.miniLabel);
                }

                _textureSettings.Compression = (TextureImporterCompression)EditorGUILayout.EnumPopup(
                    "Compression", _textureSettings.Compression);
                _textureSettings.MipmapEnabled = EditorGUILayout.Toggle(
                    "Generate Mipmaps", _textureSettings.MipmapEnabled);

                EditorGUILayout.Space(4);

                // Android override
                EditorGUILayout.LabelField("Android", EditorStyles.miniBoldLabel);
                _textureSettings.OverrideAndroid = EditorGUILayout.Toggle(
                    "Override Android", _textureSettings.OverrideAndroid);
                if (_textureSettings.OverrideAndroid)
                {
                    EditorGUI.indentLevel++;
                    _textureSettings.AndroidFormat = (TextureImporterFormat)EditorGUILayout.EnumPopup(
                        "Format", _textureSettings.AndroidFormat);
                    if (!_textureSettings.AutoDetectMaxSize)
                    {
                        _textureSettings.AndroidMaxSize = EditorGUILayout.IntPopup(
                            "Max Size", _textureSettings.AndroidMaxSize,
                            new[] { "64", "128", "256", "512", "1024", "2048", "4096" },
                            new[] { 64, 128, 256, 512, 1024, 2048, 4096 });
                    }
                    EditorGUI.indentLevel--;
                }

                EditorGUILayout.Space(4);

                // iOS override
                EditorGUILayout.LabelField("iOS", EditorStyles.miniBoldLabel);
                _textureSettings.OverrideiOS = EditorGUILayout.Toggle(
                    "Override iOS", _textureSettings.OverrideiOS);
                if (_textureSettings.OverrideiOS)
                {
                    EditorGUI.indentLevel++;
                    _textureSettings.iOSFormat = (TextureImporterFormat)EditorGUILayout.EnumPopup(
                        "Format", _textureSettings.iOSFormat);
                    if (!_textureSettings.AutoDetectMaxSize)
                    {
                        _textureSettings.iOSMaxSize = EditorGUILayout.IntPopup(
                            "Max Size", _textureSettings.iOSMaxSize,
                            new[] { "64", "128", "256", "512", "1024", "2048", "4096" },
                            new[] { 64, 128, 256, 512, 1024, 2048, 4096 });
                    }
                    EditorGUI.indentLevel--;
                }

                EditorGUI.indentLevel--;

                // Save on change
                if (GUI.changed)
                    _textureSettings.SaveToPrefs();
            }

            EditorGUILayout.EndVertical();
        }

        void DrawSpriteAtlasSettings()
        {
            EditorGUILayout.BeginVertical(EditorStyles.helpBox);
            _showAtlasSettings = EditorGUILayout.Foldout(_showAtlasSettings, "📦 Sprite Atlas Settings", true);

            if (_showAtlasSettings)
            {
                EditorGUI.indentLevel++;

                _atlasSettings.CreateAtlas = EditorGUILayout.Toggle(
                    "Create Sprite Atlas", _atlasSettings.CreateAtlas);

                if (_atlasSettings.CreateAtlas)
                {
                    _atlasSettings.AtlasSubfolder = EditorGUILayout.TextField(
                        "Atlas Subfolder", _atlasSettings.AtlasSubfolder);
                    _atlasSettings.Padding = EditorGUILayout.IntSlider(
                        "Padding (px)", _atlasSettings.Padding, 0, 8);
                    _atlasSettings.EnableRotation = EditorGUILayout.Toggle(
                        "Allow Rotation", _atlasSettings.EnableRotation);
                    _atlasSettings.IncludeInBuild = EditorGUILayout.Toggle(
                        "Include in Build", _atlasSettings.IncludeInBuild);

                    EditorGUILayout.Space(4);

                    _atlasSettings.UseSameAsTextureSettings = EditorGUILayout.Toggle(
                        "Use Texture Settings", _atlasSettings.UseSameAsTextureSettings);

                    if (!_atlasSettings.UseSameAsTextureSettings)
                    {
                        EditorGUI.indentLevel++;
                        _atlasSettings.AtlasMaxSize = EditorGUILayout.IntPopup(
                            "Max Size", _atlasSettings.AtlasMaxSize,
                            new[] { "256", "512", "1024", "2048", "4096" },
                            new[] { 256, 512, 1024, 2048, 4096 });
                        _atlasSettings.AtlasAndroidFormat = (TextureImporterFormat)EditorGUILayout.EnumPopup(
                            "Android Format", _atlasSettings.AtlasAndroidFormat);
                        _atlasSettings.AtlasiOSFormat = (TextureImporterFormat)EditorGUILayout.EnumPopup(
                            "iOS Format", _atlasSettings.AtlasiOSFormat);
                        EditorGUI.indentLevel--;
                    }
                    else
                    {
                        EditorGUILayout.LabelField("", "Inherits from Texture Import Settings",
                            EditorStyles.miniLabel);
                    }
                }

                EditorGUI.indentLevel--;

                if (GUI.changed)
                    _atlasSettings.SaveToPrefs();
            }

            EditorGUILayout.EndVertical();
        }

        void DrawBuildButton()
        {
            GUI.enabled = !_isBuilding && _manifest != null;

            Color prevColor = GUI.backgroundColor;
            GUI.backgroundColor = new Color(0.3f, 0.8f, 0.3f);

            string buildLabel = _isBuilding ? "⏳ Building..." : "▶  Build UI";
            if (GUILayout.Button(buildLabel, GUILayout.Height(32)))
            {
                if (!_isBuilding) ExecuteBuild();
            }

            GUI.backgroundColor = prevColor;
            GUI.enabled = true;

            // Detailed progress bar with spinner
            if (_isBuilding)
            {
                EditorGUILayout.Space(2);

                // Animated spinner
                string[] spinner = { "◐", "◓", "◑", "◒" };
                int spinIdx = (int)(EditorApplication.timeSinceStartup * 4) % 4;
                string progressText = $"{spinner[spinIdx]} {_buildProgressLabel}  ({_buildProgress * 100:F0}%)";

                Rect progressRect = EditorGUILayout.GetControlRect(false, 22);
                EditorGUI.ProgressBar(progressRect, _buildProgress, progressText);

                // Force repaint for animation
                Repaint();
            }
        }

        void DrawBuildLog()
        {
            if (_buildLog.Count == 0) return;

            EditorGUILayout.LabelField("Build Log", EditorStyles.boldLabel);

            _logScroll = EditorGUILayout.BeginScrollView(_logScroll, GUILayout.MaxHeight(150));

            foreach (var entry in _buildLog)
            {
                string icon;
                Color color;
                switch (entry.Level)
                {
                    case BuildLogEntry.LogLevel.Success:
                        icon = "✅";
                        color = new Color(0.2f, 0.8f, 0.2f);
                        break;
                    case BuildLogEntry.LogLevel.Warning:
                        icon = "⚠️";
                        color = new Color(1f, 0.8f, 0.2f);
                        break;
                    default:
                        icon = "❌";
                        color = new Color(1f, 0.3f, 0.3f);
                        break;
                }

                Color prevColor = GUI.contentColor;
                GUI.contentColor = color;
                EditorGUILayout.LabelField($"{icon} {entry.Message}", EditorStyles.miniLabel);
                GUI.contentColor = prevColor;
            }

            EditorGUILayout.EndScrollView();
        }

        // =====================================================================
        // Logic
        // =====================================================================

        void LoadManifest()
        {
            _manifest = null;
            _manifestError = null;
            _buildLog.Clear();
            _foldoutStates.Clear();
            _fontMapping.Clear();

            string manifestPath = ManifestParser.FindManifestInFolder(_exportFolderPath);
            if (manifestPath == null)
            {
                _manifestError = $"No manifest.json found in: {_exportFolderPath}";
                return;
            }

            _manifest = ManifestParser.ParseFromFile(manifestPath);
            if (_manifest == null)
            {
                _manifestError = "Failed to parse manifest.json. Check console for details.";
                return;
            }

            // Apply canvas scale preset (auto-fills reference resolution)
            ApplyCanvasScalePreset();

            // Scan project fonts and auto-match
            ScanProjectFonts();

            Repaint();
        }

        void ExecuteBuild()
        {
            _isBuilding = true;
            _buildLog.Clear();
            _buildProgress = 0f;

            try
            {
                // 1. Import textures
                Dictionary<string, Sprite> sprites = null;

                if (_buildOptions.ImportTextures)
                {
                    string screenName = SanitizeFolderName(_manifest.Screen?.Name ?? "FigmaImport");
                    string targetFolder = Path.Combine(_spriteOutputFolder, screenName)
                        .Replace('\\', '/');

                    _buildProgressLabel = "Importing textures...";
                    Repaint();

                    sprites = TextureImportHelper.ImportTextures(
                        _exportFolderPath,
                        targetFolder,
                        _manifest,
                        _buildOptions.ApplyNineSlice,
                        _textureSettings,
                        (current, total, label) =>
                        {
                            _buildProgress = (float)current / total * 0.3f; // 0-30%
                            _buildProgressLabel = label;
                        });

                    _buildLog.Add(new BuildLogEntry(
                        BuildLogEntry.LogLevel.Success,
                        $"Imported {sprites.Count} textures → {TruncatePath(targetFolder, 40)}"));

                    // Create Sprite Atlas (if enabled)
                    if (_atlasSettings.CreateAtlas)
                    {
                        _buildProgressLabel = "Creating Sprite Atlas...";
                        Repaint();

                        string screenName = _manifest.Screen?.Name ?? "FigmaImport";
                        var atlas = SpriteAtlasHelper.CreateAtlas(
                            targetFolder, screenName, _atlasSettings, _textureSettings);

                        if (atlas != null)
                        {
                            _buildLog.Add(new BuildLogEntry(
                                BuildLogEntry.LogLevel.Success,
                                $"SpriteAtlas created: {atlas.name}"));
                        }
                    }
                }

                // 2. Calculate canvas scale factor
                float canvasScaleFactor = GetCanvasScaleFactor();

                _buildLog.Add(new BuildLogEntry(
                    BuildLogEntry.LogLevel.Success,
                    $"Canvas scale: {canvasScaleFactor:F2}x ({_canvasScalePreset})"));

                // 3. Build hierarchy
                _buildProgressLabel = "Building hierarchy...";
                Repaint();

                // Get export scale for sprite sizing
                float exportScale = _manifest.Screen?.ExportScale > 0
                    ? _manifest.Screen.ExportScale : 1f;

                HierarchyBuilder.Build(
                    _manifest,
                    sprites,
                    _buildOptions,
                    _renderPipeline,
                    _outputMode,
                    _canvasSettings,
                    _prefabSavePath,
                    canvasScaleFactor,
                    exportScale,
                    _fontMapping,
                    (current, total, label) =>
                    {
                        _buildProgress = 0.3f + (float)current / total * 0.7f; // 30-100%
                        _buildProgressLabel = label;
                    },
                    _buildLog);

                _buildProgress = 1f;
                _buildProgressLabel = "Done!";

                _buildLog.Add(new BuildLogEntry(
                    BuildLogEntry.LogLevel.Success,
                    $"Build complete! Mode: {_outputMode}"));
            }
            catch (System.Exception ex)
            {
                _buildLog.Add(new BuildLogEntry(
                    BuildLogEntry.LogLevel.Error,
                    $"Build failed: {ex.Message}"));
                Debug.LogException(ex);
            }
            finally
            {
                _isBuilding = false;
                EditorUtility.ClearProgressBar();
                AssetDatabase.Refresh();
                Repaint();
            }
        }

        void RefreshSceneCanvases()
        {
            _sceneCanvases = FindObjectsOfType<Canvas>();
            _sceneCanvasNames = new string[_sceneCanvases.Length];
            for (int i = 0; i < _sceneCanvases.Length; i++)
            {
                _sceneCanvasNames[i] = _sceneCanvases[i].gameObject.name;
            }

            if (_selectedCanvasIndex >= _sceneCanvases.Length)
                _selectedCanvasIndex = 0;
        }

        // =====================================================================
        // Utilities
        // =====================================================================

        /// <summary>
        /// Get the scale multiplier based on canvas scale preset.
        /// </summary>
        float GetPresetScaleValue()
        {
            switch (_canvasScalePreset)
            {
                case CanvasScalePreset.Scale1x: return 1f;
                case CanvasScalePreset.Scale1_5x: return 1.5f;
                case CanvasScalePreset.Scale2x: return 2f;
                case CanvasScalePreset.Scale3x: return 3f;
                case CanvasScalePreset.Scale4x: return 4f;
                case CanvasScalePreset.Auto:
                    return GetManifestCanvasScale();
                default: return 1f; // Custom uses manual ref resolution
            }
        }

        /// <summary>
        /// Derive canvas scale from manifest's unityRefResolution / figmaSize.
        /// This is INDEPENDENT of exportScale (which only affects PNG quality).
        /// Example: Figma 360×800, Unity ref 1080×2400 → scale = 3.0
        /// </summary>
        float GetManifestCanvasScale()
        {
            if (_manifest?.Screen == null) return 1f;

            // Always derive from unityRefResolution / figmaSize (match height)
            if (_manifest.Screen.UnityRefResolution != null && _manifest.Screen.FigmaSize != null
                && _manifest.Screen.FigmaSize.H > 0)
            {
                float derived = _manifest.Screen.UnityRefResolution.H / _manifest.Screen.FigmaSize.H;
                if (derived > 0.1f) return derived;
            }

            // Fallback: use figma size directly (1:1)
            return 1f;
        }

        /// <summary>
        /// Apply canvas scale preset to reference resolution.
        /// </summary>
        void ApplyCanvasScalePreset()
        {
            if (_manifest?.Screen?.FigmaSize == null) return;

            if (_canvasScalePreset == CanvasScalePreset.Custom) return;

            float scale = GetPresetScaleValue();
            _canvasSettings.ReferenceResolution = new Vector2(
                _manifest.Screen.FigmaSize.W * scale,
                _manifest.Screen.FigmaSize.H * scale);
        }

        /// <summary>
        /// Calculate canvasScaleFactor = canvasRefH / figmaH (match height).
        /// </summary>
        float GetCanvasScaleFactor()
        {
            if (_manifest?.Screen?.FigmaSize == null || _manifest.Screen.FigmaSize.H <= 0)
                return 1f;

            // Use match height: canvasRefH / figmaH
            float figmaH = _manifest.Screen.FigmaSize.H;
            float canvasH = _canvasSettings.ReferenceResolution.y;

            if (_canvasSettings.MatchWidthOrHeight < 0.5f)
            {
                // Match width
                float figmaW = _manifest.Screen.FigmaSize.W;
                float canvasW = _canvasSettings.ReferenceResolution.x;
                return canvasW > 0 ? canvasW / figmaW : 1f;
            }

            return canvasH > 0 ? canvasH / figmaH : 1f;
        }

        /// <summary>
        /// Scan project for all TMP_FontAsset and auto-match with manifest fonts.
        /// </summary>
        void ScanProjectFonts()
        {
            // Find ALL TMP_FontAsset in project
            string[] guids = AssetDatabase.FindAssets("t:TMP_FontAsset");
            _allProjectFonts = new TMP_FontAsset[guids.Length];
            _allProjectFontNames = new string[guids.Length];
            for (int i = 0; i < guids.Length; i++)
            {
                string path = AssetDatabase.GUIDToAssetPath(guids[i]);
                _allProjectFonts[i] = AssetDatabase.LoadAssetAtPath<TMP_FontAsset>(path);
                _allProjectFontNames[i] = _allProjectFonts[i]?.name
                    ?? Path.GetFileNameWithoutExtension(path);
            }

            // Auto-match each font from manifest
            _fontMapping.Clear();
            if (_manifest?.Fonts == null) return;

            foreach (var font in _manifest.Fonts)
            {
                if (font.Styles == null) continue;
                foreach (var style in font.Styles)
                {
                    string key = $"{font.Family}|{style}";
                    // Use existing search logic for auto-match
                    TMP_FontAsset matched = FindFontInProject(font.Family, style);
                    _fontMapping[key] = matched; // null if not found
                }
            }
        }

        /// <summary>
        /// Search project for TMP font matching family + style.
        /// </summary>
        static TMP_FontAsset FindFontInProject(string family, string style)
        {
            if (string.IsNullOrEmpty(family)) return null;

            string[] patterns = new[]
            {
                $"{family}-{style}",
                $"{family} {style}",
                family
            };

            foreach (string pattern in patterns)
            {
                string[] guids = AssetDatabase.FindAssets($"t:TMP_FontAsset {pattern}");
                if (guids.Length > 0)
                {
                    string path = AssetDatabase.GUIDToAssetPath(guids[0]);
                    TMP_FontAsset font = AssetDatabase.LoadAssetAtPath<TMP_FontAsset>(path);
                    if (font != null) return font;
                }
            }

            return null;
        }

        /// <summary>
        /// Auto-detect sprite output folder: look for "Sprites" or "Textures" in Assets/.
        /// </summary>
        string AutoDetectSpriteFolder()
        {
            string[] folderNames = { "Sprites", "Textures" };
            foreach (string name in folderNames)
            {
                string[] guids = AssetDatabase.FindAssets($"t:Folder {name}");
                foreach (string guid in guids)
                {
                    string path = AssetDatabase.GUIDToAssetPath(guid);

                    // Only accept folders under Assets/ (skip Packages, plugins, TMP, etc.)
                    if (!path.StartsWith("Assets/")) continue;
                    if (path.Contains("TextMeshPro") || path.Contains("TextMesh Pro")) continue;
                    if (path.Contains("/Plugins/") || path.Contains("/Editor/")) continue;

                    if (Path.GetFileName(path) == name)
                    {
                        // Convert to absolute path
                        string dataPath = Application.dataPath.Replace('\\', '/');
                        string relativePath = path.Substring("Assets".Length);
                        return (dataPath + relativePath).Replace('\\', '/');
                    }
                }
            }

            // Fallback
            return Path.Combine(Application.dataPath, "FigmaImport").Replace('\\', '/');
        }

        static string TruncatePath(string path, int maxLength)
        {
            if (path.Length <= maxLength) return path;
            return "..." + path.Substring(path.Length - maxLength + 3);
        }

        static string SanitizeFolderName(string name)
        {
            char[] invalid = Path.GetInvalidFileNameChars();
            foreach (char c in invalid)
                name = name.Replace(c, '_');
            // Also replace spaces and parentheses
            name = name.Replace(' ', '_').Replace('(', '_').Replace(')', '_');
            // Collapse multiple underscores
            while (name.Contains("__"))
                name = name.Replace("__", "_");
            return name.Trim('_');
        }
    }
}
