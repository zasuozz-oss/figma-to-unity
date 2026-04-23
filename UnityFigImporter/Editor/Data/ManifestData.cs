// =============================================================================
// ManifestData — C# data classes mirroring manifest.json schema v1.0
// =============================================================================

using System;
using System.Collections.Generic;
using Newtonsoft.Json;

namespace FigmaImporter.Data
{
    [Serializable]
    public class ManifestData
    {
        [JsonProperty("version")]
        public string Version;

        [JsonProperty("exportDate")]
        public string ExportDate;

        [JsonProperty("screen")]
        public ScreenData Screen;

        [JsonProperty("elements")]
        public List<ElementData> Elements;

        [JsonProperty("assets")]
        public List<AssetEntryData> Assets;

        [JsonProperty("fonts")]
        public List<FontEntryData> Fonts;
    }

    [Serializable]
    public class ScreenData
    {
        [JsonProperty("name")]
        public string Name;

        [JsonProperty("figmaSize")]
        public SizeData FigmaSize;

        [JsonProperty("unityRefResolution")]
        public SizeData UnityRefResolution;

        [JsonProperty("exportScale")]
        public float ExportScale = 1f;
    }

    [Serializable]
    public class SizeData
    {
        [JsonProperty("w")]
        public float W;

        [JsonProperty("h")]
        public float H;
    }

    [Serializable]
    public class ElementData
    {
        [JsonProperty("id")]
        public string Id;

        [JsonProperty("name")]
        public string Name;

        [JsonProperty("figmaType")]
        public string FigmaType;

        [JsonProperty("parentId")]
        public string ParentId;

        [JsonProperty("rect")]
        public RectData Rect;

        [JsonProperty("unity")]
        public UnityTransformData Unity;

        [JsonProperty("components")]
        public List<string> Components;

        [JsonProperty("style")]
        public StyleData Style;

        [JsonProperty("text")]
        public TextPropsData Text;

        [JsonProperty("asset")]
        public string Asset;

        [JsonProperty("assetBounds")]
        public AssetBoundsData AssetBounds;

        [JsonProperty("interactive")]
        public bool Interactive;

        [JsonProperty("children")]
        public List<string> Children;

        [JsonProperty("merged")]
        public bool Merged;

        [JsonProperty("exportable")]
        public bool Exportable;

        [JsonProperty("autoLayout")]
        public AutoLayoutData AutoLayout;

        [JsonProperty("nineSlice")]
        public NineSliceData NineSlice;

        [JsonProperty("clipsContent")]
        public bool ClipsContent;
    }

    [Serializable]
    public class AssetBoundsData
    {
        [JsonProperty("x")]
        public float X;

        [JsonProperty("y")]
        public float Y;

        [JsonProperty("w")]
        public float W;

        [JsonProperty("h")]
        public float H;

        [JsonProperty("pixelWidth")]
        public int PixelWidth;

        [JsonProperty("pixelHeight")]
        public int PixelHeight;

        [JsonProperty("exportScale")]
        public float ExportScale;
    }

    [Serializable]
    public class AutoLayoutData
    {
        [JsonProperty("layoutMode")]
        public string LayoutMode;

        [JsonProperty("paddingTop")]
        public float PaddingTop;

        [JsonProperty("paddingBottom")]
        public float PaddingBottom;

        [JsonProperty("paddingLeft")]
        public float PaddingLeft;

        [JsonProperty("paddingRight")]
        public float PaddingRight;

        [JsonProperty("itemSpacing")]
        public float ItemSpacing;

        [JsonProperty("primaryAxisAlignItems")]
        public string PrimaryAxisAlignItems;

        [JsonProperty("counterAxisAlignItems")]
        public string CounterAxisAlignItems;
    }

    [Serializable]
    public class NineSliceData
    {
        [JsonProperty("border")]
        public float[] Border; // [left, bottom, right, top]

        [JsonProperty("exportScale")]
        public float ExportScale;
    }

    [Serializable]
    public class RectData
    {
        [JsonProperty("x")]
        public float X;

        [JsonProperty("y")]
        public float Y;

        [JsonProperty("w")]
        public float W;

        [JsonProperty("h")]
        public float H;
    }

    [Serializable]
    public class UnityTransformData
    {
        [JsonProperty("anchorMin")]
        public float[] AnchorMin;

        [JsonProperty("anchorMax")]
        public float[] AnchorMax;

        [JsonProperty("pivot")]
        public float[] Pivot;

        [JsonProperty("sizeDelta")]
        public float[] SizeDelta;

        [JsonProperty("offsetMin")]
        public float[] OffsetMin;

        [JsonProperty("offsetMax")]
        public float[] OffsetMax;

        [JsonProperty("localScale")]
        public float[] LocalScale;
    }

    [Serializable]
    public class StyleData
    {
        [JsonProperty("fill")]
        public float[] Fill;

        [JsonProperty("cornerRadius")]
        public float CornerRadius;

        [JsonProperty("opacity")]
        public float Opacity = 1f;

        [JsonProperty("shadow")]
        public ShadowData Shadow;
    }

    [Serializable]
    public class ShadowData
    {
        [JsonProperty("x")]
        public float X;

        [JsonProperty("y")]
        public float Y;

        [JsonProperty("blur")]
        public float Blur;

        [JsonProperty("color")]
        public float[] Color;
    }

    [Serializable]
    public class TextPropsData
    {
        [JsonProperty("content")]
        public string Content;

        [JsonProperty("fontFamily")]
        public string FontFamily;

        [JsonProperty("fontStyle")]
        public string FontStyle;

        [JsonProperty("fontSize")]
        public float FontSize;

        [JsonProperty("color")]
        public float[] Color;

        [JsonProperty("alignment")]
        public string Alignment;

        [JsonProperty("lineHeight")]
        public float? LineHeight;

        [JsonProperty("letterSpacing")]
        public float? LetterSpacing;
    }

    [Serializable]
    public class AssetEntryData
    {
        [JsonProperty("file")]
        public string File;

        [JsonProperty("nodeId")]
        public string NodeId;

        [JsonProperty("scale")]
        public float Scale;
    }

    [Serializable]
    public class FontEntryData
    {
        [JsonProperty("family")]
        public string Family;

        [JsonProperty("styles")]
        public List<string> Styles;
    }
}
