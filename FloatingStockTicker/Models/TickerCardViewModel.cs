using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Media;

namespace FloatingStockTicker.Models;

public sealed class TickerCardViewModel : INotifyPropertyChanged
{
    private static readonly Brush FlatBrush = ThemeBrush(
        "FlatBrush",
        Color.FromRgb(184, 195, 206));
    private static readonly Brush UpBrush = ThemeBrush(
        "PositiveBrush",
        Color.FromRgb(80, 211, 148));
    private static readonly Brush DownBrush = ThemeBrush(
        "NegativeBrush",
        Color.FromRgb(242, 123, 131));

    public TickerCardViewModel(string symbol)
    {
        Symbol = symbol;
        Reset();
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    public string Symbol { get; }

    public string PriceText { get; private set; } = "—";

    public string ChangeText { get; private set; } = "• Waiting for quote";

    public string ExtendedText { get; private set; } = string.Empty;

    public string ExtendedPriceText { get; private set; } = string.Empty;

    public string ExtendedChangeText { get; private set; } = string.Empty;

    public Visibility ExtendedVisibility { get; private set; } = Visibility.Collapsed;

    public string ErrorText { get; private set; } = string.Empty;

    public Visibility ErrorVisibility { get; private set; } = Visibility.Collapsed;

    public IReadOnlyList<decimal> ChartValues { get; private set; } = [];

    public decimal? PreviousCloseReference { get; private set; }

    public double? PostMarketDividerFraction { get; private set; }

    public string ChartTooltipText { get; private set; } = "No intraday chart data";

    public Brush DailyDirectionBrush { get; private set; } = FlatBrush;

    public Brush ExtendedDirectionBrush { get; private set; } = FlatBrush;

    public SessionIconKind RegularSessionIconKind => SessionIconKind.Regular;

    public string RegularSessionIconName =>
        RegularSessionIconKind.AccessibleName();

    public SessionIconKind ExtendedSessionIconKind { get; private set; } =
        SessionIconKind.AfterHours;

    public string ExtendedSessionIconName =>
        ExtendedSessionIconKind.AccessibleName();

    public void Reset()
    {
        PriceText = "—";
        ChangeText = "• Waiting for quote";
        ExtendedText = string.Empty;
        ExtendedPriceText = string.Empty;
        ExtendedChangeText = string.Empty;
        ExtendedVisibility = Visibility.Collapsed;
        ErrorText = string.Empty;
        ErrorVisibility = Visibility.Collapsed;
        ChartValues = [];
        PreviousCloseReference = null;
        PostMarketDividerFraction = null;
        ChartTooltipText = "No intraday chart data";
        DailyDirectionBrush = FlatBrush;
        ExtendedDirectionBrush = FlatBrush;
        ExtendedSessionIconKind = SessionIconKind.AfterHours;
        NotifyAll();
    }

    public void Apply(StockTickerState state)
    {
        PriceText = state.HasTrade ? state.CurrentPrice.ToString("N2") : "—";
        ChangeText = !state.HasTrade
            ? "• Waiting for quote"
            : !state.HasDailyBaseline
                ? "• Change unavailable"
                : PriceDisplayFormatting.FormatDirectionalChange(
                    state.DailyChange,
                    state.DailyChangePercent,
                    state.DailyDirection);
        if (state.ExtendedPrice is { } extendedPrice
            && ShouldShowExtendedQuote(state))
        {
            ExtendedSessionIconKind = state.ExtendedSession switch
            {
                MarketSession.PreMarket => SessionIconKind.PreMarket,
                MarketSession.Overnight => SessionIconKind.Overnight,
                _ => SessionIconKind.AfterHours
            };
            var extendedChange = extendedPrice - state.CurrentPrice;
            var extendedPercent = state.CurrentPrice == 0
                ? 0
                : extendedChange / state.CurrentPrice * 100m;
            ExtendedPriceText = extendedPrice.ToString("N2");
            ExtendedChangeText = PriceDisplayFormatting.FormatDirectionalChange(
                extendedChange,
                extendedPercent,
                state.ExtendedDirection);
            ExtendedText = $"{ExtendedPriceText}  {ExtendedChangeText}";
            ExtendedVisibility = Visibility.Visible;
        }
        else
        {
            ExtendedText = string.Empty;
            ExtendedPriceText = string.Empty;
            ExtendedChangeText = string.Empty;
            ExtendedVisibility = Visibility.Collapsed;
            ExtendedSessionIconKind = SessionIconKind.AfterHours;
        }
        ErrorText = string.Empty;
        ErrorVisibility = Visibility.Collapsed;
        ChartValues = state.IntradayPoints.Select(point => point.Price).ToArray();
        var firstPostMarketIndex = state.IntradayPoints
            .Select((point, index) => (point, index))
            .FirstOrDefault(item => item.point.Session == MarketSession.AfterHours)
            .index;
        PostMarketDividerFraction =
            state.IntradayPoints.Count > 1
            && firstPostMarketIndex > 0
                ? (firstPostMarketIndex - 0.5)
                    / (state.IntradayPoints.Count - 1d)
                : null;
        PreviousCloseReference = state.HasDailyBaseline
            ? state.DailyBaseline
            : null;
        var tooltipParts = new List<string>();
        if (state.HasTrade)
        {
            tooltipParts.Add(
                $"Session: {FormatSession(state.Session)} · latest quote {FormatTimestamp(state.LastUpdate)}");
            tooltipParts.Add($"Regular price: {state.CurrentPrice:N2}");
        }

        if (state.ExtendedPrice is { } tooltipExtendedPrice
            && state.ExtendedLastUpdate is { } extendedTimestamp
            && ShouldShowExtendedQuote(state))
        {
            var extendedLabel = state.ExtendedSession == MarketSession.Overnight
                ? "Overnight price"
                : "Extended price";
            tooltipParts.Add(
                $"{extendedLabel}: {tooltipExtendedPrice:N2} · latest {FormatTimestamp(extendedTimestamp)}");
        }

        if (PreviousCloseReference is { } previousClose)
        {
            tooltipParts.Add($"Previous close: {previousClose:N2}");
        }

        if (state.IntradayPoints.Count > 0)
        {
            tooltipParts.Add(
                $"Day low {state.IntradayPoints.Min(point => point.Price):N2} · high {state.IntradayPoints.Max(point => point.Price):N2} (extended hours included)");
        }
        if (PostMarketDividerFraction is not null)
        {
            tooltipParts.Add("Vertical divider marks regular market close");
        }

        ChartTooltipText = tooltipParts.Count == 0
            ? "No intraday chart data"
            : string.Join(" · ", tooltipParts);
        DailyDirectionBrush = DirectionBrushFor(state.DailyDirection);
        ExtendedDirectionBrush = DirectionBrushFor(state.ExtendedDirection);
        NotifyAll();
    }

    public void SetError(string message)
    {
        ErrorText = message;
        ErrorVisibility = string.IsNullOrWhiteSpace(message)
            ? Visibility.Collapsed
            : Visibility.Visible;
        Notify(nameof(ErrorText));
        Notify(nameof(ErrorVisibility));
    }

    private void NotifyAll()
    {
        Notify(nameof(PriceText));
        Notify(nameof(ChangeText));
        Notify(nameof(ExtendedText));
        Notify(nameof(ExtendedPriceText));
        Notify(nameof(ExtendedChangeText));
        Notify(nameof(ExtendedVisibility));
        Notify(nameof(RegularSessionIconKind));
        Notify(nameof(RegularSessionIconName));
        Notify(nameof(ExtendedSessionIconKind));
        Notify(nameof(ExtendedSessionIconName));
        Notify(nameof(ErrorText));
        Notify(nameof(ErrorVisibility));
        Notify(nameof(ChartValues));
        Notify(nameof(PreviousCloseReference));
        Notify(nameof(PostMarketDividerFraction));
        Notify(nameof(ChartTooltipText));
        Notify(nameof(DailyDirectionBrush));
        Notify(nameof(ExtendedDirectionBrush));
    }

    private void Notify([CallerMemberName] string? propertyName = null)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }

    private static string FormatSession(MarketSession session) => session switch
    {
        MarketSession.PreMarket => "Pre-market",
        MarketSession.Regular => "Regular",
        MarketSession.AfterHours => "After-hours",
        MarketSession.Overnight => "Overnight",
        MarketSession.Closed => "Closed",
        _ => "Unknown"
    };

    private static bool IsExtendedSession(MarketSession session) =>
        session is MarketSession.PreMarket
            or MarketSession.AfterHours
            or MarketSession.Overnight;

    private static bool ShouldShowExtendedQuote(StockTickerState state) =>
        IsExtendedSession(state.ExtendedSession)
        && state.ExtendedSession switch
        {
            MarketSession.PreMarket =>
                state.Session == MarketSession.PreMarket,
            MarketSession.AfterHours =>
                state.Session is MarketSession.AfterHours
                    or MarketSession.Closed,
            MarketSession.Overnight =>
                state.Session is MarketSession.Overnight
                    or MarketSession.Closed,
            _ => false
        };

    private static string FormatTimestamp(DateTimeOffset? timestamp) =>
        timestamp is { } value
            ? value.ToString("h:mm:ss tt")
            : "—";

    private static Brush DirectionBrushFor(PriceDirection direction) => direction switch
    {
        PriceDirection.Up => UpBrush,
        PriceDirection.Down => DownBrush,
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
