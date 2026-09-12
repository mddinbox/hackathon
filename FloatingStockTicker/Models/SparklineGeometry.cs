namespace FloatingStockTicker.Models;

public readonly record struct SparklinePoint(double X, double Y);

public static class SparklineGeometry
{
    public static IReadOnlyList<SparklinePoint> Normalize(
        IReadOnlyList<decimal>? values,
        double width,
        double height,
        decimal? referenceValue = null)
    {
        if (values is null
            || values.Count == 0
            || !double.IsFinite(width)
            || !double.IsFinite(height)
            || width <= 0
            || height <= 0)
        {
            return [];
        }

        var finiteValues = values
            .Select(value => (double)value)
            .Where(double.IsFinite)
            .ToArray();
        if (finiteValues.Length == 0)
        {
            return [];
        }

        var domainValues = finiteValues.ToList();
        if (referenceValue is > 0
            && double.IsFinite((double)referenceValue.Value))
        {
            domainValues.Add((double)referenceValue.Value);
        }

        var minimum = domainValues.Min();
        var maximum = domainValues.Max();
        var range = maximum - minimum;
        var isFlat = !double.IsFinite(range) || range <= double.Epsilon;
        var points = new SparklinePoint[finiteValues.Length];

        for (var index = 0; index < finiteValues.Length; index++)
        {
            var x = finiteValues.Length == 1
                ? width / 2
                : index * width / (finiteValues.Length - 1);
            var y = isFlat
                ? height / 2
                : height - ((finiteValues[index] - minimum) / range * height);
            if (!double.IsFinite(y))
            {
                y = height / 2;
            }

            points[index] = new SparklinePoint(
                Math.Clamp(x, 0, width),
                Math.Clamp(y, 0, height));
        }

        return points;
    }

    public static bool TryNormalizeReference(
        IReadOnlyList<decimal>? values,
        decimal? referenceValue,
        double height,
        out double y)
    {
        y = 0;
        if (referenceValue is not > 0
            || !double.IsFinite(height)
            || height <= 0
            || !double.IsFinite((double)referenceValue.Value))
        {
            return false;
        }

        var finiteValues = values?
            .Select(value => (double)value)
            .Where(double.IsFinite)
            .ToArray()
            ?? [];
        var domainValues = finiteValues.ToList();
        domainValues.Add((double)referenceValue.Value);
        var minimum = domainValues.Min();
        var maximum = domainValues.Max();
        var range = maximum - minimum;
        y = !double.IsFinite(range) || range <= double.Epsilon
            ? height / 2
            : height - (((double)referenceValue.Value - minimum) / range * height);
        if (!double.IsFinite(y))
        {
            y = height / 2;
        }

        y = Math.Clamp(y, 0, height);
        return true;
    }
}
