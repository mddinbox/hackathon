using System.IO;
using System.Text.Json;
using FloatingStockTicker.Models;

namespace FloatingStockTicker.Services;

public sealed class SettingsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true
    };

    public SettingsStore(string? settingsPath = null)
    {
        SettingsPath = settingsPath ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "FloatingStockTicker",
            "settings.json");
    }

    public string SettingsPath { get; }

    public SettingsLoadResult Load()
    {
        if (!File.Exists(SettingsPath))
        {
            return new SettingsLoadResult(CreateDefaultSettings(), null, false);
        }

        try
        {
            return Parse(File.ReadAllText(SettingsPath));
        }
        catch (JsonException ex)
        {
            return new SettingsLoadResult(new AppSettings(), $"The settings file is invalid and was reset: {ex.Message}", false);
        }
        catch (IOException ex)
        {
            return new SettingsLoadResult(new AppSettings(), $"The settings file could not be read: {ex.Message}", false);
        }
        catch (UnauthorizedAccessException ex)
        {
            return new SettingsLoadResult(new AppSettings(), $"The settings file could not be read: {ex.Message}", false);
        }
    }

    public void Save(AppSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        if (!AppSettings.IsValidPollingInterval(settings.PollingIntervalSeconds))
        {
            throw new ArgumentOutOfRangeException(
                nameof(settings.PollingIntervalSeconds),
                AppSettings.PollingIntervalValidationMessage);
        }

        Normalize(settings);
        NormalizeWindowSize(settings);
        var directory = Path.GetDirectoryName(SettingsPath)
            ?? throw new InvalidOperationException("The settings directory could not be determined.");
        Directory.CreateDirectory(directory);
        var json = JsonSerializer.Serialize(settings, JsonOptions);
        File.WriteAllText(SettingsPath, json);
    }

    public static SettingsLoadResult Parse(string json)
    {
        ArgumentNullException.ThrowIfNull(json);
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        var intervalProperty = TryGetPropertyIgnoreCase(
            root,
            nameof(AppSettings.PollingIntervalSeconds),
            out var intervalElement);
        var invalidPollingInterval = intervalProperty
            && (intervalElement.ValueKind != JsonValueKind.Number
                || !intervalElement.TryGetInt32(out var pollingInterval)
                || !AppSettings.IsValidPollingInterval(pollingInterval));
        var settingsJson = invalidPollingInterval
            ? SerializeWithoutProperty(
                root,
                nameof(AppSettings.PollingIntervalSeconds))
            : json;
        var settings = JsonSerializer.Deserialize<AppSettings>(settingsJson, JsonOptions)
            ?? CreateDefaultSettings();
        settings.Symbols ??= [];
        var hasSymbols = TryGetPropertyIgnoreCase(
                root,
                nameof(AppSettings.Symbols),
                out var symbolsElement)
            && symbolsElement.ValueKind == JsonValueKind.Array;
        var hasPollingInterval = intervalProperty;
        var hasPauseDuringQuietHours = TryGetPropertyIgnoreCase(
            root,
            nameof(AppSettings.PauseDuringQuietHours),
            out _);
        var hasEnableGlobalShortcut = TryGetPropertyIgnoreCase(
            root,
            nameof(AppSettings.EnableGlobalShortcut),
            out _);
        var hasLegacyApiKey = TryGetPropertyIgnoreCase(
            root,
            "ApiKey",
            out _);
        var migrated = false;

        if (!hasSymbols)
        {
            settings.Symbols.Clear();
        }

        if (TryGetPropertyIgnoreCase(
                root,
                "Symbol",
                out var legacySymbolElement)
            && legacySymbolElement.ValueKind == JsonValueKind.String
            && !string.IsNullOrWhiteSpace(legacySymbolElement.GetString()))
        {
            settings.Symbols.Insert(0, legacySymbolElement.GetString()!);
            migrated = true;
        }

        var invalidSymbols = Normalize(settings);
        var warnings = new List<string>();
        if (migrated)
        {
            warnings.Add("Migrated the previous symbol into the ticker list.");
        }

        if (invalidSymbols.Count > 0)
        {
            warnings.Add($"{invalidSymbols.Count} invalid saved symbol(s) were skipped.");
        }

        var invalidWindowSize = NormalizeWindowSize(settings);
        if (invalidWindowSize)
        {
            warnings.Add("Invalid saved window size was ignored.");
        }

        if (invalidPollingInterval)
        {
            settings.PollingIntervalSeconds = AppSettings.DefaultPollingIntervalSeconds;
            warnings.Add(
                $"Invalid saved polling interval was reset to {AppSettings.DefaultPollingIntervalSeconds} seconds.");
        }

        return new SettingsLoadResult(
            settings,
            warnings.Count == 0 ? null : string.Join(" ", warnings),
            migrated
            || invalidSymbols.Count > 0
            || invalidWindowSize
            || invalidPollingInterval
            || hasLegacyApiKey
            || !hasSymbols
            || !hasPollingInterval
            || !hasPauseDuringQuietHours
            || !hasEnableGlobalShortcut);
    }

    private static AppSettings CreateDefaultSettings() => new();

    private static List<string> Normalize(AppSettings settings)
    {
        settings.Symbols = SymbolRules.NormalizeList(settings.Symbols, out var invalidSymbols)
            .Where(symbol => !MarketOverviewSymbols.IsBuiltIn(symbol))
            .ToList();
        return invalidSymbols;
    }

    private static bool NormalizeWindowSize(AppSettings settings)
    {
        if (settings.WindowWidth is null && settings.WindowHeight is null)
        {
            return false;
        }

        if (WindowSizeCalculator.IsValidSavedSize(
                settings.WindowWidth,
                settings.WindowHeight))
        {
            return false;
        }

        settings.WindowWidth = null;
        settings.WindowHeight = null;
        return true;
    }

    private static bool TryGetPropertyIgnoreCase(
        JsonElement root,
        string propertyName,
        out JsonElement value)
    {
        if (root.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in root.EnumerateObject())
            {
                if (string.Equals(
                    property.Name,
                    propertyName,
                    StringComparison.OrdinalIgnoreCase))
                {
                    value = property.Value;
                    return true;
                }
            }
        }

        value = default;
        return false;
    }

    private static string SerializeWithoutProperty(
        JsonElement root,
        string propertyName)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return "{}";
        }

        var properties = new Dictionary<string, JsonElement>(
            StringComparer.OrdinalIgnoreCase);
        foreach (var property in root.EnumerateObject())
        {
            if (!string.Equals(
                property.Name,
                propertyName,
                StringComparison.OrdinalIgnoreCase))
            {
                properties[property.Name] = property.Value;
            }
        }

        return JsonSerializer.Serialize(properties, JsonOptions);
    }
}

public sealed record SettingsLoadResult(
    AppSettings Settings,
    string? Warning,
    bool RequiresRewrite = false);
