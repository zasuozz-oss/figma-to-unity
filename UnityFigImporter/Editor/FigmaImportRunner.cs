// =============================================================================
// FigmaImportRunner — Shared build core for window + headless import.
// Mirrors the former FigmaImporterWindow.ExecuteBuild() pipeline:
// ManifestParser → TextureImportHelper → SpriteAtlasHelper → HierarchyBuilder.
// =============================================================================

using System.Collections.Generic;
using System.IO;
using FigmaImporter.Data;
using TMPro;
using UnityEditor;
using UnityEngine;

namespace FigmaImporter
{
    public class ImportRequest
    {
        public string ExportFolder;                  // absolute folder containing manifest.json + PNGs
        public OutputMode OutputMode = OutputMode.Scene;
        public RenderPipeline RenderPipeline = RenderPipeline.UGUI;
        public string PrefabSavePath = "Assets/Prefabs/UI/";
        public string SpriteOutputFolder;            // absolute path under Assets/; null → <dataPath>/FigmaImport
        public BuildOptions BuildOptions = new BuildOptions();
        public TextureImportSettings TextureSettings = new TextureImportSettings();
        public SpriteAtlasSettings AtlasSettings = new SpriteAtlasSettings();
        public CanvasSettings CanvasSettings;        // null → defaults + auto ref resolution from manifest
        public Dictionary<string, TMP_FontAsset> FontMapping; // null → auto-match project fonts
        public System.Action<float, string> OnProgress;       // 0..1 + label
    }

    public class ImportResult
    {
        public bool Success;
        public string RootName;
        public int TextureCount;
        public List<BuildLogEntry> Log = new List<BuildLogEntry>();
    }

    public static class FigmaImportRunner
    {
        public static ImportResult Run(ImportRequest req)
        {
            var result = new ImportResult();

            try
            {
                // 0. Load manifest
                string manifestPath = ManifestParser.FindManifestInFolder(req.ExportFolder);
                if (manifestPath == null)
                {
                    Fail(result, $"No manifest.json found in: {req.ExportFolder}");
                    return result;
                }

                var manifest = ManifestParser.ParseFromFile(manifestPath);
                if (manifest == null)
                {
                    Fail(result, "Failed to parse manifest.json. Check console for details.");
                    return result;
                }

                var canvasSettings = req.CanvasSettings ?? AutoCanvasSettings(manifest);
                var fontMapping = req.FontMapping ?? AutoMatchFonts(manifest);

                // 1. Import textures
                Dictionary<string, Sprite> sprites = null;

                if (req.BuildOptions.ImportTextures)
                {
                    string spriteRoot = string.IsNullOrEmpty(req.SpriteOutputFolder)
                        ? Path.Combine(Application.dataPath, "FigmaImport").Replace('\\', '/')
                        : req.SpriteOutputFolder;
                    string screenName = SanitizeFolderName(manifest.Screen?.Name ?? "FigmaImport");
                    string targetFolder = Path.Combine(spriteRoot, screenName).Replace('\\', '/');

                    Report(req, 0f, "Importing textures...");

                    sprites = TextureImportHelper.ImportTextures(
                        req.ExportFolder,
                        targetFolder,
                        manifest,
                        req.TextureSettings,
                        (current, total, label) =>
                            Report(req, (float)current / total * 0.3f, label)); // 0-30%

                    result.TextureCount = sprites.Count;
                    result.Log.Add(new BuildLogEntry(
                        BuildLogEntry.LogLevel.Success,
                        $"Imported {sprites.Count} textures → {targetFolder}"));

                    if (req.AtlasSettings != null && req.AtlasSettings.CreateAtlas)
                    {
                        Report(req, 0.3f, "Creating Sprite Atlas...");

                        var atlas = SpriteAtlasHelper.CreateAtlas(
                            targetFolder, screenName, req.AtlasSettings, req.TextureSettings);

                        if (atlas != null)
                        {
                            result.Log.Add(new BuildLogEntry(
                                BuildLogEntry.LogLevel.Success,
                                $"SpriteAtlas created: {atlas.name}"));
                        }
                    }
                }

                // 2. Canvas scale factor
                float canvasScaleFactor = GetCanvasScaleFactor(manifest, canvasSettings);

                result.Log.Add(new BuildLogEntry(
                    BuildLogEntry.LogLevel.Success,
                    $"Canvas scale: {canvasScaleFactor:F2}x"));

                // 3. Build hierarchy
                Report(req, 0.3f, "Building hierarchy...");

                float exportScale = manifest.Screen?.ExportScale > 0
                    ? manifest.Screen.ExportScale : 1f;

                var root = HierarchyBuilder.Build(
                    manifest,
                    sprites,
                    req.BuildOptions,
                    req.RenderPipeline,
                    req.OutputMode,
                    canvasSettings,
                    req.PrefabSavePath,
                    canvasScaleFactor,
                    exportScale,
                    fontMapping,
                    (current, total, label) =>
                        Report(req, 0.3f + (float)current / total * 0.7f, label), // 30-100%
                    result.Log);

                result.RootName = root != null ? root.name : null;
                result.Success = root != null
                    && !result.Log.Exists(e => e.Level == BuildLogEntry.LogLevel.Error);

                Report(req, 1f, "Done!");
            }
            catch (System.Exception ex)
            {
                Fail(result, $"Build failed: {ex.Message}");
                Debug.LogException(ex);
            }
            finally
            {
                EditorUtility.ClearProgressBar();
                AssetDatabase.Refresh();
            }

            return result;
        }

        /// <summary>
        /// Default canvas settings with the "Auto" preset behavior:
        /// ReferenceResolution = figmaSize * (unityRefResolution.H / figmaSize.H).
        /// </summary>
        public static CanvasSettings AutoCanvasSettings(ManifestData manifest)
        {
            var settings = new CanvasSettings();

            if (manifest?.Screen?.FigmaSize == null) return settings;

            float scale = 1f;
            if (manifest.Screen.UnityRefResolution != null && manifest.Screen.FigmaSize.H > 0)
            {
                float derived = manifest.Screen.UnityRefResolution.H / manifest.Screen.FigmaSize.H;
                if (derived > 0.1f) scale = derived;
            }

            settings.ReferenceResolution = new Vector2(
                manifest.Screen.FigmaSize.W * scale,
                manifest.Screen.FigmaSize.H * scale);
            return settings;
        }

        /// <summary>
        /// canvasScaleFactor = canvasRefH / figmaH (or width when MatchWidthOrHeight < 0.5).
        /// Independent of exportScale (PNG quality only).
        /// </summary>
        public static float GetCanvasScaleFactor(ManifestData manifest, CanvasSettings canvasSettings)
        {
            if (manifest?.Screen?.FigmaSize == null || manifest.Screen.FigmaSize.H <= 0)
                return 1f;

            if (canvasSettings.MatchWidthOrHeight < 0.5f)
            {
                float figmaW = manifest.Screen.FigmaSize.W;
                float canvasW = canvasSettings.ReferenceResolution.x;
                return canvasW > 0 ? canvasW / figmaW : 1f;
            }

            float figmaH = manifest.Screen.FigmaSize.H;
            float canvasH = canvasSettings.ReferenceResolution.y;
            return canvasH > 0 ? canvasH / figmaH : 1f;
        }

        /// <summary>
        /// Auto-match every "family|style" font key in the manifest against
        /// the project's TMP_FontAssets. Values may be null (no match).
        /// </summary>
        public static Dictionary<string, TMP_FontAsset> AutoMatchFonts(ManifestData manifest)
        {
            var mapping = new Dictionary<string, TMP_FontAsset>();
            if (manifest?.Fonts == null) return mapping;

            foreach (var font in manifest.Fonts)
            {
                if (font.Styles == null) continue;
                foreach (var style in font.Styles)
                {
                    string key = $"{font.Family}|{style}";
                    mapping[key] = FindFontInProject(font.Family, style);
                }
            }
            return mapping;
        }

        /// <summary>
        /// Search project for TMP font matching family + style.
        /// </summary>
        public static TMP_FontAsset FindFontInProject(string family, string style)
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

        public static string SanitizeFolderName(string name)
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

        static void Report(ImportRequest req, float progress, string label)
        {
            req.OnProgress?.Invoke(progress, label);
        }

        static void Fail(ImportResult result, string message)
        {
            result.Success = false;
            result.Log.Add(new BuildLogEntry(BuildLogEntry.LogLevel.Error, message));
        }
    }
}
