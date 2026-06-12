using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace FigmaImporter.Sync
{
    /// <summary>Model for the .unity-figma staging folder (one subfolder per synced element).</summary>
    public static class SyncLibrary
    {
        public class Entry
        {
            public string Folder;
            public string Name;
            public string NodeId;
            public string ManifestPath;
            public string PreviewPath;
            public int NodeCount;
            public DateTime SyncedAtUtc;
        }

        /// <summary>&lt;UnityProject&gt;/.unity-figma - dot-prefix keeps it out of the asset pipeline.</summary>
        public static string Root =>
            Path.Combine(Path.GetDirectoryName(Application.dataPath), ".unity-figma");

        /// <summary>Subfolder for one element, keyed by hyphenated nodeId ("6839:39318" -> "6839-39318").</summary>
        public static string FolderFor(string nodeId) =>
            Path.Combine(Root, nodeId.Replace(':', '-'));

        public static List<Entry> List() => List(Root);

        /// <summary>Scan a staging root; folders without a readable manifest are skipped. Newest first.</summary>
        public static List<Entry> List(string root)
        {
            var entries = new List<Entry>();
            if (!Directory.Exists(root)) return entries;
            foreach (var folder in Directory.GetDirectories(root))
            {
                var entry = Load(folder);
                if (entry != null) entries.Add(entry);
            }
            entries.Sort((a, b) => b.SyncedAtUtc.CompareTo(a.SyncedAtUtc));
            return entries;
        }

        public static Entry Load(string folder)
        {
            var manifestPath = Path.Combine(folder, "manifest.json");
            if (!File.Exists(manifestPath)) return null;
            try
            {
                var manifest = JObject.Parse(File.ReadAllText(manifestPath));
                var elements = manifest["elements"] as JArray;
                var previewPath = Path.Combine(folder, "preview.png");
                return new Entry
                {
                    Folder = folder,
                    Name = (string)manifest.SelectToken("screen.name") ?? Path.GetFileName(folder),
                    NodeId = Path.GetFileName(folder).Replace('-', ':'),
                    ManifestPath = manifestPath,
                    PreviewPath = File.Exists(previewPath) ? previewPath : null,
                    NodeCount = elements != null ? elements.Count : 0,
                    SyncedAtUtc = File.GetLastWriteTimeUtc(manifestPath),
                };
            }
            catch
            {
                return null;
            }
        }

        public static void Delete(Entry entry)
        {
            if (Directory.Exists(entry.Folder))
                Directory.Delete(entry.Folder, true);
        }

        public static Texture2D LoadPreview(Entry entry)
        {
            if (entry == null || entry.PreviewPath == null || !File.Exists(entry.PreviewPath))
                return null;
            var tex = new Texture2D(2, 2);
            if (tex.LoadImage(File.ReadAllBytes(entry.PreviewPath)))
                return tex;
            UnityEngine.Object.DestroyImmediate(tex);
            return null;
        }

        /// <summary>"0m", "22m", "4h", "3d" - relative age for the Library list.</summary>
        public static string FormatAge(DateTime utc)
        {
            var span = DateTime.UtcNow - utc;
            if (span.TotalMinutes < 60) return Math.Max(0, (int)span.TotalMinutes) + "m";
            if (span.TotalHours < 24) return (int)span.TotalHours + "h";
            return (int)span.TotalDays + "d";
        }
    }
}
