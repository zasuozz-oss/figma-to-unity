using System.IO;
using Newtonsoft.Json;

namespace FigmaImporter.Sync
{
    /// <summary>
    /// Hand-off artifact written after an import so the AI agent can continue
    /// with figma-build steps 4-6 (rename, hierarchy cleanup, scripts).
    /// Unity cannot call the agent directly - this prepares descriptor + prompt.
    /// </summary>
    public static class ImportDescriptor
    {
        public class Data
        {
            public string name;
            public string nodeId;
            public string canonicalUrl;
            public string outputDir;
            public string prefabPath;
        }

        public static void Write(string path, Data data)
        {
            File.WriteAllText(path, JsonConvert.SerializeObject(data, Formatting.Indented));
        }

        public static string BuildPrompt(Data data)
        {
            return
$@"Continue the figma-build pipeline (steps 4-6) for the freshly imported prefab.
- Element: {data.name}
- Export folder: {data.outputDir}
- Imported prefab: {data.prefabPath}
Clean up the hierarchy to Unity naming standards, then generate and wire scripts per the figma-build skill.";
        }
    }
}
