namespace FloatingStockTicker.Models;

public static class SymbolOrder
{
    public static bool TryMove(
        IList<string> symbols,
        string sourceSymbol,
        string targetSymbol)
    {
        ArgumentNullException.ThrowIfNull(symbols);

        var sourceIndex = FindIndex(symbols, sourceSymbol);
        var targetIndex = FindIndex(symbols, targetSymbol);
        if (sourceIndex < 0
            || targetIndex < 0
            || sourceIndex == targetIndex)
        {
            return false;
        }

        var symbol = symbols[sourceIndex];
        symbols.RemoveAt(sourceIndex);
        symbols.Insert(targetIndex, symbol);
        return true;
    }

    private static int FindIndex(
        IList<string> symbols,
        string symbol)
    {
        for (var index = 0; index < symbols.Count; index++)
        {
            if (string.Equals(
                    symbols[index],
                    symbol,
                    StringComparison.OrdinalIgnoreCase))
            {
                return index;
            }
        }

        return -1;
    }
}
