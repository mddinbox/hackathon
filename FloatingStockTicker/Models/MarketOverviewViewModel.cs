using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Media;

namespace FloatingStockTicker.Models;

public sealed class MarketOverviewIndexViewModel : INotifyPropertyChanged
{
    private static readonly Brush FlatBrush = ThemeBrush(
        "FlatBrush",
        Color.FromRgb(184, 195, 206));
    private readonly MarketIndexDefinition _definition;
    private string _cashTooltip = string.Empty;
    private string _futuresTooltip = string.Empty;

    public MarketOverviewIndexViewModel(MarketIndexDefinition definition)
    {
        _definition = definition;
        SeriesBrush = ThemeBrush(
            definition.SeriesBrushKey,
            definition.FallbackColor);
        Reset();
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    public string Symbol => _definition.Symbol;

    public string FuturesSymbol => _definition.FuturesSymbol;

    public string Label => _definition.Label;

    public Brush SeriesBrush { get; }

    public string PriceText { get; private set; } = "—";

    public string ChangeText { get; private set; } = "• Unavailable";

    public Brush DirectionBrush { get; private set; } = FlatBrush;

    public string FuturesPriceText { get; private set; } = "--";

    public string FuturesChangeText { get; private set; } = string.Empty;

    public Brush FuturesDirectionBrush { get; private set; } = FlatBrush;

    public Visibility FuturesVisibility { get; private set; } =
        Visibility.Collapsed;

    public SessionIconKind CashSessionIconKind => SessionIconKind.Regular;

    public string CashSessionIconName => "Cash index";

    public SessionIconKind FuturesSessionIconKind => SessionIconKind.Overnight;

    public string FuturesSessionIconName => "Index futures";

    public string ErrorText { get; private set; } = string.Empty;

    public Visibility ErrorVisibility { get; private set; } = Visibility.Collapsed;

    public string TooltipText { get; private set; } = "Unavailable";

    public IReadOnlyList<NormalizedMarketPoint> SeriesPoints { get; private set; } = [];

    public void Reset()
    {
        PriceText = "—";
        ChangeText = "• Unavailable";
        DirectionBrush = FlatBrush;
        FuturesPriceText = "--";
        FuturesChangeText = string.Empty;
        FuturesDirectionBrush = FlatBrush;
        FuturesVisibility = Visibility.Collapsed;
        ErrorText = string.Empty;
        ErrorVisibility = Visibility.Collapsed;
        _cashTooltip = "Cash index unavailable";
        _futuresTooltip = "Futures unavailable";
        RefreshTooltip();
        SeriesPoints = [];
        NotifyAll();
    }

    public void ApplyCash(StockTickerState state)
    {
        PriceText = state.HasTrade ? state.CurrentPrice.ToString("N2") : "—";
        ChangeText = state.HasTrade && state.HasDailyBaseline
            ? PriceDisplayFormatting.FormatDirectionalChange(
                state.DailyChange,
                state.DailyChangePercent,
                state.DailyDirection)
            : "• Unavailable";
        DirectionBrush = DirectionBrushFor(state.DailyDirection, state.HasTrade && state.HasDailyBaseline);
        FuturesVisibility = state.Session == MarketSession.Regular
            ? Visibility.Collapsed
            : Visibility.Visible;
        ErrorText = string.Empty;
        ErrorVisibility = Visibility.Collapsed;
        SeriesPoints = MarketOverviewSeriesNormalizer.Normalize(state);
        _cashTooltip = state.HasTrade && state.HasDailyBaseline
            ? $"Cash index {state.CurrentPrice:N2} · {ChangeText}"
            : "Cash index unavailable";
        RefreshTooltip();
        NotifyAll();
    }

    public void ApplyFutures(StockTickerState state)
    {
        FuturesPriceText = state.HasTrade
            ? state.CurrentPrice.ToString("N2")
            : "--";
        FuturesChangeText = state.HasTrade && state.HasDailyBaseline
            ? PriceDisplayFormatting.FormatDirectionalChange(
                state.DailyChange,
                state.DailyChangePercent,
                state.DailyDirection)
            : string.Empty;
        FuturesDirectionBrush = DirectionBrushFor(
            state.DailyDirection,
            state.HasTrade && state.HasDailyBaseline);
        _futuresTooltip = state.HasTrade && state.HasDailyBaseline
            ? $"Futures {state.CurrentPrice:N2} · {FuturesChangeText}"
            : "Futures unavailable";
        RefreshTooltip();
        NotifyAll();
    }

    public void SetCashError(string message)
    {
        ErrorText = message;
        ErrorVisibility = string.IsNullOrWhiteSpace(message)
            ? Visibility.Collapsed
            : Visibility.Visible;
        if (!string.IsNullOrWhiteSpace(message))
        {
            _cashTooltip = $"Cash index unavailable · {message}";
        }
        RefreshTooltip();
        Notify(nameof(ErrorText));
        Notify(nameof(ErrorVisibility));
        Notify(nameof(TooltipText));
    }

    public void SetFuturesError(string message)
    {
        FuturesPriceText = "--";
        FuturesChangeText = string.Empty;
        FuturesDirectionBrush = FlatBrush;
        _futuresTooltip = string.IsNullOrWhiteSpace(message)
            ? "Futures unavailable"
            : $"Futures unavailable · {message}";
        RefreshTooltip();
        Notify(nameof(FuturesPriceText));
        Notify(nameof(FuturesChangeText));
        Notify(nameof(FuturesDirectionBrush));
        Notify(nameof(TooltipText));
    }

    private void RefreshTooltip()
    {
        TooltipText = $"{Label}: {_cashTooltip} · {_futuresTooltip}";
    }

    private void NotifyAll()
    {
        Notify(nameof(PriceText));
        Notify(nameof(ChangeText));
        Notify(nameof(DirectionBrush));
        Notify(nameof(FuturesPriceText));
        Notify(nameof(FuturesChangeText));
        Notify(nameof(FuturesDirectionBrush));
        Notify(nameof(FuturesVisibility));
        Notify(nameof(CashSessionIconKind));
        Notify(nameof(CashSessionIconName));
        Notify(nameof(FuturesSessionIconKind));
        Notify(nameof(FuturesSessionIconName));
        Notify(nameof(ErrorText));
        Notify(nameof(ErrorVisibility));
        Notify(nameof(TooltipText));
        Notify(nameof(SeriesPoints));
    }

    private void Notify([CallerMemberName] string? propertyName = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));

    private static Brush DirectionBrushFor(
        PriceDirection direction,
        bool hasBaseline) =>
        !hasBaseline
            ? FlatBrush
            : direction switch
            {
                PriceDirection.Up => ThemeBrush(
                    "PositiveBrush",
                    Color.FromRgb(80, 211, 148)),
                PriceDirection.Down => ThemeBrush(
                    "NegativeBrush",
                    Color.FromRgb(242, 123, 131)),
                _ => FlatBrush
            };

    private static Brush ThemeBrush(string key, Color fallbackColor)
    {
        if (Application.Current?.TryFindResource(key) is Brush brush)
        {
            return brush;
        }

        var fallback = new SolidColorBrush(fallbackColor);
        fallback.Freeze();
        return fallback;
    }

}

public sealed record MarketOverviewChartSeries(
    string Label,
    IReadOnlyList<NormalizedMarketPoint> Points,
    Brush Stroke);

public sealed class MarketOverviewViewModel : INotifyPropertyChanged
{
    private readonly MarketOverviewState _state = new();

    public MarketOverviewViewModel()
    {
        _state.Reset();
        foreach (var definition in MarketOverviewSymbols.Definitions)
        {
            IndexCards.Add(new MarketOverviewIndexViewModel(definition));
        }
        RefreshCards();
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    public ObservableCollection<MarketOverviewIndexViewModel> IndexCards { get; } = [];

    public IReadOnlyList<MarketOverviewChartSeries> ChartSeries =>
        IndexCards
            .Where(card => card.SeriesPoints.Count > 0)
            .Select(card => new MarketOverviewChartSeries(
                card.Label,
                card.SeriesPoints,
                card.SeriesBrush))
            .ToArray();

    public string OverviewTooltipText =>
        string.Join(" · ", IndexCards.Select(card => card.TooltipText));

    public void Reset()
    {
        _state.Reset();
        foreach (var card in IndexCards)
        {
            card.Reset();
        }
        NotifyOverview();
    }

    public bool Apply(QuoteTick tick)
    {
        if (!_state.Apply(tick))
        {
            return false;
        }

        var definition = MarketOverviewSymbols.FindBySymbol(tick.Symbol);
        var card = definition is null
            ? null
            : IndexCards.FirstOrDefault(item =>
                string.Equals(
                    item.Symbol,
                    definition.Symbol,
                    StringComparison.OrdinalIgnoreCase));
        if (card is null)
        {
            return false;
        }

        if (string.Equals(
                tick.Symbol,
                card.FuturesSymbol,
                StringComparison.OrdinalIgnoreCase))
        {
            card.ApplyFutures(_state.Get(tick.Symbol));
        }
        else
        {
            card.ApplyCash(_state.Get(tick.Symbol));
        }
        NotifyOverview();
        return true;
    }

    public bool SetError(string symbol, string message)
    {
        var definition = MarketOverviewSymbols.FindBySymbol(symbol);
        var card = definition is null
            ? null
            : IndexCards.FirstOrDefault(item =>
                string.Equals(
                    item.Symbol,
                    definition.Symbol,
                    StringComparison.OrdinalIgnoreCase));
        if (card is null)
        {
            return false;
        }

        if (string.Equals(
                symbol,
                card.FuturesSymbol,
                StringComparison.OrdinalIgnoreCase))
        {
            card.SetFuturesError(message);
        }
        else
        {
            card.SetCashError(message);
        }
        NotifyOverview();
        return true;
    }

    private void RefreshCards()
    {
        foreach (var card in IndexCards)
        {
            card.ApplyCash(_state.Get(card.Symbol));
            card.ApplyFutures(_state.Get(card.FuturesSymbol));
        }
        NotifyOverview();
    }

    private void NotifyOverview()
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(ChartSeries)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(OverviewTooltipText)));
    }
}
