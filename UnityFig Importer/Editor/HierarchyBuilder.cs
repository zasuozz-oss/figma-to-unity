// =============================================================================
// HierarchyBuilder — Build Unity UI tree from manifest elements (BFS)
// =============================================================================

using System.Collections.Generic;
using System.IO;
using FigmaImporter.Data;
using TMPro;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace FigmaImporter
{
    /// <summary>
    /// Build options for the hierarchy builder.
    /// </summary>
    public class BuildOptions
    {
        public bool ImportTextures = true;
        public bool ApplyNineSlice = true;
        public bool DisableRaycastTarget = true;
        public bool ScaleToUnityResolution = true;
    }

    /// <summary>
    /// Canvas creation settings for Scene mode.
    /// </summary>
    public class CanvasSettings
    {
        public enum CanvasTarget { CreateNew, UseExisting }

        public CanvasTarget Target = CanvasTarget.CreateNew;
        public Canvas ExistingCanvas;
        public RenderMode RenderMode = RenderMode.ScreenSpaceOverlay;
        public Vector2 ReferenceResolution = new Vector2(1080, 1920);
        public float MatchWidthOrHeight = 1f;
    }

    /// <summary>
    /// Render pipeline: UGUI (Canvas + Image) vs 2D Object (SpriteRenderer).
    /// </summary>
    public enum RenderPipeline
    {
        UGUI,
        Object2D
    }

    /// <summary>
    /// Output mode for the build pipeline.
    /// </summary>
    public enum OutputMode
    {
        Scene,
        Prefab,
        Both
    }

    /// <summary>
    /// Single build log entry.
    /// </summary>
    public class BuildLogEntry
    {
        public enum LogLevel { Success, Warning, Error }

        public LogLevel Level;
        public string Message;

        public BuildLogEntry(LogLevel level, string message)
        {
            Level = level;
            Message = message;
        }
    }

    public static class HierarchyBuilder
    {
        /// <summary>
        /// Build the full UI hierarchy from a parsed manifest.
        /// </summary>
        public static GameObject Build(
            ManifestData manifest,
            Dictionary<string, Sprite> sprites,
            BuildOptions options,
            RenderPipeline renderPipeline,
            OutputMode outputMode,
            CanvasSettings canvasSettings,
            string prefabSavePath,
            float canvasScaleFactor = 1f,
            float exportScale = 1f,
            Dictionary<string, TMP_FontAsset> fontMapping = null,
            System.Action<int, int, string> onProgress = null,
            List<BuildLogEntry> log = null)
        {
            var elementLookup = ManifestParser.BuildElementLookup(manifest);
            var rootElements = ManifestParser.GetRootElements(manifest);

            if (rootElements.Count == 0)
            {
                LogEntry(log, BuildLogEntry.LogLevel.Error, "No root elements found in manifest.");
                return null;
            }

            // canvasScaleFactor = canvasRefHeight / figmaHeight
            // Used for RectTransform positions/sizes, font sizes, layout spacing
            // Separate from exportScale which only determines PNG quality
            float scaleFactor = canvasScaleFactor;

            // Ratio for converting sprite native size to reference resolution
            // PNG pixels / exportScale = design pixels; design pixels * canvasScale = ref pixels
            float spriteScaleRatio = exportScale > 0.01f ? canvasScaleFactor / exportScale : 1f;

            int totalElements = manifest.Elements.Count;
            int processedCount = 0;

            // Build hierarchy for each root element
            var builtRoots = new List<GameObject>();

            foreach (var rootElement in rootElements)
            {
                GameObject rootGO;
                if (renderPipeline == RenderPipeline.Object2D)
                {
                    rootGO = Build2DElementRecursive(
                        rootElement, null, elementLookup, sprites, scaleFactor,
                        options, fontMapping, ref processedCount, totalElements, onProgress, log);
                }
                else
                {
                    rootGO = BuildElementRecursive(
                        rootElement, null, elementLookup, sprites, scaleFactor, spriteScaleRatio,
                        options, fontMapping, ref processedCount, totalElements, onProgress, log);
                }

                if (rootGO != null)
                    builtRoots.Add(rootGO);
            }

            if (builtRoots.Count == 0)
            {
                LogEntry(log, BuildLogEntry.LogLevel.Error, "Failed to build any root elements.");
                return null;
            }

            // Use first root as the main root
            GameObject mainRoot = builtRoots[0];

            // Handle output mode
            if (renderPipeline == RenderPipeline.Object2D)
            {
                // 2D Object mode — no Canvas needed
                if (outputMode == OutputMode.Prefab || outputMode == OutputMode.Both)
                    BuildPrefabMode(mainRoot, prefabSavePath, log);
                LogEntry(log, BuildLogEntry.LogLevel.Success, "2D Object hierarchy created.");
            }
            else
            {
                // UGUI mode
                if (outputMode == OutputMode.Scene || outputMode == OutputMode.Both)
                {
                    BuildSceneMode(mainRoot, canvasSettings, manifest);
                    LogEntry(log, BuildLogEntry.LogLevel.Success, "Scene hierarchy created.");
                }

                if (outputMode == OutputMode.Prefab || outputMode == OutputMode.Both)
                {
                    BuildPrefabMode(mainRoot, prefabSavePath, log);
                }
            }

            return mainRoot;
        }

        /// <summary>
        /// Recursively build a single element and its children.
        /// </summary>
        static GameObject BuildElementRecursive(
            ElementData element,
            Transform parent,
            Dictionary<string, ElementData> lookup,
            Dictionary<string, Sprite> sprites,
            float scaleFactor,
            float spriteScaleRatio,
            BuildOptions options,
            Dictionary<string, TMP_FontAsset> fontMapping,
            ref int processedCount,
            int totalElements,
            System.Action<int, int, string> onProgress,
            List<BuildLogEntry> log)
        {
            processedCount++;
            onProgress?.Invoke(processedCount, totalElements, $"Building: {element.Name}");

            // Create GameObject
            GameObject go = new GameObject(element.Name);

            if (parent != null)
            {
                go.transform.SetParent(parent, false);
            }

            // Add RectTransform (required for UI)
            RectTransform rt = go.AddComponent<RectTransform>();

            // Check if parent has auto-layout → keep Figma anchors/pivot
            // Otherwise → force middle-center (0.5, 0.5)
            bool parentHasAutoLayout = false;
            if (parent != null)
            {
                // Check parent's layout group components
                parentHasAutoLayout = parent.GetComponent<HorizontalLayoutGroup>() != null
                                  || parent.GetComponent<VerticalLayoutGroup>() != null;
            }

            ApplyRectTransform(rt, element.Unity, scaleFactor, parentHasAutoLayout);

            // Fix 1: Root element — reset to center of Canvas
            if (parent == null)
            {
                rt.anchorMin = new Vector2(0.5f, 0.5f);
                rt.anchorMax = new Vector2(0.5f, 0.5f);
                rt.pivot = new Vector2(0.5f, 0.5f);
                rt.anchoredPosition = Vector2.zero;
            }

            // Add components
            AddComponents(go, element, sprites, scaleFactor, spriteScaleRatio, options, fontMapping, log);

            LogEntry(log, BuildLogEntry.LogLevel.Success, $"{element.Name} — created");

            // Process children in order
            if (element.Children != null)
            {
                foreach (string childId in element.Children)
                {
                    if (lookup.TryGetValue(childId, out ElementData childElement))
                    {
                        BuildElementRecursive(
                            childElement, go.transform, lookup, sprites, scaleFactor, spriteScaleRatio,
                            options, fontMapping, ref processedCount, totalElements, onProgress, log);
                    }
                    else
                    {
                        // Fix 4: Only warn for parents without asset (exportable/merged elements have flattened children)
                        if (string.IsNullOrEmpty(element.Asset) && !element.Merged)
                        {
                            LogEntry(log, BuildLogEntry.LogLevel.Warning,
                                $"Child ID \"{childId}\" not found for parent \"{element.Name}\"");
                        }
                    }
                }
            }

            return go;
        }

        /// <summary>
        /// Apply pre-computed RectTransform values from manifest.
        /// If parent is NOT auto-layout, forces middle-center anchor/pivot
        /// and recalculates position accordingly.
        /// </summary>
        static void ApplyRectTransform(RectTransform rt, UnityTransformData unity, float scaleFactor, bool parentHasAutoLayout)
        {
            // Default to center anchor/pivot
            rt.anchorMin = new Vector2(0.5f, 0.5f);
            rt.anchorMax = new Vector2(0.5f, 0.5f);
            rt.pivot = new Vector2(0.5f, 0.5f);

            if (unity == null) return;

            if (parentHasAutoLayout)
            {
                // Parent has auto-layout — use Figma anchors/pivot so LayoutGroup controls position
                if (unity.AnchorMin != null && unity.AnchorMin.Length >= 2)
                    rt.anchorMin = new Vector2(unity.AnchorMin[0], unity.AnchorMin[1]);

                if (unity.AnchorMax != null && unity.AnchorMax.Length >= 2)
                    rt.anchorMax = new Vector2(unity.AnchorMax[0], unity.AnchorMax[1]);

                if (unity.Pivot != null && unity.Pivot.Length >= 2)
                    rt.pivot = new Vector2(unity.Pivot[0], unity.Pivot[1]);
            }
            // else: keep default middle-center (0.5, 0.5) for anchor and pivot

            // Step 3: Position — use offsetMin/Max if available (they encode both position AND size)
            // For middle-center anchoring, offsets are relative to parent center
            bool hasOffsets = (unity.OffsetMin != null && unity.OffsetMin.Length >= 2)
                           && (unity.OffsetMax != null && unity.OffsetMax.Length >= 2);

            if (hasOffsets)
            {
                rt.offsetMin = new Vector2(unity.OffsetMin[0] * scaleFactor, unity.OffsetMin[1] * scaleFactor);
                rt.offsetMax = new Vector2(unity.OffsetMax[0] * scaleFactor, unity.OffsetMax[1] * scaleFactor);
            }
            else if (unity.SizeDelta != null && unity.SizeDelta.Length >= 2)
            {
                rt.sizeDelta = new Vector2(unity.SizeDelta[0] * scaleFactor, unity.SizeDelta[1] * scaleFactor);
            }

            // localScale — always [1,1,1]
            rt.localScale = Vector3.one;
        }

        /// <summary>
        /// Add Unity components based on manifest element data.
        /// </summary>
        static void AddComponents(
            GameObject go,
            ElementData element,
            Dictionary<string, Sprite> sprites,
            float scaleFactor,
            float spriteScaleRatio,
            BuildOptions options,
            Dictionary<string, TMP_FontAsset> fontMapping,
            List<BuildLogEntry> log)
        {
            // Backward-compat: if element has asset but no Image in components, add it
            bool hasImageComponent = false;
            if (element.Components != null)
            {
                foreach (string c in element.Components)
                {
                    if (c == "Image") { hasImageComponent = true; break; }
                }
            }
            if (!hasImageComponent && !string.IsNullOrEmpty(element.Asset))
            {
                AddImageComponent(go, element, sprites, spriteScaleRatio, options, log);
            }

            if (element.Components == null) return;

            foreach (string componentName in element.Components)
            {
                switch (componentName)
                {
                    case "Image":
                        // Skip Image for root container (no parent, no asset) — it's not visual
                        if (string.IsNullOrEmpty(element.ParentId) && string.IsNullOrEmpty(element.Asset))
                            break;
                        AddImageComponent(go, element, sprites, spriteScaleRatio, options, log);
                        break;

                    case "TextMeshProUGUI":
                        AddTextComponent(go, element, scaleFactor, options, fontMapping, log);
                        break;

                    case "HorizontalLayoutGroup":
                        AddLayoutGroup(go, element, isHorizontal: true, scaleFactor);
                        break;

                    case "VerticalLayoutGroup":
                        AddLayoutGroup(go, element, isHorizontal: false, scaleFactor);
                        break;

                    case "CanvasGroup":
                        AddCanvasGroup(go, element);
                        break;

                    default:
                        LogEntry(log, BuildLogEntry.LogLevel.Warning,
                            $"{element.Name} — unknown component \"{componentName}\", skipped");
                        break;
                }
            }
        }

        static void AddImageComponent(
            GameObject go,
            ElementData element,
            Dictionary<string, Sprite> sprites,
            float spriteScaleRatio,
            BuildOptions options,
            List<BuildLogEntry> log)
        {
            Image image = go.AddComponent<Image>();

            // Assign sprite if available
            if (!string.IsNullOrEmpty(element.Asset) && sprites != null)
            {
                // Fix 3: Try exact key first, then fallback without extension
                Sprite sprite = null;
                if (!sprites.TryGetValue(element.Asset, out sprite))
                {
                    // Fallback: try with .png extension
                    string withExt = element.Asset.EndsWith(".png") ? element.Asset : element.Asset + ".png";
                    string withoutExt = Path.GetFileNameWithoutExtension(element.Asset);
                    if (!sprites.TryGetValue(withExt, out sprite))
                        sprites.TryGetValue(withoutExt, out sprite);
                }

                if (sprite != null)
                {
                    image.sprite = sprite;
                    image.type = Image.Type.Simple;

                    RectTransform rt = go.GetComponent<RectTransform>();
                    bool isStretchH = !Mathf.Approximately(rt.anchorMin.x, rt.anchorMax.x);
                    bool isStretchV = !Mathf.Approximately(rt.anchorMin.y, rt.anchorMax.y);

                    if (!isStretchH && !isStretchV)
                    {
                        // Fixed-size element: use PNG native size (includes Figma effects).
                        // Preserve CENTER position because effects expand equally in
                        // all directions from the node center.
                        Vector2 pivotOffset = new Vector2(0.5f - rt.pivot.x, 0.5f - rt.pivot.y);
                        Vector2 oldCenter = rt.anchoredPosition
                            + Vector2.Scale(rt.sizeDelta, pivotOffset);

                        image.SetNativeSize();
                        rt.sizeDelta *= spriteScaleRatio;

                        // Restore center → recalculate anchoredPosition for new size
                        rt.anchoredPosition = oldCenter
                            - Vector2.Scale(rt.sizeDelta, pivotOffset);
                    }
                    // Stretch elements: keep manifest offsets (sizeDelta = inset)
                }
                else
                {
                    LogEntry(log, BuildLogEntry.LogLevel.Warning,
                        $"{element.Name} — sprite \"{element.Asset}\" not found in {sprites.Count} loaded sprites");
                }
            }

            // Apply fill color
            if (element.Style?.Fill != null && element.Style.Fill.Length >= 4)
            {
                image.color = new Color(
                    element.Style.Fill[0],
                    element.Style.Fill[1],
                    element.Style.Fill[2],
                    element.Style.Fill[3]);
            }

            // If we have a sprite, set color to white so sprite shows correctly
            if (image.sprite != null)
                image.color = Color.white;

            // RaycastTarget optimization — only keep for button/mask/bg
            if (options.DisableRaycastTarget && !ShouldKeepRaycast(element))
                image.raycastTarget = false;
        }

        static void AddTextComponent(
            GameObject go,
            ElementData element,
            float scaleFactor,
            BuildOptions options,
            Dictionary<string, TMP_FontAsset> fontMapping,
            List<BuildLogEntry> log)
        {
            TextMeshProUGUI text = go.AddComponent<TextMeshProUGUI>();

            if (element.Text == null)
            {
                LogEntry(log, BuildLogEntry.LogLevel.Warning,
                    $"{element.Name} — has TextMeshProUGUI component but no text data");
                return;
            }

            // Content
            text.text = element.Text.Content;

            // Font size: scaled by canvasScaleFactor (canvasRefH / figmaH)
            // This ensures correct sizing regardless of export scale
            text.fontSize = element.Text.FontSize * scaleFactor;

            // Color
            if (element.Text.Color != null && element.Text.Color.Length >= 4)
            {
                text.color = new Color(
                    element.Text.Color[0],
                    element.Text.Color[1],
                    element.Text.Color[2],
                    element.Text.Color[3]);
            }

            // Alignment mapping
            text.alignment = MapTextAlignment(element.Text.Alignment);

            // Letter spacing (Figma uses px, TMP uses em percentage)
            if (element.Text.LetterSpacing.HasValue)
                text.characterSpacing = element.Text.LetterSpacing.Value;

            // Line height
            if (element.Text.LineHeight.HasValue && element.Text.LineHeight.Value > 0)
                text.lineSpacing = element.Text.LineHeight.Value;

            // Font — use pre-built mapping if available, fallback to search
            TMP_FontAsset fontAsset = null;
            string fontKey = $"{element.Text.FontFamily}|{element.Text.FontStyle}";
            if (fontMapping != null && fontMapping.TryGetValue(fontKey, out TMP_FontAsset mappedFont))
            {
                fontAsset = mappedFont;
            }
            else
            {
                fontAsset = FindFontAsset(element.Text.FontFamily, element.Text.FontStyle);
            }

            if (fontAsset != null)
            {
                text.font = fontAsset;
            }
            else
            {
                LogEntry(log, BuildLogEntry.LogLevel.Warning,
                    $"{element.Name} — font \"{element.Text.FontFamily} {element.Text.FontStyle}\" not found, using default");
            }

            // RaycastTarget optimization
            if (options.DisableRaycastTarget && !ShouldKeepRaycast(element))
                text.raycastTarget = false;

            // Overflow
            text.overflowMode = TextOverflowModes.Overflow;
            text.enableWordWrapping = true;
        }

        static void AddLayoutGroup(GameObject go, ElementData element, bool isHorizontal, float scaleFactor)
        {
            HorizontalOrVerticalLayoutGroup layout;

            if (isHorizontal)
                layout = go.AddComponent<HorizontalLayoutGroup>();
            else
                layout = go.AddComponent<VerticalLayoutGroup>();

            // Don't let layout group override child sizes — we set them manually
            layout.childControlWidth = false;
            layout.childControlHeight = false;
            layout.childForceExpandWidth = false;
            layout.childForceExpandHeight = false;

            // Apply spacing and padding from Figma auto-layout data
            if (element.AutoLayout != null)
            {
                layout.spacing = element.AutoLayout.ItemSpacing * scaleFactor;
                layout.padding = new RectOffset(
                    Mathf.RoundToInt(element.AutoLayout.PaddingLeft * scaleFactor),
                    Mathf.RoundToInt(element.AutoLayout.PaddingRight * scaleFactor),
                    Mathf.RoundToInt(element.AutoLayout.PaddingTop * scaleFactor),
                    Mathf.RoundToInt(element.AutoLayout.PaddingBottom * scaleFactor)
                );
            }
        }

        static void AddCanvasGroup(GameObject go, ElementData element)
        {
            CanvasGroup canvasGroup = go.AddComponent<CanvasGroup>();

            if (element.Style != null)
                canvasGroup.alpha = element.Style.Opacity;
        }

        /// <summary>
        /// Map Figma/manifest alignment string → TMP TextAlignmentOptions.
        /// </summary>
        static TextAlignmentOptions MapTextAlignment(string alignment)
        {
            if (string.IsNullOrEmpty(alignment))
                return TextAlignmentOptions.TopLeft;

            switch (alignment)
            {
                case "TopLeft": return TextAlignmentOptions.TopLeft;
                case "TopCenter": return TextAlignmentOptions.Top;
                case "TopRight": return TextAlignmentOptions.TopRight;
                case "MiddleLeft": return TextAlignmentOptions.MidlineLeft;
                case "MiddleCenter": return TextAlignmentOptions.Center;
                case "MiddleRight": return TextAlignmentOptions.MidlineRight;
                case "BottomLeft": return TextAlignmentOptions.BottomLeft;
                case "BottomCenter": return TextAlignmentOptions.Bottom;
                case "BottomRight": return TextAlignmentOptions.BottomRight;
                default:
                    Debug.LogWarning($"[FigmaImporter] Unknown alignment: {alignment}, defaulting to TopLeft");
                    return TextAlignmentOptions.TopLeft;
            }
        }

        /// <summary>
        /// Try to find a TMP_FontAsset in the project by family name and style.
        /// </summary>
        static TMP_FontAsset FindFontAsset(string family, string style)
        {
            if (string.IsNullOrEmpty(family)) return null;

            // Search patterns: "FontFamily-Style", "FontFamily Style", "FontFamily"
            string[] searchPatterns = new[]
            {
                $"{family}-{style}",
                $"{family} {style}",
                family
            };

            foreach (string pattern in searchPatterns)
            {
                string[] guids = AssetDatabase.FindAssets($"t:TMP_FontAsset {pattern}");
                if (guids.Length > 0)
                {
                    string path = AssetDatabase.GUIDToAssetPath(guids[0]);
                    TMP_FontAsset font = AssetDatabase.LoadAssetAtPath<TMP_FontAsset>(path);
                    if (font != null) return font;
                }
            }

            return null;
        }

        // =====================================================================
        // Output modes
        // =====================================================================

        /// <summary>
        /// Scene mode: wrap root in Canvas with settings.
        /// </summary>
        static void BuildSceneMode(GameObject root, CanvasSettings settings, ManifestData manifest)
        {
            Canvas canvas;
            string rootName = root.name;

            if (settings.Target == CanvasSettings.CanvasTarget.UseExisting && settings.ExistingCanvas != null)
            {
                // Auto-replace: remove old child with same name
                RemoveExistingChild(settings.ExistingCanvas.transform, rootName);

                // Use existing canvas — reparent
                root.transform.SetParent(settings.ExistingCanvas.transform, false);
                return;
            }

            // Auto-replace: remove old Canvas containing child with same root name
            RemoveExistingImport(rootName);

            // Create new Canvas
            GameObject canvasGO = new GameObject("Canvas");
            canvasGO.layer = 5; // UI layer
            canvas = canvasGO.AddComponent<Canvas>();
            canvas.renderMode = settings.RenderMode;

            // CanvasScaler
            CanvasScaler scaler = canvasGO.AddComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = settings.ReferenceResolution;
            scaler.matchWidthOrHeight = settings.MatchWidthOrHeight;
            scaler.referencePixelsPerUnit = 100f;

            // GraphicRaycaster
            canvasGO.AddComponent<GraphicRaycaster>();

            // Reparent root under canvas
            root.transform.SetParent(canvasGO.transform, false);

            // Set all children to UI layer
            SetLayerRecursive(root, 5);

            // Ensure EventSystem exists
            if (Object.FindObjectOfType<UnityEngine.EventSystems.EventSystem>() == null)
            {
                GameObject eventSystem = new GameObject("EventSystem");
                eventSystem.AddComponent<UnityEngine.EventSystems.EventSystem>();
                eventSystem.AddComponent<UnityEngine.EventSystems.StandaloneInputModule>();
            }

            Undo.RegisterCreatedObjectUndo(canvasGO, "Figma Import - Canvas");
        }

        /// <summary>
        /// Remove existing child with matching name from parent (for UseExisting canvas).
        /// </summary>
        static void RemoveExistingChild(Transform parent, string childName)
        {
            for (int i = parent.childCount - 1; i >= 0; i--)
            {
                Transform child = parent.GetChild(i);
                if (child.name == childName)
                {
                    Debug.Log($"[FigmaImporter] Replacing existing child: {childName}");
                    Undo.DestroyObjectImmediate(child.gameObject);
                }
            }
        }

        /// <summary>
        /// Remove existing Canvas that contains a child with matching root name (for CreateNew).
        /// </summary>
        static void RemoveExistingImport(string rootName)
        {
            Canvas[] allCanvases = Object.FindObjectsOfType<Canvas>();
            foreach (Canvas c in allCanvases)
            {
                Transform t = c.transform;
                for (int i = 0; i < t.childCount; i++)
                {
                    if (t.GetChild(i).name == rootName)
                    {
                        Debug.Log($"[FigmaImporter] Replacing existing import Canvas with root: {rootName}");
                        Undo.DestroyObjectImmediate(c.gameObject);
                        break;
                    }
                }
            }
        }

        /// <summary>
        /// Prefab mode: save root as prefab WITHOUT Canvas/EventSystem.
        /// </summary>
        static void BuildPrefabMode(GameObject root, string savePath, List<BuildLogEntry> log)
        {
            if (string.IsNullOrEmpty(savePath))
            {
                savePath = "Assets/Prefabs/UI/";
                LogEntry(log, BuildLogEntry.LogLevel.Warning,
                    $"No prefab path specified, using default: {savePath}");
            }

            // Ensure directory exists
            string directory = Path.GetDirectoryName(savePath);
            if (!string.IsNullOrEmpty(directory) && !AssetDatabase.IsValidFolder(directory))
            {
                // Create folder recursively
                string[] parts = directory.Replace('\\', '/').Split('/');
                string currentPath = parts[0];
                for (int i = 1; i < parts.Length; i++)
                {
                    string nextPath = currentPath + "/" + parts[i];
                    if (!AssetDatabase.IsValidFolder(nextPath))
                        AssetDatabase.CreateFolder(currentPath, parts[i]);
                    currentPath = nextPath;
                }
            }

            // Build final path
            string finalPath = savePath;
            if (AssetDatabase.IsValidFolder(savePath))
            {
                // savePath is a folder, append filename
                finalPath = Path.Combine(savePath, root.name + ".prefab").Replace('\\', '/');
            }

            // Ensure .prefab extension
            if (!finalPath.EndsWith(".prefab"))
                finalPath += ".prefab";

            PrefabUtility.SaveAsPrefabAsset(root, finalPath);
            LogEntry(log, BuildLogEntry.LogLevel.Success, $"Prefab saved: {finalPath}");
        }

        // =====================================================================
        // 2D Object mode (SpriteRenderer-based)
        // =====================================================================

        /// <summary>
        /// Build element as 2D Object using SpriteRenderer instead of UGUI.
        /// Positions elements in world space (pixels → world units via PPU).
        /// </summary>
        static GameObject Build2DElementRecursive(
            ElementData element,
            Transform parent,
            Dictionary<string, ElementData> lookup,
            Dictionary<string, Sprite> sprites,
            float scaleFactor,
            BuildOptions options,
            Dictionary<string, TMP_FontAsset> fontMapping,
            ref int processedCount,
            int totalElements,
            System.Action<int, int, string> onProgress,
            List<BuildLogEntry> log)
        {
            processedCount++;
            onProgress?.Invoke(processedCount, totalElements, $"Building 2D: {element.Name}");

            GameObject go = new GameObject(element.Name);

            if (parent != null)
                go.transform.SetParent(parent, false);

            // Position in world space: Figma pixels → Unity units
            // Using 100 PPU as standard (1 unit = 100 pixels)
            float ppu = 100f;
            float worldX = element.Rect.X * scaleFactor / ppu;
            float worldY = -element.Rect.Y * scaleFactor / ppu; // Flip Y (Figma Y-down → Unity Y-up)
            go.transform.localPosition = new Vector3(worldX, worldY, 0f);

            // Add SpriteRenderer for visual elements
            bool hasImage = element.Components != null && element.Components.Contains("Image");
            if (hasImage)
            {
                SpriteRenderer sr = go.AddComponent<SpriteRenderer>();

                // Assign sprite
                if (!string.IsNullOrEmpty(element.Asset) && sprites != null)
                {
                    if (sprites.TryGetValue(element.Asset, out Sprite sprite))
                    {
                        sr.sprite = sprite;
                        sr.drawMode = SpriteDrawMode.Simple;
                    }
                    else
                    {
                        LogEntry(log, BuildLogEntry.LogLevel.Warning,
                            $"{element.Name} — sprite \"{element.Asset}\" not found");
                    }
                }

                // Apply color
                if (element.Style?.Fill != null && element.Style.Fill.Length >= 4)
                {
                    sr.color = new Color(
                        element.Style.Fill[0],
                        element.Style.Fill[1],
                        element.Style.Fill[2],
                        element.Style.Fill[3]);
                }

                if (sr.sprite != null)
                    sr.color = Color.white;

                // Sorting order based on depth (parent processes first = lower order)
                sr.sortingOrder = processedCount;
            }

            // Add TextMeshPro for text elements (3D world-space)
            bool hasText = element.Components != null && element.Components.Contains("TextMeshProUGUI");
            if (hasText && element.Text != null)
            {
                TextMeshPro tmp = go.AddComponent<TextMeshPro>();
                tmp.text = element.Text.Content;
                tmp.fontSize = element.Text.FontSize * scaleFactor;

                // Color
                if (element.Text.Color != null && element.Text.Color.Length >= 4)
                {
                    tmp.color = new Color(
                        element.Text.Color[0],
                        element.Text.Color[1],
                        element.Text.Color[2],
                        element.Text.Color[3]);
                }

                // Alignment
                tmp.alignment = MapTextAlignment(element.Text.Alignment);

                // Letter spacing
                if (element.Text.LetterSpacing.HasValue)
                    tmp.characterSpacing = element.Text.LetterSpacing.Value;

                // Line height
                if (element.Text.LineHeight.HasValue && element.Text.LineHeight.Value > 0)
                    tmp.lineSpacing = element.Text.LineHeight.Value;

                // Font — use pre-built mapping if available, fallback to search
                TMP_FontAsset fontAsset2D = null;
                string fontKey2D = $"{element.Text.FontFamily}|{element.Text.FontStyle}";
                if (fontMapping != null && fontMapping.TryGetValue(fontKey2D, out TMP_FontAsset mapped2D))
                    fontAsset2D = mapped2D;
                else
                    fontAsset2D = FindFontAsset(element.Text.FontFamily, element.Text.FontStyle);
                if (fontAsset2D != null)
                    tmp.font = fontAsset2D;

                // Overflow
                tmp.overflowMode = TextOverflowModes.Overflow;
                tmp.enableWordWrapping = true;

                // Sorting
                tmp.sortingOrder = processedCount;
            }

            LogEntry(log, BuildLogEntry.LogLevel.Success, $"{element.Name} — created (2D)");

            // Process children
            if (element.Children != null)
            {
                foreach (string childId in element.Children)
                {
                    if (lookup.TryGetValue(childId, out ElementData childElement))
                    {
                        Build2DElementRecursive(
                            childElement, go.transform, lookup, sprites, scaleFactor,
                            options, fontMapping, ref processedCount, totalElements, onProgress, log);
                    }
                    else
                    {
                        LogEntry(log, BuildLogEntry.LogLevel.Warning,
                            $"Child ID \"{childId}\" not found for parent \"{element.Name}\"");
                    }
                }
            }

            return go;
        }

        // =====================================================================
        // Helpers
        // =====================================================================

        static readonly string PathSeparator = "/";

        static string Path_GetDirectoryName(string path) => System.IO.Path.GetDirectoryName(path);

        /// <summary>
        /// Determine if an element should keep raycastTarget enabled.
        /// Returns true for buttons, masks, backgrounds, and interactive elements.
        /// </summary>
        static bool ShouldKeepRaycast(ElementData element)
        {
            // Explicitly interactive
            if (element.Interactive) return true;

            // Check name patterns (case-insensitive)
            if (!string.IsNullOrEmpty(element.Name))
            {
                string nameLower = element.Name.ToLowerInvariant();
                if (nameLower.Contains("button") || nameLower.Contains("btn") ||
                    nameLower.Contains("mask") ||
                    nameLower.Contains("background") || nameLower.Contains("_bg") ||
                    nameLower.StartsWith("bg") ||
                    nameLower.Contains("toggle") || nameLower.Contains("input") ||
                    nameLower.Contains("slider") || nameLower.Contains("scrollbar") ||
                    nameLower.Contains("dropdown"))
                {
                    return true;
                }
            }

            return false;
        }

        static void LogEntry(List<BuildLogEntry> log, BuildLogEntry.LogLevel level, string message)
        {
            log?.Add(new BuildLogEntry(level, message));

            switch (level)
            {
                case BuildLogEntry.LogLevel.Success:
                    Debug.Log($"[FigmaImporter] ✅ {message}");
                    break;
                case BuildLogEntry.LogLevel.Warning:
                    Debug.LogWarning($"[FigmaImporter] ⚠️ {message}");
                    break;
                case BuildLogEntry.LogLevel.Error:
                    Debug.LogError($"[FigmaImporter] ❌ {message}");
                    break;
            }
        }
        /// <summary>
        /// Recursively set the layer for a GameObject and all its children.
        /// </summary>
        static void SetLayerRecursive(GameObject go, int layer)
        {
            go.layer = layer;
            foreach (Transform child in go.transform)
            {
                SetLayerRecursive(child.gameObject, layer);
            }
        }
    }
}
