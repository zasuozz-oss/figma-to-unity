using System.Text.RegularExpressions;

namespace FigmaImporter.Sync
{
    /// <summary>Pure helpers for normalizing Figma node references.</summary>
    public static class FigmaSyncUrl
    {
        static readonly Regex ColonId = new Regex(@"^\d+:\d+$");
        static readonly Regex NodeIdParam = new Regex(@"[?&]node-id=([0-9]+-[0-9]+)");

        /// <summary>
        /// Returns a colon node-id ("4029:12345") from either a colon id or a
        /// Figma URL with a node-id query param. Null if neither matches.
        /// </summary>
        public static string ExtractNodeId(string input)
        {
            if (string.IsNullOrWhiteSpace(input)) return null;
            input = input.Trim();
            if (ColonId.IsMatch(input)) return input;

            var m = NodeIdParam.Match(input);
            if (m.Success) return m.Groups[1].Value.Replace('-', ':');
            return null;
        }
    }
}
