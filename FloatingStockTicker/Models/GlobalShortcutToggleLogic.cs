namespace FloatingStockTicker.Models;

public enum GlobalShortcutWindowAction
{
    Minimize,
    Restore
}

public static class GlobalShortcutToggleLogic
{
    public static GlobalShortcutWindowAction Decide(
        bool isMinimized,
        bool isForeground) =>
        !isMinimized && isForeground
            ? GlobalShortcutWindowAction.Minimize
            : GlobalShortcutWindowAction.Restore;
}
