using System.Text.Json;
using System.Net;
using System.Windows;
using System.Windows.Media;
using FloatingStockTicker.Controls;
using FloatingStockTicker.Models;
using FloatingStockTicker.Services;

namespace FloatingStockTicker.Tests;

[TestClass]
public sealed class StockTickerLogicTests
{
    [TestMethod]
    public void ApplicationVersionUsesThreePartDisplayText()
    {
        Assert.AreEqual(
            "Version 1.2.3",
            ApplicationVersion.Format(new Version(1, 2, 3, 4)));
        Assert.AreEqual(
            "Version unavailable",
            ApplicationVersion.Format(null));
    }

    [TestMethod]
    public void YahooParserReadsRegularMarketPriceAndTimestamp()
    {
        const string message = """
            {
              "chart": {
                "result": [
                  {
                    "meta": {
                      "symbol": "AAPL",
                      "regularMarketPrice": 187.42,
                      "regularMarketTime": 1710000000,
                      "previousClose": 185.00
                    }
                  }
                ],
                "error": null
              }
            }
            """;

        var parsed = YahooChartParser.TryParseQuote(
            message,
            " aapl ",
            DateTimeOffset.UnixEpoch,
            out var quote,
            out var error);

        Assert.IsTrue(parsed, error);
        Assert.AreEqual("AAPL", quote.Symbol);
        Assert.AreEqual(187.42m, quote.Price);
        Assert.AreEqual(DateTimeOffset.FromUnixTimeSeconds(1710000000), quote.Timestamp);
    }

    [TestMethod]
    public void YahooParserUsesChartPreviousCloseWhenPreviousCloseIsInvalid()
    {
        const string message = """
            {
              "chart": {
                "result": [{
                  "meta": {
                    "regularMarketPrice": 499.21,
                    "previousClose": "NaN",
                    "chartPreviousClose": 487.46
                  }
                }],
                "error": null
              }
            }
            """;

        Assert.IsTrue(
            YahooChartParser.TryParseQuote(
                message,
                "MSFT",
                DateTimeOffset.UnixEpoch,
                out var quote,
                out var error),
            error);

        Assert.AreEqual(499.21m, quote.Price);
        Assert.AreEqual(487.46m, quote.PreviousClose);
    }

    [TestMethod]
    public void YahooParserRejectsMalformedAndMissingData()
    {
        Assert.IsFalse(
            YahooChartParser.TryParseQuote(
                "{",
                "AAPL",
                DateTimeOffset.UnixEpoch,
                out _,
                out var malformedError));
        StringAssert.Contains(malformedError, "valid JSON");

        const string missingPrice = """{"chart":{"result":[{"meta":{"symbol":"AAPL"}}]}}""";
        Assert.IsFalse(
            YahooChartParser.TryParseQuote(
                missingPrice,
                "AAPL",
                DateTimeOffset.UnixEpoch,
                out _,
                out var missingError));
        StringAssert.Contains(missingError, "regularMarketPrice");
    }

    [TestMethod]
    public void YahooParserReportsYahooChartErrors()
    {
        const string message = """
            {
              "chart": {
                "result": [],
                "error": { "description": "Symbol not found" }
              }
            }
            """;

        Assert.IsFalse(
            YahooChartParser.TryParseQuote(
                message,
                "MISSING",
                DateTimeOffset.UnixEpoch,
                out _,
                out var error));
        Assert.AreEqual("Symbol not found", error);
    }

    [TestMethod]
    public void RefreshStatusUsesInclusiveThreeAndTenMinuteBoundaries()
    {
        var now = DateTimeOffset.UtcNow;

        Assert.AreEqual(
            RefreshHealth.Waiting,
            RefreshStatusClassifier.Classify(null, now));
        Assert.AreEqual(
            RefreshHealth.Fresh,
            RefreshStatusClassifier.Classify(now.AddMinutes(-3), now));
        Assert.AreEqual(
            RefreshHealth.Aging,
            RefreshStatusClassifier.Classify(now.AddMinutes(-3).AddTicks(-1), now));
        Assert.AreEqual(
            RefreshHealth.Aging,
            RefreshStatusClassifier.Classify(now.AddMinutes(-10), now));
        Assert.AreEqual(
            RefreshHealth.Stale,
            RefreshStatusClassifier.Classify(now.AddMinutes(-10).AddTicks(-1), now));
    }

    [TestMethod]
    [DataRow(false, true, "Minimize")]
    [DataRow(true, true, "Restore")]
    [DataRow(false, false, "Restore")]
    [DataRow(true, false, "Restore")]
    public void GlobalShortcutToggleDecisionUsesForegroundAndMinimizedState(
        bool isMinimized,
        bool isForeground,
        string expectedAction)
    {
        Assert.AreEqual(
            Enum.Parse<GlobalShortcutWindowAction>(expectedAction),
            GlobalShortcutToggleLogic.Decide(isMinimized, isForeground));
    }

    [TestMethod]
    public void GlobalShortcutRestorePreservesCapturedNormalBounds()
    {
        var captured = new WindowNormalBounds(128, 244, 900, 610);
        var fallback = new WindowNormalBounds(16, 16, 450, 500);

        var restored = GlobalShortcutWindowBoundsLogic.ChooseRestoreBounds(
            captured,
            fallback);

        Assert.AreEqual(captured, restored);
        Assert.AreEqual(128d, restored!.Value.Left);
        Assert.AreEqual(244d, restored.Value.Top);
        Assert.AreEqual(900d, restored.Value.Width);
        Assert.AreEqual(610d, restored.Value.Height);
    }

    [TestMethod]
    public void GlobalShortcutRestoreUsesWpfFallbackOnlyWhenCapturedBoundsAreInvalid()
    {
        var invalidCaptured = new WindowNormalBounds(
            double.NaN,
            244,
            900,
            610);
        var fallback = new WindowNormalBounds(16, 16, 450, 500);

        var restored = GlobalShortcutWindowBoundsLogic.ChooseRestoreBounds(
            invalidCaptured,
            fallback);

        Assert.AreEqual(fallback, restored);
    }

    [TestMethod]
    public void GlobalShortcutUsesTheExpectedModifierAndKeyConstants()
    {
        Assert.AreEqual(
            GlobalHotkeyDefinition.ModAlt,
            uint.Parse("1", System.Globalization.CultureInfo.InvariantCulture));
        Assert.AreEqual(
            GlobalHotkeyDefinition.ModControl,
            uint.Parse("2", System.Globalization.CultureInfo.InvariantCulture));
        Assert.AreEqual(
            GlobalHotkeyDefinition.ModShift,
            uint.Parse("4", System.Globalization.CultureInfo.InvariantCulture));
        Assert.AreEqual(
            GlobalHotkeyDefinition.Modifiers,
            uint.Parse("7", System.Globalization.CultureInfo.InvariantCulture));
        Assert.AreEqual(
            GlobalHotkeyDefinition.VirtualKeyF12,
            uint.Parse("123", System.Globalization.CultureInfo.InvariantCulture));
        Assert.AreEqual(
            GlobalHotkeyDefinition.DisplayText,
            string.Join(string.Empty, ["Ctrl", "+Alt", "+Shift", "+F12"]));
    }

    [TestMethod]
    public void GlobalShortcutRegistrationFailureIsNonFatalAndExplainsConflict()
    {
        var api = new StubGlobalHotkeyApi(registerResult: false);
        var registration = new GlobalHotkeyRegistration(api);

        Assert.IsFalse(registration.TryRegister(new IntPtr(123), out var warning));
        Assert.IsFalse(registration.IsRegistered);
        StringAssert.Contains(warning, GlobalHotkeyDefinition.DisplayText);
        StringAssert.Contains(warning, "another application");
        Assert.AreEqual(1, api.RegisterCalls);
        Assert.AreEqual(0, api.UnregisterCalls);
    }

    [TestMethod]
    public void WindowPlacementUsesLogicalWorkAreaAndClampsToScreen()
    {
        var placement = WindowPlacementCalculator.CalculateLowerRight(
            new ScreenWorkArea(10, 20, 100, 80),
            60,
            50,
            16);

        Assert.AreEqual(34d, placement.Left);
        Assert.AreEqual(34d, placement.Top);

        var oversized = WindowPlacementCalculator.CalculateLowerRight(
            new ScreenWorkArea(10, 20, 100, 80),
            150,
            120,
            16);

        Assert.AreEqual(10d, oversized.Left);
        Assert.AreEqual(20d, oversized.Top);
    }

    [TestMethod]
    public void WindowSizeUsesDefaultsAndRestoresValidSavedDimensions()
    {
        var workArea = new ScreenWorkArea(0, 0, 1920, 1080);

        var defaults = WindowSizeCalculator.Resolve(null, null, workArea);
        Assert.AreEqual(500d, defaults.Width);
        Assert.AreEqual(WindowSizeCalculator.DefaultHeight, defaults.Height);

        var restored = WindowSizeCalculator.Resolve(600, 480, workArea);
        Assert.AreEqual(600d, restored.Width);
        Assert.AreEqual(480d, restored.Height);
        Assert.IsTrue(WindowSizeCalculator.IsValidSavedSize(600, 480));
    }

    [TestMethod]
    public void WindowSizeClampsToWorkAreaAndMinimums()
    {
        var clamped = WindowSizeCalculator.Resolve(
            900,
            700,
            new ScreenWorkArea(100, 50, 700, 500),
            16);

        Assert.AreEqual(668d, clamped.Width);
        Assert.AreEqual(468d, clamped.Height);

        var invalid = WindowSizeCalculator.Resolve(
            100,
            double.NaN,
            new ScreenWorkArea(0, 0, 1920, 1080));
        Assert.AreEqual(WindowSizeCalculator.DefaultWidth, invalid.Width);
        Assert.AreEqual(WindowSizeCalculator.DefaultHeight, invalid.Height);
    }

    [TestMethod]
    [DataRow(450d, 1)]
    [DataRow(845d, 1)]
    [DataRow(846d, 2)]
    [DataRow(1271d, 2)]
    [DataRow(1272d, 3)]
    [DataRow(2000d, 3)]
    public void ResponsiveTileLayoutUsesOneTwoOrThreeColumnsAtWidthBoundaries(
        double availableWidth,
        int expectedColumns)
    {
        Assert.AreEqual(
            expectedColumns,
            ResponsiveTileLayout.GetColumnCount(availableWidth));
    }

    [TestMethod]
    public void ResponsiveTileLayoutKeepsEqualSpacedCardWidths()
    {
        var itemWidth = ResponsiveTileLayout.GetItemWidth(
            900,
            ResponsiveTileLayout.GetColumnCount(900));

        Assert.AreEqual(447d, itemWidth);
        Assert.AreEqual(
            900d,
            itemWidth * 2 + ResponsiveTileLayout.InterCardSpacing);
    }

    [TestMethod]
    public void SettingsRoundTripPersistsWindowSizeWithSymbolsAndAlwaysOnTop()
    {
        var path = Path.Combine(
            AppContext.BaseDirectory,
            $"window-size-settings-{Guid.NewGuid():N}.json");
        try
        {
            var store = new SettingsStore(path);
            store.Save(new AppSettings
            {
                Symbols = ["MSFT"],
                AlwaysOnTop = false,
                PollingIntervalSeconds = 45,
                PauseDuringQuietHours = true,
                EnableGlobalShortcut = false,
                WindowWidth = 600,
                WindowHeight = 480
            });

            var result = store.Load();
            CollectionAssert.AreEqual(new[] { "MSFT" }, result.Settings.Symbols);
            Assert.IsFalse(result.Settings.AlwaysOnTop);
            Assert.AreEqual(45, result.Settings.PollingIntervalSeconds);
            Assert.IsTrue(result.Settings.PauseDuringQuietHours);
            Assert.IsFalse(result.Settings.EnableGlobalShortcut);
            Assert.AreEqual(600d, result.Settings.WindowWidth);
            Assert.AreEqual(480d, result.Settings.WindowHeight);
        }

        finally
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
    }

    [TestMethod]
    [DataRow("2026-08-03T05:59:59", true, "2026-08-03T06:00:00")]
    [DataRow("2026-08-03T06:00:00", false, "")]
    [DataRow("2026-08-03T17:59:59", false, "")]
    [DataRow("2026-08-03T18:00:00", true, "2026-08-04T06:00:00")]
    [DataRow("2026-08-06T18:00:00", true, "2026-08-07T06:00:00")]
    [DataRow("2026-08-07T18:00:00", true, "2026-08-10T06:00:00")]
    [DataRow("2026-08-08T12:00:00", true, "2026-08-10T06:00:00")]
    [DataRow("2026-08-09T23:59:59", true, "2026-08-10T06:00:00")]
    public void QuietHoursScheduleUsesLocalBoundarySemantics(
        string localTimeText,
        bool expectedPaused,
        string expectedResumeText)
    {
        var localTime = DateTime.Parse(
            localTimeText,
            provider: null,
            System.Globalization.DateTimeStyles.AssumeLocal);
        var result = QuietHoursSchedule.Evaluate(localTime, true);

        Assert.AreEqual(expectedPaused, result.IsPaused);
        if (string.IsNullOrEmpty(expectedResumeText))
        {
            Assert.IsNull(result.NextResumeTime);
        }
        else
        {
            Assert.AreEqual(
                DateTime.Parse(
                    expectedResumeText,
                    provider: null,
                    System.Globalization.DateTimeStyles.AssumeLocal),
                result.NextResumeTime);
        }
    }

    [TestMethod]
    public void QuietHoursScheduleCanBeDisabledWithoutAResumeTime()
    {
        var result = QuietHoursSchedule.Evaluate(
            new DateTime(2026, 8, 8, 12, 0, 0),
            false);

        Assert.IsFalse(result.IsPaused);
        Assert.IsNull(result.NextResumeTime);
    }

    [TestMethod]
    public void SettingsParserResetsMalformedOrOutOfRangePollingInterval()
    {
        var outOfRange = SettingsStore.Parse(
            """{"Symbols":["MSFT"],"PollingIntervalSeconds":5,"PauseDuringQuietHours":true}""");

        CollectionAssert.AreEqual(new[] { "MSFT" }, outOfRange.Settings.Symbols);
        Assert.AreEqual(
            AppSettings.DefaultPollingIntervalSeconds,
            outOfRange.Settings.PollingIntervalSeconds);
        Assert.IsTrue(outOfRange.Settings.PauseDuringQuietHours);
        StringAssert.Contains(outOfRange.Warning!, "polling interval");
        Assert.IsTrue(outOfRange.RequiresRewrite);

        var malformed = SettingsStore.Parse(
            """{"Symbols":["AAPL"],"PollingIntervalSeconds":"fast"}""");

        CollectionAssert.AreEqual(new[] { "AAPL" }, malformed.Settings.Symbols);
        Assert.AreEqual(
            AppSettings.DefaultPollingIntervalSeconds,
            malformed.Settings.PollingIntervalSeconds);
        StringAssert.Contains(malformed.Warning!, "polling interval");
        Assert.IsTrue(malformed.RequiresRewrite);
    }

    [TestMethod]
    public void SettingsParserDefaultsMissingGlobalShortcutToEnabledWithoutLosingSettings()
    {
        var result = SettingsStore.Parse(
            """{"Symbols":["MSFT"],"AlwaysOnTop":false,"PollingIntervalSeconds":30,"PauseDuringQuietHours":true}""");

        CollectionAssert.AreEqual(new[] { "MSFT" }, result.Settings.Symbols);
        Assert.IsFalse(result.Settings.AlwaysOnTop);
        Assert.AreEqual(30, result.Settings.PollingIntervalSeconds);
        Assert.IsTrue(result.Settings.PauseDuringQuietHours);
        Assert.IsTrue(result.Settings.EnableGlobalShortcut);
        Assert.IsTrue(result.RequiresRewrite);
    }

    [TestMethod]
    public void SettingsParserDefaultsMissingQuietHoursToEnabledAndPreservesExplicitFalse()
    {
        var missing = SettingsStore.Parse(
            """{"Symbols":["MSFT"],"PollingIntervalSeconds":30,"EnableGlobalShortcut":true}""");

        CollectionAssert.AreEqual(new[] { "MSFT" }, missing.Settings.Symbols);
        Assert.IsTrue(missing.Settings.PauseDuringQuietHours);
        Assert.IsTrue(missing.RequiresRewrite);

        var explicitFalse = SettingsStore.Parse(
            """{"Symbols":["MSFT"],"PollingIntervalSeconds":30,"PauseDuringQuietHours":false,"EnableGlobalShortcut":true}""");

        Assert.IsFalse(explicitFalse.Settings.PauseDuringQuietHours);
        Assert.IsFalse(explicitFalse.RequiresRewrite);
    }

    [TestMethod]
    public void PausedRefreshPresentationUsesPausedAsTheOnlySuffix()
    {
        var lastRefresh = new DateTimeOffset(
            2026,
            8,
            6,
            23,
            10,
            0,
            TimeSpan.Zero);

        var text = RefreshStatusPresentation.FormatLastUpdated(
            lastRefresh,
            TimeSpan.FromSeconds(30),
            isPaused: true);

        Assert.AreEqual(
            $"Updated {lastRefresh.ToLocalTime():h:mm:ss tt} · Paused",
            text);
        Assert.AreEqual(1, text.Split("Paused").Length - 1);
        Assert.IsFalse(text.Contains("poll", StringComparison.OrdinalIgnoreCase));
    }

    [TestMethod]
    public void SettingsStoreRejectsInvalidPollingIntervalOnSave()
    {
        var store = new SettingsStore(
            Path.Combine(
                AppContext.BaseDirectory,
                $"invalid-polling-settings-{Guid.NewGuid():N}.json"));

        Assert.Throws<ArgumentOutOfRangeException>(
            () => store.Save(new AppSettings
            {
                PollingIntervalSeconds = AppSettings.MaxPollingIntervalSeconds + 1
            }));
    }

    [TestMethod]
    public void GlobalShortcutRegistrationCanDisableAndReenable()
    {
        var api = new StubGlobalHotkeyApi(registerResult: true);
        var registration = new GlobalHotkeyRegistration(api);

        Assert.IsTrue(registration.TryRegister(new IntPtr(123), out var warning));
        Assert.IsEmpty(warning);
        Assert.IsTrue(registration.IsRegistered);

        Assert.IsTrue(registration.Unregister(new IntPtr(123)));
        Assert.IsFalse(registration.IsRegistered);
        Assert.AreEqual(1, api.UnregisterCalls);

        Assert.IsTrue(registration.TryRegister(new IntPtr(123), out warning));
        Assert.IsEmpty(warning);
        Assert.IsTrue(registration.IsRegistered);
        Assert.AreEqual(2, api.RegisterCalls);
    }

    [TestMethod]
    public void FirstRunStartsWithOnlyThePinnedMarketOverview()
    {
        var path = Path.Combine(
            AppContext.BaseDirectory,
            $"first-run-settings-{Guid.NewGuid():N}.json");
        try
        {
            var result = new SettingsStore(path).Load();

            Assert.IsEmpty(result.Settings.Symbols);
            Assert.IsTrue(result.Settings.PauseDuringQuietHours);
            CollectionAssert.AreEqual(
                new[]
                {
                    "^DJI",
                    "YM=F",
                    "^GSPC",
                    "ES=F",
                    "^IXIC",
                    "NQ=F"
                },
                MarketOverviewSymbols.CombineWithUserSymbols(
                    result.Settings.Symbols).ToArray());
        }
        finally
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
    }

    [TestMethod]
    public void SettingsParserIgnoresInvalidWindowSizeWithoutLosingOtherSettings()
    {
        var result = SettingsStore.Parse(
            """{"Symbols":["MSFT"],"AlwaysOnTop":false,"WindowWidth":100,"WindowHeight":null}""");

        CollectionAssert.AreEqual(new[] { "MSFT" }, result.Settings.Symbols);
        Assert.IsFalse(result.Settings.AlwaysOnTop);
        Assert.IsNull(result.Settings.WindowWidth);
        Assert.IsNull(result.Settings.WindowHeight);
        StringAssert.Contains(result.Warning, "window size");
        Assert.IsTrue(result.RequiresRewrite);
    }

    [TestMethod]
    public void LowerRightPlacementUsesRestoredClampedWindowSize()
    {
        var workArea = new ScreenWorkArea(100, 50, 1200, 800);
        var size = WindowSizeCalculator.Resolve(600, 400, workArea);
        var placement = WindowPlacementCalculator.CalculateLowerRight(
            workArea,
            size.Width,
            size.Height);

        Assert.AreEqual(684d, placement.Left);
        Assert.AreEqual(434d, placement.Top);
    }

    [TestMethod]
    [DataRow("110", "100", "Up")]
    [DataRow("90", "100", "Down")]
    [DataRow("100", "100", "Flat")]
    [DataRow("100.004", "100", "Flat")]
    [DataRow("100.005", "100", "Flat")]
    [DataRow("100", "", "Flat")]
    public void DailyDirectionTableUsesPreviousCloseAndFlatTolerance(
        string currentText,
        string previousCloseText,
        string expectedDirection)
    {
        var state = new StockTickerState("TEST");
        var hasPreviousClose = decimal.TryParse(previousCloseText, out var previousClose);

        Assert.IsTrue(
            state.Apply(new QuoteTick(
                "TEST",
                decimal.Parse(currentText),
                DateTimeOffset.UnixEpoch,
                PreviousClose: hasPreviousClose ? previousClose : null)));

        Assert.AreEqual(
            Enum.Parse<PriceDirection>(expectedDirection),
            state.DailyDirection);
        Assert.AreEqual(hasPreviousClose, state.HasDailyBaseline);
    }

    [TestMethod]
    [DataRow("100", "110", "Up")]
    [DataRow("110", "100", "Down")]
    [DataRow("100", "100", "Flat")]
    [DataRow("100", "100.004", "Flat")]
    public void IntradayTrendDirectionTableUsesFirstAndLatestPlottedClose(
        string firstText,
        string lastText,
        string expectedDirection)
    {
        var state = new StockTickerState("TEST");
        Assert.IsTrue(
            state.Apply(new QuoteTick(
                "TEST",
                decimal.Parse(lastText),
                DateTimeOffset.UnixEpoch,
                [
                    new IntradayPoint(DateTimeOffset.UnixEpoch.AddMinutes(2), decimal.Parse(lastText)),
                    new IntradayPoint(DateTimeOffset.UnixEpoch, decimal.Parse(firstText))
                ])));

        Assert.AreEqual(
            Enum.Parse<PriceDirection>(expectedDirection),
            state.IntradayTrendDirection);
    }

    [TestMethod]
    [DataRow("110", "100", "90", "95", "Up", "Up")]
    [DataRow("90", "100", "110", "105", "Down", "Down")]
    [DataRow("90", "100", "80", "95", "Down", "Up")]
    [DataRow("110", "100", "120", "105", "Up", "Down")]
    public void DailyAndIntradayDirectionsRemainIndependent(
        string currentText,
        string previousCloseText,
        string firstCloseText,
        string lastCloseText,
        string expectedDaily,
        string expectedIntraday)
    {
        var state = new StockTickerState("TEST");
        Assert.IsTrue(
            state.Apply(new QuoteTick(
                "TEST",
                decimal.Parse(currentText),
                DateTimeOffset.UnixEpoch,
                [
                    new IntradayPoint(DateTimeOffset.UnixEpoch, decimal.Parse(firstCloseText)),
                    new IntradayPoint(DateTimeOffset.UnixEpoch.AddMinutes(1), decimal.Parse(lastCloseText))
                ],
                PreviousClose: decimal.Parse(previousCloseText))));

        Assert.AreEqual(
            Enum.Parse<PriceDirection>(expectedDaily),
            state.DailyDirection);
        Assert.AreEqual(
            Enum.Parse<PriceDirection>(expectedIntraday),
            state.IntradayTrendDirection);
    }

    [TestMethod]
    public void YahooParserFiltersRegularSessionAndKeepsTimestampClosePairs()
    {
        const string message = """
            {
              "chart": {
                "result": [{
                  "meta": {
                    "regularMarketPrice": 103,
                    "currentTradingPeriod": {
                      "regular": { "start": 100, "end": 300 }
                    }
                  },
                  "timestamp": [300, 100, 200, 100, 400],
                  "indicators": {
                    "quote": [{
                      "close": [103, 101, 102, 104, 105],
                      "open": [103, 101, 102, 104, 105]
                    }]
                  }
                }],
                "error": null
              }
            }
            """;

        Assert.IsTrue(
            YahooChartParser.TryParseQuote(
                message,
                "AAPL",
                DateTimeOffset.UnixEpoch,
                out var quote,
                out var error),
            error);

        var points = quote.IntradayPoints!;
        CollectionAssert.AreEqual(
            new[]
            {
                new IntradayPoint(DateTimeOffset.FromUnixTimeSeconds(100), 104m, MarketSession.Regular),
                new IntradayPoint(DateTimeOffset.FromUnixTimeSeconds(200), 102m, MarketSession.Regular)
            },
            points.ToArray());
        Assert.AreEqual(102m, points[^1].Price);
    }

    [TestMethod]
    [DataRow(100L, "PreMarket")]
    [DataRow(199L, "PreMarket")]
    [DataRow(200L, "Regular")]
    [DataRow(299L, "Regular")]
    [DataRow(300L, "AfterHours")]
    [DataRow(399L, "AfterHours")]
    [DataRow(400L, "Closed")]
    public void MarketSessionClassifierUsesHalfOpenYahooBoundaries(
        long timestampSeconds,
        string expectedSession)
    {
        var periods = new TradingPeriods(
            new TradingPeriod(
                DateTimeOffset.FromUnixTimeSeconds(100),
                DateTimeOffset.FromUnixTimeSeconds(200)),
            new TradingPeriod(
                DateTimeOffset.FromUnixTimeSeconds(200),
                DateTimeOffset.FromUnixTimeSeconds(300)),
            new TradingPeriod(
                DateTimeOffset.FromUnixTimeSeconds(300),
                DateTimeOffset.FromUnixTimeSeconds(400)));

        var actual = MarketSessionClassifier.Classify(
            DateTimeOffset.FromUnixTimeSeconds(timestampSeconds),
            periods);

        Assert.AreEqual(
            Enum.Parse<MarketSession>(expectedSession),
            actual);
    }

    [TestMethod]
    public void YahooParserIncludesMixedPreRegularAndPostPointsAndSelectsActivePostQuote()
    {
        const string message = """
            {
              "chart": {
                "result": [{
                  "meta": {
                    "regularMarketPrice": 4,
                    "regularMarketTime": 299,
                    "previousClose": 10,
                    "currentTradingPeriod": {
                      "pre": { "start": 100, "end": 200 },
                      "regular": { "start": 200, "end": 300 },
                      "post": { "start": 300, "end": 400 }
                    }
                  },
                  "timestamp": [100, 199, 200, 299, 300, 399, 400],
                  "indicators": {
                    "quote": [{
                      "close": [1, 2, 3, 4, 5, 6, 7]
                    }]
                  }
                }],
                "error": null
              }
            }
            """;

        Assert.IsTrue(
            YahooChartParser.TryParseQuote(
                message,
                "TEST",
                DateTimeOffset.FromUnixTimeSeconds(399),
                out var quote,
                out var error),
            error);

        CollectionAssert.AreEqual(
            new[]
            {
                new IntradayPoint(
                    DateTimeOffset.FromUnixTimeSeconds(100),
                    1,
                    MarketSession.PreMarket),
                new IntradayPoint(
                    DateTimeOffset.FromUnixTimeSeconds(199),
                    2,
                    MarketSession.PreMarket),
                new IntradayPoint(
                    DateTimeOffset.FromUnixTimeSeconds(200),
                    3,
                    MarketSession.Regular),
                new IntradayPoint(
                    DateTimeOffset.FromUnixTimeSeconds(299),
                    4,
                    MarketSession.Regular),
                new IntradayPoint(
                    DateTimeOffset.FromUnixTimeSeconds(300),
                    5,
                    MarketSession.AfterHours),
                new IntradayPoint(
                    DateTimeOffset.FromUnixTimeSeconds(399),
                    6,
                    MarketSession.AfterHours)
            },
            quote.IntradayPoints!.ToArray());
        Assert.AreEqual(4m, quote.Price);
        Assert.AreEqual(
            DateTimeOffset.FromUnixTimeSeconds(299),
            quote.Timestamp);
        Assert.AreEqual(MarketSession.AfterHours, quote.Session);
        Assert.AreEqual(6m, quote.ExtendedPrice);
        Assert.AreEqual(
            DateTimeOffset.FromUnixTimeSeconds(399),
            quote.ExtendedTimestamp);
        Assert.AreEqual(MarketSession.AfterHours, quote.ExtendedSession);
        Assert.AreEqual(10m, quote.PreviousClose);

        var state = new StockTickerState("TEST");
        Assert.IsTrue(state.Apply(quote));
        var card = new TickerCardViewModel("TEST");
        card.Apply(state);
        Assert.AreEqual("6.00", card.ExtendedPriceText);
        Assert.AreEqual("▲ +2.00 (+50.00%)", card.ExtendedChangeText);
        Assert.AreEqual(
            "6.00  ▲ +2.00 (+50.00%)",
            card.ExtendedText);
        StringAssert.Contains(card.ChartTooltipText, "Extended price: 6.00");
        Assert.AreEqual(Visibility.Visible, card.ExtendedVisibility);
    }

    [TestMethod]
    public void YahooParserFallsBackToRegularPriceWhenActiveExtendedQuoteIsStale()
    {
        const string message = """
            {
              "chart": {
                "result": [{
                  "meta": {
                    "regularMarketPrice": 99,
                    "regularMarketTime": 390,
                    "currentTradingPeriod": {
                      "post": { "start": 300, "end": 5000 }
                    }
                  },
                  "timestamp": [300],
                  "indicators": { "quote": [{ "close": [88] }] }
                }],
                "error": null
              }
            }
            """;

        Assert.IsTrue(
            YahooChartParser.TryParseQuote(
                message,
                "TEST",
                DateTimeOffset.FromUnixTimeSeconds(2000),
                out var quote,
                out var error),
            error);

        Assert.AreEqual(99m, quote.Price);
        Assert.AreEqual(
            DateTimeOffset.FromUnixTimeSeconds(390),
            quote.Timestamp);
        Assert.AreEqual(MarketSession.AfterHours, quote.Session);
        Assert.AreEqual(88m, quote.IntradayPoints![0].Price);
    }

    [TestMethod]
    public void YahooParserFallsBackToLastPointWhenRegularPriceIsMissing()
    {
        const string message = """
            {
              "chart": {
                "result": [{
                  "meta": {
                    "currentTradingPeriod": {
                      "post": { "start": 300, "end": 5000 }
                    }
                  },
                  "timestamp": [300],
                  "indicators": { "quote": [{ "close": [88] }] }
                }],
                "error": null
              }
            }
            """;

        Assert.IsTrue(
            YahooChartParser.TryParseQuote(
                message,
                "TEST",
                DateTimeOffset.FromUnixTimeSeconds(2000),
                out var quote,
                out var error),
            error);

        Assert.AreEqual(88m, quote.Price);
        Assert.AreEqual(
            DateTimeOffset.FromUnixTimeSeconds(300),
            quote.Timestamp);
        Assert.AreEqual(MarketSession.AfterHours, quote.Session);
    }

    [TestMethod]
    public void TickerCardShowsRegularAndPreMarketQuotesWithIndependentDirections()
    {
        const string message = """
            {
              "chart": {
                "result": [{
                  "meta": {
                    "regularMarketPrice": 100,
                    "regularMarketTime": 150,
                    "previousClose": 110,
                    "currentTradingPeriod": {
                      "pre": { "start": 100, "end": 200 },
                      "regular": { "start": 200, "end": 300 },
                      "post": { "start": 300, "end": 400 }
                    }
                  },
                  "timestamp": [150, 199],
                  "indicators": { "quote": [{ "close": [100, 101] }] }
                }],
                "error": null
              }
            }
            """;

        Assert.IsTrue(
            YahooChartParser.TryParseQuote(
                message,
                "TEST",
                DateTimeOffset.FromUnixTimeSeconds(199),
                out var quote,
                out var error),
            error);
        var state = new StockTickerState("TEST");
        Assert.IsTrue(state.Apply(quote));
        var card = new TickerCardViewModel("TEST");
        card.Apply(state);

        Assert.AreEqual(100m, state.CurrentPrice);
        Assert.AreEqual(101m, state.ExtendedPrice);
        Assert.AreEqual(PriceDirection.Down, state.DailyDirection);
        Assert.AreEqual(PriceDirection.Up, state.ExtendedDirection);
        Assert.AreEqual("100.00", card.PriceText);
        Assert.AreEqual("101.00", card.ExtendedPriceText);
        Assert.AreEqual("▲ +1.00 (+1.00%)", card.ExtendedChangeText);
        Assert.AreEqual(
            "101.00  ▲ +1.00 (+1.00%)",
            card.ExtendedText);
        Assert.AreEqual(Visibility.Visible, card.ExtendedVisibility);
        StringAssert.Contains(card.ChartTooltipText, "Regular price: 100.00");
        StringAssert.Contains(card.ChartTooltipText, "Extended price: 101.00");
        StringAssert.Contains(card.ChartTooltipText, "Previous close: 110.00");
        Assert.AreEqual(
            Color.FromRgb(242, 123, 131),
            ((SolidColorBrush)card.DailyDirectionBrush).Color);
        Assert.AreEqual(
            Color.FromRgb(80, 211, 148),
            ((SolidColorBrush)card.ExtendedDirectionBrush).Color);
    }

    [TestMethod]
    public void TickerCardCollapsesExtendedLineWhenExtendedQuoteIsAbsentOrStale()
    {
        var state = new StockTickerState("TEST");
        Assert.IsTrue(
            state.Apply(new QuoteTick(
                "TEST",
                100,
                DateTimeOffset.UnixEpoch,
                PreviousClose: 90)));
        var card = new TickerCardViewModel("TEST");
        card.Apply(state);

        Assert.AreEqual(Visibility.Collapsed, card.ExtendedVisibility);
        Assert.IsEmpty(card.ExtendedText);
        Assert.IsEmpty(card.ExtendedPriceText);
        Assert.IsEmpty(card.ExtendedChangeText);

        const string staleMessage = """
            {
              "chart": {
                "result": [{
                  "meta": {
                    "regularMarketPrice": 100,
                    "currentTradingPeriod": {
                      "post": { "start": 300, "end": 5000 }
                    }
                  },
                  "timestamp": [300],
                  "indicators": { "quote": [{ "close": [101] }] }
                }],
                "error": null
              }
            }
            """;
        Assert.IsTrue(
            YahooChartParser.TryParseQuote(
                staleMessage,
                "TEST",
                DateTimeOffset.FromUnixTimeSeconds(2000),
                out var staleQuote,
                out var staleError),
            staleError);
        Assert.IsNull(staleQuote.ExtendedPrice);
    }

    [TestMethod]
    public void TickerCardHidesPremarketQuoteAfterRegularSessionOpens()
    {
        var state = new StockTickerState("TEST");
        Assert.IsTrue(
            state.Apply(new QuoteTick(
                "TEST",
                105,
                DateTimeOffset.UnixEpoch.AddHours(2),
                PreviousClose: 100,
                Session: MarketSession.Regular,
                ExtendedPrice: 102,
                ExtendedTimestamp: DateTimeOffset.UnixEpoch.AddHours(1),
                ExtendedSession: MarketSession.PreMarket)));

        var card = new TickerCardViewModel("TEST");
        card.Apply(state);

        Assert.AreEqual(Visibility.Collapsed, card.ExtendedVisibility);
        Assert.IsEmpty(card.ExtendedPriceText);
        Assert.IsEmpty(card.ExtendedChangeText);
        Assert.DoesNotContain("Extended price", card.ChartTooltipText);
    }

    [TestMethod]
    public void YahooParserRetainsFinalAfterHoursQuoteWhenMarketIsClosed()
    {
        const string message = """
            {
              "chart": {
                "result": [{
                  "meta": {
                    "regularMarketPrice": 100,
                    "regularMarketTime": 299,
                    "currentTradingPeriod": {
                      "pre": { "start": 100, "end": 200 },
                      "regular": { "start": 200, "end": 300 },
                      "post": { "start": 300, "end": 400 }
                    }
                  },
                  "timestamp": [299, 399],
                  "indicators": { "quote": [{ "close": [100, 101] }] }
                }],
                "error": null
              }
            }
            """;

        Assert.IsTrue(
            YahooChartParser.TryParseQuote(
                message,
                "TEST",
                DateTimeOffset.FromUnixTimeSeconds(1000),
                out var quote,
                out var error),
            error);

        Assert.AreEqual(MarketSession.Closed, quote.Session);
        Assert.AreEqual(101m, quote.ExtendedPrice);
        Assert.AreEqual(
            DateTimeOffset.FromUnixTimeSeconds(399),
            quote.ExtendedTimestamp);
        Assert.AreEqual(MarketSession.AfterHours, quote.ExtendedSession);

        var state = new StockTickerState("TEST");
        Assert.IsTrue(state.Apply(quote));
        var card = new TickerCardViewModel("TEST");
        card.Apply(state);

        Assert.AreEqual(Visibility.Visible, card.ExtendedVisibility);
        Assert.AreEqual("101.00", card.ExtendedPriceText);
        Assert.AreEqual("After-hours", card.ExtendedSessionIconName);
        StringAssert.Contains(
            card.ChartTooltipText,
            "Extended price: 101.00");
    }

    [TestMethod]
    public void YahooOvernightParserReturnsOnlyActiveOvernightQuotes()
    {
        const string message = """
            {
              "quoteResponse": {
                "result": [
                  {
                    "symbol": "AMD",
                    "marketState": "OVERNIGHT",
                    "overnightMarketPrice": 489.83,
                    "overnightMarketTime": 1786065594
                  },
                  {
                    "symbol": "MSFT",
                    "marketState": "POST",
                    "overnightMarketPrice": 500,
                    "overnightMarketTime": 1786065594
                  }
                ],
                "error": null
              }
            }
            """;

        var quotes = YahooOvernightQuoteParser.Parse(message);

        Assert.HasCount(1, quotes);
        Assert.AreEqual(489.83m, quotes["AMD"].Price);
        Assert.AreEqual(
            DateTimeOffset.FromUnixTimeSeconds(1786065594),
            quotes["AMD"].Timestamp);
        Assert.IsFalse(quotes.ContainsKey("MSFT"));
    }

    [TestMethod]
    public void SymbolsUseTheirOwnTradingPeriodsAndPreviousCloseAcrossSessions()
    {
        var preState = new StockTickerState("PRE");
        var postState = new StockTickerState("POST");
        Assert.IsTrue(
            preState.Apply(new QuoteTick(
                "PRE",
                110,
                DateTimeOffset.UnixEpoch,
                PreviousClose: 100,
                Session: MarketSession.PreMarket)));
        Assert.IsTrue(
            postState.Apply(new QuoteTick(
                "POST",
                90,
                DateTimeOffset.UnixEpoch,
                PreviousClose: 120,
                Session: MarketSession.AfterHours)));

        Assert.AreEqual(MarketSession.PreMarket, preState.Session);
        Assert.AreEqual(MarketSession.AfterHours, postState.Session);
        Assert.AreEqual(100m, preState.DailyBaseline);
        Assert.AreEqual(120m, postState.DailyBaseline);
        Assert.AreEqual(PriceDirection.Up, preState.DailyDirection);
        Assert.AreEqual(PriceDirection.Down, postState.DailyDirection);
    }

    [TestMethod]
    [DataRow("PreMarket", "Pre-market", "Visible")]
    [DataRow("Regular", "Regular", "Collapsed")]
    [DataRow("AfterHours", "After-hours", "Visible")]
    [DataRow("Overnight", "Overnight", "Visible")]
    public void TickerCardUsesOneAccessibleSessionIconPerVisibleQuoteLine(
        string sessionText,
        string expectedSessionName,
        string expectedVisibility)
    {
        var state = new StockTickerState("TEST");
        Assert.IsTrue(
            state.Apply(new QuoteTick(
                "TEST",
                110,
                DateTimeOffset.UnixEpoch,
                [
                    new IntradayPoint(
                        DateTimeOffset.UnixEpoch,
                        109,
                        Enum.Parse<MarketSession>(sessionText))
                ],
                PreviousClose: 100,
                Session: Enum.Parse<MarketSession>(sessionText),
                ExtendedPrice: sessionText == "Regular" ? null : 109,
                ExtendedTimestamp: sessionText == "Regular"
                    ? null
                    : DateTimeOffset.UnixEpoch,
                ExtendedSession: Enum.Parse<MarketSession>(sessionText))));

        var card = new TickerCardViewModel("TEST");
        card.Apply(state);

        Assert.AreEqual(
            Enum.Parse<Visibility>(expectedVisibility),
            card.ExtendedVisibility);
        Assert.AreEqual(SessionIconKind.Regular, card.RegularSessionIconKind);
        Assert.AreEqual("Regular session", card.RegularSessionIconName);
        Assert.DoesNotContain("TODAY", card.ChangeText);
        Assert.DoesNotContain("PRE", card.ExtendedText);
        Assert.DoesNotContain("POST", card.ExtendedText);
        if (expectedVisibility == "Collapsed")
        {
            Assert.IsEmpty(card.ExtendedText);
        }
        else
        {
            Assert.AreEqual(expectedSessionName, card.ExtendedSessionIconName);
            Assert.AreNotEqual(SessionIconKind.Regular, card.ExtendedSessionIconKind);
        }
        Assert.AreEqual(100m, card.PreviousCloseReference);
        StringAssert.Contains(card.ChartTooltipText, $"Session: {sessionText switch
        {
            "PreMarket" => "Pre-market",
            "AfterHours" => "After-hours",
            "Overnight" => "Overnight",
            _ => "Regular"
        }}");
        StringAssert.Contains(card.ChartTooltipText, "Previous close: 100.00");
    }

    [TestMethod]
    public void TickerCardTypographyUsesTheSymbolSizeForAllQuoteNumbers()
    {
        Assert.AreEqual(16d, TickerCardTypography.TileFontSize);
        Assert.AreEqual(
            TickerCardTypography.TileFontSize,
            TickerCardTypography.NumericFontSize,
            0.000001d);
        Assert.AreEqual(22d, TickerCardTypography.NumericLineHeight);
    }

    [TestMethod]
    public void TickerCardPlacesPostMarketDividerBetweenRegularAndPostPoints()
    {
        var start = DateTimeOffset.UnixEpoch;
        var state = new StockTickerState("MSFT");
        Assert.IsTrue(state.Apply(new QuoteTick(
            "MSFT",
            103m,
            start.AddMinutes(3),
            [
                new IntradayPoint(start, 100m, MarketSession.Regular),
                new IntradayPoint(start.AddMinutes(1), 101m, MarketSession.Regular),
                new IntradayPoint(start.AddMinutes(2), 102m, MarketSession.AfterHours),
                new IntradayPoint(start.AddMinutes(3), 103m, MarketSession.AfterHours)
            ],
            PreviousClose: 99m)));

        var card = new TickerCardViewModel("MSFT");
        card.Apply(state);

        Assert.IsNotNull(card.PostMarketDividerFraction);
        Assert.AreEqual(
            0.5d,
            card.PostMarketDividerFraction.Value,
            0.000001d);
        StringAssert.Contains(
            card.ChartTooltipText,
            "Vertical divider marks regular market close");
    }

    [TestMethod]
    public void IntradaySeriesCleaningDropsInvalidValuesAndUsesDeterministicDuplicates()
    {
        var cleaned = IntradaySeries.Clean(
        [
            new IntradayPoint(DateTimeOffset.UnixEpoch.AddSeconds(30), 3),
            new IntradayPoint(DateTimeOffset.UnixEpoch, 1),
            new IntradayPoint(DateTimeOffset.UnixEpoch.AddSeconds(30), 4),
            new IntradayPoint(DateTimeOffset.UnixEpoch.AddSeconds(15), -1)
        ]);

        CollectionAssert.AreEqual(
            new[]
            {
                new IntradayPoint(DateTimeOffset.UnixEpoch, 1),
                new IntradayPoint(DateTimeOffset.UnixEpoch.AddSeconds(30), 4)
            },
            cleaned.ToArray());
    }

    [TestMethod]
    public void YahooParserKeepsQuoteWhenPreviousCloseIsMissing()
    {
        const string message = """
            {
              "chart": {
                "result": [{
                  "meta": { "regularMarketPrice": 105 },
                  "timestamp": [100, 200],
                  "indicators": {
                    "quote": [{
                      "close": [104, 105]
                    }]
                  }
                }],
                "error": null
              }
            }
            """;

        Assert.IsTrue(
            YahooChartParser.TryParseQuote(
                message,
                "AAPL",
                DateTimeOffset.UnixEpoch,
                out var quote,
                out var error),
            error);
        Assert.AreEqual(105m, quote.Price);
        Assert.IsNull(quote.PreviousClose);
    }

    [TestMethod]
    [DataRow("110", "100", "▲ +10.00 (+10.00%)", "▲")]
    [DataRow("90", "100", "▼ -10.00 (-10.00%)", "▼")]
    [DataRow("100", "100", "• 0.00 (0.00%)", "•")]
    public void TickerCardFormatsTodayLineWithConsistentDirectionAndSigns(
        string currentText,
        string previousCloseText,
        string expectedChange,
        string expectedGlyph)
    {
        var state = new StockTickerState("TEST");
        Assert.IsTrue(
            state.Apply(new QuoteTick(
                "TEST",
                decimal.Parse(currentText),
                DateTimeOffset.UnixEpoch,
                PreviousClose: decimal.Parse(previousCloseText))));

        var card = new TickerCardViewModel("TEST");
        card.Apply(state);

        Assert.AreEqual(expectedChange, card.ChangeText);
        Assert.AreEqual(1, card.ChangeText.Count(character => character == expectedGlyph[0]));
        foreach (var glyph in new[] { "▲", "▼", "•" })
        {
            if (glyph != expectedGlyph)
            {
                Assert.DoesNotContain(glyph, card.ChangeText);
            }
        }
        Assert.DoesNotContain("TODAY", card.ChangeText);
    }

    [TestMethod]
    public void DailyChangeUsesPreviousCloseAndCalculatesPositivePercentage()
    {
        var state = new StockTickerState("MSFT");
        state.Apply(new QuoteTick(
            "MSFT",
            499.21m,
            DateTimeOffset.UnixEpoch,
            PreviousClose: 487.46m));

        Assert.IsTrue(state.HasDailyBaseline);
        Assert.AreEqual(487.46m, state.DailyBaseline);
        Assert.AreEqual(11.75m, state.DailyChange);
        Assert.AreEqual(PriceDirection.Up, state.DailyDirection);
        Assert.AreEqual(2.41m, Math.Round(state.DailyChangePercent, 2));

        var card = new TickerCardViewModel("MSFT");
        card.Apply(state);
        StringAssert.Contains(card.ChangeText, "+11.75");
        StringAssert.Contains(card.ChangeText, "+2.41%");
        Assert.DoesNotContain("TODAY", card.ChangeText);
    }

    [TestMethod]
    public void MissingOrInvalidPreviousCloseLeavesDailyChangeUnavailable()
    {
        var missing = new StockTickerState("MSFT");
        missing.Apply(new QuoteTick(
            "MSFT",
            499.21m,
            DateTimeOffset.UnixEpoch,
            PreviousClose: null));

        Assert.IsFalse(missing.HasDailyBaseline);
        Assert.AreEqual(PriceDirection.Flat, missing.DailyDirection);
        Assert.AreEqual(499.21m, missing.CurrentPrice);

        var invalid = new StockTickerState("MSFT");
        invalid.Apply(new QuoteTick(
            "MSFT",
            499.21m,
            DateTimeOffset.UnixEpoch,
            PreviousClose: 0));

        Assert.IsFalse(invalid.HasDailyBaseline);
        Assert.AreEqual(PriceDirection.Flat, invalid.DailyDirection);

        var card = new TickerCardViewModel("MSFT");
        card.Apply(invalid);
        Assert.AreEqual("• Change unavailable", card.ChangeText);
    }

    [TestMethod]
    [DataRow("110", "100", "Up", "Positive", "Up", true)]
    [DataRow("90", "100", "Down", "Negative", "Down", true)]
    [DataRow("100", "100", "Flat", "Flat", "Flat", true)]
    [DataRow("100", "", "Flat", "Flat", "None", false)]
    public void DailyColorAndPreviousCloseReferenceUseOneBaseline(
        string currentText,
        string previousCloseText,
        string expectedDailyDirection,
        string expectedBrush,
        string expectedLineDirection,
        bool expectedReference)
    {
        var current = decimal.Parse(currentText);
        var hasPreviousClose =
            decimal.TryParse(previousCloseText, out var previousClose);
        var state = new StockTickerState("TEST");
        Assert.IsTrue(
            state.Apply(new QuoteTick(
                "TEST",
                current,
                DateTimeOffset.UnixEpoch,
                hasPreviousClose
                    ? [
                        new IntradayPoint(DateTimeOffset.UnixEpoch, previousClose),
                        new IntradayPoint(DateTimeOffset.UnixEpoch.AddMinutes(1), current)
                    ]
                    : [new IntradayPoint(DateTimeOffset.UnixEpoch, current)],
                PreviousClose: hasPreviousClose ? previousClose : null)));

        Assert.AreEqual(
            Enum.Parse<PriceDirection>(expectedDailyDirection),
            state.DailyDirection);
        var card = new TickerCardViewModel("TEST");
        card.Apply(state);
        var expectedColor = expectedBrush switch
        {
            "Positive" => Color.FromRgb(80, 211, 148),
            "Negative" => Color.FromRgb(242, 123, 131),
            _ => Color.FromRgb(184, 195, 206)
        };
        Assert.AreEqual(
            expectedColor,
            ((SolidColorBrush)card.DailyDirectionBrush).Color);

        var points = SparklineGeometry.Normalize(
            card.ChartValues,
            100,
            20,
            card.PreviousCloseReference);
        var hasReference = SparklineGeometry.TryNormalizeReference(
            card.ChartValues,
            card.PreviousCloseReference,
            20,
            out var referenceY);
        Assert.AreEqual(expectedReference, hasReference);
        if (!hasReference)
        {
            return;
        }

        var endpointY = points[^1].Y;
        var lineDirection = endpointY == referenceY
            ? "Flat"
            : endpointY < referenceY
                ? "Up"
                : "Down";
        Assert.AreEqual(expectedLineDirection, lineDirection);
    }

    [TestMethod]
    public async Task YahooPollingReportsOnlyCyclesWithAtLeastOneValidQuote()
    {
        var failedHandler = new StubHttpMessageHandler(
            () => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        await using (var failedClient = new YahooFinancePollingClient(
                         TimeSpan.FromHours(1),
                         new HttpClient(failedHandler)))
        {
            var failedCompletions = 0;
            failedClient.RefreshCompleted += (_, _) => failedCompletions++;
            await failedClient.StartAsync(["AAPL"]);
            await failedHandler.RequestObserved.Task.WaitAsync(TimeSpan.FromSeconds(2));
            await Task.Delay(50);

            Assert.AreEqual(0, failedCompletions);
            await failedClient.StopAsync();
        }

        const string validResponse = """
            {
              "chart": {
                "result": [{ "meta": { "regularMarketPrice": 123.45 } }],
                "error": null
              }
            }
            """;
        var successfulHandler = new StubHttpMessageHandler(
            () => new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(validResponse)
            });
        await using (var successfulClient = new YahooFinancePollingClient(
                         TimeSpan.FromHours(1),
                         new HttpClient(successfulHandler)))
        {
            var completionSource =
                new TaskCompletionSource<YahooRefreshCompleted>(
                    TaskCreationOptions.RunContinuationsAsynchronously);
            successfulClient.RefreshCompleted += (_, completion) =>
                completionSource.TrySetResult(completion);

            await successfulClient.StartAsync(["AAPL"]);
            var completion = await completionSource.Task.WaitAsync(TimeSpan.FromSeconds(2));

            Assert.AreEqual(1, completion.SuccessfulQuotes);
            Assert.AreEqual(1, completion.RequestedSymbols);
            StringAssert.Contains(
                successfulHandler.LastRequestUri?.Query ?? string.Empty,
                "includePrePost=true");
            await successfulClient.StopAsync();
        }
    }

    [TestMethod]
    public async Task YahooPollingOverlaysOvernightQuoteOnClosedChartData()
    {
        const string chartResponse = """
            {
              "chart": {
                "result": [{
                  "meta": {
                    "regularMarketPrice": 489.28,
                    "regularMarketTime": 299,
                    "currentTradingPeriod": {
                      "pre": { "start": 100, "end": 200 },
                      "regular": { "start": 200, "end": 300 },
                      "post": { "start": 300, "end": 400 }
                    }
                  },
                  "timestamp": [399],
                  "indicators": { "quote": [{ "close": [491.7055] }] }
                }],
                "error": null
              }
            }
            """;
        const string overnightResponse = """
            {
              "quoteResponse": {
                "result": [{
                  "symbol": "AMD",
                  "marketState": "OVERNIGHT",
                  "overnightMarketPrice": 489.83,
                  "overnightMarketTime": 1786065594
                }],
                "error": null
              }
            }
            """;
        var handler = new StubHttpMessageHandler(request =>
        {
            var uri = request.RequestUri?.AbsoluteUri ?? string.Empty;
            if (uri.Contains("/v8/finance/chart/", StringComparison.Ordinal))
            {
                return JsonResponse(chartResponse);
            }

            if (uri.Contains("/v1/test/getcrumb", StringComparison.Ordinal))
            {
                return new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("test-crumb")
                };
            }

            if (uri.Contains("/v7/finance/quote", StringComparison.Ordinal))
            {
                return JsonResponse(overnightResponse);
            }

            return new HttpResponseMessage(HttpStatusCode.NotFound);
        });
        await using var client = new YahooFinancePollingClient(
            TimeSpan.FromHours(1),
            new HttpClient(handler));
        var quoteSource = new TaskCompletionSource<QuoteTick>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        client.QuoteReceived += (_, quote) => quoteSource.TrySetResult(quote);

        await client.StartAsync(["AMD"]);
        var quote = await quoteSource.Task.WaitAsync(TimeSpan.FromSeconds(2));

        Assert.AreEqual(MarketSession.Closed, quote.Session);
        Assert.AreEqual(489.83m, quote.ExtendedPrice);
        Assert.AreEqual(MarketSession.Overnight, quote.ExtendedSession);
        Assert.AreEqual(
            DateTimeOffset.FromUnixTimeSeconds(1786065594),
            quote.ExtendedTimestamp);
        Assert.IsTrue(handler.RequestUris.Any(uri =>
            uri.AbsoluteUri.Contains(
                "overnightPrice=true",
                StringComparison.Ordinal)));
        await client.StopAsync();
    }

    [TestMethod]
    public async Task YahooPollingIntervalChangeWakesAnActiveLoopWithoutNetworkAccess()
    {
        const string validResponse = """
            {
              "chart": {
                "result": [{ "meta": { "regularMarketPrice": 123.45 } }],
                "error": null
              }
            }
            """;
        var handler = new StubHttpMessageHandler(
            () => new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(validResponse)
            });

        await using var client = new YahooFinancePollingClient(
            TimeSpan.FromHours(1),
            new HttpClient(handler));
        await client.StartAsync(["AAPL"]);
        await handler.RequestObserved.Task.WaitAsync(TimeSpan.FromSeconds(2));
        var requestsBeforeChange = handler.RequestCount;

        await client.UpdatePollIntervalAsync(TimeSpan.FromMilliseconds(20));
        await Task.Delay(150);

        Assert.IsGreaterThan(requestsBeforeChange, handler.RequestCount);
        Assert.AreEqual(TimeSpan.FromMilliseconds(20), client.PollInterval);
    }

    [TestMethod]
    public void YahooParserExtractsCleanChronologicalIntradayPoints()
    {
        const string message = """
            {
              "chart": {
                "result": [{
                  "meta": { "regularMarketPrice": 102.25 },
                  "timestamp": [300, 100, 200, 400],
                  "indicators": {
                    "quote": [{
                      "close": [null, 101.5, "NaN", 102.25]
                    }]
                  }
                }],
                "error": null
              }
            }
            """;

        Assert.IsTrue(
            YahooChartParser.TryParseQuote(
                message,
                "AAPL",
                DateTimeOffset.UnixEpoch,
                out var quote,
                out var error),
            error);

        var points = quote.IntradayPoints!;
        Assert.HasCount(2, points);
        Assert.AreEqual(DateTimeOffset.FromUnixTimeSeconds(100), points[0].Timestamp);
        Assert.AreEqual(101.5m, points[0].Price);
        Assert.AreEqual(DateTimeOffset.FromUnixTimeSeconds(400), points[1].Timestamp);
        Assert.AreEqual(102.25m, points[1].Price);
    }

    [TestMethod]
    public void YahooParserKeepsLatestQuoteWhenIntradayHistoryIsMissing()
    {
        const string message = """
            {
              "chart": {
                "result": [{
                  "meta": { "regularMarketPrice": 202.5 },
                  "timestamp": ["bad"],
                  "indicators": { "quote": [{ "close": [null, "Infinity"] }] }
                }],
                "error": null
              }
            }
            """;

        Assert.IsTrue(
            YahooChartParser.TryParseQuote(
                message,
                "MSFT",
                DateTimeOffset.UnixEpoch,
                out var quote,
                out var error),
            error);

        Assert.AreEqual(202.5m, quote.Price);
        Assert.IsEmpty(quote.IntradayPoints!);
    }

    [TestMethod]
    public void SparklineGeometryHandlesFlatSingleAndZeroSizedInputs()
    {
        var flat = SparklineGeometry.Normalize([12m, 12m, 12m], 100, 20);
        Assert.HasCount(3, flat);
        Assert.IsTrue(flat.All(point => point.Y == 10));

        var single = SparklineGeometry.Normalize([12m], 100, 20);
        Assert.HasCount(1, single);
        Assert.AreEqual(50d, single[0].X);
        Assert.AreEqual(10d, single[0].Y);

        Assert.IsEmpty(SparklineGeometry.Normalize([1m, 2m], 0, 20));
        Assert.IsEmpty(SparklineGeometry.Normalize([1m, 2m], 100, 0));
    }

    [TestMethod]
    public void SparklineGeometryIncludesPreviousCloseReferenceInDomain()
    {
        var points = SparklineGeometry.Normalize([100m, 110m], 100, 20, 120m);

        Assert.HasCount(2, points);
        Assert.AreEqual(20d, points[0].Y);
        Assert.AreEqual(10d, points[1].Y);
        Assert.IsTrue(
            SparklineGeometry.TryNormalizeReference(
                [100m, 110m],
                120m,
                20,
                out var referenceY));
        Assert.AreEqual(0d, referenceY);
    }

    [TestMethod]
    public void StateUpdatesChartWithoutChangingDailyBaseline()
    {
        var state = new StockTickerState("AAPL");
        state.Apply(new QuoteTick(
            "AAPL",
            100,
            DateTimeOffset.UnixEpoch,
            [new IntradayPoint(DateTimeOffset.UnixEpoch, 99)],
            PreviousClose: 99m));
        state.Apply(new QuoteTick(
            "AAPL",
            102,
            DateTimeOffset.UnixEpoch.AddMinutes(1),
            [
                new IntradayPoint(DateTimeOffset.UnixEpoch, 99),
                new IntradayPoint(DateTimeOffset.UnixEpoch.AddMinutes(1), 102)
            ],
            PreviousClose: 99m));

        Assert.AreEqual(99m, state.DailyBaseline);
        Assert.AreEqual(3m, state.DailyChange);
        Assert.HasCount(2, state.IntradayPoints);
        Assert.AreEqual(102m, state.IntradayPoints[1].Price);
    }

    [TestMethod]
    public void StateUsesPreviousCloseForChangeAndDirection()
    {
        var state = new StockTickerState("MSFT");
        state.Apply(new QuoteTick(
            "MSFT",
            499.21m,
            DateTimeOffset.UnixEpoch,
            [
                new IntradayPoint(DateTimeOffset.UnixEpoch, 488.89m),
                new IntradayPoint(DateTimeOffset.UnixEpoch.AddMinutes(1), 499.21m)
            ],
            PreviousClose: 487.46m));

        Assert.AreEqual(487.46m, state.DailyBaseline);
        Assert.AreEqual(11.75m, state.DailyChange);
        Assert.AreEqual(PriceDirection.Up, state.DailyDirection);

        var card = new TickerCardViewModel("MSFT");
        card.Apply(state);
        StringAssert.Contains(card.ChartTooltipText, "Previous close: 487.46");
        StringAssert.Contains(card.ChartTooltipText, "Day low");
    }

    [TestMethod]
    public void DivergentDailyAndIntradayDirectionsUseDailyBrush()
    {
        var state = new StockTickerState("DRAM");
        state.Apply(new QuoteTick(
            "DRAM",
            51.52m,
            DateTimeOffset.UnixEpoch,
            [
                new IntradayPoint(DateTimeOffset.UnixEpoch, 49.36m),
                new IntradayPoint(DateTimeOffset.UnixEpoch.AddMinutes(1), 48.945m),
                new IntradayPoint(DateTimeOffset.UnixEpoch.AddMinutes(2), 52.95m),
                new IntradayPoint(DateTimeOffset.UnixEpoch.AddMinutes(3), 51.52m)
            ],
            PreviousClose: 53.74m));

        Assert.AreEqual(PriceDirection.Down, state.DailyDirection);
        Assert.AreEqual(PriceDirection.Up, state.IntradayTrendDirection);

        var card = new TickerCardViewModel("DRAM");
        card.Apply(state);

        Assert.AreEqual(
            Color.FromRgb(242, 123, 131),
            ((SolidColorBrush)card.DailyDirectionBrush).Color);
        var referenceStroke =
            (Brush)SparklineControl.ReferenceStrokeProperty.DefaultMetadata.DefaultValue;
        Assert.AreEqual(
            Color.FromRgb(214, 222, 230),
            ((SolidColorBrush)referenceStroke).Color);
        Assert.AreNotSame(card.DailyDirectionBrush, referenceStroke);
        Assert.AreEqual(51.52m, card.ChartValues[^1]);
    }

    [TestMethod]
    public void CollectionStateTracksMultipleQuotesIndependently()
    {
        var state = new TickerCollectionState();
        state.Reset(["AAPL", "MSFT"]);

        Assert.IsTrue(state.Apply(new QuoteTick(
            "AAPL",
            100,
            DateTimeOffset.UnixEpoch,
            PreviousClose: 100m)));
        Assert.IsTrue(state.Apply(new QuoteTick(
            "MSFT",
            200,
            DateTimeOffset.UnixEpoch.AddSeconds(1),
            PreviousClose: 200m)));
        Assert.IsTrue(state.Apply(new QuoteTick(
            "AAPL",
            101.5m,
            DateTimeOffset.UnixEpoch.AddSeconds(2),
            PreviousClose: 100m)));

        Assert.AreEqual(101.5m, state.Get("aapl")!.CurrentPrice);
        Assert.AreEqual(1.5m, state.Get("AAPL")!.DailyChange);
        Assert.AreEqual(200m, state.Get("MSFT")!.CurrentPrice);

        state.SetSymbols(["MSFT", "NVDA"]);
        Assert.IsNull(state.Get("AAPL"));
        Assert.AreEqual(200m, state.Get("MSFT")!.CurrentPrice);
        Assert.IsFalse(state.Get("NVDA")!.HasTrade);
    }

    [TestMethod]
    public void MultipleSymbolsUseTheirOwnPreviousCloseForChangeColorAndReference()
    {
        const string aaplMessage = """
            {
              "chart": {
                "result": [{
                  "meta": { "regularMarketPrice": 110, "previousClose": 100 },
                  "timestamp": [1, 2],
                  "indicators": { "quote": [{ "close": [101, 110] }] }
                }],
                "error": null
              }
            }
            """;
        const string msftMessage = """
            {
              "chart": {
                "result": [{
                  "meta": { "regularMarketPrice": 90, "previousClose": 120 },
                  "timestamp": [1, 2],
                  "indicators": { "quote": [{ "close": [119, 90] }] }
                }],
                "error": null
              }
            }
            """;

        Assert.IsTrue(
            YahooChartParser.TryParseQuote(
                aaplMessage,
                "AAPL",
                DateTimeOffset.UnixEpoch,
                out var aaplQuote,
                out var aaplError),
            aaplError);
        Assert.IsTrue(
            YahooChartParser.TryParseQuote(
                msftMessage,
                "MSFT",
                DateTimeOffset.UnixEpoch,
                out var msftQuote,
                out var msftError),
            msftError);

        var collection = new TickerCollectionState();
        collection.Reset(["AAPL", "MSFT"]);
        Assert.IsTrue(collection.Apply(aaplQuote));
        Assert.IsTrue(collection.Apply(msftQuote));

        var aaplState = collection.Get("AAPL")!;
        var msftState = collection.Get("MSFT")!;
        Assert.AreEqual(100m, aaplState.DailyBaseline);
        Assert.AreEqual(10m, aaplState.DailyChange);
        Assert.AreEqual(PriceDirection.Up, aaplState.DailyDirection);
        Assert.AreEqual(120m, msftState.DailyBaseline);
        Assert.AreEqual(-30m, msftState.DailyChange);
        Assert.AreEqual(PriceDirection.Down, msftState.DailyDirection);

        var aaplCard = new TickerCardViewModel("AAPL");
        aaplCard.Apply(aaplState);
        var msftCard = new TickerCardViewModel("MSFT");
        msftCard.Apply(msftState);
        Assert.AreEqual(100m, aaplCard.PreviousCloseReference);
        Assert.AreEqual(120m, msftCard.PreviousCloseReference);
        StringAssert.Contains(aaplCard.ChartTooltipText, "Previous close: 100.00");
        StringAssert.Contains(msftCard.ChartTooltipText, "Previous close: 120.00");
        Assert.AreEqual(
            Color.FromRgb(80, 211, 148),
            ((SolidColorBrush)aaplCard.DailyDirectionBrush).Color);
        Assert.AreEqual(
            Color.FromRgb(242, 123, 131),
            ((SolidColorBrush)msftCard.DailyDirectionBrush).Color);

        var aaplPoints = SparklineGeometry.Normalize(
            aaplCard.ChartValues,
            100,
            20,
            aaplCard.PreviousCloseReference);
        var msftPoints = SparklineGeometry.Normalize(
            msftCard.ChartValues,
            100,
            20,
            msftCard.PreviousCloseReference);
        Assert.IsTrue(
            SparklineGeometry.TryNormalizeReference(
                aaplCard.ChartValues,
                aaplCard.PreviousCloseReference,
                20,
                out var aaplReferenceY));
        Assert.IsTrue(
            SparklineGeometry.TryNormalizeReference(
                msftCard.ChartValues,
                msftCard.PreviousCloseReference,
                20,
                out var msftReferenceY));
        Assert.IsLessThan(aaplReferenceY, aaplPoints[^1].Y);
        Assert.IsGreaterThan(msftReferenceY, msftPoints[^1].Y);
    }

    [TestMethod]
    public void SettingsParserMigratesLegacySingleSymbolAndIgnoresApiKey()
    {
        var result = SettingsStore.Parse(
            """{"ApiKey":"old-key","Symbol":" msft ","AlwaysOnTop":true}""");

        Assert.HasCount(1, result.Settings.Symbols);
        Assert.AreEqual("MSFT", result.Settings.Symbols[0]);
        StringAssert.Contains(result.Warning, "Migrated");
        Assert.IsTrue(result.RequiresRewrite);
    }

    [TestMethod]
    public void SettingsParserNormalizesAndDeduplicatesSymbols()
    {
        var result = SettingsStore.Parse(
            """{"Symbols":[" aapl ","AAPL","MSFT","bad symbol"]}""");

        CollectionAssert.AreEqual(new[] { "AAPL", "MSFT" }, result.Settings.Symbols);
        StringAssert.Contains(result.Warning, "invalid");
    }

    [TestMethod]
    public void SettingsParserPreservesCaseInsensitiveSymbolProperties()
    {
        var result = SettingsStore.Parse(
            """{"symbols":["MSFT"]}""");

        CollectionAssert.AreEqual(new[] { "MSFT" }, result.Settings.Symbols);
    }

    [TestMethod]
    public void SettingsSaveDoesNotPersistApiKey()
    {
        var path = Path.Combine(
            AppContext.BaseDirectory,
            $"settings-test-{Guid.NewGuid():N}.json");
        try
        {
            var store = new SettingsStore(path);
            store.Save(new AppSettings { Symbols = ["AAPL"] });
            var json = File.ReadAllText(path);
            Assert.DoesNotContain("ApiKey", json, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
    }

    [TestMethod]
    public void SymbolRulesRejectEmptyAndInvalidEntries()
    {
        Assert.IsFalse(SymbolRules.TryNormalize(" ", out _, out var emptyError));
        Assert.IsFalse(SymbolRules.TryNormalize("AAPL!", out _, out var invalidError));
        Assert.IsTrue(SymbolRules.TryNormalize(" msft ", out var normalized, out _));
        Assert.IsTrue(SymbolRules.TryNormalize(" ym=f ", out var futures, out _));
        Assert.AreEqual("MSFT", normalized);
        Assert.AreEqual("YM=F", futures);
        Assert.IsFalse(string.IsNullOrWhiteSpace(emptyError));
        Assert.IsFalse(string.IsNullOrWhiteSpace(invalidError));
    }

    [TestMethod]
    public void SymbolOrderMovesTilesAndPreservesAllSymbols()
    {
        var symbols = new List<string> { "AAPL", "MSFT", "AMD", "NVDA" };

        Assert.IsTrue(SymbolOrder.TryMove(symbols, "AAPL", "AMD"));
        CollectionAssert.AreEqual(
            new[] { "MSFT", "AMD", "AAPL", "NVDA" },
            symbols);

        Assert.IsTrue(SymbolOrder.TryMove(symbols, "NVDA", "MSFT"));
        CollectionAssert.AreEqual(
            new[] { "NVDA", "MSFT", "AMD", "AAPL" },
            symbols);

        Assert.IsFalse(SymbolOrder.TryMove(symbols, "NVDA", "NVDA"));
        Assert.IsFalse(SymbolOrder.TryMove(symbols, "UNKNOWN", "AMD"));
    }

    [TestMethod]
    public void SymbolOrderRemainsVisualOrderIndependentOfColumnCount()
    {
        var symbols = new List<string> { "AAPL", "MSFT", "AMD", "NVDA", "TSLA" };

        Assert.IsTrue(SymbolOrder.TryMove(symbols, "MSFT", "TSLA"));
        CollectionAssert.AreEqual(
            new[] { "AAPL", "AMD", "NVDA", "TSLA", "MSFT" },
            symbols);
    }

    [TestMethod]
    public void LegacyJsonMalformedPayloadStillRaisesJsonException()
    {
        Assert.Throws<JsonException>(() => SettingsStore.Parse("{"));
    }

    [TestMethod]
    public void MarketOverviewUsesStableBuiltInIdentityOrderAndPollingSymbols()
    {
        CollectionAssert.AreEqual(
            new[]
            {
                "^DJI",
                "YM=F",
                "^GSPC",
                "ES=F",
                "^IXIC",
                "NQ=F"
            },
            MarketOverviewSymbols.Symbols.ToArray());

        CollectionAssert.AreEqual(
            new[]
            {
                "^DJI",
                "YM=F",
                "^GSPC",
                "ES=F",
                "^IXIC",
                "NQ=F",
                "MSFT",
                "AAPL"
            },
            MarketOverviewSymbols.CombineWithUserSymbols(
                ["MSFT", "^DJI", "AAPL", "^IXIC", "ES=F"]).ToArray());
        Assert.IsTrue(MarketOverviewSymbols.IsBuiltIn("^DJI"));
        Assert.IsTrue(MarketOverviewSymbols.IsBuiltIn("^gspc"));
        Assert.IsTrue(MarketOverviewSymbols.IsBuiltIn("YM=F"));
        Assert.AreEqual(
            "^GSPC",
            MarketOverviewSymbols.FindBySymbol("es=f")?.Symbol);
    }

    [TestMethod]
    public void BuiltInIndexesAreRemovedFromPersistedUserSymbols()
    {
        var result = SettingsStore.Parse(
            """{"Symbols":["MSFT","^DJI","ES=F","^GSPC","AAPL"]}""");

        CollectionAssert.AreEqual(new[] { "MSFT", "AAPL" }, result.Settings.Symbols);
    }

    [TestMethod]
    public void MarketOverviewNormalizesEachSeriesToItsOwnPreviousCloseAndIncludesZero()
    {
        var state = new StockTickerState("^DJI");
        Assert.IsTrue(
            state.Apply(new QuoteTick(
                "^DJI",
                110,
                DateTimeOffset.UnixEpoch.AddMinutes(2),
                [
                    new IntradayPoint(
                        DateTimeOffset.UnixEpoch,
                        100,
                        MarketSession.Regular),
                    new IntradayPoint(
                        DateTimeOffset.UnixEpoch.AddMinutes(1),
                        105,
                        MarketSession.Regular),
                    new IntradayPoint(
                        DateTimeOffset.UnixEpoch.AddMinutes(2),
                        110,
                        MarketSession.Regular)
                ],
                PreviousClose: 100)));

        var normalized = MarketOverviewSeriesNormalizer.Normalize(state);
        Assert.AreEqual(0m, normalized[0].PercentChange);
        Assert.AreEqual(5m, normalized[1].PercentChange);
        Assert.AreEqual(10m, normalized[2].PercentChange);
        Assert.IsTrue(
            CompositeChartMath.TryGetDomain(
                [normalized],
                out var minimum,
                out var maximum));
        Assert.IsLessThanOrEqualTo(0m, minimum);
        Assert.IsGreaterThanOrEqualTo(0m, maximum);
    }

    [TestMethod]
    public void MarketOverviewUsesEachIndexOwnPreviousCloseIndependently()
    {
        var overview = new MarketOverviewViewModel();
        Assert.IsTrue(
            overview.Apply(new QuoteTick(
                "^DJI",
                110,
                DateTimeOffset.UnixEpoch.AddMinutes(2),
                [
                    new IntradayPoint(
                        DateTimeOffset.UnixEpoch,
                        100,
                        MarketSession.Regular),
                    new IntradayPoint(
                        DateTimeOffset.UnixEpoch.AddMinutes(2),
                        110,
                        MarketSession.Regular)
                ],
                PreviousClose: 100)));
        Assert.IsTrue(
            overview.Apply(new QuoteTick(
                "^GSPC",
                210,
                DateTimeOffset.UnixEpoch.AddMinutes(2),
                [
                    new IntradayPoint(
                        DateTimeOffset.UnixEpoch,
                        200,
                        MarketSession.Regular),
                    new IntradayPoint(
                        DateTimeOffset.UnixEpoch.AddMinutes(2),
                        210,
                        MarketSession.Regular)
                ],
                PreviousClose: 200)));

        var dow = overview.IndexCards.Single(card => card.Symbol == "^DJI");
        var sp = overview.IndexCards.Single(card => card.Symbol == "^GSPC");
        Assert.AreEqual("110.00", dow.PriceText);
        Assert.AreEqual("▲ +10.00 (+10.00%)", dow.ChangeText);
        Assert.AreEqual("210.00", sp.PriceText);
        Assert.AreEqual("▲ +10.00 (+5.00%)", sp.ChangeText);
        Assert.AreEqual(10m, dow.SeriesPoints[^1].PercentChange);
        Assert.AreEqual(5m, sp.SeriesPoints[^1].PercentChange);
        Assert.AreEqual(
            2,
            overview.ChartSeries
                .SelectMany(series => series.Points)
                .Where(point => point.PercentChange == 0m)
                .Count(point => point.Timestamp == DateTimeOffset.UnixEpoch));
    }

    [TestMethod]
    public void MarketOverviewPairsCashIndexesWithIndependentFuturesRows()
    {
        var overview = new MarketOverviewViewModel();
        Assert.IsTrue(
            overview.Apply(new QuoteTick(
                "^DJI",
                110,
                DateTimeOffset.UnixEpoch,
                [new IntradayPoint(
                    DateTimeOffset.UnixEpoch,
                    110,
                    MarketSession.Regular)],
                PreviousClose: 100)));
        Assert.IsTrue(
            overview.Apply(new QuoteTick(
                "YM=F",
                205,
                DateTimeOffset.UnixEpoch,
                [new IntradayPoint(
                    DateTimeOffset.UnixEpoch,
                    205,
                    MarketSession.Regular)],
                PreviousClose: 200)));

        var dow = overview.IndexCards.Single(card => card.Symbol == "^DJI");
        Assert.AreEqual("YM=F", dow.FuturesSymbol);
        Assert.AreEqual("110.00", dow.PriceText);
        Assert.AreEqual("205.00", dow.FuturesPriceText);
        Assert.AreEqual("▲ +10.00 (+10.00%)", dow.ChangeText);
        Assert.AreEqual("▲ +5.00 (+2.50%)", dow.FuturesChangeText);
        Assert.AreEqual("Cash index", dow.CashSessionIconName);
        Assert.AreEqual("Index futures", dow.FuturesSessionIconName);
        StringAssert.Contains(dow.TooltipText, "Cash index 110.00");
        StringAssert.Contains(dow.TooltipText, "Futures 205.00");
        Assert.HasCount(1, overview.ChartSeries);
        Assert.AreEqual("DOW", overview.ChartSeries[0].Label);
    }

    [TestMethod]
    public void MarketOverviewFuturesFailureDoesNotRemoveCashIndexSeries()
    {
        var overview = new MarketOverviewViewModel();
        Assert.IsTrue(
            overview.Apply(new QuoteTick(
                "^GSPC",
                210,
                DateTimeOffset.UnixEpoch,
                [new IntradayPoint(
                    DateTimeOffset.UnixEpoch,
                    210,
                    MarketSession.Regular)],
                PreviousClose: 200)));

        Assert.IsTrue(overview.SetError("ES=F", "futures unavailable"));

        var sp = overview.IndexCards.Single(card => card.Symbol == "^GSPC");
        Assert.AreEqual("210.00", sp.PriceText);
        Assert.AreEqual("--", sp.FuturesPriceText);
        Assert.IsEmpty(sp.FuturesChangeText);
        Assert.HasCount(1, overview.ChartSeries);
        Assert.AreEqual("S&P", overview.ChartSeries[0].Label);
        StringAssert.Contains(sp.TooltipText, "Futures unavailable");
    }

    [TestMethod]
    public void MarketOverviewHidesFuturesRowDuringRegularCashSession()
    {
        var overview = new MarketOverviewViewModel();
        var sp = overview.IndexCards.Single(card => card.Symbol == "^GSPC");
        var changedProperties = new List<string?>();
        sp.PropertyChanged += (_, change) =>
            changedProperties.Add(change.PropertyName);
        Assert.IsTrue(
            overview.Apply(new QuoteTick(
                "ES=F",
                205,
                DateTimeOffset.UnixEpoch,
                PreviousClose: 200,
                Session: MarketSession.Regular)));
        Assert.IsTrue(
            overview.Apply(new QuoteTick(
                "^GSPC",
                110,
                DateTimeOffset.UnixEpoch,
                PreviousClose: 100,
                Session: MarketSession.Regular)));

        Assert.AreEqual(Visibility.Collapsed, sp.FuturesVisibility);
        CollectionAssert.Contains(
            changedProperties,
            nameof(MarketOverviewIndexViewModel.FuturesVisibility));

        Assert.IsTrue(
            overview.Apply(new QuoteTick(
                "^GSPC",
                110,
                DateTimeOffset.UnixEpoch.AddHours(8),
                PreviousClose: 100,
                Session: MarketSession.Closed)));

        Assert.AreEqual(Visibility.Visible, sp.FuturesVisibility);
        Assert.AreEqual("205.00", sp.FuturesPriceText);
    }

    [TestMethod]
    public void MarketOverviewKeepsOtherIndexesWhenOneFailsAndUsesDistinctSeries()
    {
        var overview = new MarketOverviewViewModel();
        Assert.IsTrue(
            overview.Apply(new QuoteTick(
                "^DJI",
                110,
                DateTimeOffset.UnixEpoch.AddMinutes(2),
                [
                    new IntradayPoint(
                        DateTimeOffset.UnixEpoch,
                        100,
                        MarketSession.Regular),
                    new IntradayPoint(
                        DateTimeOffset.UnixEpoch.AddMinutes(1),
                        110,
                        MarketSession.Regular)
                ],
                PreviousClose: 100)));
        Assert.IsTrue(
            overview.Apply(new QuoteTick(
                "^IXIC",
                90,
                DateTimeOffset.UnixEpoch.AddMinutes(2),
                [
                    new IntradayPoint(
                        DateTimeOffset.UnixEpoch,
                        100,
                        MarketSession.Regular),
                    new IntradayPoint(
                        DateTimeOffset.UnixEpoch.AddMinutes(1),
                        90,
                        MarketSession.Regular)
                ],
                PreviousClose: 100)));

        Assert.IsTrue(overview.SetError("^GSPC", "index unavailable"));
        var dow = overview.IndexCards.Single(card => card.Symbol == "^DJI");
        var sp = overview.IndexCards.Single(card => card.Symbol == "^GSPC");
        var nasdaq = overview.IndexCards.Single(card => card.Symbol == "^IXIC");
        Assert.AreEqual("110.00", dow.PriceText);
        Assert.AreEqual("• Unavailable", sp.ChangeText);
        Assert.AreEqual("90.00", nasdaq.PriceText);
        Assert.HasCount(2, overview.ChartSeries);
        Assert.AreEqual("DOW", overview.ChartSeries[0].Label);
        Assert.AreEqual("NASDAQ", overview.ChartSeries[1].Label);
        Assert.AreNotSame(
            overview.ChartSeries[0].Stroke,
            overview.ChartSeries[1].Stroke);
    }

    [TestMethod]
    public void YahooChartUrlEscapesCaretBuiltInSymbols()
    {
        var url = YahooFinancePollingClient.BuildChartUrl("^DJI");

        StringAssert.Contains(url, "/%5EDJI?");
        StringAssert.Contains(url, "includePrePost=true");
    }

    [TestMethod]
    public void YahooOvernightUrlRequestsBatchOvernightFields()
    {
        var url = YahooFinancePollingClient.BuildOvernightQuoteUrl(
            ["AMD", "MSFT"],
            "a/b");

        StringAssert.Contains(url, "symbols=AMD,MSFT");
        StringAssert.Contains(url, "overnightMarketPrice");
        StringAssert.Contains(url, "overnightPrice=true");
        StringAssert.Contains(url, "crumb=a%2Fb");
    }

    [TestMethod]
    public void YahooClientDoesNotRestrictCrumbResponseToJson()
    {
        var createClient = typeof(YahooFinancePollingClient).GetMethod(
            "CreateHttpClient",
            System.Reflection.BindingFlags.Static
                | System.Reflection.BindingFlags.NonPublic);
        Assert.IsNotNull(createClient);
        using var client = (HttpClient)createClient.Invoke(null, null)!;

        Assert.IsEmpty(client.DefaultRequestHeaders.Accept);
    }

    [TestMethod]
    public void MarketOverviewUsesStableDistinctSeriesColorsAndSolidStrokeMetrics()
    {
        var overview = new MarketOverviewViewModel();
        var dow = overview.IndexCards.Single(card => card.Symbol == "^DJI");
        var sp = overview.IndexCards.Single(card => card.Symbol == "^GSPC");
        var nasdaq = overview.IndexCards.Single(card => card.Symbol == "^IXIC");

        Assert.AreEqual("DOW", dow.Label);
        Assert.AreEqual("S&P", sp.Label);
        Assert.AreEqual("NASDAQ", nasdaq.Label);
        Assert.AreEqual(
            Color.FromRgb(59, 130, 246),
            ((SolidColorBrush)dow.SeriesBrush).Color);
        Assert.AreEqual(
            Color.FromRgb(251, 191, 36),
            ((SolidColorBrush)sp.SeriesBrush).Color);
        Assert.AreEqual(
            Color.FromRgb(244, 114, 182),
            ((SolidColorBrush)nasdaq.SeriesBrush).Color);
        Assert.AreNotSame(dow.SeriesBrush, sp.SeriesBrush);
        Assert.AreNotSame(sp.SeriesBrush, nasdaq.SeriesBrush);
        Assert.AreNotSame(dow.SeriesBrush, nasdaq.SeriesBrush);
        var pens = new[]
        {
            CompositeSparklineControl.CreateSeriesPen(dow.SeriesBrush),
            CompositeSparklineControl.CreateSeriesPen(sp.SeriesBrush),
            CompositeSparklineControl.CreateSeriesPen(nasdaq.SeriesBrush)
        };
        Assert.AreEqual(0, pens.Sum(pen => pen.DashStyle.Dashes.Count));
        Assert.AreEqual(pens[0].Thickness, pens[1].Thickness);
        Assert.AreEqual(pens[1].Thickness, pens[2].Thickness);
        Assert.AreEqual(
            SparklineMetrics.SeriesStrokeThickness,
            pens[0].Thickness,
            0.000001d);
        Assert.AreEqual(
            SparklineMetrics.SeriesStrokeThickness,
            (double)SparklineControl.StrokeThicknessProperty
                .DefaultMetadata.DefaultValue,
            0.000001d);
        var referencePen = CompositeSparklineControl.CreateReferencePen(
            new SolidColorBrush(Color.FromRgb(127, 139, 150)));
        Assert.AreEqual(
            SparklineMetrics.ReferenceStrokeThickness,
            referencePen.Thickness,
            0.000001d);
        Assert.AreEqual(0, referencePen.DashStyle.Dashes.Count);
        Assert.IsLessThan(pens[0].Thickness, referencePen.Thickness);

        var palette = new[]
        {
            ((SolidColorBrush)dow.SeriesBrush).Color,
            ((SolidColorBrush)sp.SeriesBrush).Color,
            ((SolidColorBrush)nasdaq.SeriesBrush).Color
        };
        var reference = Color.FromRgb(127, 139, 150);
        for (var first = 0; first < palette.Length; first++)
        {
            Assert.IsGreaterThan(
                80d,
                ColorDistance(palette[first], reference),
                "Overview series color is too close to the neutral reference line.");
            for (var second = first + 1; second < palette.Length; second++)
            {
                Assert.IsGreaterThan(
                    80d,
                    ColorDistance(palette[first], palette[second]),
                    "Overview series colors are not sufficiently distinct.");
            }
        }
    }

    private static double ColorDistance(Color first, Color second) =>
        Math.Sqrt(
            Math.Pow(first.R - second.R, 2)
            + Math.Pow(first.G - second.G, 2)
            + Math.Pow(first.B - second.B, 2));

    private static HttpResponseMessage JsonResponse(string json) =>
        new(HttpStatusCode.OK)
        {
            Content = new StringContent(
                json,
                System.Text.Encoding.UTF8,
                "application/json")
        };

    private sealed class StubHttpMessageHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _responseFactory;

        public StubHttpMessageHandler(Func<HttpResponseMessage> responseFactory)
            : this(_ => responseFactory())
        {
        }

        public StubHttpMessageHandler(
            Func<HttpRequestMessage, HttpResponseMessage> responseFactory)
        {
            _responseFactory = responseFactory;
        }

        public TaskCompletionSource<bool> RequestObserved { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Uri? LastRequestUri { get; private set; }

        public IReadOnlyList<Uri> RequestUris
        {
            get
            {
                lock (_requestUris)
                {
                    return _requestUris.ToArray();
                }
            }
        }

        public int RequestCount => Volatile.Read(ref _requestCount);

        private int _requestCount;
        private readonly List<Uri> _requestUris = [];

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _requestCount);
            LastRequestUri = request.RequestUri;
            if (request.RequestUri is { } requestUri)
            {
                lock (_requestUris)
                {
                    _requestUris.Add(requestUri);
                }
            }
            RequestObserved.TrySetResult(true);
            return Task.FromResult(_responseFactory(request));
        }
    }

    private sealed class StubGlobalHotkeyApi : IGlobalHotkeyApi
    {
        private readonly bool _registerResult;

        public StubGlobalHotkeyApi(bool registerResult)
        {
            _registerResult = registerResult;
        }

        public int RegisterCalls { get; private set; }

        public int UnregisterCalls { get; private set; }

        public bool RegisterHotKey(
            IntPtr windowHandle,
            int id,
            uint modifiers,
            uint virtualKey)
        {
            RegisterCalls++;
            return _registerResult;
        }

        public bool UnregisterHotKey(IntPtr windowHandle, int id)
        {
            UnregisterCalls++;
            return true;
        }
    }
}
