using System;
using System.Text;
using System.Threading;
using Newtonsoft.Json;
using UnityEngine.Networking;

namespace FigmaImporter.Sync
{
    /// <summary>Blocking REST client for the Figma bridge (localhost, fast).</summary>
    public class FigmaBridgeClient
    {
        readonly string _baseUrl;
        readonly int _timeoutMs;

        public FigmaBridgeClient(int port, int timeoutMs = 130000)
        {
            _baseUrl = $"http://localhost:{port}";
            _timeoutMs = timeoutMs;
        }

        [Serializable]
        public class HealthInfo { public bool ok; public string version; public bool pluginConnected; }

        [Serializable]
        public class SelectionInfo { public string nodeId; public string name; public string fileKey; public string url; }

        [Serializable]
        public class ExportResult { public string nodeId; public string outputDir; public int assetCount; public string name; public int nodeCount; }

        class Envelope<T> { public T data; public string error; }

        public bool TryHealth(out HealthInfo info, out string error)
        {
            return Get("/api/health", out info, out error);
        }

        public bool TryGetSelection(out SelectionInfo info, out string error)
        {
            return Get("/api/selection", out info, out error);
        }

        public bool TryExportElement(string nodeId, string figmaUrl, out ExportResult result, out string error)
        {
            var body = JsonConvert.SerializeObject(new { nodeId, figmaUrl });
            return Post("/api/export_element", body, out result, out error);
        }

        bool Get<T>(string path, out T value, out string error)
        {
            using (var req = UnityWebRequest.Get(_baseUrl + path))
                return Send(req, out value, out error);
        }

        bool Post<T>(string path, string json, out T value, out string error)
        {
            using (var req = new UnityWebRequest(_baseUrl + path, "POST"))
            {
                req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
                req.downloadHandler = new DownloadHandlerBuffer();
                req.SetRequestHeader("Content-Type", "application/json");
                return Send(req, out value, out error);
            }
        }

        bool Send<T>(UnityWebRequest req, out T value, out string error)
        {
            value = default;
            error = null;
            var op = req.SendWebRequest();
            int waited = 0;
            while (!op.isDone && waited < _timeoutMs)
            {
                Thread.Sleep(15);
                waited += 15;
            }
            if (!op.isDone) { error = "Bridge request timed out"; return false; }
            if (req.result != UnityWebRequest.Result.Success)
            {
                error = $"Bridge offline ({req.error})";
                return false;
            }
            var env = JsonConvert.DeserializeObject<Envelope<T>>(req.downloadHandler.text);
            if (env != null && !string.IsNullOrEmpty(env.error)) { error = env.error; return false; }
            if (env == null || env.data == null) { error = "Empty bridge response"; return false; }
            value = env.data;
            return true;
        }
    }
}
