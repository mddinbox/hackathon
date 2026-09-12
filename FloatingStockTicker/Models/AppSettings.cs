namespace FloatingStockTicker.Models;

public sealed class AppSettings
{
    public const int DefaultPollingIntervalSeconds = 10;

    public const int MinPollingIntervalSeconds = 10;

    public const int MaxPollingIntervalSeconds = 3600;

    public List<string> Symbols { get; set; } = [];

    public bool AlwaysOnTop { get; set; } = true;

    public int PollingIntervalSeconds { get; set; } = DefaultPollingIntervalSeconds;

    public bool PauseDuringQuietHours { get; set; } = true;

    public bool EnableGlobalShortcut { get; set; } = true;

    public double? WindowWidth { get; set; }

    public double? WindowHeight { get; set; }

    public static bool IsValidPollingInterval(int seconds) =>
        seconds is >= MinPollingIntervalSeconds and <= MaxPollingIntervalSeconds;

    public static string PollingIntervalValidationMessage =>
        $"Polling interval must be a whole number from {MinPollingIntervalSeconds} to {MaxPollingIntervalSeconds} seconds.";

    public AppSettings Clone() => new()
    {
        Symbols = [.. Symbols],
        AlwaysOnTop = AlwaysOnTop,
        PollingIntervalSeconds = PollingIntervalSeconds,
        PauseDuringQuietHours = PauseDuringQuietHours,
        EnableGlobalShortcut = EnableGlobalShortcut,
        WindowWidth = WindowWidth,
        WindowHeight = WindowHeight
    };
}
