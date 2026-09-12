namespace FloatingStockTicker.Models;

public static class PriceDisplayFormatting
{
    public static string DirectionGlyph(PriceDirection direction) => direction switch
    {
        PriceDirection.Up => "▲",
        PriceDirection.Down => "▼",
        _ => "•"
    };

    public static string FormatChange(decimal change, PriceDirection direction) =>
        direction == PriceDirection.Flat
            ? "0.00"
            : change switch
        {
            > 0 => $"+{change:N2}",
            < 0 => change.ToString("N2"),
            _ => "0.00"
        };

    public static string FormatPercent(decimal percent, PriceDirection direction) =>
        direction == PriceDirection.Flat
            ? "0.00%"
            : percent switch
        {
            > 0 => $"+{percent:N2}%",
            < 0 => $"{percent:N2}%",
            _ => "0.00%"
        };

    public static string FormatDirectionalChange(
        decimal change,
        decimal percent,
        PriceDirection direction) =>
        $"{DirectionGlyph(direction)} {FormatChange(change, direction)} " +
        $"({FormatPercent(percent, direction)})";
}
