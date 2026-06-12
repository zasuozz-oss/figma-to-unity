using System.Diagnostics;
using System.IO;
using UnityEditor;

namespace FigmaImporter.Sync
{
    /// <summary>Spawns the standalone bridge (node dist/standalone.js) when none is running.</summary>
    public static class BridgeLauncher
    {
        const string PREF_NODE = "FigmaSync_NodePath";
        const string PREF_BRIDGE = "FigmaSync_BridgeDir";

        public static string NodePath
        {
            get => EditorPrefs.GetString(PREF_NODE, "node");
            set => EditorPrefs.SetString(PREF_NODE, value);
        }

        /// <summary>Path to FigExportForUnity/server (contains dist/standalone.js).</summary>
        public static string BridgeDir
        {
            get => EditorPrefs.GetString(PREF_BRIDGE, "");
            set => EditorPrefs.SetString(PREF_BRIDGE, value);
        }

        public static bool TrySpawn(out string error)
        {
            return TrySpawn(1994, out error);
        }

        public static bool TrySpawn(int port, out string error)
        {
            error = null;
            var script = Path.Combine(BridgeDir, "dist", "standalone.js");
            if (string.IsNullOrEmpty(BridgeDir) || !File.Exists(script))
            {
                error = $"standalone.js not found at: {script}. Set the bridge dir.";
                return false;
            }
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = NodePath,
                    Arguments = $"\"{script}\"",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WorkingDirectory = BridgeDir,
                };
                psi.EnvironmentVariables["FIGMA_BRIDGE_PORT"] = port.ToString();
                Process.Start(psi);
                return true;
            }
            catch (System.Exception ex)
            {
                error = $"Failed to spawn node: {ex.Message}";
                return false;
            }
        }
    }
}
