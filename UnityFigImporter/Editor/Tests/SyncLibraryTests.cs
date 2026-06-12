using System;
using System.IO;
using FigmaImporter.Sync;
using NUnit.Framework;

namespace FigmaImporter.Tests
{
    public class SyncLibraryTests
    {
        string _root;

        [SetUp]
        public void SetUp()
        {
            _root = Path.Combine(Path.GetTempPath(), "unity-figma-tests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_root);
        }

        [TearDown]
        public void TearDown()
        {
            if (Directory.Exists(_root)) Directory.Delete(_root, true);
        }

        void WriteManifest(string folderName, string json)
        {
            var folder = Path.Combine(_root, folderName);
            Directory.CreateDirectory(folder);
            File.WriteAllText(Path.Combine(folder, "manifest.json"), json);
        }

        [Test]
        public void FolderFor_HyphenatesNodeId()
        {
            StringAssert.EndsWith("6839-39318", SyncLibrary.FolderFor("6839:39318"));
        }

        [Test]
        public void List_ParsesManifest()
        {
            WriteManifest("10-20", "{\"screen\":{\"name\":\"Shop\"},\"elements\":[{},{}]}");
            var entries = SyncLibrary.List(_root);
            Assert.AreEqual(1, entries.Count);
            Assert.AreEqual("Shop", entries[0].Name);
            Assert.AreEqual(2, entries[0].NodeCount);
            Assert.AreEqual("10:20", entries[0].NodeId);
            Assert.IsNull(entries[0].PreviewPath);
        }

        [Test]
        public void List_SkipsCorruptAndEmptyFolders()
        {
            WriteManifest("1-2", "not json at all");
            Directory.CreateDirectory(Path.Combine(_root, "3-4"));
            WriteManifest("5-6", "{\"screen\":{\"name\":\"Ok\"},\"elements\":[]}");
            var entries = SyncLibrary.List(_root);
            Assert.AreEqual(1, entries.Count);
            Assert.AreEqual("Ok", entries[0].Name);
        }

        [Test]
        public void List_SortsNewestFirst()
        {
            WriteManifest("1-1", "{\"screen\":{\"name\":\"Old\"},\"elements\":[]}");
            WriteManifest("2-2", "{\"screen\":{\"name\":\"New\"},\"elements\":[]}");
            File.SetLastWriteTimeUtc(
                Path.Combine(_root, "1-1", "manifest.json"),
                DateTime.UtcNow.AddHours(-5));
            var entries = SyncLibrary.List(_root);
            Assert.AreEqual("New", entries[0].Name);
            Assert.AreEqual("Old", entries[1].Name);
        }

        [Test]
        public void List_PopulatesUnityPreviewPath()
        {
            WriteManifest("7-8", "{\"screen\":{\"name\":\"Hud\"},\"elements\":[]}");
            File.WriteAllBytes(Path.Combine(_root, "7-8", "unity-preview.png"), new byte[] { 1 });
            var entries = SyncLibrary.List(_root);
            Assert.AreEqual(1, entries.Count);
            StringAssert.EndsWith("unity-preview.png", entries[0].UnityPreviewPath);
            Assert.IsNull(entries[0].PreviewPath);
        }

        [Test]
        public void FormatAge_MinutesHoursDays()
        {
            Assert.AreEqual("0m", SyncLibrary.FormatAge(DateTime.UtcNow));
            Assert.AreEqual("22m", SyncLibrary.FormatAge(DateTime.UtcNow.AddMinutes(-22)));
            Assert.AreEqual("4h", SyncLibrary.FormatAge(DateTime.UtcNow.AddHours(-4).AddMinutes(-5)));
            Assert.AreEqual("3d", SyncLibrary.FormatAge(DateTime.UtcNow.AddDays(-3).AddHours(-1)));
        }
    }
}
