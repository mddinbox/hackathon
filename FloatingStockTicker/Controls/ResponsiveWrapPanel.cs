using System.Windows;
using System.Windows.Controls;
using FloatingStockTicker.Models;

namespace FloatingStockTicker.Controls;

public sealed class ResponsiveWrapPanel : Panel
{
    protected override Size MeasureOverride(Size availableSize)
    {
        var width = GetLayoutWidth(availableSize.Width);
        var columns = ResponsiveTileLayout.GetColumnCount(width);
        var itemWidth = ResponsiveTileLayout.GetItemWidth(width, columns);
        var rowHeights = MeasureChildren(itemWidth, columns);

        return new Size(width, GetTotalHeight(rowHeights));
    }

    protected override Size ArrangeOverride(Size finalSize)
    {
        var width = GetLayoutWidth(finalSize.Width);
        var columns = ResponsiveTileLayout.GetColumnCount(width);
        var itemWidth = ResponsiveTileLayout.GetItemWidth(width, columns);
        var rowHeights = GetRowHeights(columns);
        var y = 0d;

        for (var index = 0; index < InternalChildren.Count; index++)
        {
            var row = index / columns;
            var column = index % columns;
            var x = column * (itemWidth + ResponsiveTileLayout.InterCardSpacing);
            InternalChildren[index].Arrange(
                new Rect(x, y, itemWidth, rowHeights[row]));

            if (column == columns - 1
                || index == InternalChildren.Count - 1)
            {
                y += rowHeights[row] + ResponsiveTileLayout.InterCardSpacing;
            }
        }

        return finalSize;
    }

    private double[] MeasureChildren(double itemWidth, int columns)
    {
        var rowHeights = new double[GetRowCount(columns)];
        foreach (UIElement child in InternalChildren)
        {
            child.Measure(new Size(itemWidth, double.PositiveInfinity));
        }

        return GetRowHeights(columns, rowHeights);
    }

    private double[] GetRowHeights(int columns)
    {
        return GetRowHeights(columns, new double[GetRowCount(columns)]);
    }

    private double[] GetRowHeights(int columns, double[] rowHeights)
    {
        for (var index = 0; index < InternalChildren.Count; index++)
        {
            var row = index / columns;
            rowHeights[row] = Math.Max(
                rowHeights[row],
                InternalChildren[index].DesiredSize.Height);
        }

        return rowHeights;
    }

    private int GetRowCount(int columns) =>
        InternalChildren.Count == 0
            ? 0
            : (InternalChildren.Count + columns - 1) / columns;

    private static double GetTotalHeight(IReadOnlyList<double> rowHeights) =>
        rowHeights.Count == 0
            ? 0
            : rowHeights.Sum() + (rowHeights.Count - 1) * ResponsiveTileLayout.InterCardSpacing;

    private double GetLayoutWidth(double availableWidth)
    {
        if (double.IsFinite(availableWidth) && availableWidth > 0)
        {
            return availableWidth;
        }

        var desiredWidth = InternalChildren
            .Cast<UIElement>()
            .Select(child => child.DesiredSize.Width)
            .DefaultIfEmpty(ResponsiveTileLayout.MinimumCardWidth)
            .Max();
        return Math.Max(ResponsiveTileLayout.MinimumCardWidth, desiredWidth);
    }
}
