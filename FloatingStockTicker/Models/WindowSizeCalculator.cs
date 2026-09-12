namespace FloatingStockTicker.Models;

public readonly record struct WindowSize(double Width, double Height);

public static class WindowSizeCalculator
{
    public const double DefaultWidth = 500;
    public const double DefaultHeight = 500;
    public const double MinimumWidth = 420;
    public const double MinimumHeight = 260;

    public static WindowSize Resolve(
        double? savedWidth,
        double? savedHeight,
        ScreenWorkArea workArea,
        double margin = 16)
    {
        var width = IsValidSavedDimension(savedWidth, MinimumWidth)
            ? savedWidth!.Value
            : DefaultWidth;
        var height = IsValidSavedDimension(savedHeight, MinimumHeight)
            ? savedHeight!.Value
            : DefaultHeight;

        return new(
            ClampToWorkArea(width, workArea.Width, MinimumWidth, margin),
            ClampToWorkArea(height, workArea.Height, MinimumHeight, margin));
    }

    public static bool IsValidSavedSize(double? width, double? height) =>
        IsValidSavedDimension(width, MinimumWidth)
        && IsValidSavedDimension(height, MinimumHeight);

    private static bool IsValidSavedDimension(double? value, double minimum) =>
        value is { } dimension
        && double.IsFinite(dimension)
        && dimension >= minimum;

    private static double ClampToWorkArea(
        double desired,
        double workAreaDimension,
        double minimum,
        double margin)
    {
        if (!double.IsFinite(workAreaDimension) || workAreaDimension <= 0)
        {
            return desired;
        }

        var safeMargin = double.IsFinite(margin) && margin > 0 ? margin : 0;
        var maximum = Math.Max(minimum, workAreaDimension - safeMargin * 2);
        return Math.Clamp(desired, minimum, maximum);
    }
}
