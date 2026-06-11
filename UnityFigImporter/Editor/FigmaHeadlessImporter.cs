// =============================================================================
// FigmaHeadlessImporter — Entry point for automated imports (utk exec / CI).
// Wraps FigmaImportRunner and returns a JSON summary string so callers
// outside Unity (e.g. `utk exec`) can read the result.
// =============================================================================

using Newtonsoft.Json;
using UnityEngine;

namespace FigmaImporter
{
    public static class FigmaHeadlessImporter
    {
        /// <summary>
        /// Import a Figma export folder (manifest.json + PNGs) with default
        /// window behavior (auto canvas scale, auto font match).
        /// Returns JSON: { success, rootName, textureCount, outputMode, log[] }.
        /// </summary>
        public static string Import(
            string exportFolder,
            string outputMode = "Scene",
            string prefabSavePath = "Assets/Prefabs/UI/",
            string spriteFolder = null)
        {
            OutputMode mode;
            try
            {
                mode = (OutputMode)System.Enum.Parse(typeof(OutputMode), outputMode, true);
            }
            catch (System.Exception)
            {
                return JsonConvert.SerializeObject(new
                {
                    success = false,
                    log = new[] { $"Error: invalid outputMode '{outputMode}'. Use Scene, Prefab, or Both." },
                });
            }

            var request = new ImportRequest
            {
                ExportFolder = ToAbsolutePath(exportFolder),
                OutputMode = mode,
                PrefabSavePath = prefabSavePath,
                SpriteOutputFolder = spriteFolder != null ? ToAbsolutePath(spriteFolder) : null,
            };

            var result = FigmaImportRunner.Run(request);

            return JsonConvert.SerializeObject(new
            {
                success = result.Success,
                rootName = result.RootName,
                textureCount = result.TextureCount,
                outputMode = mode.ToString(),
                prefabSavePath,
                log = result.Log.ConvertAll(e => $"{e.Level}: {e.Message}"),
            });
        }

        /// <summary>"Assets/..." → absolute path; absolute paths pass through.</summary>
        static string ToAbsolutePath(string path)
        {
            path = path.Replace('\\', '/');
            if (path == "Assets" || path.StartsWith("Assets/"))
                return (Application.dataPath + path.Substring("Assets".Length)).Replace('\\', '/');
            return path;
        }
    }
}
