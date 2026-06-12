using System.Collections.Generic;
using UnityEditor;
using UnityEditor.IMGUI.Controls;
using UnityEngine;

namespace FigmaImporter.Sync
{
    /// <summary>
    /// Expandable/collapsible tree of manifest elements. Single-click selects
    /// (the window highlights the element on the preview); double-click (or F2)
    /// renames — the new name is reported back so the window can persist it
    /// into manifest.json, which Build then uses for GameObject names.
    /// </summary>
    public class FigmaNodeTreeView : TreeView
    {
        public class Node
        {
            public string ElementId;
            public string Name;
            public string FigmaType;
            public List<Node> Children = new List<Node>();
        }

        /// <summary>Element id of the newly selected row, or null.</summary>
        public System.Action<string> ElementSelected;
        /// <summary>Element id + accepted new name.</summary>
        public System.Action<string, string> ElementRenamed;

        List<Node> _roots = new List<Node>();
        readonly Dictionary<int, Node> _nodesByItemId = new Dictionary<int, Node>();

        public FigmaNodeTreeView(TreeViewState state) : base(state)
        {
            showAlternatingRowBackgrounds = true;
        }

        public void SetData(List<Node> roots)
        {
            _roots = roots ?? new List<Node>();
            Reload();
            ExpandAll();
        }

        protected override TreeViewItem BuildRoot()
        {
            _nodesByItemId.Clear();
            var root = new TreeViewItem { id = 0, depth = -1, displayName = "<root>" };
            int nextId = 1;
            foreach (var node in _roots)
                AddItem(root, node, ref nextId);
            if (root.children == null)
                root.children = new List<TreeViewItem>();
            SetupDepthsFromParentsAndChildren(root);
            return root;
        }

        void AddItem(TreeViewItem parent, Node node, ref int nextId)
        {
            var item = new TreeViewItem { id = nextId++, displayName = node.Name };
            _nodesByItemId[item.id] = node;
            parent.AddChild(item);
            foreach (var child in node.Children)
                AddItem(item, child, ref nextId);
        }

        protected override void RowGUI(RowGUIArgs args)
        {
            base.RowGUI(args);
            if (!args.isRenaming
                && _nodesByItemId.TryGetValue(args.item.id, out var node)
                && !string.IsNullOrEmpty(node.FigmaType))
            {
                var rect = args.rowRect;
                rect.xMin = Mathf.Max(rect.xMin, rect.xMax - 72);
                GUI.Label(rect, node.FigmaType, EditorStyles.centeredGreyMiniLabel);
            }
        }

        protected override bool CanRename(TreeViewItem item) => item.id != 0;

        protected override void RenameEnded(RenameEndedArgs args)
        {
            if (!args.acceptedRename || string.IsNullOrWhiteSpace(args.newName)) return;
            if (!_nodesByItemId.TryGetValue(args.itemID, out var node)) return;
            node.Name = args.newName.Trim();
            var item = FindItem(args.itemID, rootItem);
            if (item != null) item.displayName = node.Name;
            ElementRenamed?.Invoke(node.ElementId, node.Name);
        }

        protected override void DoubleClickedItem(int id)
        {
            var item = FindItem(id, rootItem);
            if (item != null) BeginRename(item);
        }

        protected override void SelectionChanged(IList<int> selectedIds)
        {
            string elementId = null;
            if (selectedIds != null && selectedIds.Count > 0
                && _nodesByItemId.TryGetValue(selectedIds[0], out var node))
                elementId = node.ElementId;
            ElementSelected?.Invoke(elementId);
        }
    }
}
