using System.Windows;
using System.Windows.Automation.Peers;
using System.Windows.Media;
using FloatingStockTicker.Models;

namespace FloatingStockTicker.Controls;

public sealed class SessionIconControl : FrameworkElement
{
    private static readonly Brush DefaultBrush =
        Application.Current?.TryFindResource("SessionIconBrush") as Brush
        ?? CreateBrush(Color.FromRgb(190, 207, 231));

    public static readonly DependencyProperty KindProperty =
        DependencyProperty.Register(
            nameof(Kind),
            typeof(SessionIconKind),
            typeof(SessionIconControl),
            new FrameworkPropertyMetadata(
                SessionIconKind.Regular,
                FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty IconBrushProperty =
        DependencyProperty.Register(
            nameof(IconBrush),
            typeof(Brush),
            typeof(SessionIconControl),
            new FrameworkPropertyMetadata(
                DefaultBrush,
                FrameworkPropertyMetadataOptions.AffectsRender));

    public SessionIconKind Kind
    {
        get => (SessionIconKind)GetValue(KindProperty);
        set => SetValue(KindProperty, value);
    }

    public Brush? IconBrush
    {
        get => (Brush?)GetValue(IconBrushProperty);
        set => SetValue(IconBrushProperty, value);
    }

    protected override AutomationPeer OnCreateAutomationPeer() =>
        new SessionIconAutomationPeer(this);

    protected override void OnRender(DrawingContext drawingContext)
    {
        base.OnRender(drawingContext);

        if (ActualWidth <= 0 || ActualHeight <= 0)
        {
            return;
        }

        var brush = IconBrush ?? DefaultBrush;
        var pen = new Pen(brush, 1.25)
        {
            LineJoin = PenLineJoin.Round,
            StartLineCap = PenLineCap.Round,
            EndLineCap = PenLineCap.Round
        };
        pen.Freeze();

        switch (Kind)
        {
            case SessionIconKind.PreMarket:
                DrawPreMarket(drawingContext, pen);
                break;
            case SessionIconKind.AfterHours:
            case SessionIconKind.Overnight:
                DrawAfterHours(drawingContext, brush);
                break;
            default:
                DrawRegular(drawingContext, pen);
                break;
        }
    }

    private void DrawRegular(DrawingContext drawingContext, Pen pen)
    {
        var size = Math.Min(ActualWidth, ActualHeight);
        var center = new Point(ActualWidth / 2, ActualHeight / 2);
        var radius = size * 0.2;
        drawingContext.DrawEllipse(null, pen, center, radius, radius);

        var rayStart = size * 0.34;
        var rayEnd = size * 0.46;
        for (var index = 0; index < 8; index++)
        {
            var angle = index * Math.PI / 4;
            var direction = new Vector(Math.Cos(angle), Math.Sin(angle));
            drawingContext.DrawLine(
                pen,
                center + direction * rayStart,
                center + direction * rayEnd);
        }
    }

    private void DrawPreMarket(DrawingContext drawingContext, Pen pen)
    {
        var size = Math.Min(ActualWidth, ActualHeight);
        var center = new Point(ActualWidth / 2, ActualHeight * 0.72);
        var radius = size * 0.3;
        var geometry = new StreamGeometry();
        using (var context = geometry.Open())
        {
            context.BeginFigure(
                new Point(center.X - radius, center.Y),
                false,
                false);
            context.BezierTo(
                new Point(center.X - radius * 0.58, center.Y - radius * 1.18),
                new Point(center.X + radius * 0.58, center.Y - radius * 1.18),
                new Point(center.X + radius, center.Y),
                true,
                false);
        }

        geometry.Freeze();
        drawingContext.DrawGeometry(null, pen, geometry);
        drawingContext.DrawLine(
            pen,
            new Point(center.X - radius * 1.12, center.Y),
            new Point(center.X + radius * 1.12, center.Y));
        drawingContext.DrawLine(
            pen,
            new Point(center.X, center.Y - radius * 1.08),
            new Point(center.X, center.Y - radius * 1.48));
        drawingContext.DrawLine(
            pen,
            new Point(center.X - radius * 0.72, center.Y - radius * 0.72),
            new Point(center.X - radius * 0.99, center.Y - radius * 1.02));
        drawingContext.DrawLine(
            pen,
            new Point(center.X + radius * 0.72, center.Y - radius * 0.72),
            new Point(center.X + radius * 0.99, center.Y - radius * 1.02));
    }

    private void DrawAfterHours(DrawingContext drawingContext, Brush brush)
    {
        var size = Math.Min(ActualWidth, ActualHeight);
        var left = (ActualWidth - size) / 2 + size * 0.18;
        var right = (ActualWidth - size) / 2 + size * 0.82;
        var top = (ActualHeight - size) / 2 + size * 0.12;
        var bottom = (ActualHeight - size) / 2 + size * 0.88;
        var width = right - left;
        var height = bottom - top;
        var geometry = new StreamGeometry();
        using (var context = geometry.Open())
        {
            context.BeginFigure(
                new Point(left + width * 0.8, top),
                false,
                true);
            context.BezierTo(
                new Point(left + width * 0.26, top + height * 0.05),
                new Point(left, top + height * 0.34),
                new Point(left, top + height * 0.5),
                true,
                false);
            context.BezierTo(
                new Point(left, top + height * 0.66),
                new Point(left + width * 0.26, bottom - height * 0.05),
                new Point(left + width * 0.8, bottom),
                true,
                false);
            context.BezierTo(
                new Point(left + width * 0.5, bottom - height * 0.16),
                new Point(left + width * 0.42, top + height * 0.18),
                new Point(left + width * 0.8, top),
                true,
                false);
        }

        geometry.Freeze();
        var pen = new Pen(brush, 1.25)
        {
            LineJoin = PenLineJoin.Round,
            StartLineCap = PenLineCap.Round,
            EndLineCap = PenLineCap.Round
        };
        pen.Freeze();
        drawingContext.DrawGeometry(null, pen, geometry);
    }

    private static Brush CreateBrush(Color color)
    {
        var brush = new SolidColorBrush(color);
        brush.Freeze();
        return brush;
    }

    private sealed class SessionIconAutomationPeer : FrameworkElementAutomationPeer
    {
        public SessionIconAutomationPeer(SessionIconControl owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() =>
            AutomationControlType.Image;
    }
}
