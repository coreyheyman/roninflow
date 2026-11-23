// RoninFlow Suite — block trading for the rest of the day from the chart: click the status marker at the top right of
// the account panel, choose this account or every account (and whether to flatten now), and confirm. RoninFlow keeps
// the block until midnight in your time zone and Journal Sync's risk enforcement applies it.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

using OFT.Rendering.Context;
using OFT.Rendering.Tools;

namespace TradeJournal
{
    public partial class RoninFlowHud
    {
        private bool _blockAsk;                 // the pop-up is open
        private string _blockScope = "this";    // "this" or "all"
        private bool _blockFlatten;
        private bool _blockBusy;
        private string _blockMsg = "";
        private bool _blockDone;
        private Rectangle _stateRect = Rectangle.Empty;
        private Rectangle _blockRect = Rectangle.Empty;
        private readonly List<(Rectangle Box, string Action)> _blockButtons = new();

        /// <summary>Every account ATAS is connected to (for "all accounts").</summary>
        private List<string> AllAccounts()
        {
            var list = new List<string>();
            try
            {
                var core = RiskEnforcer.TradingCore(this);
                if (core != null)
                    list.AddRange(core.Portfolios.Where(p => p != null).Select(p => p.AccountID ?? "").Where(a => a.Length > 0));
            }
            catch { }
            var mine = TradingManager?.Portfolio?.AccountID ?? "";
            if (mine.Length > 0) list.Add(mine);
            list.AddRange(_positions.Select(p => p.Account).Where(a => a.Length > 0));
            return list.Distinct(StringComparer.OrdinalIgnoreCase).OrderBy(a => a, StringComparer.OrdinalIgnoreCase).ToList();
        }

        private void BlockAction(string action)
        {
            switch (action)
            {
                case "close":
                    _blockAsk = false;
                    break;
                case "scope:this":
                    _blockScope = "this";
                    break;
                case "scope:all":
                    _blockScope = "all";
                    break;
                case "flatten":
                    _blockFlatten = !_blockFlatten;
                    break;
                case "confirm":
                    if (_blockBusy || _blockDone) break;
                    var ids = _blockScope == "all" ? AllAccounts() : new List<string> { TradingManager?.Portfolio?.AccountID ?? "" };
                    ids = ids.Where(a => a.Length > 0).ToList();
                    if (ids.Count == 0) { _blockMsg = "No account is selected on this chart."; break; }
                    _blockBusy = true;
                    _blockMsg = "Blocking…";
                    _ = Task.Run(() => PostBlock(ids, _blockFlatten));
                    break;
            }
        }

        private async Task PostBlock(List<string> ids, bool flatten)
        {
            try
            {
                using var ask = new HttpRequestMessage(HttpMethod.Post, $"{Root()}/api/atas/risk/lock");
                if (!string.IsNullOrWhiteSpace(Token))
                    ask.Headers.TryAddWithoutValidation("Authorization", "Bearer " + Token.Trim());
                ask.Content = new StringContent(JsonSerializer.Serialize(new { accounts = ids, flatten }), Encoding.UTF8, "application/json");
                using var reply = await Http.SendAsync(ask);
                reply.EnsureSuccessStatusCode();
                RiskEnforcer.RefreshSoon(); // applied on the enforcer's next pass, not at the next rules refresh
                _blockDone = true;
                _blockMsg = ids.Count == 1
                    ? $"{Mask(ids[0])} is blocked until tomorrow{(flatten ? " and is being flattened" : "")}."
                    : $"{ids.Count} accounts are blocked until tomorrow{(flatten ? " and are being flattened" : "")}.";
            }
            catch (Exception e)
            {
                _blockMsg = "Couldn't reach RoninFlow: " + e.Message;
            }
            finally
            {
                _blockBusy = false;
                RedrawChart();
            }
        }

        private void DrawBlockAsk(RenderContext g)
        {
            _blockButtons.Clear();
            var r = Container.Region;
            var w = Math.Min(440, r.Width - 40);
            var pad = 16;
            var lh = g.MeasureString("Ag", _font).Height;
            var sh = g.MeasureString("Ag", _small).Height;
            var bh = g.MeasureString("Ag", _big).Height;
            var textW = w - pad * 2;
            var mine = TradingManager?.Portfolio?.AccountID ?? "";
            var all = AllAccounts();
            var acct = _snap?.Account;
            var enforcer = _snap?.Enforcer == true || RiskEnforcer.Running;

            var intro = Wrap(g, "New orders are blocked until midnight; closing a position still works. The block can't be lifted from the chart.", _font, textW, 4);
            var warn = enforcer ? new List<string>() : Wrap(g, "Risk enforcement isn't running: switch on \"Enforce RoninFlow risk rules\" in Journal Sync on any chart, or the block won't be applied.", _small, textW - 14, 4);
            var already = acct != null && acct.ManualLock;
            var allLine = Fit(g, string.Join(", ", all.Select(Mask)), _small, textW - 30);
            var optH = lh + sh + 14;
            var h = 3 + pad + bh + 10 + intro.Count * (lh + 3) + 10
                + (already ? sh + 8 : 0)
                + optH * 2 + 8 + 6
                + lh + 12
                + (warn.Count > 0 ? warn.Count * (sh + 2) + 16 : 0)
                + (_blockMsg.Length > 0 ? lh + 8 : 0)
                + lh + 10 + pad;
            var rect = new Rectangle(r.Left + (r.Width - w) / 2, r.Top + Math.Max(16, (r.Height - h) / 2), w, h);
            _blockRect = rect;
            g.FillRectangle(Color.FromArgb(250, Math.Min(255, Background.R + 6), Math.Min(255, Background.G + 6), Math.Min(255, Background.B + 6)), rect, Radius + 2);
            g.DrawRectangle(new RenderPen(BorderColor, 1), rect, Radius + 2);
            g.FillRectangle(NegativeColor, new Rectangle(rect.X + 1, rect.Y + 1, rect.Width - 2, 3), 1);
            var x = rect.X + pad;
            var y = rect.Y + 3 + pad;

            g.DrawString("Block trading for the rest of the day?", _big, TextColor, x, y);
            var xr = new Rectangle(rect.Right - pad - 12, y + 2, 14, 14);
            g.DrawString("✕", _font, MutedColor, xr.X, xr.Y);
            _blockButtons.Add((Rectangle.Inflate(xr, 6, 6), "close"));
            y += bh + 10;
            foreach (var l in intro) { g.DrawString(l, _font, A(TextColor, 210), x, y); y += lh + 3; }
            y += 10;
            if (already)
            {
                g.DrawString("This account is already blocked for today.", _small, NegativeColor, x, y);
                y += sh + 8;
            }

            // which accounts
            void Option(string key, string title, string sub, bool on, bool enabled)
            {
                var box = new Rectangle(x, y, textW, optH);
                g.FillRectangle(on ? A(NegativeColor, 26) : TileColor, box, Math.Min(Radius, 5));
                g.DrawRectangle(new RenderPen(on ? A(NegativeColor, 150) : BorderColor, 1), box, Math.Min(Radius, 5));
                var dot = new Rectangle(box.X + 10, box.Y + 9 + (lh - 12) / 2, 12, 12);
                g.DrawEllipse(new RenderPen(on ? NegativeColor : MutedColor, 1), dot);
                if (on) g.FillEllipse(NegativeColor, Rectangle.Inflate(dot, -3, -3));
                g.DrawString(title, _bold, enabled ? TextColor : MutedColor, box.X + 30, box.Y + 6);
                g.DrawString(sub, _small, MutedColor, box.X + 30, box.Y + 8 + lh);
                if (enabled) _blockButtons.Add((box, key));
                y += optH + 8;
            }
            Option("scope:this", "This account", mine.Length > 0 ? Mask(mine) : "no account selected on this chart", _blockScope == "this", mine.Length > 0);
            Option("scope:all", $"All accounts ({all.Count})", allLine.Length > 0 ? allLine : "none connected", _blockScope == "all", all.Count > 0);
            y += 6;

            // flatten now
            var cb = new Rectangle(x, y + (lh - 14) / 2, 14, 14);
            g.FillRectangle(_blockFlatten ? NegativeColor : TileColor, cb, 3);
            g.DrawRectangle(new RenderPen(_blockFlatten ? NegativeColor : BorderColor, 1), cb, 3);
            if (_blockFlatten) g.DrawString("✓", _small, Color.White, cb.X + 2, cb.Y);
            const string flatText = "Also close open positions and cancel orders now";
            var fw = g.MeasureString(flatText, _font).Width;
            g.DrawString(flatText, _font, TextColor, cb.Right + 8, y);
            _blockButtons.Add((new Rectangle(x, y - 3, fw + 26, lh + 6), "flatten"));
            y += lh + 12;

            if (warn.Count > 0)
            {
                var wr = new Rectangle(x, y, textW, warn.Count * (sh + 2) + 10);
                g.FillRectangle(A(WarningColor, 24), wr, 4);
                g.DrawRectangle(new RenderPen(A(WarningColor, 120), 1), wr, 4);
                var ty = wr.Y + 5;
                foreach (var l in warn) { g.DrawString(l, _small, WarningColor, wr.X + 7, ty); ty += sh + 2; }
                y += wr.Height + 6;
            }

            if (_blockMsg.Length > 0)
            {
                g.DrawString(Fit(g, _blockMsg, _font, textW), _font, _blockDone ? PositiveColor : _blockBusy ? MutedColor : NegativeColor, x, y);
                y += lh + 8;
            }

            // buttons
            var bx = x;
            var buttons = _blockDone
                ? new List<(string Label, string Action, bool Primary)> { ("Close", "close", true) }
                : new List<(string Label, string Action, bool Primary)> { (_blockBusy ? "Blocking…" : "Block for today", "confirm", true), ("Cancel", "close", false) };
            foreach (var (label, action, primary) in buttons)
            {
                var bw = g.MeasureString(label, _font).Width + 22;
                var br = new Rectangle(bx, y, bw, lh + 10);
                var fill = primary ? (_blockDone ? AccentColor : NegativeColor) : TileColor;
                g.FillRectangle(fill, br, Math.Min(Radius, 5));
                g.DrawRectangle(new RenderPen(primary ? fill : BorderColor, 1), br, Math.Min(Radius, 5));
                g.DrawString(label, _font, primary ? Color.White : TextColor, br.X + 11, br.Y + 5);
                _blockButtons.Add((br, action));
                bx += bw + 8;
            }
        }
    }
}
