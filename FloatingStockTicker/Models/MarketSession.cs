namespace FloatingStockTicker.Models;

public enum MarketSession
{
    Unknown,
    PreMarket,
    Regular,
    AfterHours,
    Overnight,
    Closed
}

public readonly record struct TradingPeriod(
    DateTimeOffset Start,
    DateTimeOffset End)
{
    public bool Contains(DateTimeOffset timestamp) =>
        timestamp >= Start && timestamp < End;
}

public sealed record TradingPeriods(
    TradingPeriod? PreMarket = null,
    TradingPeriod? Regular = null,
    TradingPeriod? AfterHours = null)
{
    public bool HasAny =>
        PreMarket is not null
        || Regular is not null
        || AfterHours is not null;
}

public static class MarketSessionClassifier
{
    public static MarketSession Classify(
        DateTimeOffset timestamp,
        TradingPeriods? periods)
    {
        if (periods is null || !periods.HasAny)
        {
            return MarketSession.Unknown;
        }

        if (periods.PreMarket?.Contains(timestamp) == true)
        {
            return MarketSession.PreMarket;
        }

        if (periods.Regular?.Contains(timestamp) == true)
        {
            return MarketSession.Regular;
        }

        if (periods.AfterHours?.Contains(timestamp) == true)
        {
            return MarketSession.AfterHours;
        }

        return MarketSession.Closed;
    }

    public static bool IsInTradingDay(
        DateTimeOffset timestamp,
        TradingPeriods? periods)
    {
        if (periods is null || !periods.HasAny)
        {
            return true;
        }

        var start = new[]
        {
            periods.PreMarket?.Start,
            periods.Regular?.Start,
            periods.AfterHours?.Start
        }
        .Where(value => value is not null)
        .Select(value => value!.Value)
        .DefaultIfEmpty()
        .Min();
        var end = new[]
        {
            periods.PreMarket?.End,
            periods.Regular?.End,
            periods.AfterHours?.End
        }
        .Where(value => value is not null)
        .Select(value => value!.Value)
        .DefaultIfEmpty()
        .Max();

        return timestamp >= start && timestamp < end;
    }
}
