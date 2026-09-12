namespace FloatingStockTicker.Models;

public readonly record struct WindowNormalBounds(
    double Left,
    double Top,
    double Width,
    double Height)
{
    public bool IsValid =>
        double.IsFinite(Left)
        && double.IsFinite(Top)
        && double.IsFinite(Width)
        && double.IsFinite(Height)
        && Width > 0
        && Height > 0;
}

public static class GlobalShortcutWindowBoundsLogic
{
    public static WindowNormalBounds? ChooseRestoreBounds(
        WindowNormalBounds? capturedBounds,
        WindowNormalBounds? restoreBounds)
    {
        if (capturedBounds is { } captured && captured.IsValid)
        {
            return captured;
        }

        if (restoreBounds is { } fallback && fallback.IsValid)
        {
            return fallback;
        }

        return null;
    }
}
