using NUnit.Framework;
using FigmaImporter.Sync;

namespace FigmaImporter.Tests
{
    public class FigmaSyncUrlTests
    {
        [Test]
        public void ExtractNodeId_FromUrl_ReturnsColonId()
        {
            Assert.AreEqual(
                "4029:12345",
                FigmaSyncUrl.ExtractNodeId(
                    "https://www.figma.com/design/AbC/My-File?node-id=4029-12345&t=x"));
        }

        [Test]
        public void ExtractNodeId_FromColonId_ReturnsVerbatim()
        {
            Assert.AreEqual("1:2", FigmaSyncUrl.ExtractNodeId("1:2"));
        }

        [Test]
        public void ExtractNodeId_Invalid_ReturnsNull()
        {
            Assert.IsNull(FigmaSyncUrl.ExtractNodeId("not a url"));
            Assert.IsNull(FigmaSyncUrl.ExtractNodeId(""));
        }
    }
}
