using System.IO;
using NUnit.Framework;
using FigmaImporter.Sync;

namespace FigmaImporter.Tests
{
    public class ImportDescriptorTests
    {
        [Test]
        public void Write_ProducesJsonWithAllFields()
        {
            var dir = Path.Combine(Path.GetTempPath(), Path.GetRandomFileName());
            Directory.CreateDirectory(dir);
            var path = Path.Combine(dir, "last-import.json");

            ImportDescriptor.Write(path, new ImportDescriptor.Data
            {
                name = "Shop",
                nodeId = "1:2",
                canonicalUrl = "https://figma/x",
                outputDir = "/tmp/exp",
                prefabPath = "Assets/Prefabs/UI/Shop.prefab",
            });

            StringAssert.Contains("\"name\": \"Shop\"", File.ReadAllText(path));
            StringAssert.Contains("\"prefabPath\": \"Assets/Prefabs/UI/Shop.prefab\"",
                File.ReadAllText(path));
        }

        [Test]
        public void BuildPrompt_ReferencesPrefabAndOutputDir()
        {
            var prompt = ImportDescriptor.BuildPrompt(new ImportDescriptor.Data
            {
                name = "Shop",
                outputDir = "/tmp/exp",
                prefabPath = "Assets/Prefabs/UI/Shop.prefab",
            });
            StringAssert.Contains("/tmp/exp", prompt);
            StringAssert.Contains("Assets/Prefabs/UI/Shop.prefab", prompt);
            StringAssert.Contains("figma-build", prompt);
        }
    }
}
