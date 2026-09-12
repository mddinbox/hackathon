using System.IO;
using System.Net;
using System.Net.Http;
using FloatingStockTicker.Models;

namespace FloatingStockTicker.Services;

public enum PollingConnectionState
{
    Disconnected,
    WaitingForSymbols,
    Polling,
    Waiting,
    Paused,
    Stopping
}

public sealed record PollingStatus(PollingConnectionState State, string Message);

public sealed record SymbolPollError(string Symbol, string Message);

public sealed record YahooRefreshCompleted(
    DateTimeOffset CompletedAt,
    int SuccessfulQuotes,
    int RequestedSymbols);

public sealed class YahooFinancePollingClient : IAsyncDisposable
{
    public static readonly TimeSpan DefaultPollInterval = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan YahooSessionRetryDelay =
        TimeSpan.FromMinutes(5);

    private readonly HttpClient _httpClient;
    private readonly object _pollIntervalGate = new();
    private readonly SemaphoreSlim _lifecycleGate = new(1, 1);
    private readonly SemaphoreSlim _pollSignal = new(0, 1);
    private readonly object _symbolsGate = new();
    private TimeSpan _pollInterval;
    private CancellationTokenSource? _pollCts;
    private Task? _pollTask;
    private string[] _symbols = [];
    private bool _isPaused;
    private string? _yahooCrumb;
    private DateTimeOffset _nextYahooSessionAttempt = DateTimeOffset.MinValue;

    public YahooFinancePollingClient(TimeSpan? pollInterval = null, HttpClient? httpClient = null)
    {
        _pollInterval = pollInterval ?? DefaultPollInterval;
        if (_pollInterval <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(
                nameof(pollInterval),
                "The polling interval must be greater than zero.");
        }

        _httpClient = httpClient ?? CreateHttpClient();
    }

    public TimeSpan PollInterval
    {
        get
        {
            lock (_pollIntervalGate)
            {
                return _pollInterval;
            }
        }
    }

    public bool IsPaused => Volatile.Read(ref _isPaused);

    public event EventHandler<PollingStatus>? StatusChanged;

    public event EventHandler<QuoteTick>? QuoteReceived;

    public event EventHandler<SymbolPollError>? SymbolError;

    public event EventHandler<YahooRefreshCompleted>? RefreshCompleted;

    public async Task StartAsync(IReadOnlyCollection<string> symbols)
    {
        await _lifecycleGate.WaitAsync().ConfigureAwait(false);
        try
        {
            await StopCoreAsync().ConfigureAwait(false);
            SetSymbols(symbols);
            if (GetSymbols().Length == 0)
            {
                PublishWaitingOrPausedStatus();
                return;
            }

            if (IsPaused)
            {
                PublishStatus(PollingConnectionState.Paused, "Polling paused");
                return;
            }

            StartPollLoop();
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    public async Task UpdateSymbolsAsync(IReadOnlyCollection<string> symbols)
    {
        await _lifecycleGate.WaitAsync().ConfigureAwait(false);
        try
        {
            SetSymbols(symbols);
            if (_pollCts is null)
            {
                if (GetSymbols().Length == 0)
                {
                    PublishWaitingOrPausedStatus();
                    return;
                }

                if (IsPaused)
                {
                    PublishStatus(PollingConnectionState.Paused, "Polling paused");
                    return;
                }

                StartPollLoop();
                return;
            }

            SignalPoll();
            if (GetSymbols().Length == 0)
            {
                PublishStatus(PollingConnectionState.WaitingForSymbols, "Add a symbol to start Yahoo Finance polling");
            }
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    public async Task UpdatePollIntervalAsync(TimeSpan pollInterval)
    {
        if (pollInterval <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(
                nameof(pollInterval),
                "The polling interval must be greater than zero.");
        }

        await _lifecycleGate.WaitAsync().ConfigureAwait(false);
        try
        {
            lock (_pollIntervalGate)
            {
                _pollInterval = pollInterval;
            }

            SignalPoll();
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    public async Task PauseAsync(string? message = null)
    {
        await _lifecycleGate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (!IsPaused)
            {
                Volatile.Write(ref _isPaused, true);
                await StopCoreAsync(publishStopped: false).ConfigureAwait(false);
            }

            PublishStatus(
                PollingConnectionState.Paused,
                string.IsNullOrWhiteSpace(message) ? "Polling paused" : message);
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    public async Task ResumeAsync()
    {
        await _lifecycleGate.WaitAsync().ConfigureAwait(false);
        try
        {
            if (!IsPaused)
            {
                SignalPoll();
                return;
            }

            Volatile.Write(ref _isPaused, false);
            if (GetSymbols().Length == 0)
            {
                PublishStatus(PollingConnectionState.WaitingForSymbols, "Add a symbol to start Yahoo Finance polling");
                return;
            }

            StartPollLoop();
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    public async Task StopAsync()
    {
        await _lifecycleGate.WaitAsync().ConfigureAwait(false);
        try
        {
            await StopCoreAsync().ConfigureAwait(false);
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    private async Task PollLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            if (IsPaused)
            {
                break;
            }

            var symbols = GetSymbols();
            if (symbols.Length == 0)
            {
                PublishStatus(PollingConnectionState.WaitingForSymbols, "Add a symbol to start Yahoo Finance polling");
                await WaitForNextCycleAsync(cancellationToken).ConfigureAwait(false);
                continue;
            }

            var results = new List<SymbolPollResult>(symbols.Length);
            PublishStatus(
                PollingConnectionState.Polling,
                $"Polling Yahoo Finance · {symbols.Length} symbol{(symbols.Length == 1 ? string.Empty : "s")}");

            foreach (var symbol in symbols)
            {
                if (cancellationToken.IsCancellationRequested
                    || IsPaused
                    || !IsConfigured(symbol))
                {
                    continue;
                }

                var result = await PollSymbolAsync(symbol, cancellationToken).ConfigureAwait(false);
                if (!IsConfigured(symbol))
                {
                    continue;
                }

                results.Add(new SymbolPollResult(
                    symbol,
                    result.Quote,
                    result.Error));
            }

            var closedSymbols = results
                .Where(result => result.Quote?.Session == MarketSession.Closed)
                .Select(result => result.Symbol)
                .ToArray();
            if (closedSymbols.Length > 0)
            {
                var overnightQuotes = await PollOvernightQuotesAsync(
                    closedSymbols,
                    cancellationToken).ConfigureAwait(false);
                for (var index = 0; index < results.Count; index++)
                {
                    var result = results[index];
                    if (result.Quote is not null
                        && overnightQuotes.TryGetValue(
                            result.Symbol,
                            out var overnightQuote))
                    {
                        results[index] = result with
                        {
                            Quote = result.Quote with
                            {
                                ExtendedPrice = overnightQuote.Price,
                                ExtendedTimestamp = overnightQuote.Timestamp,
                                ExtendedSession = MarketSession.Overnight
                            }
                        };
                    }
                }
            }

            if (cancellationToken.IsCancellationRequested || IsPaused)
            {
                break;
            }

            var successful = 0;
            foreach (var result in results)
            {
                if (!IsConfigured(result.Symbol))
                {
                    continue;
                }

                if (result.Quote is not null)
                {
                    successful++;
                    QuoteReceived?.Invoke(this, result.Quote);
                }
                else if (!string.IsNullOrWhiteSpace(result.Error))
                {
                    SymbolError?.Invoke(
                        this,
                        new SymbolPollError(result.Symbol, result.Error));
                }
            }

            if (successful > 0)
            {
                RefreshCompleted?.Invoke(
                    this,
                    new YahooRefreshCompleted(
                        DateTimeOffset.UtcNow,
                        successful,
                        symbols.Length));
            }

            PublishStatus(
                PollingConnectionState.Waiting,
                $"Yahoo Finance · {successful}/{symbols.Length} updated · next poll in {PollInterval.TotalSeconds:0}s");
            await WaitForNextCycleAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task<(QuoteTick? Quote, string? Error)> PollSymbolAsync(
        string symbol,
        CancellationToken cancellationToken)
    {
        var url = BuildChartUrl(symbol);

        try
        {
            using var response = await _httpClient.GetAsync(
                url,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken).ConfigureAwait(false);

            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                return (null, "Yahoo Finance rate-limited this symbol (HTTP 429).");
            }

            if (!response.IsSuccessStatusCode)
            {
                return (null, $"Yahoo Finance returned HTTP {(int)response.StatusCode}.");
            }

            var json = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            return YahooChartParser.TryParseQuote(
                    json,
                    symbol,
                    DateTimeOffset.UtcNow,
                    out var quote,
                    out var error)
                ? (quote, null)
                : (null, error);
        }
        catch (TaskCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return (null, null);
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return (null, "Yahoo Finance request timed out.");
        }
        catch (HttpRequestException ex)
        {
            return (null, $"Yahoo Finance network error: {ex.Message}");
        }
        catch (IOException ex)
        {
            return (null, $"Yahoo Finance response error: {ex.Message}");
        }
    }

    public static string BuildChartUrl(string symbol) =>
        $"https://query1.finance.yahoo.com/v8/finance/chart/{Uri.EscapeDataString(symbol)}" +
        "?interval=1m&range=1d&includePrePost=true";

    public static string BuildOvernightQuoteUrl(
        IReadOnlyCollection<string> symbols,
        string crumb)
    {
        var symbolList = string.Join(
            ",",
            symbols.Select(Uri.EscapeDataString));
        return "https://query1.finance.yahoo.com/v7/finance/quote" +
            $"?symbols={symbolList}" +
            "&fields=regularMarketPrice%2CpostMarketPrice%2CpostMarketTime" +
            "%2CovernightMarketPrice%2CovernightMarketTime" +
            "%2CovernightMarketChange%2CovernightMarketChangePercent" +
            "%2CmarketState" +
            "&formatted=false&overnightPrice=true&region=US&lang=en-US" +
            $"&crumb={Uri.EscapeDataString(crumb)}";
    }

    private async Task<IReadOnlyDictionary<string, YahooOvernightQuote>>
        PollOvernightQuotesAsync(
            IReadOnlyCollection<string> symbols,
            CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var crumb = await GetYahooCrumbAsync(cancellationToken)
                .ConfigureAwait(false);
            if (string.IsNullOrWhiteSpace(crumb))
            {
                return new Dictionary<string, YahooOvernightQuote>();
            }

            try
            {
                using var response = await _httpClient.GetAsync(
                    BuildOvernightQuoteUrl(symbols, crumb),
                    HttpCompletionOption.ResponseHeadersRead,
                    cancellationToken).ConfigureAwait(false);

                if (response.StatusCode is HttpStatusCode.Unauthorized
                    or HttpStatusCode.Forbidden)
                {
                    _yahooCrumb = null;
                    _nextYahooSessionAttempt = DateTimeOffset.MinValue;
                    continue;
                }

                if (!response.IsSuccessStatusCode)
                {
                    return new Dictionary<string, YahooOvernightQuote>();
                }

                var json = await response.Content.ReadAsStringAsync(
                    cancellationToken).ConfigureAwait(false);
                return YahooOvernightQuoteParser.Parse(json);
            }
            catch (TaskCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return new Dictionary<string, YahooOvernightQuote>();
            }
            catch (TaskCanceledException)
            {
                return new Dictionary<string, YahooOvernightQuote>();
            }
            catch (HttpRequestException)
            {
                return new Dictionary<string, YahooOvernightQuote>();
            }
            catch (IOException)
            {
                return new Dictionary<string, YahooOvernightQuote>();
            }
        }

        DelayYahooSessionRetry();
        return new Dictionary<string, YahooOvernightQuote>();
    }

    private async Task<string?> GetYahooCrumbAsync(
        CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(_yahooCrumb))
        {
            return _yahooCrumb;
        }

        if (DateTimeOffset.UtcNow < _nextYahooSessionAttempt)
        {
            return null;
        }

        try
        {
            using (await _httpClient.GetAsync(
                       "https://fc.yahoo.com",
                       HttpCompletionOption.ResponseHeadersRead,
                       cancellationToken).ConfigureAwait(false))
            {
            }

            using var response = await _httpClient.GetAsync(
                "https://query1.finance.yahoo.com/v1/test/getcrumb",
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                DelayYahooSessionRetry();
                return null;
            }

            var crumb = (await response.Content.ReadAsStringAsync(
                cancellationToken).ConfigureAwait(false)).Trim();
            if (string.IsNullOrWhiteSpace(crumb)
                || crumb.StartsWith('{')
                || crumb.StartsWith('<'))
            {
                DelayYahooSessionRetry();
                return null;
            }

            _yahooCrumb = crumb;
            _nextYahooSessionAttempt = DateTimeOffset.MinValue;
            return crumb;
        }
        catch (TaskCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return null;
        }
        catch (TaskCanceledException)
        {
            DelayYahooSessionRetry();
            return null;
        }
        catch (HttpRequestException)
        {
            DelayYahooSessionRetry();
            return null;
        }
        catch (IOException)
        {
            DelayYahooSessionRetry();
            return null;
        }
    }

    private void DelayYahooSessionRetry()
    {
        _nextYahooSessionAttempt =
            DateTimeOffset.UtcNow + YahooSessionRetryDelay;
    }

    private async Task WaitForNextCycleAsync(CancellationToken cancellationToken)
    {
        using var waitCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var delayTask = Task.Delay(PollInterval, waitCts.Token);
        var signalTask = _pollSignal.WaitAsync(waitCts.Token);
        try
        {
            await Task.WhenAny(delayTask, signalTask).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        finally
        {
            waitCts.Cancel();
        }
    }

    private async Task StopCoreAsync(bool publishStopped = true)
    {
        if (_pollCts is null)
        {
            return;
        }

        if (publishStopped)
        {
            PublishStatus(PollingConnectionState.Stopping, "Stopping Yahoo Finance polling");
        }

        _pollCts.Cancel();
        var pollTask = _pollTask;
        if (pollTask is not null)
        {
            try
            {
                await pollTask.ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
            }
        }

        _pollTask = null;
        _pollCts.Dispose();
        _pollCts = null;
        if (publishStopped)
        {
            PublishStatus(PollingConnectionState.Disconnected, "Yahoo Finance polling stopped");
        }
    }

    private void StartPollLoop()
    {
        if (_pollCts is not null)
        {
            SignalPoll();
            return;
        }

        _pollCts = new CancellationTokenSource();
        _pollTask = PollLoopAsync(_pollCts.Token);
    }

    private void PublishWaitingOrPausedStatus()
    {
        PublishStatus(
            IsPaused
                ? PollingConnectionState.Paused
                : PollingConnectionState.WaitingForSymbols,
            IsPaused
                ? "Polling paused"
                : "Add a symbol to start Yahoo Finance polling");
    }

    private void SetSymbols(IEnumerable<string> symbols)
    {
        lock (_symbolsGate)
        {
            _symbols = SymbolRules.NormalizeList(symbols, out _).ToArray();
        }
    }

    private string[] GetSymbols()
    {
        lock (_symbolsGate)
        {
            return [.. _symbols];
        }
    }

    private bool IsConfigured(string symbol)
    {
        lock (_symbolsGate)
        {
            return _symbols.Contains(symbol, StringComparer.OrdinalIgnoreCase);
        }
    }

    private void SignalPoll()
    {
        if (_pollSignal.CurrentCount == 0)
        {
            _pollSignal.Release();
        }
    }

    private static HttpClient CreateHttpClient()
    {
        var handler = new HttpClientHandler
        {
            CookieContainer = new CookieContainer(),
            UseCookies = true,
            AutomaticDecompression =
                DecompressionMethods.GZip
                | DecompressionMethods.Deflate
        };
        var client = new HttpClient(handler)
        {
            Timeout = TimeSpan.FromSeconds(8)
        };
        client.DefaultRequestHeaders.TryAddWithoutValidation(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
        return client;
    }

    private sealed record SymbolPollResult(
        string Symbol,
        QuoteTick? Quote,
        string? Error);

    private void PublishStatus(PollingConnectionState state, string message)
    {
        StatusChanged?.Invoke(this, new PollingStatus(state, message));
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync().ConfigureAwait(false);
        _httpClient.Dispose();
        _pollSignal.Dispose();
        _lifecycleGate.Dispose();
    }
}
