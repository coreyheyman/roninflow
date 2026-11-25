using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
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
            Show("journal", url, "RoninFlow", near, onTop, wa =>
                new Rectangle(wa.Left + wa.Width / 12, wa.Top + wa.Height / 14, wa.Width * 10 / 12, wa.Height * 12 / 14), tool: false);
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

        private static void Show(string key, string url, string title, Point near, bool onTop, Func<Rectangle, Rectangle> place, bool tool, bool keepPlace = true)
        {
            if (!EnsureThread()) { OpenInBrowser(url); return; }
            _ctx!.Post(_ =>
            {
                try
                {
                    var screen = Screen.FromPoint(near.IsEmpty ? Cursor.Position : near).WorkingArea;
                    var want = keepPlace && LastBounds.TryGetValue(key, out var lb) ? lb : place(screen);
                    want = Fit(want, Screen.FromRectangle(want).WorkingArea);

                    if (Forms.TryGetValue(key, out var open) && !open.IsDisposed)
                    {
                        var view = (WebView2)open.Tag!;
                        if (view.CoreWebView2 != null) view.CoreWebView2.Navigate(url);
                        else view.Source = new Uri(url);
                        open.Text = title;
                        open.TopMost = onTop;
                        if (!keepPlace) open.Bounds = want; // a review jumps to the execution clicked
                        if (open.WindowState == FormWindowState.Minimized) open.WindowState = FormWindowState.Normal;
                        open.Show();
                        open.Activate();
                        return;
                    }

                    var f = new Form
                    {
                        Text = title,
                        StartPosition = FormStartPosition.Manual,
                        Bounds = want,
                        TopMost = onTop,
                        BackColor = Back,
                        ShowInTaskbar = !tool,
                        FormBorderStyle = tool ? FormBorderStyle.SizableToolWindow : FormBorderStyle.Sizable,
                        MinimumSize = new Size(320, 360),
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
                    wv.CoreWebView2InitializationCompleted += (_, e) =>
                    {
                        if (!e.IsSuccess)
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
                        core.WindowCloseRequested += (_, _) => f.Close();                 // the page's own close / “done” buttons
                        core.NewWindowRequested += (_, a) => { a.Handled = true; OpenInBrowser(a.Uri); }; // links out go to your browser
                        core.DocumentTitleChanged += (_, _) => { if (!tool && !string.IsNullOrWhiteSpace(core.DocumentTitle)) f.Text = core.DocumentTitle; };
                    };
                    f.FormClosing += (_, _) => { if (f.WindowState == FormWindowState.Normal) LastBounds[key] = f.Bounds; };
                    f.FormClosed += (_, _) => { Forms.Remove(key); try { wv.Dispose(); } catch { } };
                    Forms[key] = f;
                    wv.Source = new Uri(url);
                    f.Show();
                    f.Activate();
                }
                catch
                {
                    OpenInBrowser(url);
                }
            }, null);
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
