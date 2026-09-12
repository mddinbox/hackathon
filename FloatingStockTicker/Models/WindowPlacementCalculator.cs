namespace FloatingStockTicker.Models;

public readonly record struct ScreenWorkArea(
    double Left,
    double Top,
    double Width,
    double Height)
{
    public double Right => Left + Width;

    public double Bottom => Top + Height;
}

public readonly record struct WindowPlacement(double Left, double Top);

public static class WindowPlacementCalculator
{
    public static WindowPlacement CalculateLowerRight(
        ScreenWorkArea workArea,
        double windowWidth,
        double windowHeight,
        double margin = 16)
    {
        var areaLeft = FiniteOrZero(workArea.Left);
        var areaTop = FiniteOrZero(workArea.Top);
        var areaWidth = PositiveOrZero(workArea.Width);
        var areaHeight = PositiveOrZero(workArea.Height);
        var width = PositiveOrZero(windowWidth);
        var height = PositiveOrZero(windowHeight);
        var safeMargin = PositiveOrZero(margin);
        var areaRight = areaLeft + areaWidth;
        var areaBottom = areaTop + areaHeight;
        var maximumLeft = Math.Max(areaLeft, areaRight - width);
        var maximumTop = Math.Max(areaTop, areaBottom - height);

        return new(
            Math.Clamp(areaRight - width - safeMargin, areaLeft, maximumLeft),
            Math.Clamp(areaBottom - height - safeMargin, areaTop, maximumTop));
    }

    private static double FiniteOrZero(double value) =>
        double.IsFinite(value) ? value : 0;

    private static double PositiveOrZero(double value) =>
        double.IsFinite(value) && value > 0 ? value : 0;
}
