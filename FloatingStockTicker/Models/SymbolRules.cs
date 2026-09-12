using System.Text.RegularExpressions;

namespace FloatingStockTicker.Models;

public static partial class SymbolRules
{
    private const int MaxLength = 24;

    public static bool TryNormalize(string? rawSymbol, out string symbol, out string error)
    {
        symbol = rawSymbol?.Trim().ToUpperInvariant() ?? string.Empty;
        if (symbol.Length == 0)
        {
            error = "Enter a symbol such as AAPL or MSFT.";
            return false;
        }

        if (symbol.Length > MaxLength)
        {
            error = $"Symbols must be {MaxLength} characters or fewer.";
            return false;
        }

        if (!ValidSymbolRegex().IsMatch(symbol))
        {
            error = "Use letters, numbers, '.', '-', '_', ':' or '=' only.";
            return false;
        }

        error = string.Empty;
        return true;
    }

    public static List<string> NormalizeList(IEnumerable<string>? rawSymbols, out List<string> invalidSymbols)
    {
        invalidSymbols = [];
        var normalized = new List<string>();
        foreach (var rawSymbol in rawSymbols ?? [])
        {
            if (!TryNormalize(rawSymbol, out var symbol, out _))
            {
                invalidSymbols.Add(rawSymbol);
                continue;
            }

            if (!normalized.Contains(symbol, StringComparer.OrdinalIgnoreCase))
            {
                normalized.Add(symbol);
            }
        }

        return normalized;
    }

    [GeneratedRegex("^[A-Z0-9^][A-Z0-9._:^=\\-]*$", RegexOptions.CultureInvariant)]
    private static partial Regex ValidSymbolRegex();
}
