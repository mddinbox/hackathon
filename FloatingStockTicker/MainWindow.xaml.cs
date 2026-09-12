using System.Collections.ObjectModel;
using System.ComponentModel;
using System.IO;
using System.Net.Http;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using FloatingStockTicker.Models;
using FloatingStockTicker.Services;

namespace FloatingStockTicker;

public partial class MainWindow : Window
{
    private readonly SettingsStore _settingsStore = new();
    private readonly YahooFinancePollingClient _feedClient = new();
    private readonly TickerCollectionState _tickerState = new();
    public MarketOverviewViewModel MarketOverview { get; } = new();
    private readonly SemaphoreSlim _streamingGate = new(1, 1);
    private readonly SemaphoreSlim _scheduleGate = new(1, 1);
    private readonly DispatcherTimer _refreshAgeTimer;
    private readonly DispatcherTimer _scheduleTimer;
    private readonly GlobalHotkeyRegistration _globalHotkeyRegistration = new();
    private HwndSource? _hotkeySource;
    private bool _hotkeyHookAttached;
    private AppSettings _settings = new();
    private DateTimeOffset? _lastSuccessfulRefresh;
    private bool _isShuttingDown;
    private bool _scheduledPauseActive;
    private DateTime? _nextResumeTime;
    private WindowNormalBounds? _boundsBeforeMinimizeOrHide;
    private bool _settingsLoaded;
    private bool _applyingWindowSize;
    private bool _restoringFromGlobalShortcut;
    private double _lastNonMinimizedWidth;
    private double _lastNonMinimizedHeight;
    private Point _tickerDragStart;
    private TickerCardViewModel? _tickerDragCandidate;

    public MainWindow()
    {
        InitializeComponent();
        DataContext = this;
        _feedClient.StatusChanged += FeedClient_OnStatusChanged;
        _feedClient.QuoteReceived += FeedClient_OnQuoteReceived;
        _feedClient.SymbolError += FeedClient_OnSymbolError;
        _feedClient.RefreshCompleted += FeedClient_OnRefreshCompleted;
        _refreshAgeTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(5)
        };
        _refreshAgeTimer.Tick += RefreshAgeTimer_OnTick;
        _scheduleTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(15)
        };
        _scheduleTimer.Tick += ScheduleTimer_OnTick;
        SourceInitialized += MainWindow_OnSourceInitialized;
        Loaded += MainWindow_OnLoaded;
        ContentRendered += MainWindow_OnContentRendered;
        SizeChanged += MainWindow_OnSizeChanged;
        StateChanged += MainWindow_OnStateChanged;
        IsVisibleChanged += MainWindow_OnIsVisibleChanged;
        Closing += MainWindow_OnClosing;
    }

    public ObservableCollection<TickerCardViewModel> TickerCards { get; } = [];

    private void MainWindow_OnSourceInitialized(object? sender, EventArgs e)
    {
        var windowHandle = new WindowInteropHelper(this).Handle;
        _hotkeySource = HwndSource.FromHwnd(windowHandle);
    }

    private IntPtr MainWindowHwndHook(
        IntPtr hwnd,
        int message,
        IntPtr wParam,
        IntPtr lParam,
        ref bool handled)
    {
        if (message == GlobalHotkeyDefinition.WmHotKey
            && wParam.ToInt32() == GlobalHotkeyDefinition.Id)
        {
            ToggleWindowFromGlobalShortcut();
            handled = true;
        }

        return IntPtr.Zero;
    }

    private void MainWindow_OnContentRendered(object? sender, EventArgs e)
    {
        if (ActualWidth <= 0 || ActualHeight <= 0)
        {
            return;
        }

        if (_settingsLoaded)
        {
            ApplyRestoredWindowSize();
        }

        var workArea = SystemParameters.WorkArea;
        var placement = WindowPlacementCalculator.CalculateLowerRight(
            new ScreenWorkArea(
                workArea.Left,
                workArea.Top,
                workArea.Width,
                workArea.Height),
            ActualWidth,
            ActualHeight);
        Left = placement.Left;
        Top = placement.Top;
        ContentRendered -= MainWindow_OnContentRendered;
    }

    private async void MainWindow_OnLoaded(object sender, RoutedEventArgs e)
    {
        var loadResult = _settingsStore.Load();
        _settings = loadResult.Settings;
        ApplyRestoredWindowSize();
        _settingsLoaded = true;
        RememberCurrentWindowSize();
        ApplySettingsToView();
        _refreshAgeTimer.Start();
        _scheduleTimer.Start();
        UpdateGlobalRefreshDisplay();

        if (loadResult.RequiresRewrite)
        {
            try
            {
                _settingsStore.Save(_settings);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or InvalidOperationException)
            {
                SetValidation($"Could not migrate settings: {ex.Message}", isError: false);
            }
        }

        if (!string.IsNullOrWhiteSpace(loadResult.Warning))
        {
            SetValidation(loadResult.Warning, isError: false);
        }

        ApplyGlobalShortcutPreference();
        await _feedClient.UpdatePollIntervalAsync(
            TimeSpan.FromSeconds(_settings.PollingIntervalSeconds));
        await ApplyQuietHoursScheduleAsync();
        await StartStreamingAsync();
    }

    private async Task StartStreamingAsync()
    {
        await _streamingGate.WaitAsync();
        try
        {
            var settings = _settings.Clone();
            _lastSuccessfulRefresh = null;
            await _feedClient.StopAsync();
            _tickerState.Reset(settings.Symbols);
            MarketOverview.Reset();
            RefreshTickerCards();
            await _feedClient.StartAsync(
                MarketOverviewSymbols.CombineWithUserSymbols(settings.Symbols));
            UpdateGlobalRefreshDisplay();
        }
        finally
        {
            _streamingGate.Release();
        }
    }

    private async Task UpdateSymbolsAsync(AppSettings updatedSettings)
    {
        _settingsStore.Save(updatedSettings);
        _settings = updatedSettings;
        _tickerState.SetSymbols(_settings.Symbols);
        RefreshTickerCards();
        await _feedClient.UpdateSymbolsAsync(
            MarketOverviewSymbols.CombineWithUserSymbols(_settings.Symbols));
    }

    private void ApplySettingsToView()
    {
        Topmost = _settings.AlwaysOnTop;
        HeaderSummaryText.Text = FormatHeaderSummary(_settings.Symbols);
    }

    private void ApplyGlobalShortcutPreference()
    {
        if (!_settings.EnableGlobalShortcut)
        {
            UnregisterGlobalHotkey();
            return;
        }

        if (_hotkeySource is null)
        {
            SetValidation(
                $"Global shortcut {GlobalHotkeyDefinition.DisplayText} could not be registered because the window handle was unavailable.",
                isError: false);
            return;
        }

        if (!_globalHotkeyRegistration.TryRegister(
                _hotkeySource.Handle,
                out var warning))
        {
            SetValidation(warning, isError: false);
            return;
        }

        if (!_hotkeyHookAttached)
        {
            _hotkeySource.AddHook(MainWindowHwndHook);
            _hotkeyHookAttached = true;
        }
    }

    private void ApplyRestoredWindowSize()
    {
        var workArea = SystemParameters.WorkArea;
        var size = WindowSizeCalculator.Resolve(
            _settings.WindowWidth,
            _settings.WindowHeight,
            new ScreenWorkArea(
                workArea.Left,
                workArea.Top,
                workArea.Width,
                workArea.Height));
        _applyingWindowSize = true;
        try
        {
            Width = size.Width;
            Height = size.Height;
        }
        finally
        {
            _applyingWindowSize = false;
        }

        _lastNonMinimizedWidth = Width;
        _lastNonMinimizedHeight = Height;
    }

    private void MainWindow_OnSizeChanged(object? sender, SizeChangedEventArgs e)
    {
        if (!_settingsLoaded
            || _applyingWindowSize
            || WindowState == WindowState.Minimized)
        {
            return;
        }

        RememberCurrentWindowSize();
    }

    private void RememberCurrentWindowSize()
    {
        if (!WindowSizeCalculator.IsValidSavedSize(Width, Height))
        {
            return;
        }

        _lastNonMinimizedWidth = Width;
        _lastNonMinimizedHeight = Height;
        if (_settingsLoaded)
        {
            _settings.WindowWidth = Width;
            _settings.WindowHeight = Height;
        }
    }

    private void MainWindow_OnClosing(object? sender, CancelEventArgs e)
    {
        UnregisterGlobalHotkey();
        if (!_settingsLoaded
            || !WindowSizeCalculator.IsValidSavedSize(
                _lastNonMinimizedWidth,
                _lastNonMinimizedHeight))
        {
            return;
        }

        _settings.WindowWidth = _lastNonMinimizedWidth;
        _settings.WindowHeight = _lastNonMinimizedHeight;
        try
        {
            _settingsStore.Save(_settings);
        }
        catch (Exception ex) when (
            ex is IOException
            or UnauthorizedAccessException
            or InvalidOperationException)
        {
            System.Diagnostics.Trace.WriteLine(
                $"Could not persist window size: {ex.Message}");
        }
    }

    private void AddSymbolToggleButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (AddSymbolEditorPanel.Visibility == Visibility.Visible)
        {
            HideAddSymbolEditor();
            return;
        }

        ShowAddSymbolEditor();
    }

    private async void AddSymbolButton_OnClick(object sender, RoutedEventArgs e)
    {
        await AddSymbolAsync();
    }

    private async void AddSymbolBox_OnKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != Key.Enter)
        {
            if (e.Key == Key.Escape)
            {
                e.Handled = true;
                HideAddSymbolEditor();
            }

            return;
        }

        e.Handled = true;
        await AddSymbolAsync();
    }

    private async Task AddSymbolAsync()
    {
        if (!SymbolRules.TryNormalize(AddSymbolBox.Text, out var symbol, out var error))
        {
            SetValidation(error, isError: true);
            return;
        }

        if (_settings.Symbols.Contains(symbol, StringComparer.OrdinalIgnoreCase))
        {
            SetValidation($"{symbol} is already being tracked.", isError: true);
            return;
        }

        if (MarketOverviewSymbols.IsBuiltIn(symbol))
        {
            SetValidation($"{symbol} is included in Market Overview.", isError: true);
            return;
        }

        var updatedSettings = _settings.Clone();
        updatedSettings.Symbols.Add(symbol);
        try
        {
            await UpdateSymbolsAsync(updatedSettings);
            HideAddSymbolEditor();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or HttpRequestException or InvalidOperationException)
        {
            SetValidation($"Could not add {symbol}: {ex.Message}", isError: true);
        }
    }

    private void ShowAddSymbolEditor()
    {
        SetValidation(string.Empty, isError: true);
        AddSymbolEditorPanel.Visibility = Visibility.Visible;
        AddSymbolBox.Focus();
        AddSymbolBox.SelectAll();
    }

    private void HideAddSymbolEditor()
    {
        AddSymbolEditorPanel.Visibility = Visibility.Collapsed;
        AddSymbolBox.Clear();
        SetValidation(string.Empty, isError: true);
        AddSymbolToggleButton.Focus();
    }

    private async void RemoveTickerButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (sender is not FrameworkElement { DataContext: TickerCardViewModel card })
        {
            return;
        }

        var updatedSettings = _settings.Clone();
        updatedSettings.Symbols.RemoveAll(symbol =>
            string.Equals(symbol, card.Symbol, StringComparison.OrdinalIgnoreCase));

        try
        {
            await UpdateSymbolsAsync(updatedSettings);
            SetValidation(string.Empty, isError: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or HttpRequestException or InvalidOperationException)
        {
            SetValidation($"Could not remove {card.Symbol}: {ex.Message}", isError: true);
        }
    }

    private void TickerCard_OnPreviewMouseLeftButtonDown(
        object sender,
        MouseButtonEventArgs e)
    {
        if (FindVisualParent<Button>(e.OriginalSource as DependencyObject) is not null
            || sender is not FrameworkElement
            {
                DataContext: TickerCardViewModel card
            })
        {
            _tickerDragCandidate = null;
            return;
        }

        _tickerDragStart = e.GetPosition(this);
        _tickerDragCandidate = card;
    }

    private void TickerCard_OnPreviewMouseLeftButtonUp(
        object sender,
        MouseButtonEventArgs e)
    {
        _tickerDragCandidate = null;
    }

    private void TickerCard_OnMouseMove(
        object sender,
        MouseEventArgs e)
    {
        if (e.LeftButton != MouseButtonState.Pressed
            || _tickerDragCandidate is null
            || sender is not FrameworkElement element)
        {
            return;
        }

        var current = e.GetPosition(this);
        if (Math.Abs(current.X - _tickerDragStart.X)
                < SystemParameters.MinimumHorizontalDragDistance
            && Math.Abs(current.Y - _tickerDragStart.Y)
                < SystemParameters.MinimumVerticalDragDistance)
        {
            return;
        }

        var card = _tickerDragCandidate;
        _tickerDragCandidate = null;
        DragDrop.DoDragDrop(
            element,
            new DataObject(typeof(TickerCardViewModel), card),
            DragDropEffects.Move);
    }

    private void TickerCard_OnDragOver(
        object sender,
        DragEventArgs e)
    {
        e.Effects = e.Data.GetDataPresent(typeof(TickerCardViewModel))
            ? DragDropEffects.Move
            : DragDropEffects.None;
        e.Handled = true;
    }

    private void TickerCard_OnDrop(
        object sender,
        DragEventArgs e)
    {
        if (sender is not FrameworkElement
            {
                DataContext: TickerCardViewModel target
            }
            || e.Data.GetData(typeof(TickerCardViewModel))
                is not TickerCardViewModel source)
        {
            return;
        }

        var sourceIndex = TickerCards.IndexOf(source);
        var targetIndex = TickerCards.IndexOf(target);
        if (sourceIndex < 0
            || targetIndex < 0
            || sourceIndex == targetIndex)
        {
            return;
        }

        var updatedSettings = _settings.Clone();
        if (!SymbolOrder.TryMove(
                updatedSettings.Symbols,
                source.Symbol,
                target.Symbol))
        {
            return;
        }

        TickerCards.Move(sourceIndex, targetIndex);
        try
        {
            _settingsStore.Save(updatedSettings);
            _settings = updatedSettings;
            HeaderSummaryText.Text = FormatHeaderSummary(_settings.Symbols);
            SetValidation(string.Empty, isError: true);
        }
        catch (Exception ex) when (
            ex is IOException
                or UnauthorizedAccessException
                or InvalidOperationException)
        {
            TickerCards.Move(targetIndex, sourceIndex);
            SetValidation(
                $"Could not save ticker order: {ex.Message}",
                isError: true);
        }

        e.Handled = true;
    }

    private static T? FindVisualParent<T>(DependencyObject? child)
        where T : DependencyObject
    {
        while (child is not null)
        {
            if (child is T match)
            {
                return match;
            }

            child = VisualTreeHelper.GetParent(child);
        }

        return null;
    }

    private async void SettingsButton_OnClick(object sender, RoutedEventArgs e)
    {
        await ShowSettingsAsync();
    }

    private async Task ShowSettingsAsync()
    {
        if (_isShuttingDown)
        {
            return;
        }

        var settingsWindow = new SettingsWindow(_settings.Clone())
        {
            Owner = this
        };

        if (settingsWindow.ShowDialog() != true || settingsWindow.Result is null)
        {
            return;
        }

        var updatedSettings = settingsWindow.Result;
        updatedSettings.WindowWidth = _lastNonMinimizedWidth;
        updatedSettings.WindowHeight = _lastNonMinimizedHeight;
        try
        {
            _settingsStore.Save(updatedSettings);
            _settings = updatedSettings;
            ApplySettingsToView();
            await _feedClient.UpdatePollIntervalAsync(
                TimeSpan.FromSeconds(_settings.PollingIntervalSeconds));
            await ApplyQuietHoursScheduleAsync();
            ApplyGlobalShortcutPreference();
            UpdateGlobalRefreshDisplay();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or HttpRequestException or InvalidOperationException)
        {
            SetValidation($"Could not save settings: {ex.Message}", isError: true);
        }
    }

    private void MinimizeButton_OnClick(object sender, RoutedEventArgs e)
    {
        WindowState = WindowState.Minimized;
    }

    private void ToggleWindowFromGlobalShortcut()
    {
        var windowHandle = new WindowInteropHelper(this).Handle;
        var wasMinimized = WindowState == WindowState.Minimized;
        var wasHidden = !IsVisible;
        var isForeground = IsVisible
            && WindowState != WindowState.Minimized
            && IsActive
            && windowHandle != IntPtr.Zero
            && NativeMethods.GetForegroundWindow() == windowHandle;
        var action = GlobalShortcutToggleLogic.Decide(
            WindowState == WindowState.Minimized,
            isForeground);

        if (action == GlobalShortcutWindowAction.Minimize)
        {
            _boundsBeforeMinimizeOrHide = CaptureNormalBounds();
            WindowState = WindowState.Minimized;
            return;
        }

        var restoreBounds = wasMinimized || wasHidden
            ? GlobalShortcutWindowBoundsLogic.ChooseRestoreBounds(
                _boundsBeforeMinimizeOrHide,
                CaptureRestoreBounds())
            : null;

        _restoringFromGlobalShortcut = true;
        try
        {
            if (!IsVisible)
            {
                Show();
            }

            WindowState = WindowState.Normal;
            windowHandle = new WindowInteropHelper(this).Handle;
            NativeMethods.ShowWindow(windowHandle, 9);
            Activate();
            NativeMethods.SetForegroundWindow(windowHandle);
            ApplyNormalBounds(restoreBounds);
            Focus();
        }
        finally
        {
            _restoringFromGlobalShortcut = false;
            _boundsBeforeMinimizeOrHide = null;
        }
    }

    private void MainWindow_OnStateChanged(
        object? sender,
        EventArgs e)
    {
        if (WindowState == WindowState.Minimized)
        {
            _boundsBeforeMinimizeOrHide ??= CaptureNormalBounds();
        }
        else if (!_restoringFromGlobalShortcut)
        {
            _boundsBeforeMinimizeOrHide = null;
        }
    }

    private void MainWindow_OnIsVisibleChanged(
        object? sender,
        DependencyPropertyChangedEventArgs e)
    {
        if (!IsVisible)
        {
            _boundsBeforeMinimizeOrHide ??= CaptureNormalBounds();
        }
    }

    private WindowNormalBounds? CaptureNormalBounds()
    {
        var width = double.IsFinite(Width) ? Width : ActualWidth;
        var height = double.IsFinite(Height) ? Height : ActualHeight;
        var bounds = new WindowNormalBounds(Left, Top, width, height);
        return bounds.IsValid ? bounds : null;
    }

    private WindowNormalBounds? CaptureRestoreBounds()
    {
        var restoreBounds = RestoreBounds;
        var bounds = new WindowNormalBounds(
            restoreBounds.Left,
            restoreBounds.Top,
            restoreBounds.Width,
            restoreBounds.Height);
        return bounds.IsValid ? bounds : null;
    }

    private void ApplyNormalBounds(WindowNormalBounds? bounds)
    {
        if (bounds is not { } normalBounds || !normalBounds.IsValid)
        {
            return;
        }

        Left = normalBounds.Left;
        Top = normalBounds.Top;
        Width = normalBounds.Width;
        Height = normalBounds.Height;
    }

    private void CloseButton_OnClick(object sender, RoutedEventArgs e)
    {
        Close();
    }

    private void HeaderGrid_OnMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        WindowSurface_OnMouseLeftButtonDown(sender, e);
    }

    private void WindowSurface_OnMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (IsInteractiveControl(e.OriginalSource as DependencyObject)
            || e.LeftButton != MouseButtonState.Pressed)
        {
            return;
        }

        e.Handled = true;
        DragMove();
    }

    private static bool IsInteractiveControl(DependencyObject? source)
    {
        while (source is not null)
        {
            if (source is Button or TextBox)
            {
                return true;
            }

            source = VisualTreeHelper.GetParent(source);
        }

        return false;
    }

    private void FeedClient_OnStatusChanged(object? sender, PollingStatus status)
    {
        if (_isShuttingDown || Dispatcher.HasShutdownStarted)
        {
            return;
        }

        _ = Dispatcher.BeginInvoke(() =>
        {
            UpdateGlobalRefreshDisplay();
        });
    }

    private void FeedClient_OnRefreshCompleted(
        object? sender,
        YahooRefreshCompleted completion)
    {
        if (_isShuttingDown || Dispatcher.HasShutdownStarted)
        {
            return;
        }

        _ = Dispatcher.BeginInvoke(() =>
        {
            _lastSuccessfulRefresh = completion.CompletedAt;
            UpdateGlobalRefreshDisplay();
        });
    }

    private void RefreshAgeTimer_OnTick(object? sender, EventArgs e)
    {
        UpdateGlobalRefreshDisplay();
    }

    private void ScheduleTimer_OnTick(object? sender, EventArgs e)
    {
        _ = ApplyQuietHoursScheduleAsync();
    }

    private async Task ApplyQuietHoursScheduleAsync()
    {
        if (_isShuttingDown)
        {
            return;
        }

        await _scheduleGate.WaitAsync();
        try
        {
            if (_isShuttingDown)
            {
                return;
            }

            var schedule = QuietHoursSchedule.Evaluate(
                DateTime.Now,
                _settings.PauseDuringQuietHours);
            var wasPaused = _scheduledPauseActive;
            _scheduledPauseActive = schedule.IsPaused;
            _nextResumeTime = schedule.NextResumeTime;

            if (wasPaused != schedule.IsPaused)
            {
                if (schedule.IsPaused)
                {
                    await _feedClient.PauseAsync(
                        FormatPauseMessage(schedule.NextResumeTime));
                }
                else
                {
                    await _feedClient.ResumeAsync();
                }
            }

            UpdateGlobalRefreshDisplay();
        }
        finally
        {
            _scheduleGate.Release();
        }
    }

    private void FeedClient_OnQuoteReceived(object? sender, QuoteTick tick)
    {
        if (_isShuttingDown || Dispatcher.HasShutdownStarted)
        {
            return;
        }

        _ = Dispatcher.BeginInvoke(() =>
        {
            if (MarketOverviewSymbols.IsBuiltIn(tick.Symbol))
            {
                MarketOverview.Apply(tick);
                return;
            }

            if (!_tickerState.Apply(tick))
            {
                return;
            }

            var card = TickerCards.FirstOrDefault(item =>
                string.Equals(item.Symbol, tick.Symbol, StringComparison.OrdinalIgnoreCase));
            var state = _tickerState.Get(tick.Symbol);
            if (card is not null && state is not null)
            {
                card.Apply(state);
            }
        });
    }

    private void FeedClient_OnSymbolError(object? sender, SymbolPollError pollError)
    {
        if (_isShuttingDown || Dispatcher.HasShutdownStarted)
        {
            return;
        }

        _ = Dispatcher.BeginInvoke(() =>
        {
            if (MarketOverviewSymbols.IsBuiltIn(pollError.Symbol))
            {
                MarketOverview.SetError(pollError.Symbol, pollError.Message);
                return;
            }

            var card = TickerCards.FirstOrDefault(item =>
                string.Equals(item.Symbol, pollError.Symbol, StringComparison.OrdinalIgnoreCase));
            card?.SetError(pollError.Message);
            SetValidation($"{pollError.Symbol}: {pollError.Message}", isError: false);
        });
    }

    private void RefreshTickerCards()
    {
        TickerCards.Clear();
        foreach (var symbol in _settings.Symbols)
        {
            var card = new TickerCardViewModel(symbol);
            var state = _tickerState.Get(symbol);
            if (state is not null)
            {
                card.Apply(state);
            }

            TickerCards.Add(card);
        }

        HeaderSummaryText.Text = FormatHeaderSummary(_settings.Symbols);
        var hasSymbols = TickerCards.Count > 0;
        TickerItemsControl.Visibility = hasSymbols ? Visibility.Visible : Visibility.Collapsed;
        NoSymbolsText.Visibility = hasSymbols ? Visibility.Collapsed : Visibility.Visible;
    }

    private void SetValidation(string message, bool isError)
    {
        ValidationText.Text = message;
        ValidationText.Foreground = ThemeBrush(isError ? "NegativeBrush" : "WarningBrush");
    }

    private Brush ThemeBrush(string key) =>
        (Brush)FindResource(key);

    private void UpdateGlobalRefreshDisplay()
    {
        if (_scheduledPauseActive)
        {
            StatusText.Text = "Quiet hours";
            StatusDot.Fill = ThemeBrush("WarningBrush");
        }
        else
        {
            var health = RefreshStatusClassifier.Classify(
                _lastSuccessfulRefresh,
                DateTimeOffset.UtcNow);

            StatusText.Text = health switch
            {
                RefreshHealth.Fresh => "Refreshed recently",
                RefreshHealth.Aging => "Refresh is aging",
                RefreshHealth.Stale => "Refresh is stale",
                _ => "Waiting for first refresh"
            };
            StatusDot.Fill = health switch
            {
                RefreshHealth.Fresh => ThemeBrush("PositiveBrush"),
                RefreshHealth.Aging => ThemeBrush("WarningBrush"),
                RefreshHealth.Stale => ThemeBrush("NegativeBrush"),
                _ => ThemeBrush("MutedTextBrush")
            };
        }

        GlobalLastUpdatedText.Text = RefreshStatusPresentation.FormatLastUpdated(
            _lastSuccessfulRefresh,
            _feedClient.PollInterval,
            _scheduledPauseActive);
    }

    private static string FormatPauseMessage(DateTime? nextResumeTime) =>
        nextResumeTime is { } nextResume
            ? $"Paused until {nextResume:h:mm tt}"
            : "Paused";

    private static string FormatHeaderSummary(IReadOnlyCollection<string> symbols)
    {
        return symbols.Count switch
        {
            0 => "No symbols",
            1 => symbols.First(),
            _ => $"{symbols.Count} symbols"
        };
    }

    public async Task ShutdownAsync()
    {
        if (_isShuttingDown)
        {
            return;
        }

        _isShuttingDown = true;
        UnregisterGlobalHotkey();
        _refreshAgeTimer.Stop();
        _scheduleTimer.Stop();
        await _feedClient.DisposeAsync().ConfigureAwait(false);
    }

    private void UnregisterGlobalHotkey()
    {
        if (_hotkeyHookAttached && _hotkeySource is not null)
        {
            _hotkeySource.RemoveHook(MainWindowHwndHook);
            _hotkeyHookAttached = false;
        }

        var windowHandle = _hotkeySource?.Handle
            ?? new WindowInteropHelper(this).Handle;
        _globalHotkeyRegistration.Unregister(windowHandle);
    }
}
