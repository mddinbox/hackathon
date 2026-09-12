using System.Globalization;
using System.Text.Json;
using FloatingStockTicker.Models;

namespace FloatingStockTicker.Services;

public sealed record YahooOvernightQuote(
    string Symbol,
    decimal Price,
    DateTimeOffset Timestamp);

public static class YahooOvernightQuoteParser
{
    public static IReadOnlyDictionary<string, YahooOvernightQuote> Parse(string json)
    {
        var quotes = new Dictionary<string, YahooOvernightQuote>(
            StringComparer.OrdinalIgnoreCase);

        try
        {
            using var document = JsonDocument.Parse(json);
            if (!document.RootElement.TryGetProperty("quoteResponse", out var response)
                || response.ValueKind != JsonValueKind.Object
                || !response.TryGetProperty("result", out var results)
                || results.ValueKind != JsonValueKind.Array)
            {
                return quotes;
            }

            foreach (var result in results.EnumerateArray())
            {
                if (result.ValueKind != JsonValueKind.Object
                    || !TryReadString(result, "marketState", out var marketState)
                    || !string.Equals(
                        marketState,
                        "OVERNIGHT",
                        StringComparison.OrdinalIgnoreCase)
                    || !TryReadString(result, "symbol", out var rawSymbol)
                    || !SymbolRules.TryNormalize(rawSymbol, out var symbol, out _)
                    || !result.TryGetProperty(
                        "overnightMarketPrice",
                        out var priceElement)
                    || !TryReadFiniteDecimal(priceElement, out var price)
                    || price < 0
                    || !result.TryGetProperty(
                        "overnightMarketTime",
                        out var timeElement)
                    || !TryReadInt64(timeElement, out var unixSeconds)
                    || unixSeconds <= 0)
                {
                    continue;
                }

                try
                {
                    quotes[symbol] = new YahooOvernightQuote(
                        symbol,
                        price,
                        DateTimeOffset.FromUnixTimeSeconds(unixSeconds));
                }
                catch (ArgumentOutOfRangeException)
                {
                }
            }
        }
        catch (JsonException)
        {
        }
        catch (InvalidOperationException)
        {
        }

        return quotes;
    }

    private static bool TryReadString(
        JsonElement element,
        string propertyName,
        out string value)
    {
        value = string.Empty;
        if (!element.TryGetProperty(propertyName, out var property)
            || property.ValueKind != JsonValueKind.String
            || string.IsNullOrWhiteSpace(property.GetString()))
        {
            return false;
        }

        value = property.GetString()!;
        return true;
    }

    private static bool TryReadFiniteDecimal(
        JsonElement element,
        out decimal value)
    {
        value = 0;
        if (element.ValueKind == JsonValueKind.Number
            && element.TryGetDecimal(out value))
        {
            return true;
        }

        if (element.ValueKind == JsonValueKind.Number
            && element.TryGetDouble(out var number)
            && double.IsFinite(number)
            && number >= (double)decimal.MinValue
            && number <= (double)decimal.MaxValue)
        {
            value = (decimal)number;
            return true;
        }

        return element.ValueKind == JsonValueKind.String
            && decimal.TryParse(
                element.GetString(),
                NumberStyles.Float,
                CultureInfo.InvariantCulture,
                out value);
    }

    private static bool TryReadInt64(JsonElement element, out long value)
    {
        value = 0;
        if (element.ValueKind == JsonValueKind.Number
            && element.TryGetInt64(out value))
        {
            return true;
        }

        return element.ValueKind == JsonValueKind.String
            && long.TryParse(
                element.GetString(),
                NumberStyles.Integer,
                CultureInfo.InvariantCulture,
                out value);
    }
}
