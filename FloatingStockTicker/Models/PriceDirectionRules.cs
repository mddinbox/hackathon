namespace FloatingStockTicker.Models;

public static class PriceDirectionRules
{
    // A half-cent move is treated as flat because the widget displays prices to two decimals.
    public const decimal FlatTolerance = 0.005m;

    public static PriceDirection CompareDaily(decimal previousClose, decimal currentPrice) =>
        Compare(previousClose, currentPrice);

    public static PriceDirection CompareExtended(
        decimal regularPrice,
        decimal extendedPrice) =>
        Compare(regularPrice, extendedPrice);

    public static PriceDirection CompareIntradayTrend(
        decimal firstClose,
        decimal latestClose) =>
        Compare(firstClose, latestClose);

    private static PriceDirection Compare(decimal first, decimal last)
    {
        var difference = last - first;
        return difference > FlatTolerance
            ? PriceDirection.Up
            : difference < -FlatTolerance
                ? PriceDirection.Down
                : PriceDirection.Flat;
    }
}
