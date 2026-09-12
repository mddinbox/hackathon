namespace FloatingStockTicker.Models;

public static class IntradaySeries
{
    public static IReadOnlyList<IntradayPoint> Clean(
        IEnumerable<IntradayPoint>? points)
    {
        if (points is null)
        {
            return [];
        }

        var byTimestamp = new Dictionary<DateTimeOffset, IntradayPoint>();
        foreach (var point in points)
        {
            if (point.Price < 0)
            {
                continue;
            }

            // Duplicate timestamps use the last valid value from the source.
            byTimestamp[point.Timestamp] = point;
        }

        return byTimestamp
            .OrderBy(pair => pair.Key)
            .Select(pair => pair.Value)
            .ToArray();
    }
}
