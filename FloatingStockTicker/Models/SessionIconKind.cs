namespace FloatingStockTicker.Models;

public enum SessionIconKind
{
    Regular,
    PreMarket,
    AfterHours,
    Overnight
}

public static class SessionIconKindExtensions
{
    public static string AccessibleName(this SessionIconKind kind) => kind switch
    {
        SessionIconKind.Regular => "Regular session",
        SessionIconKind.PreMarket => "Pre-market",
        SessionIconKind.AfterHours => "After-hours",
        SessionIconKind.Overnight => "Overnight",
        _ => "Market session"
    };
}
