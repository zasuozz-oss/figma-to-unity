// =============================================================================
// SpriteAtlasHelper — Auto-create SpriteAtlas from imported sprites
// =============================================================================

using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.U2D;
using UnityEngine;
using UnityEngine.U2D;

namespace FigmaImporter
{
    // =========================================================================
    // SpriteAtlasSettings — User-configurable Sprite Atlas settings
    // =========================================================================
    [System.Serializable]
    public class SpriteAtlasSettings
    {
        public bool CreateAtlas = true;
        public bool EnableRotation = false;
        public int Padding = 8;
        public bool IncludeInBuild = true;
        public string AtlasSubfolder = "Atlas";

        // Platform override: inherit from TextureImportSettings or set independently
        public bool UseSameAsTextureSettings = true;
        public TextureImporterFormat AtlasAndroidFormat = TextureImporterFormat.ASTC_4x4;
        public TextureImporterFormat AtlasiOSFormat = TextureImporterFormat.ASTC_4x4;
        public int AtlasMaxSize = 2048;

        // EditorPrefs keys
        const string PREF_PREFIX = "FigmaImporter_Atlas_";

        public void SaveToPrefs()
        {
            EditorPrefs.SetBool(PREF_PREFIX + "Create", CreateAtlas);
            EditorPrefs.SetBool(PREF_PREFIX + "Rotation", EnableRotation);
            EditorPrefs.SetInt(PREF_PREFIX + "Padding", Padding);
            EditorPrefs.SetBool(PREF_PREFIX + "InBuild", IncludeInBuild);
            EditorPrefs.SetString(PREF_PREFIX + "Subfolder", AtlasSubfolder);

            EditorPrefs.SetBool(PREF_PREFIX + "SameAsTex", UseSameAsTextureSettings);
            EditorPrefs.SetInt(PREF_PREFIX + "AndroidFmt", (int)AtlasAndroidFormat);
            EditorPrefs.SetInt(PREF_PREFIX + "iOSFmt", (int)AtlasiOSFormat);
            EditorPrefs.SetInt(PREF_PREFIX + "MaxSize", AtlasMaxSize);
        }

        public void LoadFromPrefs()
        {
            CreateAtlas = EditorPrefs.GetBool(PREF_PREFIX + "Create", true);
            EnableRotation = EditorPrefs.GetBool(PREF_PREFIX + "Rotation", false);
            Padding = EditorPrefs.GetInt(PREF_PREFIX + "Padding", 8);
            IncludeInBuild = EditorPrefs.GetBool(PREF_PREFIX + "InBuild", true);
            AtlasSubfolder = EditorPrefs.GetString(PREF_PREFIX + "Subfolder", "Atlas");

            UseSameAsTextureSettings = EditorPrefs.GetBool(PREF_PREFIX + "SameAsTex", true);
            AtlasAndroidFormat = (TextureImporterFormat)EditorPrefs.GetInt(PREF_PREFIX + "AndroidFmt", (int)TextureImporterFormat.ASTC_4x4);
            AtlasiOSFormat = (TextureImporterFormat)EditorPrefs.GetInt(PREF_PREFIX + "iOSFmt", (int)TextureImporterFormat.ASTC_4x4);
            AtlasMaxSize = EditorPrefs.GetInt(PREF_PREFIX + "MaxSize", 2048);
        }
    }

    public static class SpriteAtlasHelper
    {
        /// <summary>
        /// Create a SpriteAtlas containing all sprites from the given folder.
        /// Atlas is saved to a sibling "Atlas" subfolder.
        /// </summary>
        public static SpriteAtlas CreateAtlas(
            string spriteFolder,
            string screenName,
            SpriteAtlasSettings settings,
            TextureImportSettings texSettings = null)
        {
            if (!settings.CreateAtlas) return null;

            // Determine atlas output folder (sibling to sprite folder)
            string parentFolder = Path.GetDirectoryName(spriteFolder)?.Replace('\\', '/');
            if (string.IsNullOrEmpty(parentFolder)) parentFolder = spriteFolder;

            string atlasFolder = parentFolder + "/" + settings.AtlasSubfolder;
            string atlasAssetFolder = FilePathToAssetPath(atlasFolder);

            // Ensure Atlas folder exists
            CreateFolderRecursive(atlasAssetFolder);

            string atlasName = SanitizeName(screenName) + "_Atlas";
            string atlasPath = atlasAssetFolder + "/" + atlasName + ".spriteatlas";

            // Create or load existing atlas
            SpriteAtlas atlas = AssetDatabase.LoadAssetAtPath<SpriteAtlas>(atlasPath);
            if (atlas == null)
            {
                atlas = new SpriteAtlas();
                AssetDatabase.CreateAsset(atlas, atlasPath);
            }

            // Configure packing settings
            var packSettings = atlas.GetPackingSettings();
            packSettings.enableRotation = settings.EnableRotation;
            packSettings.padding = settings.Padding;
            atlas.SetPackingSettings(packSettings);

            // Configure include in build
            atlas.SetIncludeInBuild(settings.IncludeInBuild);

            // Configure platform settings
            ConfigurePlatformSettings(atlas, settings, texSettings);

            // Add sprite folder as packable
            string spriteFolderAssetPath = FilePathToAssetPath(spriteFolder);
            Object folderObj = AssetDatabase.LoadAssetAtPath<Object>(spriteFolderAssetPath);
            if (folderObj != null)
            {
                // Remove existing packables and add fresh
                var existing = atlas.GetPackables();
                if (existing != null && existing.Length > 0)
                    atlas.Remove(existing);

                atlas.Add(new Object[] { folderObj });
            }

            EditorUtility.SetDirty(atlas);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            // Auto pack preview so atlas is ready to use immediately
            SpriteAtlasUtility.PackAllAtlases(EditorUserBuildSettings.activeBuildTarget);

            Debug.Log($"[FigmaImporter] ✅ SpriteAtlas created & packed: {atlasPath}");
            return atlas;
        }

        static void ConfigurePlatformSettings(
            SpriteAtlas atlas,
            SpriteAtlasSettings settings,
            TextureImportSettings texSettings)
        {
            // Determine formats and max size
            TextureImporterFormat androidFmt;
            TextureImporterFormat iosFmt;
            int maxSize;

            if (settings.UseSameAsTextureSettings && texSettings != null)
            {
                androidFmt = texSettings.AndroidFormat;
                iosFmt = texSettings.iOSFormat;
                maxSize = texSettings.MaxTextureSize;
            }
            else
            {
                androidFmt = settings.AtlasAndroidFormat;
                iosFmt = settings.AtlasiOSFormat;
                maxSize = settings.AtlasMaxSize;
            }

            // Android
            var androidPlatform = atlas.GetPlatformSettings("Android");
            androidPlatform.overridden = true;
            androidPlatform.format = androidFmt;
            androidPlatform.maxTextureSize = maxSize;
            atlas.SetPlatformSettings(androidPlatform);

            // iOS
            var iosPlatform = atlas.GetPlatformSettings("iPhone");
            iosPlatform.overridden = true;
            iosPlatform.format = iosFmt;
            iosPlatform.maxTextureSize = maxSize;
            atlas.SetPlatformSettings(iosPlatform);
        }

        // =====================================================================
        // Utility methods (mirror TextureImportHelper)
        // =====================================================================

        static string FilePathToAssetPath(string absolutePath)
        {
            absolutePath = absolutePath.Replace('\\', '/');
            string dataPath = Application.dataPath.Replace('\\', '/');

            if (absolutePath.StartsWith(dataPath))
                return "Assets" + absolutePath.Substring(dataPath.Length);

            int assetsIdx = absolutePath.IndexOf("Assets/");
            if (assetsIdx >= 0)
                return absolutePath.Substring(assetsIdx);

            return absolutePath;
        }

        static void CreateFolderRecursive(string assetPath)
        {
            string[] parts = assetPath.Split('/');
            string currentPath = parts[0]; // "Assets"
            for (int i = 1; i < parts.Length; i++)
            {
                string nextPath = currentPath + "/" + parts[i];
                if (!AssetDatabase.IsValidFolder(nextPath))
                    AssetDatabase.CreateFolder(currentPath, parts[i]);
                currentPath = nextPath;
            }
        }

        static string SanitizeName(string name)
        {
            char[] invalid = Path.GetInvalidFileNameChars();
            foreach (char c in invalid)
                name = name.Replace(c, '_');
            name = name.Replace(' ', '_').Replace('(', '_').Replace(')', '_');
            while (name.Contains("__"))
                name = name.Replace("__", "_");
            return name.Trim('_');
        }
    }
}
