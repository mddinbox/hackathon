namespace FloatingStockTicker.Models;

public static class ResponsiveTileLayout
{
    public const double MinimumCardWidth = 420;
    public const double InterCardSpacing = 6;
    public const int MaximumColumns = 3;

    public static int GetColumnCount(double availableWidth)
    {
        if (!double.IsFinite(availableWidth) || availableWidth <= 0)
        {
            return 1;
        }

        var columns = (int)Math.Floor(
            (availableWidth + InterCardSpacing)
            / (MinimumCardWidth + InterCardSpacing));
        return Math.Clamp(columns, 1, MaximumColumns);
    }

    public static double GetItemWidth(
        double availableWidth,
        int columnCount)
    {
        var columns = Math.Clamp(columnCount, 1, MaximumColumns);
        var width = (availableWidth - (columns - 1) * InterCardSpacing) / columns;
        return Math.Max(0, width);
    }
}
