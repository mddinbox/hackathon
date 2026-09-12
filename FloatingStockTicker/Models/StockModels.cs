namespace FloatingStockTicker.Models;

public enum PriceDirection
{
    Flat,
    Up,
    Down
}

public sealed record IntradayPoint(
    DateTimeOffset Timestamp,
    decimal Price,
    MarketSession Session = MarketSession.Unknown);

public sealed record QuoteTick(
    string Symbol,
    decimal Price,
    DateTimeOffset Timestamp,
    IReadOnlyList<IntradayPoint>? IntradayPoints = null,
    decimal? PreviousClose = null,
    MarketSession Session = MarketSession.Unknown,
    decimal? ExtendedPrice = null,
    DateTimeOffset? ExtendedTimestamp = null,
    MarketSession ExtendedSession = MarketSession.Unknown);

public sealed class StockTickerState
{
    public StockTickerState(string symbol)
    {
        Reset(symbol);
    }

    public string Symbol { get; private set; } = string.Empty;

    public bool HasTrade { get; private set; }

    public bool HasDailyBaseline { get; private set; }

    public decimal CurrentPrice { get; private set; }

    public decimal DailyBaseline { get; private set; }

    public decimal DailyChange { get; private set; }

    public decimal DailyChangePercent { get; private set; }

    public PriceDirection DailyDirection { get; private set; } = PriceDirection.Flat;

    public PriceDirection IntradayTrendDirection { get; private set; } = PriceDirection.Flat;

    public PriceDirection ExtendedDirection { get; private set; } = PriceDirection.Flat;

    public MarketSession Session { get; private set; } = MarketSession.Unknown;

    public decimal? ExtendedPrice { get; private set; }

    public DateTimeOffset? ExtendedLastUpdate { get; private set; }

    public MarketSession ExtendedSession { get; private set; } = MarketSession.Unknown;

    public DateTimeOffset? LastUpdate { get; private set; }

    public IReadOnlyList<IntradayPoint> IntradayPoints { get; private set; } = [];

    public void Reset(string symbol)
    {
        Symbol = symbol.Trim().ToUpperInvariant();
        HasTrade = false;
        HasDailyBaseline = false;
        CurrentPrice = 0;
        DailyBaseline = 0;
        DailyChange = 0;
        DailyChangePercent = 0;
        DailyDirection = PriceDirection.Flat;
        IntradayTrendDirection = PriceDirection.Flat;
        ExtendedDirection = PriceDirection.Flat;
        Session = MarketSession.Unknown;
        ExtendedPrice = null;
        ExtendedLastUpdate = null;
        ExtendedSession = MarketSession.Unknown;
        LastUpdate = null;
        IntradayPoints = [];
    }

    public bool Apply(QuoteTick tick)
    {
        if (!string.Equals(Symbol, tick.Symbol, StringComparison.OrdinalIgnoreCase)
            || tick.Price < 0)
        {
            return false;
        }

        CurrentPrice = tick.Price;
        HasDailyBaseline = tick.PreviousClose is > 0;
        if (HasDailyBaseline)
        {
            DailyBaseline = tick.PreviousClose!.Value;
            DailyChange = CurrentPrice - DailyBaseline;
            try
            {
                DailyChangePercent = DailyChange / DailyBaseline * 100m;
            }
            catch (OverflowException)
            {
                HasDailyBaseline = false;
                DailyBaseline = 0;
                DailyChange = 0;
                DailyChangePercent = 0;
            }
        }
        else
        {
            DailyBaseline = 0;
            DailyChange = 0;
            DailyChangePercent = 0;
        }

        HasTrade = true;
        DailyDirection = HasDailyBaseline
            ? PriceDirectionRules.CompareDaily(
                DailyBaseline,
                CurrentPrice)
            : PriceDirection.Flat;
        Session = tick.Session;
        LastUpdate = tick.Timestamp.ToLocalTime();
        ExtendedPrice = tick.ExtendedPrice;
        ExtendedLastUpdate = tick.ExtendedTimestamp?.ToLocalTime();
        ExtendedSession = tick.ExtendedSession;
        ExtendedDirection = ExtendedPrice is { } extendedPrice
            ? PriceDirectionRules.CompareExtended(
                CurrentPrice,
                extendedPrice)
            : PriceDirection.Flat;
        IntradayPoints = IntradaySeries.Clean(tick.IntradayPoints);
        if (IntradayPoints.Count > 0)
        {
            IntradayTrendDirection = PriceDirectionRules.CompareIntradayTrend(
                IntradayPoints[0].Price,
                IntradayPoints[^1].Price);
        }
        else
        {
            IntradayTrendDirection = PriceDirection.Flat;
        }

        return true;
    }
}

public sealed class TickerCollectionState
{
    private readonly Dictionary<string, StockTickerState> _states =
        new(StringComparer.OrdinalIgnoreCase);

    public IReadOnlyCollection<StockTickerState> States => _states.Values;

    public void Reset(IEnumerable<string> symbols)
    {
        _states.Clear();
        foreach (var symbol in symbols)
        {
            if (SymbolRules.TryNormalize(symbol, out var normalized, out _)
                && !MarketOverviewSymbols.IsBuiltIn(normalized))
            {
                _states[normalized] = new StockTickerState(normalized);
            }
        }
    }

    public void SetSymbols(IEnumerable<string> symbols)
    {
        var normalizedSymbols = SymbolRules.NormalizeList(symbols, out _)
            .Where(symbol => !MarketOverviewSymbols.IsBuiltIn(symbol))
            .ToList();
        var requested = new HashSet<string>(normalizedSymbols, StringComparer.OrdinalIgnoreCase);

        foreach (var existing in _states.Keys.Where(key => !requested.Contains(key)).ToArray())
        {
            _states.Remove(existing);
        }

        foreach (var symbol in normalizedSymbols)
        {
            if (!_states.ContainsKey(symbol))
            {
                _states[symbol] = new StockTickerState(symbol);
            }
        }
    }

    public bool Apply(QuoteTick tick)
    {
        return _states.TryGetValue(tick.Symbol, out var state) && state.Apply(tick);
    }

    public StockTickerState? Get(string symbol)
    {
        return _states.TryGetValue(symbol, out var state) ? state : null;
    }
}
