namespace FloatingStockTicker.Models;

public sealed record QuietHoursScheduleResult(
    bool IsPaused,
    DateTime? NextResumeTime);

public static class QuietHoursSchedule
{
    private static readonly TimeSpan QuietHoursStart = new(18, 0, 0);
    private static readonly TimeSpan QuietHoursEnd = new(6, 0, 0);

    public static QuietHoursScheduleResult Evaluate(
        DateTime localTime,
        bool pauseDuringQuietHours)
    {
        localTime = DateTime.SpecifyKind(localTime, DateTimeKind.Unspecified);
        if (!pauseDuringQuietHours)
        {
            return new QuietHoursScheduleResult(false, null);
        }

        if (localTime.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday)
        {
            return new QuietHoursScheduleResult(
                true,
                NextMonday(localTime.Date).Add(QuietHoursEnd));
        }

        var time = localTime.TimeOfDay;
        if (time < QuietHoursEnd)
        {
            return new QuietHoursScheduleResult(
                true,
                localTime.Date.Add(QuietHoursEnd));
        }

        if (time >= QuietHoursStart)
        {
            var nextResumeDate = localTime.DayOfWeek == DayOfWeek.Friday
                ? NextMonday(localTime.Date)
                : localTime.Date.AddDays(1);
            return new QuietHoursScheduleResult(
                true,
                nextResumeDate.Add(QuietHoursEnd));
        }

        return new QuietHoursScheduleResult(false, null);
    }

    private static DateTime NextMonday(DateTime date)
    {
        var daysUntilMonday =
            ((int)DayOfWeek.Monday - (int)date.DayOfWeek + 7) % 7;
        if (daysUntilMonday == 0)
        {
            daysUntilMonday = 7;
        }

        return date.Date.AddDays(daysUntilMonday);
    }
}
