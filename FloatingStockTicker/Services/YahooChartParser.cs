using System.Globalization;
using System.Text.Json;
using FloatingStockTicker.Models;

namespace FloatingStockTicker.Services;

public static class YahooChartParser
{
    public static readonly TimeSpan MaxActiveQuoteAge = TimeSpan.FromMinutes(15);

    public static bool TryParseQuote(
        string json,
        string requestedSymbol,
        DateTimeOffset fallbackTimestamp,
        out QuoteTick quote,
        out string error)
    {
        quote = default!;
        error = string.Empty;

        if (!SymbolRules.TryNormalize(requestedSymbol, out var symbol, out error))
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("chart", out var chart)
                || chart.ValueKind != JsonValueKind.Object)
            {
                error = "Yahoo response did not contain a chart object.";
                return false;
            }

            if (chart.TryGetProperty("error", out var chartError)
                && chartError.ValueKind == JsonValueKind.Object
                && chartError.TryGetProperty("description", out var description)
                && description.ValueKind == JsonValueKind.String
                && !string.IsNullOrWhiteSpace(description.GetString()))
            {
                error = description.GetString()!;
                return false;
            }

            if (!chart.TryGetProperty("result", out var results)
                || results.ValueKind != JsonValueKind.Array
                || results.GetArrayLength() == 0
                || results[0].ValueKind != JsonValueKind.Object
                || !results[0].TryGetProperty("meta", out var meta)
                || meta.ValueKind != JsonValueKind.Object)
            {
                error = "Yahoo response did not contain a valid chart result.";
                return false;
            }

            var result = results[0];
            var timestamp = fallbackTimestamp;
            if (meta.TryGetProperty("regularMarketTime", out var timeElement)
                && TryReadInt64(timeElement, out var unixSeconds)
                && unixSeconds > 0)
            {
                try
                {
                    timestamp = DateTimeOffset.FromUnixTimeSeconds(unixSeconds);
                }
                catch (ArgumentOutOfRangeException)
                {
                    error = "Yahoo response contained an invalid market timestamp.";
                    return false;
                }
            }

            var periods = ReadTradingPeriods(meta);
            var points = ReadIntradayPoints(result, periods);
            var regularPrice = 0m;
            var hasRegularPrice =
                meta.TryGetProperty("regularMarketPrice", out var priceElement)
                && TryReadFiniteDecimal(priceElement, out regularPrice)
                && regularPrice >= 0;
            var activeSession = MarketSessionClassifier.Classify(
                fallbackTimestamp,
                periods);
            if (!TrySelectPrimaryQuote(
                    points,
                    hasRegularPrice ? regularPrice : null,
                    timestamp,
                    fallbackTimestamp,
                    out var selectedPrice,
                    out var selectedTimestamp))
            {
                error = "Yahoo response did not contain regularMarketPrice or a valid intraday quote.";
                return false;
            }

            var hasExtendedQuote = TrySelectExtendedQuote(
                points,
                activeSession,
                fallbackTimestamp,
                out var extendedPrice,
                out var extendedTimestamp,
                out var extendedSession);
            quote = new QuoteTick(
                symbol,
                selectedPrice,
                selectedTimestamp,
                points,
                ReadPreviousClose(meta),
                activeSession,
                hasExtendedQuote ? extendedPrice : null,
                hasExtendedQuote ? extendedTimestamp : null,
                hasExtendedQuote ? extendedSession : MarketSession.Unknown);
            return true;
        }
        catch (JsonException)
        {
            error = "Yahoo response was not valid JSON.";
            return false;
        }
        catch (InvalidOperationException)
        {
            error = "Yahoo response had an unexpected shape.";
            return false;
        }
    }

    private static IReadOnlyList<IntradayPoint> ReadIntradayPoints(
        JsonElement result,
        TradingPeriods? periods)
    {
        if (!result.TryGetProperty("timestamp", out var timestamps)
            || timestamps.ValueKind != JsonValueKind.Array
            || !result.TryGetProperty("indicators", out var indicators)
            || indicators.ValueKind != JsonValueKind.Object
            || !indicators.TryGetProperty("quote", out var quotes)
            || quotes.ValueKind != JsonValueKind.Array
            || quotes.GetArrayLength() == 0
            || quotes[0].ValueKind != JsonValueKind.Object
            || !quotes[0].TryGetProperty("close", out var closes)
            || closes.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var points = new List<IntradayPoint>();
        var count = Math.Min(timestamps.GetArrayLength(), closes.GetArrayLength());
        for (var index = 0; index < count; index++)
        {
            if (!TryReadInt64(timestamps[index], out var unixSeconds)
                || unixSeconds <= 0
                || !TryReadFiniteDecimal(closes[index], out var price)
                || price < 0
                || !TryCreateTimestamp(unixSeconds, out var pointTimestamp)
                || !MarketSessionClassifier.IsInTradingDay(pointTimestamp, periods))
            {
                continue;
            }

            points.Add(new IntradayPoint(
                pointTimestamp,
                price,
                MarketSessionClassifier.Classify(pointTimestamp, periods)));
        }

        return IntradaySeries.Clean(points);
    }

    private static bool TrySelectPrimaryQuote(
        IReadOnlyList<IntradayPoint> points,
        decimal? regularPrice,
        DateTimeOffset regularPriceTimestamp,
        DateTimeOffset observedAt,
        out decimal price,
        out DateTimeOffset timestamp)
    {
        if (regularPrice is { } currentPrice)
        {
            price = currentPrice;
            timestamp = regularPriceTimestamp;
            return true;
        }

        var fallback = points
            .Where(point => point.Timestamp <= observedAt)
            .LastOrDefault();
        if (fallback != default)
        {
            price = fallback.Price;
            timestamp = fallback.Timestamp;
            return true;
        }

        price = 0;
        timestamp = observedAt;
        return false;
    }

    private static bool TrySelectExtendedQuote(
        IReadOnlyList<IntradayPoint> points,
        MarketSession activeSession,
        DateTimeOffset observedAt,
        out decimal price,
        out DateTimeOffset timestamp,
        out MarketSession session)
    {
        var preferred = activeSession switch
        {
            MarketSession.PreMarket or MarketSession.AfterHours => points
                .Where(point => point.Session == activeSession)
                .LastOrDefault(point => IsUsableActivePoint(point, observedAt)),
            MarketSession.Closed => points
                .Where(point => point.Session == MarketSession.AfterHours)
                .LastOrDefault(point => point.Timestamp <= observedAt),
            _ => default
        };
        if (preferred != default)
        {
            price = preferred.Price;
            timestamp = preferred.Timestamp;
            session = preferred.Session;
            return true;
        }

        price = 0;
        timestamp = default;
        session = MarketSession.Unknown;
        return false;
    }

    private static bool IsUsableActivePoint(
        IntradayPoint point,
        DateTimeOffset observedAt)
    {
        var age = observedAt - point.Timestamp;
        return point.Timestamp <= observedAt
            && age >= TimeSpan.Zero
            && age <= MaxActiveQuoteAge;
    }

    private static decimal? ReadPreviousClose(JsonElement meta)
    {
        if (TryReadPositiveDecimal(meta, "previousClose", out var previousClose))
        {
            return previousClose;
        }

        return TryReadPositiveDecimal(meta, "chartPreviousClose", out var chartPreviousClose)
            ? chartPreviousClose
            : null;
    }

    private static TradingPeriods? ReadTradingPeriods(JsonElement meta)
    {
        if (!meta.TryGetProperty("currentTradingPeriod", out var currentPeriod)
            || currentPeriod.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new TradingPeriods(
            TryReadNamedPeriod(currentPeriod, "pre", out var pre) ? pre : null,
            TryReadNamedPeriod(currentPeriod, "regular", out var regular) ? regular : null,
            TryReadNamedPeriod(currentPeriod, "post", out var post) ? post : null);
    }

    private static bool TryReadNamedPeriod(
        JsonElement parent,
        string name,
        out TradingPeriod period)
    {
        period = default;
        return parent.TryGetProperty(name, out var element)
            && TryReadPeriod(element, out period);
    }

    private static bool TryReadPeriod(
        JsonElement element,
        out TradingPeriod period)
    {
        period = default;
        if (element.ValueKind != JsonValueKind.Object
            || !element.TryGetProperty("start", out var startElement)
            || !element.TryGetProperty("end", out var endElement))
        {
            return false;
        }

        if (!TryReadInt64(startElement, out var startSeconds)
            || !TryReadInt64(endElement, out var endSeconds)
            || startSeconds <= 0
            || endSeconds <= startSeconds
            || !TryCreateTimestamp(startSeconds, out var start)
            || !TryCreateTimestamp(endSeconds, out var end))
        {
            return false;
        }

        period = new TradingPeriod(start, end);
        return true;
    }

    private static bool TryCreateTimestamp(
        long unixSeconds,
        out DateTimeOffset timestamp)
    {
        try
        {
            timestamp = DateTimeOffset.FromUnixTimeSeconds(unixSeconds);
            return true;
        }
        catch (ArgumentOutOfRangeException)
        {
            timestamp = default;
            return false;
        }
    }

    private static bool TryReadPositiveDecimal(
        JsonElement objectElement,
        string propertyName,
        out decimal value)
    {
        value = 0;
        return objectElement.TryGetProperty(propertyName, out var element)
            && TryReadFiniteDecimal(element, out value)
            && value > 0;
    }

    private static bool TryReadFiniteDecimal(JsonElement element, out decimal value)
    {
        value = 0;
        if (element.ValueKind == JsonValueKind.Number && element.TryGetDecimal(out value))
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
        if (element.ValueKind == JsonValueKind.Number && element.TryGetInt64(out value))
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
