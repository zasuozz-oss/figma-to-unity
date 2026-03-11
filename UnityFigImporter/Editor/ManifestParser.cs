// =============================================================================
// ManifestParser — Deserialize manifest.json → C# objects
// =============================================================================

using System.Collections.Generic;
using System.IO;
using FigmaImporter.Data;
using Newtonsoft.Json;
using UnityEngine;

namespace FigmaImporter
{
    public static class ManifestParser
    {
        /// <summary>
        /// Parse a manifest JSON string into ManifestData.
        /// </summary>
        public static ManifestData Parse(string jsonContent)
        {
            if (string.IsNullOrWhiteSpace(jsonContent))
            {
                Debug.LogError("[FigmaImporter] Empty JSON content.");
                return null;
            }

            var manifest = JsonConvert.DeserializeObject<ManifestData>(jsonContent);

            if (manifest == null)
            {
                Debug.LogError("[FigmaImporter] Failed to deserialize manifest JSON.");
                return null;
            }

            if (manifest.Version != "1.0")
            {
                Debug.LogWarning($"[FigmaImporter] Unsupported manifest version: {manifest.Version}. Expected 1.0.");
            }

            if (manifest.Elements == null || manifest.Elements.Count == 0)
            {
                Debug.LogError("[FigmaImporter] Manifest has no elements.");
                return null;
            }

            return manifest;
        }

        /// <summary>
        /// Parse manifest.json from a file path.
        /// </summary>
        public static ManifestData ParseFromFile(string filePath)
        {
            if (!File.Exists(filePath))
            {
                Debug.LogError($"[FigmaImporter] File not found: {filePath}");
                return null;
            }

            string json = File.ReadAllText(filePath);
            return Parse(json);
        }

        /// <summary>
        /// Build a lookup dictionary mapping element ID → ElementData.
        /// </summary>
        public static Dictionary<string, ElementData> BuildElementLookup(ManifestData manifest)
        {
            var lookup = new Dictionary<string, ElementData>(manifest.Elements.Count);
            foreach (var element in manifest.Elements)
            {
                if (!lookup.ContainsKey(element.Id))
                    lookup[element.Id] = element;
                else
                    Debug.LogWarning($"[FigmaImporter] Duplicate element ID: {element.Id}");
            }
            return lookup;
        }

        /// <summary>
        /// Get root elements (parentId == null).
        /// </summary>
        public static List<ElementData> GetRootElements(ManifestData manifest)
        {
            var roots = new List<ElementData>();
            foreach (var element in manifest.Elements)
            {
                if (string.IsNullOrEmpty(element.ParentId))
                    roots.Add(element);
            }
            return roots;
        }

        /// <summary>
        /// Detect manifest.json in a folder.
        /// </summary>
        public static string FindManifestInFolder(string folderPath)
        {
            string manifestPath = Path.Combine(folderPath, "manifest.json");
            return File.Exists(manifestPath) ? manifestPath : null;
        }
    }
}
