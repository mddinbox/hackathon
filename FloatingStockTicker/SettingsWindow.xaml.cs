using System.Globalization;
using System.Windows;
using FloatingStockTicker.Models;

namespace FloatingStockTicker;

public partial class SettingsWindow : Window
{
    private readonly AppSettings _settings;

    public SettingsWindow(AppSettings settings)
    {
        InitializeComponent();
        _settings = settings;
        AlwaysOnTopBox.IsChecked = settings.AlwaysOnTop;
        EnableGlobalShortcutBox.IsChecked = settings.EnableGlobalShortcut;
        PollingIntervalBox.Text = settings.PollingIntervalSeconds.ToString(
            CultureInfo.InvariantCulture);
        PauseDuringQuietHoursBox.IsChecked = settings.PauseDuringQuietHours;
        VersionText.Text = ApplicationVersion.DisplayText;
    }

    public AppSettings? Result { get; private set; }

    private void SaveButton_OnClick(object sender, RoutedEventArgs e)
    {
        if (!int.TryParse(
                PollingIntervalBox.Text,
                NumberStyles.None,
                CultureInfo.InvariantCulture,
                out var pollingInterval)
            || !AppSettings.IsValidPollingInterval(pollingInterval))
        {
            ValidationText.Text = AppSettings.PollingIntervalValidationMessage;
            PollingIntervalBox.Focus();
            PollingIntervalBox.SelectAll();
            return;
        }

        Result = _settings.Clone();
        Result.AlwaysOnTop = AlwaysOnTopBox.IsChecked == true;
        Result.EnableGlobalShortcut = EnableGlobalShortcutBox.IsChecked == true;
        Result.PollingIntervalSeconds = pollingInterval;
        Result.PauseDuringQuietHours = PauseDuringQuietHoursBox.IsChecked == true;
        DialogResult = true;
    }

    private void CancelButton_OnClick(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
    }
}
