namespace FloatingStockTicker.Models;

public enum RefreshHealth
{
    Waiting,
    Fresh,
    Aging,
    Stale
}

public static class RefreshStatusClassifier
{
    public static RefreshHealth Classify(
        DateTimeOffset? lastSuccessfulRefresh,
        DateTimeOffset now)
    {
        if (lastSuccessfulRefresh is not { } lastRefresh)
        {
            return RefreshHealth.Waiting;
        }

        var age = now - lastRefresh;
        return age <= TimeSpan.FromMinutes(3)
            ? RefreshHealth.Fresh
            : age <= TimeSpan.FromMinutes(10)
                ? RefreshHealth.Aging
                : RefreshHealth.Stale;
    }
}

public static class RefreshStatusPresentation
{
    public static string FormatLastUpdated(
        DateTimeOffset? lastSuccessfulRefresh,
        TimeSpan pollInterval,
        bool isPaused)
    {
        var suffix = isPaused
            ? "Paused"
            : $"{pollInterval.TotalSeconds:0}s poll";
        return lastSuccessfulRefresh is { } lastRefresh
            ? $"Updated {lastRefresh.ToLocalTime():h:mm:ss tt} · {suffix}"
            : $"Updated — · {suffix}";
    }
}
