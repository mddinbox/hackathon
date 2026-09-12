using System.Runtime.InteropServices;

namespace FloatingStockTicker.Services;

public static class GlobalHotkeyDefinition
{
    public const int Id = 0x465354;

    public const uint ModAlt = 0x0001;

    public const uint ModControl = 0x0002;

    public const uint ModShift = 0x0004;

    public const uint Modifiers = ModAlt | ModControl | ModShift;

    public const uint VirtualKeyF12 = 0x007B;

    public const int WmHotKey = 0x0312;

    public const string DisplayText = "Ctrl+Alt+Shift+F12";
}

public interface IGlobalHotkeyApi
{
    bool RegisterHotKey(
        IntPtr windowHandle,
        int id,
        uint modifiers,
        uint virtualKey);

    bool UnregisterHotKey(IntPtr windowHandle, int id);
}

public sealed class GlobalHotkeyRegistration
{
    private readonly IGlobalHotkeyApi _api;

    public GlobalHotkeyRegistration()
        : this(new Win32GlobalHotkeyApi())
    {
    }

    public GlobalHotkeyRegistration(IGlobalHotkeyApi api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
    }

    public bool IsRegistered { get; private set; }

    public bool TryRegister(IntPtr windowHandle, out string warning)
    {
        if (IsRegistered)
        {
            warning = string.Empty;
            return true;
        }

        if (windowHandle == IntPtr.Zero)
        {
            warning = $"Global shortcut {GlobalHotkeyDefinition.DisplayText} could not be registered because the window handle was unavailable.";
            return false;
        }

        if (!_api.RegisterHotKey(
                windowHandle,
                GlobalHotkeyDefinition.Id,
                GlobalHotkeyDefinition.Modifiers,
                GlobalHotkeyDefinition.VirtualKeyF12))
        {
            warning = $"Global shortcut {GlobalHotkeyDefinition.DisplayText} could not be registered. It may already be in use by another application.";
            return false;
        }

        IsRegistered = true;
        warning = string.Empty;
        return true;
    }

    public bool Unregister(IntPtr windowHandle)
    {
        if (!IsRegistered)
        {
            return true;
        }

        var unregistered = windowHandle != IntPtr.Zero
            && _api.UnregisterHotKey(windowHandle, GlobalHotkeyDefinition.Id);
        IsRegistered = false;
        return unregistered;
    }
}

internal sealed class Win32GlobalHotkeyApi : IGlobalHotkeyApi
{
    public bool RegisterHotKey(
        IntPtr windowHandle,
        int id,
        uint modifiers,
        uint virtualKey) =>
        NativeMethods.RegisterHotKey(
            windowHandle,
            id,
            modifiers,
            virtualKey);

    public bool UnregisterHotKey(IntPtr windowHandle, int id) =>
        NativeMethods.UnregisterHotKey(windowHandle, id);
}

internal static class NativeMethods
{
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool RegisterHotKey(
        IntPtr hWnd,
        int id,
        uint fsModifiers,
        uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool UnregisterHotKey(
        IntPtr hWnd,
        int id);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ShowWindow(
        IntPtr hWnd,
        int nCmdShow);
}
