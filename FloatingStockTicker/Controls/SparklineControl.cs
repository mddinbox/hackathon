using System.Globalization;
using System.Windows;
using System.Windows.Media;
using FloatingStockTicker.Models;

namespace FloatingStockTicker.Controls;

public sealed class SparklineControl : FrameworkElement
{
    private static readonly Brush DefaultStroke =
        Application.Current?.TryFindResource("FlatBrush") as Brush
        ?? CreateBrush(Color.FromRgb(184, 195, 206));
    private static readonly Brush DefaultReferenceStroke =
        Application.Current?.TryFindResource("SparklineReferenceBrush") as Brush
        ?? CreateBrush(Color.FromRgb(214, 222, 230));
    private static readonly Brush DefaultSessionDividerStroke =
        Application.Current?.TryFindResource("SparklineSessionDividerBrush") as Brush
        ?? CreateBrush(Color.FromArgb(72, 214, 222, 230));

    public static readonly DependencyProperty ValuesProperty =
        DependencyProperty.Register(
            nameof(Values),
            typeof(IReadOnlyList<decimal>),
            typeof(SparklineControl),
            new FrameworkPropertyMetadata(
                Array.Empty<decimal>(),
                FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty StrokeProperty =
        DependencyProperty.Register(
            nameof(Stroke),
            typeof(Brush),
            typeof(SparklineControl),
            new FrameworkPropertyMetadata(
                DefaultStroke,
                FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty ReferenceStrokeProperty =
        DependencyProperty.Register(
            nameof(ReferenceStroke),
            typeof(Brush),
            typeof(SparklineControl),
            new FrameworkPropertyMetadata(
                DefaultReferenceStroke,
                FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty StrokeThicknessProperty =
        DependencyProperty.Register(
            nameof(StrokeThickness),
            typeof(double),
            typeof(SparklineControl),
            new FrameworkPropertyMetadata(
                SparklineMetrics.SeriesStrokeThickness,
                FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty SessionDividerPositionProperty =
        DependencyProperty.Register(
            nameof(SessionDividerPosition),
            typeof(double?),
            typeof(SparklineControl),
            new FrameworkPropertyMetadata(
                null,
                FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty SessionDividerStrokeProperty =
        DependencyProperty.Register(
            nameof(SessionDividerStroke),
            typeof(Brush),
            typeof(SparklineControl),
            new FrameworkPropertyMetadata(
                DefaultSessionDividerStroke,
                FrameworkPropertyMetadataOptions.AffectsRender));

    public IReadOnlyList<decimal>? Values
    {
        get => (IReadOnlyList<decimal>?)GetValue(ValuesProperty);
        set => SetValue(ValuesProperty, value);
    }

    public Brush? Stroke
    {
        get => (Brush?)GetValue(StrokeProperty);
        set => SetValue(StrokeProperty, value);
    }

    public Brush? ReferenceStroke
    {
        get => (Brush?)GetValue(ReferenceStrokeProperty);
        set => SetValue(ReferenceStrokeProperty, value);
    }

    public double StrokeThickness
    {
        get => (double)GetValue(StrokeThicknessProperty);
        set => SetValue(StrokeThicknessProperty, value);
    }

    public double? SessionDividerPosition
    {
        get => (double?)GetValue(SessionDividerPositionProperty);
        set => SetValue(SessionDividerPositionProperty, value);
    }

    public Brush? SessionDividerStroke
    {
        get => (Brush?)GetValue(SessionDividerStrokeProperty);
        set => SetValue(SessionDividerStrokeProperty, value);
    }

    protected override void OnRender(DrawingContext drawingContext)
    {
        base.OnRender(drawingContext);

        const double padding = 2;
        var points = SparklineGeometry.Normalize(
            Values,
            ActualWidth - padding * 2,
            ActualHeight - padding * 2,
            PreviousCloseReference);
        var hasReference = SparklineGeometry.TryNormalizeReference(
            Values,
            PreviousCloseReference,
            ActualHeight - padding * 2,
            out var referenceY);
        if (hasReference)
        {
            var referencePen = new Pen(ReferenceStroke ?? DefaultReferenceStroke, 1)
            {
                DashStyle = DashStyles.Dash,
                StartLineCap = PenLineCap.Flat,
                EndLineCap = PenLineCap.Flat
            };
            referencePen.Freeze();
            drawingContext.DrawLine(
                referencePen,
                new Point(padding, referenceY + padding),
                new Point(ActualWidth - padding, referenceY + padding));
            DrawReferenceMarker(
                drawingContext,
                referenceY + padding,
                ReferenceStroke ?? DefaultReferenceStroke);
        }

        DrawSessionDivider(drawingContext, padding);

        if (points.Count == 0)
        {
            return;
        }

        var brush = Stroke ?? DefaultStroke;
        if (points.Count == 1)
        {
            var point = ToWpfPoint(points[0], padding);
            drawingContext.DrawEllipse(brush, null, point, 2.2, 2.2);
            return;
        }

        var thickness = double.IsFinite(StrokeThickness) && StrokeThickness > 0
            ? StrokeThickness
            : SparklineMetrics.SeriesStrokeThickness;
        var pen = new Pen(brush, thickness)
        {
            LineJoin = PenLineJoin.Round,
            StartLineCap = PenLineCap.Round,
            EndLineCap = PenLineCap.Round
        };
        pen.Freeze();

        var geometry = new StreamGeometry();
        using (var context = geometry.Open())
        {
            context.BeginFigure(ToWpfPoint(points[0], padding), false, false);
            for (var index = 1; index < points.Count; index++)
            {
                context.LineTo(ToWpfPoint(points[index], padding), true, false);
            }
        }

        geometry.Freeze();
        drawingContext.DrawGeometry(null, pen, geometry);
    }

    public decimal? PreviousCloseReference
    {
        get => (decimal?)GetValue(PreviousCloseReferenceProperty);
        set => SetValue(PreviousCloseReferenceProperty, value);
    }

    public static readonly DependencyProperty PreviousCloseReferenceProperty =
        DependencyProperty.Register(
            nameof(PreviousCloseReference),
            typeof(decimal?),
            typeof(SparklineControl),
            new FrameworkPropertyMetadata(
                null,
                FrameworkPropertyMetadataOptions.AffectsRender));

    private static Point ToWpfPoint(SparklinePoint point, double padding) =>
        new(point.X + padding, point.Y + padding);

    private void DrawReferenceMarker(
        DrawingContext drawingContext,
        double lineY,
        Brush brush)
    {
        const double radius = 2;
        if (ActualWidth < 20
            || ActualHeight < radius * 2 + 4
            || !double.IsFinite(lineY))
        {
            return;
        }

        var marker = new FormattedText(
            "P",
            CultureInfo.InvariantCulture,
            FlowDirection.LeftToRight,
            new Typeface("Segoe UI Semibold"),
            7,
            brush,
            VisualTreeHelper.GetDpi(this).PixelsPerDip);
        var markerX = Math.Max(
            MarkerPadding,
            ActualWidth - MarkerPadding - marker.Width);
        var markerY = Math.Clamp(
            lineY - marker.Height / 2,
            MarkerPadding,
            Math.Max(
                MarkerPadding,
                ActualHeight - MarkerPadding - marker.Height));
        drawingContext.DrawText(marker, new Point(markerX, markerY));
    }

    private void DrawSessionDivider(
        DrawingContext drawingContext,
        double padding)
    {
        if (SessionDividerPosition is not { } position
            || !double.IsFinite(position)
            || position <= 0
            || position >= 1
            || ActualWidth <= padding * 2
            || ActualHeight <= padding * 2)
        {
            return;
        }

        var x = padding + position * (ActualWidth - padding * 2);
        var pen = new Pen(
            SessionDividerStroke ?? DefaultSessionDividerStroke,
            0.75)
        {
            StartLineCap = PenLineCap.Flat,
            EndLineCap = PenLineCap.Flat
        };
        pen.Freeze();
        drawingContext.DrawLine(
            pen,
            new Point(x, padding),
            new Point(x, ActualHeight - padding));
    }

    private const double MarkerPadding = 2;

    private static Brush CreateBrush(Color color)
    {
        var brush = new SolidColorBrush(color);
        brush.Freeze();
        return brush;
    }
}
