// =============================================================================
// TextureImportHelper — Copy PNGs → Assets, configure Sprite import + 9-slice
// =============================================================================

using System.Collections.Generic;
using System.IO;
using FigmaImporter.Data;
using UnityEditor;
using UnityEngine;

namespace FigmaImporter
{
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
            System.Action<int, int, string> onProgress = null)
        {
            var result = new Dictionary<string, Sprite>();

            // Ensure target folder exists
            CreateFolderRecursive(targetFolder);

            // Collect all PNG files
            string[] pngFiles = Directory.GetFiles(sourceFolder, "*.png");
            int total = pngFiles.Length;

            // Build cornerRadius lookup from manifest elements for 9-slice
            var cornerRadiusLookup = BuildCornerRadiusLookup(manifest);

            for (int i = 0; i < pngFiles.Length; i++)
            {
                string srcPath = pngFiles[i];
                string fileName = Path.GetFileName(srcPath);

                onProgress?.Invoke(i + 1, total, $"Importing: {fileName}");

                // Copy file to target folder (ensure directory exists)
                string destPath = Path.Combine(targetFolder, fileName);
                string destDir = Path.GetDirectoryName(destPath);
                if (!string.IsNullOrEmpty(destDir) && !Directory.Exists(destDir))
                    Directory.CreateDirectory(destDir);
                File.Copy(srcPath, destPath, overwrite: true);

                // Convert to Unity asset path (Assets/...)
                string assetPath = FilePathToAssetPath(destPath);
                AssetDatabase.ImportAsset(assetPath, ImportAssetOptions.ForceUpdate);

                // Configure TextureImporter
                var importer = AssetImporter.GetAtPath(assetPath) as TextureImporter;
                if (importer != null)
                {
                    ConfigureSpriteImporter(importer, fileName, cornerRadiusLookup, applyNineSlice);
                    importer.SaveAndReimport();
                }

                // Load the sprite
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

            AssetDatabase.Refresh();
            return result;
        }

        static void ConfigureSpriteImporter(
            TextureImporter importer,
            string fileName,
            Dictionary<string, float> cornerRadiusLookup,
            bool applyNineSlice)
        {
            importer.textureType = TextureImporterType.Sprite;
            importer.spriteImportMode = SpriteImportMode.Single;
            importer.maxTextureSize = 2048;
            importer.mipmapEnabled = false;
            importer.isReadable = false;
            importer.textureCompression = TextureImporterCompression.Compressed;

            importer.spritePixelsPerUnit = 100;

            // 9-slice detection disabled — use Simple mode for all sprites
            // TODO: re-enable when 9-slice sizing is tuned properly
            // if (applyNineSlice && cornerRadiusLookup.TryGetValue(fileName, out float cornerRadius))
            // {
            //     if (cornerRadius > 0)
            //     {
            //         float border = cornerRadius * scale;
            //         importer.spriteBorder = new Vector4(border, border, border, border);
            //     }
            // }
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
