using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace TradeJournal
{
    /// <summary>
    /// Windows that show RoninFlow itself over the chart — the whole journal, or one trade's review — in WebView2
    /// (Microsoft's Edge-based browser control, which ATAS X ships). They run on their own UI thread so they never
    /// stall the chart, share one browser profile (so you sign in once), and save straight to RoninFlow's server,
    /// which is how a change here shows up in every other open journal within a few seconds.
    /// </summary>
    internal static class JournalWindows
    {
        private static Thread? _ui;
        private static SynchronizationContext? _ctx;
        private static readonly ManualResetEventSlim Ready = new(false);
        private static readonly Dictionary<string, Form> Forms = new();
        private static readonly Dictionary<string, Rectangle> LastBounds = new(); // where you left each window, this session
        private static readonly Color Back = Color.FromArgb(10, 10, 12);

        private static bool EnsureThread()
        {
            lock (Forms)
            {
                if (_ui == null)
                {
                    _ui = new Thread(() =>
                    {
                        try { Application.EnableVisualStyles(); } catch { }
                        SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
                        _ctx = SynchronizationContext.Current;
                        Ready.Set();
                        Application.Run(); // the message loop for every RoninFlow window
                    })
                    { IsBackground = true, Name = "RoninFlow windows" };
                    _ui.SetApartmentState(ApartmentState.STA);
                    _ui.Start();
                }
            }
            return Ready.Wait(5000) && _ctx != null;
        }

        private static float Scale()
        {
            try { using var g = Graphics.FromHwnd(IntPtr.Zero); return Math.Max(1f, g.DpiX / 96f); }
            catch { return 1f; }
        }

        /// <summary>The cursor's place on screen (where a click on the chart happened).</summary>
        public static Point CursorScreen()
        {
            try { return Cursor.Position; }
            catch { return Point.Empty; }
        }

        /// <summary>The whole journal, large and centred on the screen the chart is on.</summary>
        public static void ShowJournal(string url, Point near, bool onTop)
        {
            // pick up where you left off: the page you were on last time (this session or the one before)
            var last = LastPage();
            var start = last != null && last.StartsWith(Origin(url), StringComparison.OrdinalIgnoreCase) ? last : url;
            Show("journal", start, "RoninFlow", near, onTop, wa =>
                new Rectangle(wa.Left + wa.Width / 12, wa.Top + wa.Height / 14, wa.Width * 10 / 12, wa.Height * 12 / 14), tool: false, resume: true);
        }

        /// <summary>One trade's review, next to the execution that was clicked.</summary>
        public static void ShowTrade(string url, Point at, bool onTop)
        {
            var s = Scale();
            int w = (int)(460 * s), h = (int)(760 * s), gap = (int)(18 * s);
            Show("trade", url, "RoninFlow · trade review", at, onTop, wa =>
            {
                // beside the marker (right of it, or left when there's no room), vertically centred on it
                var x = at.X + gap + w <= wa.Right ? at.X + gap : at.X - gap - w;
                var y = at.Y - h / 3;
                return new Rectangle(x, y, w, Math.Min(h, wa.Height - 20));
            }, tool: true, keepPlace: false);
        }

        private static readonly string StateDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RoninFlow");
        private static string LastPageFile => Path.Combine(StateDir, "journal-window-page.txt");
        private static string? LastPage() { try { var s = File.ReadAllText(LastPageFile).Trim(); return s.Length > 0 ? s : null; } catch { return null; } }
        private static void SaveLastPage(string url) { try { Directory.CreateDirectory(StateDir); File.WriteAllText(LastPageFile, url); } catch { } }
        private static string Origin(string url) { try { var u = new Uri(url); return u.GetLeftPart(UriPartial.Authority); } catch { return url; } }

        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();

        /// <summary>
        /// Clicking away tucks the window out of the way — the journal minimises, a trade review hides — unless focus went
        /// to another RoninFlow window or to a dialog the page opened (a file picker for screenshots, say).
        /// </summary>
        private static void TuckAwayWhenLeft(Form f, bool tool)
        {
            var uiThread = GetCurrentThreadId();
            f.Deactivate += async (_, _) =>
            {
                await System.Threading.Tasks.Task.Delay(180); // let the new foreground window settle
                if (f.IsDisposed || !f.Visible || f.WindowState == FormWindowState.Minimized || Form.ActiveForm == f) return;
                try
                {
                    var fg = GetForegroundWindow();
                    var tid = GetWindowThreadProcessId(fg, out var pid);
                    if (tid == uiThread) return; // another RoninFlow window (journal ↔ trade review)
                    var name = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName;
                    if (name.StartsWith("msedgewebview2", StringComparison.OrdinalIgnoreCase)) return; // the page's own dialog
                }
                catch { }
                if (tool) f.Hide(); else f.WindowState = FormWindowState.Minimized;
            };
        }

        private static void Show(string key, string url, string title, Point near, bool onTop, Func<Rectangle, Rectangle> place, bool tool, bool keepPlace = true, bool resume = false)
        {
            if (!EnsureThread()) { OpenInBrowser(url); return; }
            _ctx!.Post(async _ =>
            {
                try
                {
                    var screen = Screen.FromPoint(near.IsEmpty ? Cursor.Position : near).WorkingArea;
                    var want = keepPlace && LastBounds.TryGetValue(key, out var lb) ? lb : place(screen);
                    want = Fit(want, Screen.FromRectangle(want).WorkingArea);

                    if (Forms.TryGetValue(key, out var open) && !open.IsDisposed)
                    {
                        var view = (WebView2)open.Tag!;
                        if (!resume && view.CoreWebView2 != null) view.CoreWebView2.Navigate(url); // the journal stays on the page you left it on
                        open.TopMost = onTop;
                        if (!keepPlace) open.Bounds = want; // a review jumps to the execution clicked
                        if (open.WindowState == FormWindowState.Minimized) open.WindowState = FormWindowState.Normal;
                        open.Show();
                        open.Activate();
                        return;
                    }

                    var f = new HostForm
                    {
                        Text = title,
                        StartPosition = FormStartPosition.Manual,
                        Bounds = want,
                        TopMost = onTop,
                        BackColor = Back,
                        ShowInTaskbar = !tool,
                        MinimumSize = new Size(320, 300),
                    };
                    try { f.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
                    var wv = new WebView2
                    {
                        Dock = DockStyle.Fill,
                        DefaultBackgroundColor = Back,
                        CreationProperties = new CoreWebView2CreationProperties
                        {
                            UserDataFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RoninFlow", "WebView2"),
                        },
                    };
                    f.Controls.Add(wv);
                    f.Tag = wv;
                    f.FormClosing += (_, _) => { if (f.WindowState == FormWindowState.Normal) LastBounds[key] = f.Bounds; };
                    f.FormClosed += (_, _) => { Forms.Remove(key); try { wv.Dispose(); } catch { } };
                    Forms[key] = f;
                    TuckAwayWhenLeft(f, tool);
                    f.Show();
                    f.Activate();

                    try { await wv.EnsureCoreWebView2Async(); }
                    catch
                    {
                        f.Controls.Clear();
                        f.Controls.Add(new Label
                        {
                            Dock = DockStyle.Fill, ForeColor = Color.Gainsboro, BackColor = Back, TextAlign = ContentAlignment.MiddleCenter,
                            Text = "This window needs Microsoft Edge WebView2, which isn't installed.\nOpening RoninFlow in your browser instead.",
                        });
                        OpenInBrowser(url);
                        return;
                    }
                    var core = wv.CoreWebView2;
                    try { core.Settings.IsNonClientRegionSupportEnabled = true; } catch { } // CSS app-region: drag moves the window
                    try { core.Settings.IsStatusBarEnabled = false; } catch { }             // no browser link bubble at the bottom
                    // tell the page it's in a RoninFlow window, so it draws the window's buttons and drag area itself
                    await core.AddScriptToExecuteOnDocumentCreatedAsync($"window.__rfWindow = {{ kind: '{(tool ? "trade" : "journal")}', top: {(onTop ? "true" : "false")} }};");
                    void SendState() { try { core.PostWebMessageAsString($"{{\"max\":{(f.WindowState == FormWindowState.Maximized ? "true" : "false")},\"top\":{(f.TopMost ? "true" : "false")}}}"); } catch { } }
                    f.Resize += (_, _) => SendState();
                    core.WebMessageReceived += (_, e) =>
                    {
                        string? msg = null;
                        try { msg = e.TryGetWebMessageAsString(); } catch { }
                        switch (msg)
                        {
                            case "drag": ReleaseCapture(); SendMessage(f.Handle, 0xA1 /* WM_NCLBUTTONDOWN */, (IntPtr)2 /* HTCAPTION */, IntPtr.Zero); break;
                            case "max": f.WindowState = f.WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized; break;
                            case "min": f.WindowState = FormWindowState.Minimized; break;
                            case "close": f.Close(); return;
                            case "top": f.TopMost = !f.TopMost; break;
                            case "browser": OpenInBrowser(core.Source); break;
                        }
                        SendState();
                    };
                    core.WindowCloseRequested += (_, _) => f.Close();                         // the page's own close / “done” buttons
                    core.NewWindowRequested += (_, a) => { a.Handled = true; OpenInBrowser(a.Uri); }; // links out go to your browser
                    core.DocumentTitleChanged += (_, _) => { if (!tool && !string.IsNullOrWhiteSpace(core.DocumentTitle)) f.Text = core.DocumentTitle; };
                    if (resume)
                    {
                        void Remember() { try { var src = core.Source; if (!src.Contains("/#/embed/", StringComparison.Ordinal)) SaveLastPage(src); } catch { } } // for next time
                        core.HistoryChanged += (_, _) => Remember();
                        core.SourceChanged += (_, _) => Remember();
                    }
                    core.Navigate(url);
                }
                catch
                {
                    OpenInBrowser(url);
                }
            }, null);
        }

        [DllImport("user32.dll")] private static extern bool ReleaseCapture();
        [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

        /// <summary>
        /// A window with no Windows title bar that still behaves like one: native resize edges, Aero snap, shadow and
        /// (on Windows 11) rounded corners and a dark border. The page inside draws the title bar.
        /// </summary>
        private sealed class HostForm : Form
        {
            private const int WM_NCCALCSIZE = 0x83, WM_NCHITTEST = 0x84, HTCLIENT = 1;
            [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
            [StructLayout(LayoutKind.Sequential)] private struct NCCALCSIZE_PARAMS { public RECT R0, R1, R2; public IntPtr Pos; }
            [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

            private int Band => Math.Max(4, (int)Math.Round(5 * DeviceDpi / 96.0)); // the invisible strip round the page you resize by

            public HostForm()
            {
                FormBorderStyle = FormBorderStyle.Sizable; // keeps the native frame behaviour; WM_NCCALCSIZE hides what it draws
                Padding = new Padding(0);
            }

            protected override void OnHandleCreated(EventArgs e)
            {
                base.OnHandleCreated(e);
                try
                {
                    int on = 1, round = 2 /* DWMWCP_ROUND */, border = 0x00302A2A /* BGR #2A2A30 */;
                    DwmSetWindowAttribute(Handle, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, ref on, 4);
                    DwmSetWindowAttribute(Handle, 33 /* DWMWA_WINDOW_CORNER_PREFERENCE */, ref round, 4);
                    DwmSetWindowAttribute(Handle, 34 /* DWMWA_BORDER_COLOR */, ref border, 4);
                }
                catch { } // older Windows: square corners, no dark border
                ApplyPadding();
            }

            protected override void OnResize(EventArgs e) { base.OnResize(e); ApplyPadding(); }

            private void ApplyPadding()
            {
                var p = WindowState == FormWindowState.Maximized ? 0 : Band;
                if (Padding.All != p) Padding = new Padding(p);
            }

            protected override void WndProc(ref Message m)
            {
                if (m.Msg == WM_NCCALCSIZE && m.WParam != IntPtr.Zero)
                {
                    if (WindowState == FormWindowState.Maximized) // fill the work area exactly instead of spilling past the screen edges
                    {
                        var p = Marshal.PtrToStructure<NCCALCSIZE_PARAMS>(m.LParam);
                        var wa = Screen.FromHandle(Handle).WorkingArea;
                        p.R0 = new RECT { Left = wa.Left, Top = wa.Top, Right = wa.Right, Bottom = wa.Bottom };
                        Marshal.StructureToPtr(p, m.LParam, false);
                    }
                    m.Result = IntPtr.Zero; // the whole window is client area: no title bar, no visible frame
                    return;
                }
                if (m.Msg == WM_NCHITTEST && WindowState != FormWindowState.Maximized)
                {
                    base.WndProc(ref m);
                    if ((int)m.Result != HTCLIENT) return;
                    var lp = m.LParam.ToInt64();
                    var pt = PointToClient(new Point((short)(lp & 0xFFFF), (short)((lp >> 16) & 0xFFFF)));
                    int b = Band + 1, w = ClientSize.Width, h = ClientSize.Height;
                    bool l = pt.X < b, r = pt.X >= w - b, t = pt.Y < b, btm = pt.Y >= h - b;
                    var hit = t && l ? 13 : t && r ? 14 : btm && l ? 16 : btm && r ? 17 : l ? 10 : r ? 11 : t ? 12 : btm ? 15 : HTCLIENT;
                    m.Result = (IntPtr)hit;
                    return;
                }
                base.WndProc(ref m);
            }
        }

        private static Rectangle Fit(Rectangle r, Rectangle wa)
        {
            var w = Math.Min(r.Width, wa.Width);
            var h = Math.Min(r.Height, wa.Height);
            var x = Math.Max(wa.Left, Math.Min(r.Left, wa.Right - w));
            var y = Math.Max(wa.Top, Math.Min(r.Top, wa.Bottom - h));
            return new Rectangle(x, y, w, h);
        }

        public static void OpenInBrowser(string url)
        {
            try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true }); }
            catch { }
        }
    }
}
