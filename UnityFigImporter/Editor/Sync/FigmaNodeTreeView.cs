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
        /// <summary>Element id the user asked to select on Figma (context menu).</summary>
        public System.Action<string> ElementSelectOnFigma;
        /// <summary>childId, newParentId, insertIndex — a drag-drop reorder/reparent.</summary>
        public System.Action<string, string, int> ElementReparented;

        const string DragId = "FigmaNodeTreeView";

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

        protected override void ContextClickedItem(int id)
        {
            if (!_nodesByItemId.TryGetValue(id, out var node)) return;
            var menu = new GenericMenu();
            menu.AddItem(new GUIContent("Select on Figma"), false,
                () => ElementSelectOnFigma?.Invoke(node.ElementId));
            var item = FindItem(id, rootItem);
            if (item != null)
                menu.AddItem(new GUIContent("Rename"), false, () => BeginRename(item));
            menu.ShowAsContext();
        }

        // ---- Drag & drop reparent ----

        protected override bool CanStartDrag(CanStartDragArgs args)
            => args.draggedItem != null && _nodesByItemId.ContainsKey(args.draggedItem.id);

        protected override void SetupDragAndDrop(SetupDragAndDropArgs args)
        {
            DragAndDrop.PrepareStartDrag();
            DragAndDrop.SetGenericData(DragId, new List<int>(args.draggedItemIDs));
            DragAndDrop.objectReferences = new Object[0];
            DragAndDrop.StartDrag(args.draggedItemIDs.Count > 0
                ? FindItem(args.draggedItemIDs[0], rootItem)?.displayName ?? "node"
                : "node");
        }

        protected override DragAndDropVisualMode HandleDragAndDrop(DragAndDropArgs args)
        {
            var dragged = DragAndDrop.GetGenericData(DragId) as List<int>;
            if (dragged == null || dragged.Count == 0)
                return DragAndDropVisualMode.None;

            int draggedId = dragged[0];
            if (!_nodesByItemId.TryGetValue(draggedId, out var draggedNode))
                return DragAndDropVisualMode.None;

            // Resolve the target parent node and insert index for both gestures:
            //  - UponItem      → reparent as the last child of the hovered row.
            //  - BetweenItems  → reorder among siblings at the drop gap.
            // Dropping between page-level roots (parent = invisible root) is ignored.
            Node targetParent;
            int insertIndex;
            if (args.dragAndDropPosition == DragAndDropPosition.UponItem)
            {
                if (args.parentItem == null
                    || !_nodesByItemId.TryGetValue(args.parentItem.id, out targetParent))
                    return DragAndDropVisualMode.None;
                insertIndex = targetParent.Children.Count;
            }
            else if (args.dragAndDropPosition == DragAndDropPosition.BetweenItems)
            {
                if (args.parentItem == null
                    || !_nodesByItemId.TryGetValue(args.parentItem.id, out targetParent))
                    return DragAndDropVisualMode.None;
                insertIndex = args.insertAtIndex;
            }
            else
            {
                return DragAndDropVisualMode.None;
            }

            // Reject dropping a node onto itself or one of its descendants.
            if (draggedNode == targetParent || IsDescendant(targetParent, draggedNode))
                return DragAndDropVisualMode.None;

            if (args.performDrop)
            {
                var fromList = FindContainingList(draggedNode, out int oldIndex);
                if (fromList == null) return DragAndDropVisualMode.Move;
                fromList.Remove(draggedNode);
                // Removing an earlier sibling shifts the target gap down by one.
                if (ReferenceEquals(fromList, targetParent.Children) && oldIndex < insertIndex)
                    insertIndex--;
                insertIndex = Mathf.Clamp(insertIndex, 0, targetParent.Children.Count);
                targetParent.Children.Insert(insertIndex, draggedNode);
                Reload();
                ExpandAll();
                ElementReparented?.Invoke(draggedNode.ElementId, targetParent.ElementId, insertIndex);
            }
            return DragAndDropVisualMode.Move;
        }

        /// <summary>Find the children list that currently holds <paramref name="target"/>
        /// (the roots list or some node's Children), and its index within it.</summary>
        List<Node> FindContainingList(Node target, out int index)
        {
            return FindIn(_roots, target, out index);
        }

        static List<Node> FindIn(List<Node> list, Node target, out int index)
        {
            index = list.IndexOf(target);
            if (index >= 0) return list;
            foreach (var n in list)
            {
                var found = FindIn(n.Children, target, out index);
                if (found != null) return found;
            }
            index = -1;
            return null;
        }

        static bool IsDescendant(Node candidate, Node ancestor)
        {
            if (ancestor.Children == null) return false;
            foreach (var child in ancestor.Children)
            {
                if (child == candidate || IsDescendant(candidate, child)) return true;
            }
            return false;
        }
    }
}
