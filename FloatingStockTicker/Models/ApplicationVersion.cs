using System.Reflection;

namespace FloatingStockTicker.Models;

public static class ApplicationVersion
{
    public static string DisplayText =>
        Format(Assembly.GetExecutingAssembly().GetName().Version);

    public static string Format(Version? version) =>
        version is null
            ? "Version unavailable"
            : $"Version {version.Major}.{version.Minor}.{Math.Max(0, version.Build)}";
}
