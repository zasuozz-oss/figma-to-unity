// =============================================================================
// TextureImportHelper — Copy PNGs → Assets, configure Sprite import + 9-slice
// =============================================================================

using System.Collections.Generic;
using System.IO;
using FigmaImporter.Data;
using UnityEditor;
using UnityEditor.U2D;
using UnityEngine;
using UnityEngine.U2D;

namespace FigmaImporter
{
    // =========================================================================
    // TextureImportSettings — User-configurable texture import settings
    // =========================================================================
    [System.Serializable]
    public class TextureImportSettings
    {
        // General settings
        public int MaxTextureSize = 2048;
        public bool AutoDetectMaxSize = true;
        public bool MipmapEnabled = false;
        public TextureImporterCompression Compression = TextureImporterCompression.Compressed;

        // Android platform override
        public bool OverrideAndroid = true;
        public TextureImporterFormat AndroidFormat = TextureImporterFormat.ASTC_4x4;
        public int AndroidMaxSize = 2048;

        // iOS platform override
        public bool OverrideiOS = true;
        public TextureImporterFormat iOSFormat = TextureImporterFormat.ASTC_4x4;
        public int iOSMaxSize = 2048;

        /// <summary>
        /// Calculate the optimal max texture size based on actual pixel dimensions.
        /// </summary>
        public static int CalculateOptimalMaxSize(int pixelWidth, int pixelHeight)
        {
            int maxDimension = Mathf.Max(pixelWidth, pixelHeight);
            if (maxDimension <= 64) return 64;
            if (maxDimension <= 128) return 128;
            if (maxDimension <= 256) return 256;
            if (maxDimension <= 512) return 512;
            if (maxDimension <= 1024) return 1024;
            return 2048;
        }

        // EditorPrefs keys
        const string PREF_PREFIX = "FigmaImporter_Tex_";

        public void SaveToPrefs()
        {
            EditorPrefs.SetInt(PREF_PREFIX + "MaxSize", MaxTextureSize);
            EditorPrefs.SetBool(PREF_PREFIX + "AutoDetect", AutoDetectMaxSize);
            EditorPrefs.SetBool(PREF_PREFIX + "Mipmap", MipmapEnabled);
            EditorPrefs.SetInt(PREF_PREFIX + "Compression", (int)Compression);

            EditorPrefs.SetBool(PREF_PREFIX + "Android", OverrideAndroid);
            EditorPrefs.SetInt(PREF_PREFIX + "AndroidFmt", (int)AndroidFormat);
            EditorPrefs.SetInt(PREF_PREFIX + "AndroidMax", AndroidMaxSize);

            EditorPrefs.SetBool(PREF_PREFIX + "iOS", OverrideiOS);
            EditorPrefs.SetInt(PREF_PREFIX + "iOSFmt", (int)iOSFormat);
            EditorPrefs.SetInt(PREF_PREFIX + "iOSMax", iOSMaxSize);
        }

        public void LoadFromPrefs()
        {
            MaxTextureSize = EditorPrefs.GetInt(PREF_PREFIX + "MaxSize", 2048);
            AutoDetectMaxSize = EditorPrefs.GetBool(PREF_PREFIX + "AutoDetect", true);
            MipmapEnabled = EditorPrefs.GetBool(PREF_PREFIX + "Mipmap", false);
            Compression = (TextureImporterCompression)EditorPrefs.GetInt(PREF_PREFIX + "Compression", (int)TextureImporterCompression.Compressed);

            OverrideAndroid = EditorPrefs.GetBool(PREF_PREFIX + "Android", true);
            AndroidFormat = (TextureImporterFormat)EditorPrefs.GetInt(PREF_PREFIX + "AndroidFmt", (int)TextureImporterFormat.ASTC_4x4);
            AndroidMaxSize = EditorPrefs.GetInt(PREF_PREFIX + "AndroidMax", 2048);

            OverrideiOS = EditorPrefs.GetBool(PREF_PREFIX + "iOS", true);
            iOSFormat = (TextureImporterFormat)EditorPrefs.GetInt(PREF_PREFIX + "iOSFmt", (int)TextureImporterFormat.ASTC_4x4);
            iOSMaxSize = EditorPrefs.GetInt(PREF_PREFIX + "iOSMax", 2048);
        }
    }

    public static class TextureImportHelper
    {
        /// <summary>
        /// Import all PNG assets from source folder to Unity Assets folder.
        /// Returns a dictionary mapping original filename → loaded Sprite.
        /// </summary>
        public static Dictionary<string, Sprite> ImportTextures(
            string sourceFolder,
            string targetFolder,
            ManifestData manifest,
            bool applyNineSlice,
            TextureImportSettings texSettings = null,
            System.Action<int, int, string> onProgress = null)
        {
            var result = new Dictionary<string, Sprite>();
            if (texSettings == null) texSettings = new TextureImportSettings();

            // Ensure target folder exists
            CreateFolderRecursive(targetFolder);

            // Collect all PNG files
            string[] pngFiles = Directory.GetFiles(sourceFolder, "*.png");
            int total = pngFiles.Length;

            // Build cornerRadius lookup from manifest elements for 9-slice
            var cornerRadiusLookup = BuildCornerRadiusLookup(manifest);

            // ── Phase 1: Copy files + configure importers (BATCHED) ──
            AssetDatabase.StartAssetEditing();
            try
            {
                for (int i = 0; i < pngFiles.Length; i++)
                {
                    string srcPath = pngFiles[i];
                    string fileName = Path.GetFileName(srcPath);

                    onProgress?.Invoke(i + 1, total, $"Copying: {fileName}");

                    // Copy file to target folder
                    string destPath = Path.Combine(targetFolder, fileName);
                    string destDir = Path.GetDirectoryName(destPath);
                    if (!string.IsNullOrEmpty(destDir) && !Directory.Exists(destDir))
                        Directory.CreateDirectory(destDir);
                    File.Copy(srcPath, destPath, overwrite: true);
                }
            }
            finally
            {
                AssetDatabase.StopAssetEditing();
            }

            // Force reimport all copied files
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);

            // ── Phase 2: Configure importers (BATCHED) ──
            AssetDatabase.StartAssetEditing();
            try
            {
                for (int i = 0; i < pngFiles.Length; i++)
                {
                    string fileName = Path.GetFileName(pngFiles[i]);
                    string destPath = Path.Combine(targetFolder, fileName);
                    string assetPath = FilePathToAssetPath(destPath);

                    onProgress?.Invoke(i + 1, total, $"Configuring: {fileName}");

                    var importer = AssetImporter.GetAtPath(assetPath) as TextureImporter;
                    if (importer != null)
                    {
                        ConfigureSpriteImporter(importer, fileName, cornerRadiusLookup, applyNineSlice, texSettings);
                        // Note: NO SaveAndReimport() here — batched by StopAssetEditing
                    }
                }
            }
            finally
            {
                AssetDatabase.StopAssetEditing();
            }

            // ── Phase 3: Reimport all + load sprites ──
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);

            for (int i = 0; i < pngFiles.Length; i++)
            {
                string fileName = Path.GetFileName(pngFiles[i]);
                string destPath = Path.Combine(targetFolder, fileName);
                string assetPath = FilePathToAssetPath(destPath);

                Sprite sprite = AssetDatabase.LoadAssetAtPath<Sprite>(assetPath);
                if (sprite != null)
                {
                    result[fileName] = sprite;
                }
                else
                {
                    Debug.LogWarning($"[FigmaImporter] Failed to load sprite: {assetPath}");
                }
            }

            return result;
        }

        static void ConfigureSpriteImporter(
            TextureImporter importer,
            string fileName,
            Dictionary<string, float> cornerRadiusLookup,
            bool applyNineSlice,
            TextureImportSettings settings)
        {
            // Basic type settings
            importer.textureType = TextureImporterType.Sprite;
            importer.spriteImportMode = SpriteImportMode.Single;
            importer.spritePixelsPerUnit = 100;
            importer.isReadable = false;

            // User-configurable general settings
            importer.mipmapEnabled = settings.MipmapEnabled;
            importer.textureCompression = settings.Compression;

            // Max size: auto-detect from actual texture dimensions or use user setting
            int maxSize = settings.MaxTextureSize;
            if (settings.AutoDetectMaxSize)
            {
                // Read actual texture dimensions from the file
                var tex = AssetDatabase.LoadAssetAtPath<Texture2D>(importer.assetPath);
                if (tex != null)
                {
                    maxSize = TextureImportSettings.CalculateOptimalMaxSize(tex.width, tex.height);
                }
            }
            importer.maxTextureSize = maxSize;

            // ── Android platform override ──
            if (settings.OverrideAndroid)
            {
                var androidSettings = importer.GetPlatformTextureSettings("Android");
                androidSettings.overridden = true;
                androidSettings.format = settings.AndroidFormat;
                androidSettings.maxTextureSize = settings.AutoDetectMaxSize ? maxSize : settings.AndroidMaxSize;
                importer.SetPlatformTextureSettings(androidSettings);
            }

            // ── iOS platform override ──
            if (settings.OverrideiOS)
            {
                var iosSettings = importer.GetPlatformTextureSettings("iPhone");
                iosSettings.overridden = true;
                iosSettings.format = settings.iOSFormat;
                iosSettings.maxTextureSize = settings.AutoDetectMaxSize ? maxSize : settings.iOSMaxSize;
                importer.SetPlatformTextureSettings(iosSettings);
            }

            // 9-slice detection (currently disabled)
            // TODO Phase 5: re-enable with Smart 9-Slice Pipeline
        }

        /// <summary>
        /// Parse export scale from filename suffix (e.g., "@2x" → 2).
        /// </summary>
        static int ParseScaleFromFilename(string fileName)
        {
            if (fileName.Contains("@4x")) return 4;
            if (fileName.Contains("@3x")) return 3;
            if (fileName.Contains("@2x")) return 2;
            return 1;
        }

        /// <summary>
        /// Build a lookup: asset filename → cornerRadius from manifest elements.
        /// </summary>
        static Dictionary<string, float> BuildCornerRadiusLookup(ManifestData manifest)
        {
            var lookup = new Dictionary<string, float>();
            if (manifest?.Elements == null) return lookup;

            foreach (var element in manifest.Elements)
            {
                if (!string.IsNullOrEmpty(element.Asset) && element.Style != null)
                {
                    lookup[element.Asset] = element.Style.CornerRadius;
                }
            }
            return lookup;
        }

        /// <summary>
        /// Convert absolute file path to Unity asset path (Assets/...).
        /// </summary>
        static string FilePathToAssetPath(string absolutePath)
        {
            absolutePath = absolutePath.Replace('\\', '/');
            string dataPath = Application.dataPath.Replace('\\', '/');

            if (absolutePath.StartsWith(dataPath))
            {
                return "Assets" + absolutePath.Substring(dataPath.Length);
            }

            // Fallback: try to find "Assets/" in the path
            int assetsIdx = absolutePath.IndexOf("Assets/");
            if (assetsIdx >= 0)
                return absolutePath.Substring(assetsIdx);

            Debug.LogWarning($"[FigmaImporter] Cannot convert path to asset path: {absolutePath}");
            return absolutePath;
        }

        /// <summary>
        /// Create Unity folder recursively (handles nested paths).
        /// </summary>
        static void CreateFolderRecursive(string folderPath)
        {
            // Ensure it starts with Assets/
            string assetPath = FilePathToAssetPath(folderPath);
            string[] parts = assetPath.Split('/');

            string currentPath = parts[0]; // "Assets"
            for (int i = 1; i < parts.Length; i++)
            {
                string nextPath = currentPath + "/" + parts[i];
                if (!AssetDatabase.IsValidFolder(nextPath))
                {
                    AssetDatabase.CreateFolder(currentPath, parts[i]);
                }
                currentPath = nextPath;
            }
        }
    }
}
