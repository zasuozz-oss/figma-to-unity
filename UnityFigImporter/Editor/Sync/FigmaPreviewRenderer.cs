using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace FigmaImporter.Sync
{
    /// <summary>
    /// Runs a real import (OutputMode.None) with in-memory sprites and renders
    /// the resulting hierarchy offscreen to a PNG, so the Sync preview shows
    /// exactly what Unity builds — without writing anything to Assets/.
    /// </summary>
    public static class FigmaPreviewRenderer
    {
        const int MaxSize = 2048;
        const int UILayer = 5;

        // Staging-folder PNGs that are previews, not element assets.
        static readonly string[] NonAssetPngs = { "preview.png", "unity-preview.png" };

        /// <summary>
        /// Build the hierarchy with sprites loaded in-memory from the staging
        /// folder (no texture import, no atlas, nothing written to Assets/),
        /// then render the root to <paramref name="outputPng"/>. The transient
        /// root and all in-memory textures are always destroyed before
        /// returning. Render failure is best-effort: logged as a warning, the
        /// import result itself is unchanged.
        /// </summary>
        public static ImportResult ImportAndRender(ImportRequest request, string outputPng)
        {
            DeleteStalePreview(outputPng);
            request.OutputMode = OutputMode.None;

            var transient = new List<Object>();
            request.PreloadedSprites = LoadStagingSprites(request.ExportFolder, transient);

            ImportResult result;
            try
            {
                result = FigmaImportRunner.Run(request);
                if (result.Root != null)
                {
                    try
                    {
                        RenderRootToPng(result.Root, outputPng, result.Log);
                    }
                    catch (System.Exception ex)
                    {
                        result.Log.Add(new BuildLogEntry(
                            BuildLogEntry.LogLevel.Warning,
                            "Unity preview render failed: " + ex.Message));
                    }
                    finally
                    {
                        if (result.Root != null)
                            Object.DestroyImmediate(result.Root);
                        result.Root = null;
                    }
                }
            }
            finally
            {
                request.PreloadedSprites = null;
                foreach (var obj in transient)
                    if (obj != null) Object.DestroyImmediate(obj);
            }
            return result;
        }

        /// <summary>
        /// Load every element PNG in the staging folder as a transient
        /// Texture2D + Sprite. Keys match TextureImportHelper.ImportTextures
        /// (PNG filename with extension); pixelsPerUnit 100 matches the
        /// asset-import path so SetNativeSize behaves identically.
        /// </summary>
        static Dictionary<string, Sprite> LoadStagingSprites(string folder, List<Object> transient)
        {
            var sprites = new Dictionary<string, Sprite>();
            if (string.IsNullOrEmpty(folder) || !Directory.Exists(folder)) return sprites;

            foreach (var path in Directory.GetFiles(folder, "*.png"))
            {
                string fileName = Path.GetFileName(path);
                if (System.Array.IndexOf(NonAssetPngs, fileName) >= 0) continue;

                var tex = new Texture2D(2, 2, TextureFormat.RGBA32, false)
                {
                    hideFlags = HideFlags.HideAndDontSave,
                    wrapMode = TextureWrapMode.Clamp,
                    filterMode = FilterMode.Bilinear,
                };
                if (!tex.LoadImage(File.ReadAllBytes(path)))
                {
                    Object.DestroyImmediate(tex);
                    continue;
                }
                transient.Add(tex);

                var sprite = Sprite.Create(
                    tex,
                    new Rect(0, 0, tex.width, tex.height),
                    new Vector2(0.5f, 0.5f),
                    100f);
                sprite.name = Path.GetFileNameWithoutExtension(fileName);
                sprite.hideFlags = HideFlags.HideAndDontSave;
                transient.Add(sprite);

                sprites[fileName] = sprite;
            }
            return sprites;
        }

        static void RenderRootToPng(GameObject root, string outputPng, List<BuildLogEntry> log)
        {
            var prevActive = RenderTexture.active;
            var rootRect = root.GetComponent<RectTransform>();
            float srcW = rootRect != null ? rootRect.rect.width : 256f;
            float srcH = rootRect != null ? rootRect.rect.height : 256f;
            if (srcW < 1f) srcW = 256f;
            if (srcH < 1f) srcH = 256f;
            float fit = Mathf.Min(1f, MaxSize / Mathf.Max(srcW, srcH));
            int w = Mathf.Max(8, Mathf.RoundToInt(srcW * fit));
            int h = Mathf.Max(8, Mathf.RoundToInt(srcH * fit));

            GameObject camGO = null, canvasGO = null;
            RenderTexture rt = null;
            Texture2D tex = null;
            try
            {
                camGO = new GameObject("~FigmaPreviewCamera") { hideFlags = HideFlags.HideAndDontSave };
                var cam = camGO.AddComponent<Camera>();
                cam.clearFlags = CameraClearFlags.SolidColor;
                cam.backgroundColor = new Color(0.16f, 0.16f, 0.16f, 1f);
                cam.cullingMask = 1 << UILayer;
                cam.orthographic = true;
                cam.nearClipPlane = 0.1f;
                cam.farClipPlane = 200f;

                canvasGO = new GameObject("~FigmaPreviewCanvas") { hideFlags = HideFlags.HideAndDontSave };
                canvasGO.layer = UILayer;
                var canvas = canvasGO.AddComponent<Canvas>();
                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = cam;
                canvas.planeDistance = 100f;
                // No CanvasScaler: 1 canvas unit == 1 RenderTexture pixel.

                root.transform.SetParent(canvasGO.transform, false);
                SetLayerRecursive(root.transform, UILayer);
                if (rootRect != null)
                {
                    rootRect.anchorMin = rootRect.anchorMax = new Vector2(0.5f, 0.5f);
                    rootRect.pivot = new Vector2(0.5f, 0.5f);
                    rootRect.anchoredPosition = Vector2.zero;
                    root.transform.localScale = Vector3.one * fit;
                }

                rt = RenderTexture.GetTemporary(w, h, 24, RenderTextureFormat.ARGB32);
                cam.targetTexture = rt;

                Canvas.ForceUpdateCanvases();
                cam.Render();

                RenderTexture.active = rt;
                tex = new Texture2D(w, h, TextureFormat.RGBA32, false);
                tex.ReadPixels(new Rect(0, 0, w, h), 0, 0);
                tex.Apply();

                var dir = Path.GetDirectoryName(outputPng);
                if (!string.IsNullOrEmpty(dir))
                    Directory.CreateDirectory(dir);
                File.WriteAllBytes(outputPng, tex.EncodeToPNG());
                log.Add(new BuildLogEntry(
                    BuildLogEntry.LogLevel.Success,
                    $"Unity preview rendered {w}x{h} -> {Path.GetFileName(outputPng)}"));
            }
            finally
            {
                RenderTexture.active = prevActive;
                if (tex != null) Object.DestroyImmediate(tex);
                if (rt != null)
                {
                    RenderTexture.ReleaseTemporary(rt);
                }
                // Destroying the canvas also destroys the reparented root.
                if (canvasGO != null) Object.DestroyImmediate(canvasGO);
                if (camGO != null) Object.DestroyImmediate(camGO);
            }
        }

        static void DeleteStalePreview(string outputPng)
        {
            try
            {
                if (File.Exists(outputPng))
                    File.Delete(outputPng);
            }
            catch
            {
                // Best-effort cleanup only; render failure handling will report issues.
            }
        }

        static void SetLayerRecursive(Transform t, int layer)
        {
            t.gameObject.layer = layer;
            for (int i = 0; i < t.childCount; i++)
                SetLayerRecursive(t.GetChild(i), layer);
        }
    }
}
