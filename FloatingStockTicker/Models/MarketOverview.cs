using System.Windows.Media;

namespace FloatingStockTicker.Models;

public sealed record MarketIndexDefinition(
    string Symbol,
    string FuturesSymbol,
    string Label,
    string SeriesBrushKey,
    Color FallbackColor);

public static class MarketOverviewSymbols
{
    public static IReadOnlyList<MarketIndexDefinition> Definitions { get; } =
    [
        new(
            "^DJI",
            "YM=F",
            "DOW",
            "OverviewDowBrush",
            Color.FromRgb(59, 130, 246)),
        new(
            "^GSPC",
            "ES=F",
            "S&P",
            "OverviewSpBrush",
            Color.FromRgb(251, 191, 36)),
        new(
            "^IXIC",
            "NQ=F",
            "NASDAQ",
            "OverviewNasdaqBrush",
            Color.FromRgb(244, 114, 182))
    ];

    public static IReadOnlyList<string> Symbols =>
        Definitions
            .SelectMany(definition => new[]
            {
                definition.Symbol,
                definition.FuturesSymbol
            })
            .ToArray();

    public static bool IsBuiltIn(string? symbol) =>
        !string.IsNullOrWhiteSpace(symbol)
        && Definitions.Any(definition =>
            string.Equals(
                definition.Symbol,
                symbol.Trim(),
                StringComparison.OrdinalIgnoreCase)
            || string.Equals(
                definition.FuturesSymbol,
                symbol.Trim(),
                StringComparison.OrdinalIgnoreCase));

    public static MarketIndexDefinition? FindBySymbol(string? symbol) =>
        string.IsNullOrWhiteSpace(symbol)
            ? null
            : Definitions.FirstOrDefault(definition =>
                string.Equals(
                    definition.Symbol,
                    symbol.Trim(),
                    StringComparison.OrdinalIgnoreCase)
                || string.Equals(
                    definition.FuturesSymbol,
                    symbol.Trim(),
                    StringComparison.OrdinalIgnoreCase));

    public static IReadOnlyList<string> CombineWithUserSymbols(
        IEnumerable<string>? userSymbols)
    {
        var normalized = SymbolRules.NormalizeList(userSymbols, out _)
            .Where(symbol => !IsBuiltIn(symbol));
        return Symbols.Concat(normalized).ToArray();
    }
}

public sealed class MarketOverviewState
{
    private readonly Dictionary<string, StockTickerState> _states =
        new(StringComparer.OrdinalIgnoreCase);

    public IReadOnlyList<StockTickerState> States =>
        MarketOverviewSymbols.Definitions
            .SelectMany(definition => new[]
            {
                _states[definition.Symbol],
                _states[definition.FuturesSymbol]
            })
            .ToArray();

    public void Reset()
    {
        _states.Clear();
        foreach (var definition in MarketOverviewSymbols.Definitions)
        {
            _states[definition.Symbol] = new StockTickerState(definition.Symbol);
            _states[definition.FuturesSymbol] =
                new StockTickerState(definition.FuturesSymbol);
        }
    }

    public bool Apply(QuoteTick tick) =>
        _states.TryGetValue(tick.Symbol, out var state) && state.Apply(tick);

    public StockTickerState Get(string symbol) =>
        _states[symbol];
}

public sealed record NormalizedMarketPoint(
    DateTimeOffset Timestamp,
    decimal PercentChange);

public static class MarketOverviewSeriesNormalizer
{
    public static IReadOnlyList<NormalizedMarketPoint> Normalize(
        StockTickerState state)
    {
        if (!state.HasDailyBaseline || state.DailyBaseline <= 0)
        {
            return [];
        }

        var regularPoints = state.IntradayPoints
            .Where(point => point.Session == MarketSession.Regular)
            .ToArray();
        var source = regularPoints.Length > 0
            ? regularPoints
            : state.IntradayPoints.ToArray();

        return source
            .Where(point => point.Price >= 0)
            .Select(point => new NormalizedMarketPoint(
                point.Timestamp,
                (point.Price - state.DailyBaseline) / state.DailyBaseline * 100m))
            .ToArray();
    }
}

public static class CompositeChartMath
{
    public static bool TryGetDomain(
        IEnumerable<IReadOnlyList<NormalizedMarketPoint>> series,
        out decimal minimum,
        out decimal maximum)
    {
        var values = series
            .SelectMany(points => points)
            .Select(point => point.PercentChange)
            .Append(0m)
            .ToArray();
        if (values.Length == 0)
        {
            minimum = 0;
            maximum = 0;
            return false;
        }

        minimum = values.Min();
        maximum = values.Max();
        if (minimum == maximum)
        {
            minimum -= 1m;
            maximum += 1m;
        }
        else
        {
            var padding = (maximum - minimum) * 0.08m;
            minimum -= padding;
            maximum += padding;
        }

        minimum = Math.Min(minimum, 0);
        maximum = Math.Max(maximum, 0);
        return true;
    }
}
