using System.Windows;
using System.Windows.Media;
using FloatingStockTicker.Models;

namespace FloatingStockTicker.Controls;

public sealed class CompositeSparklineControl : FrameworkElement
{
    private static readonly Brush DefaultReferenceStroke =
        Application.Current?.TryFindResource("SparklineReferenceBrush") as Brush
        ?? CreateBrush(Color.FromRgb(214, 222, 230));

    public static readonly DependencyProperty SeriesProperty =
        DependencyProperty.Register(
            nameof(Series),
            typeof(IReadOnlyList<MarketOverviewChartSeries>),
            typeof(CompositeSparklineControl),
            new FrameworkPropertyMetadata(
                Array.Empty<MarketOverviewChartSeries>(),
                FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty ReferenceStrokeProperty =
        DependencyProperty.Register(
            nameof(ReferenceStroke),
            typeof(Brush),
            typeof(CompositeSparklineControl),
            new FrameworkPropertyMetadata(
                DefaultReferenceStroke,
                FrameworkPropertyMetadataOptions.AffectsRender));

    public IReadOnlyList<MarketOverviewChartSeries>? Series
    {
        get => (IReadOnlyList<MarketOverviewChartSeries>?)GetValue(SeriesProperty);
        set => SetValue(SeriesProperty, value);
    }

    public Brush? ReferenceStroke
    {
        get => (Brush?)GetValue(ReferenceStrokeProperty);
        set => SetValue(ReferenceStrokeProperty, value);
    }

    public static Pen CreateSeriesPen(Brush stroke)
    {
        ArgumentNullException.ThrowIfNull(stroke);
        var pen = new Pen(stroke, SparklineMetrics.SeriesStrokeThickness)
        {
            LineJoin = PenLineJoin.Round,
            StartLineCap = PenLineCap.Round,
            EndLineCap = PenLineCap.Round
        };
        pen.Freeze();
        return pen;
    }

    public static Pen CreateReferencePen(Brush stroke)
    {
        ArgumentNullException.ThrowIfNull(stroke);
        var pen = new Pen(stroke, SparklineMetrics.ReferenceStrokeThickness)
        {
            StartLineCap = PenLineCap.Flat,
            EndLineCap = PenLineCap.Flat
        };
        pen.Freeze();
        return pen;
    }

    protected override void OnRender(DrawingContext drawingContext)
    {
        base.OnRender(drawingContext);

        const double padding = 3;
        var series = Series?
            .Where(item => item.Points.Count > 0)
            .ToArray() ?? [];
        if (series.Length == 0
            || ActualWidth <= padding * 2
            || ActualHeight <= padding * 2)
        {
            return;
        }

        var allPoints = series.SelectMany(item => item.Points).ToArray();
        if (!CompositeChartMath.TryGetDomain(
                series.Select(item => item.Points),
                out var minimum,
                out var maximum))
        {
            return;
        }

        var minTimestamp = allPoints.Min(point => point.Timestamp);
        var maxTimestamp = allPoints.Max(point => point.Timestamp);
        var referenceY = ToY(0, minimum, maximum, ActualHeight - padding * 2) + padding;
        var referencePen = CreateReferencePen(
            ReferenceStroke ?? DefaultReferenceStroke);
        drawingContext.DrawLine(
            referencePen,
            new Point(padding, referenceY),
            new Point(ActualWidth - padding, referenceY));

        foreach (var item in series)
        {
            DrawSeries(
                drawingContext,
                item,
                minTimestamp,
                maxTimestamp,
                minimum,
                maximum,
                padding);
        }
    }

    private void DrawSeries(
        DrawingContext drawingContext,
        MarketOverviewChartSeries series,
        DateTimeOffset minTimestamp,
        DateTimeOffset maxTimestamp,
        decimal minimum,
        decimal maximum,
        double padding)
    {
        var points = series.Points;
        if (points.Count == 1)
        {
            var point = ToPoint(
                points[0],
                minTimestamp,
                maxTimestamp,
                minimum,
                maximum,
                padding);
            drawingContext.DrawEllipse(series.Stroke, null, point, 2.2, 2.2);
            return;
        }

        var pen = CreateSeriesPen(series.Stroke);
        var geometry = new StreamGeometry();
        using (var context = geometry.Open())
        {
            context.BeginFigure(
                ToPoint(
                    points[0],
                    minTimestamp,
                    maxTimestamp,
                    minimum,
                    maximum,
                    padding),
                false,
                false);
            for (var index = 1; index < points.Count; index++)
            {
                context.LineTo(
                    ToPoint(
                        points[index],
                        minTimestamp,
                        maxTimestamp,
                        minimum,
                        maximum,
                        padding),
                    true,
                    false);
            }
        }

        geometry.Freeze();
        drawingContext.DrawGeometry(null, pen, geometry);
    }

    private Point ToPoint(
        NormalizedMarketPoint point,
        DateTimeOffset minTimestamp,
        DateTimeOffset maxTimestamp,
        decimal minimum,
        decimal maximum,
        double padding)
    {
        var totalSeconds = (maxTimestamp - minTimestamp).TotalSeconds;
        var xRatio = totalSeconds <= 0
            ? 0.5
            : (point.Timestamp - minTimestamp).TotalSeconds / totalSeconds;
        var x = padding + Math.Clamp(xRatio, 0, 1) * (ActualWidth - padding * 2);
        var y = ToY(
            point.PercentChange,
            minimum,
            maximum,
            ActualHeight - padding * 2) + padding;
        return new Point(x, y);
    }

    private static double ToY(
        decimal value,
        decimal minimum,
        decimal maximum,
        double height)
    {
        var ratio = (double)((value - minimum) / (maximum - minimum));
        return height - Math.Clamp(ratio, 0, 1) * height;
    }

    private static Brush CreateBrush(Color color)
    {
        var brush = new SolidColorBrush(color);
        brush.Freeze();
        return brush;
    }
}
