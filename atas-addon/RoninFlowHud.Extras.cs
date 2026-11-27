// RoninFlow Suite — the chart parts that live on the price itself, each with its own tab in the settings:
//   * Executions: your trades on the chart — entry and exit markers, the line joining them (win or loss colour), the
//     trade's result at the exit and the open position's average price.
//   * Heatmap: resting limit orders from the DOM drawn like an order-book heatmap, behind or over the candles, with
//     an on/off button on the chart.
//   * Candles: see RoninFlowHud.Candles.cs.

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Drawing;
using System.Globalization;
using System.Linq;

using ATAS.DataFeedsCore;
using ATAS.DataFeedsCore.Statistics;
using ATAS.Indicators;

using OFT.Attributes;
using OFT.Rendering.Context;
using OFT.Rendering.Tools;

namespace TradeJournal
{
    public partial class RoninFlowHud
    {
        public enum ExecMarkerStyle { Triangles, Arrows, Circles }
        public enum ExecLine { Solid, Dashed, Dotted }
        public enum ExecResult { Money, Ticks, Points }
        public enum HmPalette { Bookmap, Thermal, Ocean, Mono, Custom }
        public enum HmScaling { Logarithmic, Linear }

        #region Settings — executions

        [Display(Name = "Show your executions on the chart", GroupName = "Executions", Order = 300)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public bool ShowExecutions { get; set; } = true;

        [Display(Name = "Every account's trades (not just the chart's)", GroupName = "Executions", Order = 301)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public bool ExecAllAccounts { get; set; } = false;

        [Display(Name = "Include the micro / mini twin (MES trades on an ES chart and back)", GroupName = "Executions", Order = 302)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public bool ExecTwins { get; set; } = true;

        [Display(Name = "Days back (0 = everything ATAS has)", GroupName = "Executions", Order = 303)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        [Range(0, 365)]
        public int ExecDays { get; set; } = 0;

        [Display(Name = "Click an execution to review the trade (syncs with your journal)", GroupName = "Executions", Order = 304)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public bool ExecReview { get; set; } = true;

        [Display(Name = "Marker style", GroupName = "Markers", Order = 310)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public ExecMarkerStyle ExecMarker { get; set; } = ExecMarkerStyle.Triangles;

        [Display(Name = "Marker size", GroupName = "Markers", Order = 311)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        [Range(4, 40)]
        public int ExecSize { get; set; } = 10;

        [Display(Name = "Buy colour", GroupName = "Markers", Order = 312)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public Color ExecBuyColor { get; set; } = Color.FromArgb(255, 43, 196, 138);

        [Display(Name = "Sell colour", GroupName = "Markers", Order = 313)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public Color ExecSellColor { get; set; } = Color.FromArgb(255, 229, 72, 77);

        [Display(Name = "Dark outline", GroupName = "Markers", Order = 314)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public bool ExecOutline { get; set; } = true;

        [Display(Name = "Show the quantity next to each marker", GroupName = "Markers", Order = 315)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public bool ExecShowQty { get; set; } = true;

        [Display(Name = "Join entry and exit with a line", GroupName = "Connecting line", Order = 320)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public bool ExecConnect { get; set; } = true;

        [Display(Name = "Winning trade line", GroupName = "Connecting line", Order = 321)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public Color ExecWinColor { get; set; } = Color.FromArgb(220, 43, 196, 138);

        [Display(Name = "Losing trade line", GroupName = "Connecting line", Order = 322)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public Color ExecLossColor { get; set; } = Color.FromArgb(220, 229, 72, 77);

        [Display(Name = "Line width", GroupName = "Connecting line", Order = 323)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        [Range(1, 8)]
        public int ExecLineWidth { get; set; } = 1;

        [Display(Name = "Line style", GroupName = "Connecting line", Order = 324)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public ExecLine ExecLineStyle { get; set; } = ExecLine.Dashed;

        [Display(Name = "Show the result at the exit", GroupName = "Labels", Order = 330)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public bool ExecShowResult { get; set; } = true;

        [Display(Name = "Result in", GroupName = "Labels", Order = 331)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public ExecResult ExecResultUnit { get; set; } = ExecResult.Money;

        [Display(Name = "Show the open position's average price", GroupName = "Open position", Order = 340)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public bool ExecShowAvg { get; set; } = true;

        // (keeps its old name so saved templates load: it was the one colour for both sides)
        [Display(Name = "Long position line", GroupName = "Open position", Order = 341)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public Color ExecAvgColor { get; set; } = Color.FromArgb(255, 43, 196, 138);

        [Display(Name = "Short position line", GroupName = "Open position", Order = 342)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public Color ExecAvgShortColor { get; set; } = Color.FromArgb(255, 229, 72, 77);

        [Display(Name = "Show working orders (limits and stops)", GroupName = "Working orders", Order = 350)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public bool ExecShowOrders { get; set; } = true;

        [Display(Name = "Buy order line", GroupName = "Working orders", Order = 351)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public Color ExecBuyOrderColor { get; set; } = Color.FromArgb(255, 77, 163, 255);

        [Display(Name = "Sell order line", GroupName = "Working orders", Order = 352)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public Color ExecSellOrderColor { get; set; } = Color.FromArgb(255, 240, 140, 60);

        [Display(Name = "Tell stops, targets and scale-ins apart (while in a position)", GroupName = "Working orders", Order = 353)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public bool ExecOrderRoles { get; set; } = true;

        [Display(Name = "Show R:R (from the average price to the stop and targets)", GroupName = "Working orders", Order = 354)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public bool ExecShowRR { get; set; } = true;

        [Display(Name = "Show the dollar amount at the stop and targets", GroupName = "Working orders", Order = 355)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public bool ExecShowMoney { get; set; } = true;

        [Display(Name = "Stop loss line", GroupName = "Working orders", Order = 356)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public Color ExecStopColor { get; set; } = Color.FromArgb(255, 229, 72, 77);

        [Display(Name = "Take profit line", GroupName = "Working orders", Order = 357)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public Color ExecTargetColor { get; set; } = Color.FromArgb(255, 43, 196, 138);

        [Display(Name = "Scale-in line", GroupName = "Working orders", Order = 358)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public Color ExecScaleColor { get; set; } = Color.FromArgb(255, 77, 163, 255);

        #endregion

        #region Settings — heatmap

        [Display(Name = "Show the DOM heatmap", GroupName = "Heatmap", Order = 600)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        public bool ShowHeatmap { get; set; } = false;

        [Display(Name = "Start with it switched off (turn it on with the chart button)", GroupName = "Heatmap", Order = 602)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        public bool HmStartOff { get; set; } = false;

        [Display(Name = "Draw behind the candles", GroupName = "Heatmap", Order = 601)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        public bool HeatmapBehind { get; set; } = true;

        [Display(Name = "Minimum size shown", GroupName = "Levels", Order = 610)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        [Range(1, 100000)]
        public decimal HmThreshold { get; set; } = 15m;

        [Display(Name = "New shade when size changes by (%)", GroupName = "Levels", Order = 611)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        [Range(5, 500)]
        public int HmReshade { get; set; } = 25;

        [Display(Name = "Live levels reach the right edge", GroupName = "Levels", Order = 612)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        public bool HmExtendLive { get; set; } = true;

        [Display(Name = "Row height (0 = one tick)", GroupName = "Levels", Order = 613)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        [Range(0, 60)]
        public int HmRowHeight { get; set; } = 0;

        [Display(Name = "Colour palette", GroupName = "Look", Order = 620)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        public HmPalette HmPaletteChoice { get; set; } = HmPalette.Bookmap;

        [Display(Name = "Scaling (log shows mid-size levels better)", GroupName = "Look", Order = 621)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        public HmScaling HmScale { get; set; } = HmScaling.Logarithmic;

        [Display(Name = "Contrast (1 = even, higher = only big levels glow)", GroupName = "Look", Order = 622)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        [Range(0.3, 3.0)]
        public double HmContrast { get; set; } = 1.2;

        [Display(Name = "Brightest at size (0 = automatic)", GroupName = "Look", Order = 623)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        [Range(0, 1000000)]
        public decimal HmBrightAt { get; set; } = 0m;

        [Display(Name = "Automatic: brightest at this percentile of recent sizes", GroupName = "Look", Order = 624)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        [Range(50, 100)]
        public int HmPercentile { get; set; } = 99;

        [Display(Name = "Opacity (%)", GroupName = "Look", Order = 625)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        [Range(10, 100)]
        public int HmOpacity { get; set; } = 100;

        [Display(Name = "Thin levels fade into the background", GroupName = "Look", Order = 626)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        public bool HmFadeThin { get; set; } = true;

        [Display(Name = "Glow above and below (px, 0 = automatic)", GroupName = "Look", Order = 627)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        [Range(0, 60)]
        public int HmGlow { get; set; } = 0;

        [Display(Name = "Fade toward the live edge (px)", GroupName = "Look", Order = 628)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        [Range(0, 400)]
        public int HmTailFade { get; set; } = 60;

        [Display(Name = "Chart background (for the fade)", GroupName = "Look", Order = 629)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        public Color HmFadeColor { get; set; } = Color.FromArgb(255, 10, 10, 12);

        [Display(Name = "Tint the chart background", GroupName = "Look", Order = 630)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        public bool HmTint { get; set; } = false;

        [Display(Name = "Background tint", GroupName = "Look", Order = 631)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        public Color HmTintColor { get; set; } = Color.FromArgb(255, 18, 20, 38);

        [Display(Name = "Thinnest (1)", GroupName = "Custom palette", Order = 640)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        public Color HmColor1 { get; set; } = Color.FromArgb(255, 8, 24, 88);

        [Display(Name = "Thin (2)", GroupName = "Custom palette", Order = 641)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        public Color HmColor2 { get; set; } = Color.FromArgb(255, 0, 150, 210);

        [Display(Name = "Medium (3)", GroupName = "Custom palette", Order = 642)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        public Color HmColor3 { get; set; } = Color.FromArgb(255, 60, 210, 90);

        [Display(Name = "Heavy (4)", GroupName = "Custom palette", Order = 643)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        public Color HmColor4 { get; set; } = Color.FromArgb(255, 255, 200, 0);

        [Display(Name = "Heaviest (5)", GroupName = "Custom palette", Order = 644)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        public Color HmColor5 { get; set; } = Color.FromArgb(255, 235, 40, 30);

        [Display(Name = "Show size tags on live levels", GroupName = "Size tags", Order = 650)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        public bool HmTags { get; set; } = true;

        [Display(Name = "Only the biggest (count)", GroupName = "Size tags", Order = 651)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        [Range(1, 50)]
        public int HmTagCount { get; set; } = 8;

        [Display(Name = "Tag text", GroupName = "Size tags", Order = 652)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        public Color HmTagText { get; set; } = Color.White;

        [Display(Name = "Show the on/off button", GroupName = "On/off button", Order = 660)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        public bool HmShowButton { get; set; } = true;

        [Display(Name = "Placement", GroupName = "On/off button", Order = 661)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        public Placement HmButtonPlacement { get; set; } = Placement.TopLeft;

        [Display(Name = "X offset", GroupName = "On/off button", Order = 662)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        [Range(-3000, 3000)]
        public int HmButtonX { get; set; } = 20;

        [Display(Name = "Y offset", GroupName = "On/off button", Order = 663)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        [Range(-3000, 3000)]
        public int HmButtonY { get; set; } = 60;

        #endregion

        // ======================================================================================================
        // layering: the heatmap behind the candles needs the indicator drawn under the price. With custom candles on,
        // everything stays on top and the order inside the indicator does it (heatmap first, then the candles).
        // ======================================================================================================

        private void UpdateLayering()
        {
            var under = ShowHeatmap && _hmEnabled && HeatmapBehind && !ShowCandles;
            if (DrawAbovePrice == under)
                DrawAbovePrice = !under;
        }

        // ======================================================================================================
        // executions
        // ======================================================================================================

        private sealed class Exec
        {
            public DateTime Open, Close;
            public decimal OpenPrice, ClosePrice, Qty, Net;
            public bool Long, Complete;
            public string Account = "", Symbol = "";
            public List<string> Ids = new(); // ATAS trade ids (several when the same trade is drawn once for every copy-traded account)
            public ExecPos? Pos;               // the position this fill belongs to, when it was scaled (several fills)
        }

        /// <summary>A scaled position: its fills' totals, shown as one result at the last exit.</summary>
        private sealed class ExecPos
        {
            public decimal Net, Qty, EntryCost, ExitCost;
            public int Count;
            public Exec Last = null!;
        }

        /// <summary>
        /// Groups the fills of each position — same account, market and side, never flat in between — so a scaled
        /// position gets one result chip with its total instead of one per fill.
        /// </summary>
        private static void GroupPositions(List<Exec> rows)
        {
            var done = rows.Where(r => r.Complete).OrderBy(r => r.Account).ThenBy(r => SymParts(r.Symbol).Root).ThenBy(r => r.Long).ThenBy(r => r.Open).ToList();
            var cur = new List<Exec>();
            var end = DateTime.MinValue;
            string key = "";
            void Flush()
            {
                if (cur.Count > 1)
                {
                    var pos = new ExecPos { Count = cur.Count, Last = cur.OrderBy(x => x.Close).Last() };
                    foreach (var x in cur) { pos.Net += x.Net; pos.Qty += x.Qty; pos.EntryCost += x.OpenPrice * x.Qty; pos.ExitCost += x.ClosePrice * x.Qty; x.Pos = pos; }
                }
                cur.Clear();
            }
            foreach (var e in done)
            {
                var k = $"{e.Account}|{SymParts(e.Symbol).Root}|{e.Long}";
                if (cur.Count > 0 && k == key && e.Open <= end) { cur.Add(e); if (e.Close > end) end = e.Close; continue; }
                Flush();
                cur.Add(e); key = k; end = e.Close;
            }
            Flush();
        }

        private volatile List<(Rectangle Box, Exec Trade)> _execHits = new();

        /// <summary>The execution marker under a point on the chart, if any (the most recent one when they overlap).</summary>
        private Exec? ExecAt(Point p)
        {
            var hits = _execHits;
            for (var i = hits.Count - 1; i >= 0; i--)
                if (hits[i].Box.Contains(p)) return hits[i].Trade;
            return null;
        }

        /// <summary>The trade's review from your journal, in a window beside the marker.</summary>
        private void OpenTradeReview(Exec e)
        {
            var q = new List<string>
            {
                "ids=" + Uri.EscapeDataString(string.Join(",", e.Ids)),
                "acct=" + Uri.EscapeDataString(e.Account),
                "sym=" + Uri.EscapeDataString(SymParts(e.Symbol).Root),
                "t=" + Uri.EscapeDataString(e.Open.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture)),
                "p=" + e.OpenPrice.ToString(CultureInfo.InvariantCulture),
            };
            JournalWindows.ShowTrade(Root() + "/#/embed/trade?" + string.Join("&", q), JournalWindows.CursorScreen(), JournalOnTop);
        }

        private volatile List<Exec> _execs = new();
        private decimal? _avgPrice;
        private decimal _avgQty;
        private decimal _tickCost; // dollars per tick per contract, from ATAS's instrument (0 = unknown)
        private bool _avgLong;
        private volatile List<Order> _orders = new();
        private DateTime _execRefreshed = DateTime.MinValue;

        private static readonly Dictionary<string, string> Twins = new(StringComparer.Ordinal)
        {
            ["MES"] = "ES", ["MNQ"] = "NQ", ["M2K"] = "RTY", ["MYM"] = "YM", ["MGC"] = "GC", ["MCL"] = "CL",
            ["SIL"] = "SI", ["MBT"] = "BTC", ["MET"] = "ETH", ["M6E"] = "6E", ["M6B"] = "6B", ["M6A"] = "6A", ["QM"] = "CL", ["QG"] = "NG",
        };

        /// <summary>"MESZ6@CME_Ind" → ("MES", "Z6"): the root and the contract month.</summary>
        private static (string Root, string Month) SymParts(string? s)
        {
            s = (s ?? "").Trim().ToUpperInvariant();
            var at = s.IndexOf('@');
            if (at > 0) s = s.Substring(0, at);
            var m = System.Text.RegularExpressions.Regex.Match(s, "^(.+?)([FGHJKMNQUVXZ]\\d{1,2})$");
            return m.Success ? (m.Groups[1].Value, m.Groups[2].Value) : (s, "");
        }

        private bool SameInstrument(string? code)
        {
            var a = SymParts(code);
            var b = SymParts(InstrumentInfo?.Instrument);
            if (a.Root.Length == 0 || b.Root.Length == 0) return false;
            if (a.Month.Length > 0 && b.Month.Length > 0 && a.Month[0] != b.Month[0]) return false; // a different contract month
            if (a.Root == b.Root) return true;
            if (!ExecTwins) return false;
            var ra = Twins.TryGetValue(a.Root, out var x) ? x : a.Root;
            var rb = Twins.TryGetValue(b.Root, out var y) ? y : b.Root;
            return ra == rb;
        }

        /// <summary>The trades for this chart (its account, unless every account is wanted), kept ready for drawing.</summary>
        private void RefreshExecutions(bool force = false)
        {
            if (!ShowExecutions) return;
            if (!force && (DateTime.UtcNow - _execRefreshed).TotalMilliseconds < 900) return;
            _execRefreshed = DateTime.UtcNow;
            var account = TradingManager?.Portfolio?.AccountID ?? "";
            var stats = TradingStatisticsProvider?.RawStatistics;
            if (stats == null) return;
            List<HistoryMyTrade> list;
            try { list = stats.HistoryMyTrades.ToList(); }
            catch { return; }
            var from = ExecDays > 0 ? DateTime.UtcNow.AddDays(-ExecDays) : DateTime.MinValue;
            var all = ExecAllAccounts || account.Length == 0; // no account picked on the chart: show them all
            var rows = new List<Exec>();
            var seen = new Dictionary<string, Exec>();
            foreach (var t in list)
            {
                if (t == null) continue;
                var acct = t.AccountID ?? t.Portfolio?.AccountID ?? "";
                if (!all && !string.Equals(acct, account, StringComparison.OrdinalIgnoreCase)) continue;
                if (!SameInstrument(t.Security?.Code ?? t.SecurityCode)) continue;
                if (t.OpenTime < from) continue;
                // the same trade copied to several accounts is drawn once, with the combined quantity
                var key = all ? $"{t.OpenTime:yyyyMMddHHmmss}|{t.OpenPrice}|{t.ClosePrice}|{t.IsComplete}|{Math.Sign(t.OpenVolume)}" : t.Id.ToString();
                if (all && seen.TryGetValue(key, out var dup))
                {
                    dup.Qty += Math.Abs(t.OpenVolume);
                    dup.Net += t.PnL - Math.Abs(t.Commission ?? 0m);
                    dup.Ids.Add(t.Id.ToString());
                    continue;
                }
                var row = new Exec
                {
                    Open = DateTime.SpecifyKind(t.OpenTime, DateTimeKind.Utc),
                    Close = DateTime.SpecifyKind(t.CloseTime, DateTimeKind.Utc),
                    OpenPrice = t.OpenPrice,
                    ClosePrice = t.ClosePrice,
                    Qty = Math.Abs(t.OpenVolume),
                    Long = t.OpenVolume > 0,
                    Complete = t.IsComplete,
                    Net = t.PnL - Math.Abs(t.Commission ?? 0m),
                    Account = acct,
                    Symbol = t.Security?.Code ?? t.SecurityCode ?? "",
                };
                row.Ids.Add(t.Id.ToString());
                if (all) seen[key] = row;
                rows.Add(row);
            }
            GroupPositions(rows);
            _execs = rows;

            // the open position on this chart's account and instrument
            decimal? avg = null;
            var lng = false;
            try
            {
                var core = RiskEnforcer.TradingCore(this);
                var pos = core?.Positions.FirstOrDefault(p => p != null && p.Volume != 0
                    && string.Equals(p.AccountID ?? p.Portfolio?.AccountID, account, StringComparison.OrdinalIgnoreCase)
                    && SameInstrument(p.Security?.Code));
                if (pos != null) { avg = pos.AveragePrice; lng = pos.Volume > 0; _avgQty = Math.Abs(pos.Volume); try { if (pos.Security?.TickCost > 0) _tickCost = pos.Security.TickCost; } catch { } }
            }
            catch { }
            if (avg == null)
            {
                var open = rows.LastOrDefault(r => !r.Complete);
                if (open != null) { avg = open.OpenPrice; lng = open.Long; _avgQty = open.Qty; }
            }
            _avgPrice = avg;
            _avgLong = lng;
            RefreshOrders();
        }

        /// <summary>The chart account's working orders on this instrument.</summary>
        private void RefreshOrders()
        {
            try
            {
                var account = TradingManager?.Portfolio?.AccountID ?? "";
                var core = RiskEnforcer.TradingCore(this);
                if (core == null || account.Length == 0) { _orders = new List<Order>(); return; }
                _orders = core.Orders.Where(o => o != null && o.State == OrderStates.Active && o.Type != OrderTypes.Market
                    && string.Equals(o.AccountID ?? o.Portfolio?.AccountID, account, StringComparison.OrdinalIgnoreCase)
                    && SameInstrument(o.Security?.Code)).ToList();
            }
            catch { }
        }

        protected override void OnNewOrder(Order order) { RefreshOrders(); RedrawChart(); }

        protected override void OnOrderChanged(Order order) { RefreshOrders(); RedrawChart(); }

        /// <summary>The bar a moment falls in (the last bar that opened at or before it), or -1 if before the chart.</summary>
        private int BarAt(DateTime utc)
        {
            var n = CurrentBar;
            if (n <= 0) return -1;
            int lo = 0, hi = n - 1;
            if (GetCandle(0).Time > utc) return -1;
            while (lo < hi)
            {
                var mid = (lo + hi + 1) / 2;
                if (GetCandle(mid).Time <= utc) lo = mid;
                else hi = mid - 1;
            }
            return lo;
        }

        private RenderPen? _execPenWin, _execPenLoss;
        private string _execPenKey = "";

        private void ExecPens()
        {
            var key = $"{ExecWinColor.ToArgb()}|{ExecLossColor.ToArgb()}|{ExecLineWidth}|{ExecLineStyle}";
            if (key == _execPenKey) return;
            _execPenKey = key;
            var dash = ExecLineStyle switch
            {
                ExecLine.Solid => System.Drawing.Drawing2D.DashStyle.Solid,
                ExecLine.Dotted => System.Drawing.Drawing2D.DashStyle.Dot,
                _ => System.Drawing.Drawing2D.DashStyle.Dash,
            };
            _execPenWin = new RenderPen(ExecWinColor, ExecLineWidth, dash);
            _execPenLoss = new RenderPen(ExecLossColor, ExecLineWidth, dash);
        }

        private void DrawExecutions(RenderContext g)
        {
            RefreshExecutions();
            var list = _execs;
            var r = Container.Region;
            ExecPens();
            var first = Math.Max(0, FirstVisibleBarNumber);
            var last = Math.Min(CurrentBar - 1, LastVisibleBarNumber);
            var labels = new List<Rectangle>();
            var hits = new List<(Rectangle, Exec)>();
            var hr = Math.Max(8, ExecSize); // a forgiving click target around each marker
            void Hit(Exec e, int x, int y) { if (r.Contains(x, y)) hits.Add((new Rectangle(x - hr, y - hr, hr * 2, hr * 2), e)); }

            g.SetClip(r);
            try
            {
                foreach (var e in list)
                {
                    var b1 = BarAt(e.Open);
                    if (b1 < 0) continue;
                    var b2 = e.Complete ? BarAt(e.Close) : -1;
                    if (b1 > last || (e.Complete && b2 < first)) continue;
                    var x1 = ChartInfo.GetXByBar(b1, false);
                    var y1 = ChartInfo.GetYByPrice(e.OpenPrice, false);

                    if (e.Complete && b2 >= 0)
                    {
                        var x2 = ChartInfo.GetXByBar(b2, false);
                        var y2 = ChartInfo.GetYByPrice(e.ClosePrice, false);
                        if (ExecConnect)
                            g.DrawLine((e.Pos?.Net ?? e.Net) >= 0 ? _execPenWin! : _execPenLoss!, x1, y1, x2, y2); // coloured by the whole position
                        DrawMarker(g, x1, y1, e.Long, e.Qty);
                        DrawMarker(g, x2, y2, !e.Long, e.Qty);
                        Hit(e, x1, y1);
                        Hit(e, x2, y2);
                        if (ExecShowResult && (e.Pos == null || e.Pos.Last == e)) // a scaled position: one total, at its last exit
                            DrawResult(g, e, x2, y2, labels);
                    }
                    else
                    {
                        DrawMarker(g, x1, y1, e.Long, e.Qty);
                        Hit(e, x1, y1);
                    }
                }

                var tags = new List<Rectangle>();
                // a horizontal line with its label chip sitting on top of it (below it when there's no room above)
                void PriceLine(decimal price, Color c, string text, System.Drawing.Drawing2D.DashStyle dash)
                {
                    var y = ChartInfo.GetYByPrice(price, false);
                    if (y < r.Top - 20 || y > r.Bottom + 20) return;
                    g.DrawLine(new RenderPen(c, 1, dash), r.Left, y, r.Right, y);
                    var size = g.MeasureString(text, _small);
                    var h = size.Height + 4;
                    var box = new Rectangle(r.Right - size.Width - 90, y - h, size.Width + 10, h);
                    if (box.Top < r.Top + 2) box.Y = y + 1;
                    for (var k = 0; k < 6 && tags.Any(t => t.IntersectsWith(box)); k++) box.Offset(-(box.Width + 6), 0); // side by side, not on top of each other
                    tags.Add(box);
                    g.FillRectangle(A(Background, 235), box, 3);
                    g.DrawRectangle(new RenderPen(A(c, 200), 1), box, 3);
                    g.DrawString(text, _small, c, box.X + 5, box.Y + 2);
                }

                var plan = PlanOrders(ExecShowOrders ? _orders : new List<Order>());

                if (ExecShowAvg && _avgPrice is decimal avg)
                {
                    var text = $"{(_avgLong ? "LONG" : "SHORT")} {_avgQty:0.##} avg {ChartInfo.GetPriceString(avg)}";
                    if (ExecShowRR && plan.Rr is decimal rr) text += $" · RR {rr:0.0#}";
                    else if (ExecShowRR && plan.RiskFree) text += " · risk-free";
                    PriceLine(avg, _avgLong ? ExecAvgColor : ExecAvgShortColor, text, System.Drawing.Drawing2D.DashStyle.Dash);
                }

                foreach (var line in plan.Lines)
                    PriceLine(line.Price, line.Color, line.Text, System.Drawing.Drawing2D.DashStyle.Dot);
            }
            finally
            {
                g.ResetClip();
                _execHits = hits;
            }
        }

        private enum OrderRole { Entry, ScaleIn, Stop, Target, Exit }

        private sealed class PlanLine
        {
            public Order Order = null!;
            public OrderRole Role;
            public decimal Price, Qty;
            public string Text = "";
            public Color Color;
        }

        private sealed class OrderPlan
        {
            public List<PlanLine> Lines = new();
            public decimal? Rr;     // reward : risk for the whole position (targets weighted by size)
            public bool RiskFree;   // the stop is at or past the average price
        }

        /// <summary>
        /// The working orders, read against the open position: orders on the position's side are scale-ins; on the other
        /// side, stops are the stop loss and limits beyond the average price are the targets (TP1 nearest). R is worked out
        /// from the average price — risk to the stop (size-weighted if the stop is split), reward to each target.
        /// </summary>
        private OrderPlan PlanOrders(List<Order> orders)
        {
            var plan = new OrderPlan();
            var tick = InstrumentInfo?.TickSize ?? 0m;
            foreach (var o in orders)
            {
                var isStop = o.Type == OrderTypes.Stop || o.Type == OrderTypes.StopLimit;
                var at = isStop ? o.TriggerPrice : o.Price;
                if (at <= 0) continue;
                var qty = o.Unfilled > 0 ? o.Unfilled : o.QuantityToFill;
                var buy = o.Direction == OrderDirections.Buy;
                var role = OrderRole.Entry;
                if (ExecOrderRoles && _avgPrice is decimal avg && _avgQty > 0)
                {
                    if (buy == _avgLong) role = OrderRole.ScaleIn;
                    else if (isStop) role = OrderRole.Stop;
                    else role = (_avgLong ? at > avg : at < avg) ? OrderRole.Target : OrderRole.Exit;
                }
                plan.Lines.Add(new PlanLine { Order = o, Role = role, Price = at, Qty = qty });
            }

            var hasPos = _avgPrice.HasValue && _avgQty > 0;
            var a = _avgPrice ?? 0m;
            var dir = _avgLong ? 1m : -1m;
            // the stop as one price: size-weighted if it's split across several orders
            var stops = plan.Lines.Where(l => l.Role == OrderRole.Stop).ToList();
            decimal? stopAt = stops.Count > 0 && stops.Sum(l => l.Qty) > 0 ? stops.Sum(l => l.Price * l.Qty) / stops.Sum(l => l.Qty) : null;
            var risk = stopAt is decimal sp ? (a - sp) * dir : 0m; // points lost per contract if stopped (≤ 0 = locked in)
            plan.RiskFree = hasPos && stopAt.HasValue && risk <= 0;
            var targets = plan.Lines.Where(l => l.Role == OrderRole.Target).OrderBy(l => Math.Abs(l.Price - a)).ToList();
            if (hasPos && risk > 0 && targets.Count > 0 && targets.Sum(l => l.Qty) > 0)
                plan.Rr = targets.Sum(l => (l.Price - a) * dir * l.Qty) / targets.Sum(l => l.Qty) / risk;

            string Move(decimal pts, decimal qty)
            {
                var sign = pts >= 0 ? "+" : "−";
                var dist = ExecResultUnit == ExecResult.Ticks && tick > 0 ? $"{sign}{Math.Abs(pts / tick):0.#}t" : $"{sign}{Math.Abs(pts):0.##} pts";
                if (ExecShowMoney && _tickCost > 0 && tick > 0) dist += $" · {sign}${Math.Abs(pts / tick * _tickCost * qty):N0}";
                return dist;
            }

            var tpNo = 0;
            foreach (var l in targets) l.Text = $"TP{(targets.Count > 1 ? (++tpNo).ToString() : "")} {l.Qty:0.##} @ {ChartInfo.GetPriceString(l.Price)} · {Move((l.Price - a) * dir, l.Qty)}"
                + (ExecShowRR && risk > 0 ? $" · RR {(l.Price - a) * dir / risk:0.0#}" : "");
            foreach (var l in stops)
            {
                var pts = (l.Price - a) * dir;
                l.Text = $"SL {l.Qty:0.##} @ {ChartInfo.GetPriceString(l.Price)} · " + (pts == 0 ? "break-even" : Move(pts, l.Qty) + (pts > 0 ? " locked" : ""));
            }
            var adds = plan.Lines.Where(l => l.Role == OrderRole.ScaleIn).OrderBy(l => Math.Abs(l.Price - a)).ToList();
            var addNo = 0;
            foreach (var l in adds)
            {
                var newAvg = (a * _avgQty + l.Price * l.Qty) / (_avgQty + l.Qty);
                if (tick > 0) newAvg = Math.Round(newAvg / tick) * tick;
                l.Text = $"ADD{(adds.Count > 1 ? (++addNo).ToString() : "")} {l.Qty:0.##} @ {ChartInfo.GetPriceString(l.Price)} · avg → {ChartInfo.GetPriceString(newAvg)}";
            }
            foreach (var l in plan.Lines)
            {
                var buy = l.Order.Direction == OrderDirections.Buy;
                var kind = l.Order.Type == OrderTypes.Limit ? "LMT" : l.Order.Type == OrderTypes.Stop ? "STP" : l.Order.Type == OrderTypes.StopLimit ? "STP LMT" : "";
                if (l.Role == OrderRole.Entry) l.Text = $"{(buy ? "BUY" : "SELL")} {kind} {l.Qty:0.##} @ {ChartInfo.GetPriceString(l.Price)}";
                if (l.Role == OrderRole.Exit) l.Text = $"EXIT {kind} {l.Qty:0.##} @ {ChartInfo.GetPriceString(l.Price)} · {Move((l.Price - a) * dir, l.Qty)}";
                l.Color = l.Role switch
                {
                    OrderRole.Stop => ExecStopColor,
                    OrderRole.Target => ExecTargetColor,
                    OrderRole.ScaleIn => ExecScaleColor,
                    _ => buy ? ExecBuyOrderColor : ExecSellOrderColor,
                };
            }
            return plan;
        }

        /// <summary>A buy points up from below its price, a sell points down from above it; the tip sits on the price.</summary>
        private void DrawMarker(RenderContext g, int x, int y, bool buy, decimal qty)
        {
            var c = buy ? ExecBuyColor : ExecSellColor;
            var s = ExecSize;
            var h = Math.Max(3, (int)Math.Round(s * 0.9));
            var half = Math.Max(2, s / 2);
            var outline = ExecOutline ? new RenderPen(Color.FromArgb(220, 0, 0, 0), 1) : null;
            int labelY;
            switch (ExecMarker)
            {
                case ExecMarkerStyle.Circles:
                {
                    var rect = new Rectangle(x - half, y - half, half * 2, half * 2);
                    g.FillEllipse(c, rect);
                    if (outline != null) g.DrawEllipse(outline, rect);
                    labelY = buy ? y + half + 1 : y - half - 1;
                    break;
                }
                case ExecMarkerStyle.Arrows:
                {
                    var d = buy ? 1 : -1; // buy: head at the price, stem below
                    var head = new[] { new Point(x, y), new Point(x - half, y + d * h), new Point(x + half, y + d * h) };
                    var stemW = Math.Max(2, half / 2);
                    var stem = new Rectangle(x - stemW / 2, buy ? y + h : y - h - h, stemW, h);
                    g.FillRectangle(c, stem);
                    g.FillPolygon(c, head);
                    if (outline != null) g.DrawPolygon(outline, head);
                    labelY = buy ? y + h * 2 + 1 : y - h * 2 - 1;
                    break;
                }
                default:
                {
                    var d = buy ? 1 : -1;
                    var pts = new[] { new Point(x, y), new Point(x - half, y + d * h), new Point(x + half, y + d * h) };
                    g.FillPolygon(c, pts);
                    if (outline != null) g.DrawPolygon(outline, pts);
                    labelY = buy ? y + h + 1 : y - h - 1;
                    break;
                }
            }
            if (ExecShowQty && qty > 0)
            {
                var text = qty.ToString("0.##");
                var size = g.MeasureString(text, _small);
                g.DrawString(text, _small, c, x - size.Width / 2, buy ? labelY : labelY - size.Height);
            }
        }

        private void DrawResult(RenderContext g, Exec e, int x, int y, List<Rectangle> used)
        {
            var tick = InstrumentInfo?.TickSize ?? 0m;
            // a scaled position: the total net, and the move per contract from its average entry to its average exit
            var p = e.Pos;
            var net = p?.Net ?? e.Net;
            var move = p != null && p.Qty > 0 ? (p.ExitCost - p.EntryCost) / p.Qty * (e.Long ? 1 : -1) : (e.ClosePrice - e.OpenPrice) * (e.Long ? 1 : -1);
            string text = ExecResultUnit switch
            {
                ExecResult.Ticks when tick > 0 => $"{(move / tick >= 0 ? "+" : "")}{move / tick:0.#}t",
                ExecResult.Points => $"{(move >= 0 ? "+" : "")}{move:0.##} pts",
                _ => (net >= 0 ? "+$" : "-$") + Math.Abs(net).ToString("N2"),
            };
            var good = ExecResultUnit == ExecResult.Money ? net >= 0 : move >= 0;
            var c = good ? ExecWinColor : ExecLossColor;
            var size = g.MeasureString(text, _small);
            var w = size.Width + 10;
            var h = size.Height + 4;
            var gap = ExecSize + 4;
            // beside the exit marker, on the side away from the price (above a sell exit, below a buy exit)
            var exitBuy = !e.Long;
            var box = new Rectangle(x + gap / 2, exitBuy ? y + gap : y - gap - h, w, h);
            for (var k = 0; k < 4 && used.Any(u => u.IntersectsWith(box)); k++)
                box.Offset(0, exitBuy ? h + 2 : -(h + 2));
            used.Add(box);
            g.FillRectangle(A(Background, 235), box, 3);
            g.DrawRectangle(new RenderPen(A(c, 200), 1), box, 3);
            g.DrawString(text, _small, Color.FromArgb(255, c.R, c.G, c.B), box.X + 5, box.Y + 2);
        }

        // ======================================================================================================
        // heatmap (resting limit orders from the DOM)
        // ======================================================================================================

        private sealed class HmNode
        {
            public int StartBar, EndBar;
            public decimal Price, Volume;
            public bool IsActive;
        }

        private readonly object _hmLock = new();
        private readonly List<HmNode> _hmNodes = new();
        private readonly Dictionary<decimal, HmNode> _hmActive = new();
        private Color[] _hmRamp = Array.Empty<Color>();
        private string _hmRampKey = "";
        private DateTime _hmLastRedraw = DateTime.MinValue;
        private bool _hmEnabled = true;
        private bool _hmInited;
        private Rectangle _hmButton = Rectangle.Empty;
        private readonly RenderFont _hmFont = new("Arial", 8, FontStyle.Bold);

        /// <summary>Starts the heatmap from the order book as it is right now.</summary>
        private void HeatmapInit()
        {
            lock (_hmLock)
            {
                _hmNodes.Clear();
                _hmActive.Clear();
                _hmInited = ShowHeatmap;
                if (!ShowHeatmap) return;
                var bar = Math.Max(0, CurrentBar - 1);
                try
                {
                    var snapshot = GetMarketDepthSnapshot();
                    if (snapshot != null)
                        foreach (var item in snapshot)
                            if (item != null && item.Volume >= HmThreshold)
                                HmStart(item.Price, item.Volume, bar);
                }
                catch
                {
                    // no depth yet
                }
            }
        }

        /// <summary>Called every second: starts the heatmap when it's switched on, lets it go when it's switched off.</summary>
        private bool _hmStartApplied;

        private void HeatmapTick()
        {
            if (!_hmStartApplied) { _hmStartApplied = true; if (HmStartOff) _hmEnabled = false; }
            if (ShowHeatmap && !_hmInited) HeatmapInit();
            else if (!ShowHeatmap && _hmInited) HeatmapInit();
        }

        protected override void MarketDepthChanged(MarketDataArg depth)
        {
            if (ShowHeatmap && _hmInited)
            {
                if (depth != null) HmDepth(depth);
                HmLiveUpdate();
            }
            base.MarketDepthChanged(depth);
        }

        protected override void MarketDepthsChanged(IEnumerable<MarketDataArg> depths)
        {
            if (ShowHeatmap && _hmInited)
            {
                if (depths != null)
                    foreach (var depth in depths)
                        if (depth != null) HmDepth(depth);
                HmLiveUpdate();
            }
            base.MarketDepthsChanged(depths);
        }

        private void HmStart(decimal price, decimal volume, int bar)
        {
            var node = new HmNode { StartBar = bar, EndBar = bar, Price = price, Volume = volume, IsActive = true };
            _hmActive[price] = node;
            _hmNodes.Add(node);
        }

        private void HmDepth(MarketDataArg depth)
        {
            var bar = Math.Max(0, CurrentBar - 1);
            lock (_hmLock)
            {
                if (depth.Volume >= HmThreshold)
                {
                    if (_hmActive.TryGetValue(depth.Price, out var node))
                    {
                        node.EndBar = bar;
                        // a big change in size starts a new segment, so the history shows the level growing or thinning
                        var change = node.Volume > 0 ? Math.Abs(depth.Volume - node.Volume) / node.Volume * 100m : 100m;
                        if (change >= HmReshade && bar > node.StartBar)
                        {
                            node.IsActive = false;
                            HmStart(depth.Price, depth.Volume, bar);
                        }
                        else
                        {
                            node.Volume = depth.Volume;
                        }
                    }
                    else
                    {
                        HmStart(depth.Price, depth.Volume, bar);
                    }
                }
                else if (_hmActive.TryGetValue(depth.Price, out var node))
                {
                    node.EndBar = bar;
                    node.IsActive = false;
                    _hmActive.Remove(depth.Price);
                }
            }
        }

        private void HmLiveUpdate()
        {
            if (!_hmEnabled) return;
            if ((DateTime.UtcNow - _hmLastRedraw).TotalMilliseconds > 50)
            {
                _hmLastRedraw = DateTime.UtcNow;
                RedrawChart();
            }
        }

        private static Color HmLerp(Color a, Color b, double t) => Color.FromArgb(255,
            (int)Math.Round(a.R + (b.R - a.R) * t), (int)Math.Round(a.G + (b.G - a.G) * t), (int)Math.Round(a.B + (b.B - a.B) * t));

        private static Color HmAlpha(Color c, int a) => Color.FromArgb(Math.Clamp(a, 0, 255), c.R, c.G, c.B);

        private static Color HmMix(Color a, Color b, double t) => Color.FromArgb(a.A, (int)(a.R + (b.R - a.R) * t), (int)(a.G + (b.G - a.G) * t), (int)(a.B + (b.B - a.B) * t));

        private Color[] HmStops() => HmPaletteChoice switch
        {
            // the classic order-book heatmap: deep blue, cyan, green, yellow, orange, red, white-hot
            HmPalette.Bookmap => new[] { Color.FromArgb(10, 20, 70), Color.FromArgb(0, 90, 200), Color.FromArgb(0, 190, 230), Color.FromArgb(40, 210, 110), Color.FromArgb(240, 230, 40), Color.FromArgb(255, 140, 0), Color.FromArgb(235, 30, 30), Color.FromArgb(255, 245, 230) },
            HmPalette.Thermal => new[] { Color.FromArgb(20, 0, 40), Color.FromArgb(90, 10, 120), Color.FromArgb(180, 20, 110), Color.FromArgb(240, 70, 40), Color.FromArgb(255, 160, 20), Color.FromArgb(255, 230, 90), Color.FromArgb(255, 255, 235) },
            HmPalette.Ocean => new[] { Color.FromArgb(5, 15, 40), Color.FromArgb(10, 60, 120), Color.FromArgb(0, 130, 190), Color.FromArgb(40, 200, 220), Color.FromArgb(170, 240, 245), Color.FromArgb(255, 255, 255) },
            HmPalette.Mono => new[] { Color.FromArgb(25, 25, 30), Color.FromArgb(90, 90, 100), Color.FromArgb(170, 170, 180), Color.FromArgb(255, 255, 255) },
            _ => new[] { HmColor1, HmColor2, HmColor3, HmColor4, HmColor5 },
        };

        private void HmBuildRamp()
        {
            var stops = HmStops();
            var key = HmPaletteChoice + "|" + string.Join(",", stops.Select(c => c.ToArgb()));
            if (key == _hmRampKey && _hmRamp.Length == 256) return;
            _hmRampKey = key;
            var ramp = new Color[256];
            for (var i = 0; i < 256; i++)
            {
                var pos = i / 255.0 * (stops.Length - 1);
                var k = Math.Min(stops.Length - 2, (int)Math.Floor(pos));
                ramp[i] = HmLerp(stops[k], stops[k + 1], pos - k);
            }
            _hmRamp = ramp;
        }

        /// <summary>A band that is solid in the middle and fades to nothing at its top and bottom.</summary>
        private static void SoftBand(RenderContext g, Color c, int x, int yMid, int w, int half)
        {
            if (half <= 0 || w <= 0) return;
            g.FillRectangle(HmAlpha(c, 0), c, new Rectangle(x, yMid - half, w, half), true);
            g.FillRectangle(c, HmAlpha(c, 0), new Rectangle(x, yMid, w, half), true);
        }

        private void DrawHeatmap(RenderContext g, Rectangle region)
        {
            if (!_hmEnabled || !_hmInited) return;
            HmBuildRamp();
            var ramp = _hmRamp;
            var current = Math.Max(0, CurrentBar - 1);
            var barW = (int)Math.Max(1, ChartInfo.PriceChartContainer.BarsWidth + ChartInfo.PriceChartContainer.BarSpacing);
            var visible = new List<(HmNode Node, int X1, int X2, int Y, decimal Volume)>();
            List<decimal> recent;

            lock (_hmLock)
            {
                if (_hmNodes.Count == 0)
                {
                    const string wait = "HEATMAP: WAITING FOR DOM / NO LEVEL 2 DATA";
                    var size = g.MeasureString(wait, _hmFont);
                    g.DrawString(wait, _hmFont, Color.FromArgb(150, 150, 150), region.Left + (region.Width - size.Width) / 2, region.Top + (region.Height - size.Height) / 2);
                    return;
                }
                if (_hmNodes.Count > 6000)
                    _hmNodes.RemoveAll(n => !n.IsActive && n.EndBar < current - 2000);

                // the scale comes from a long stretch of history, not just what's on screen, so colours don't jump as you scroll
                recent = _hmNodes.Skip(Math.Max(0, _hmNodes.Count - 3000)).Select(n => n.Volume).ToList();

                foreach (var n in _hmNodes)
                {
                    var x1 = ChartInfo.GetXByBar(n.StartBar, true);
                    var x2 = n.IsActive && HmExtendLive ? region.Right : ChartInfo.GetXByBar(n.EndBar, true) + barW;
                    if (x2 < region.Left || x1 > region.Right) continue;
                    var y = ChartInfo.GetYByPrice(n.Price, false);
                    if (y < region.Top - 60 || y > region.Bottom + 60) continue;
                    visible.Add((n, x1, Math.Max(x2, x1 + 2), y, n.Volume));
                }
            }

            if (HmTint)
                g.FillRectangle(HmTintColor, region);
            if (visible.Count == 0 || recent.Count == 0) return;

            double Tx(decimal v) => HmScale == HmScaling.Logarithmic ? Math.Log10(1 + (double)Math.Max(0, v)) : (double)Math.Max(0, v);
            recent.Sort();
            var top = HmBrightAt > 0 ? HmBrightAt : recent[Math.Clamp((int)Math.Round((recent.Count - 1) * HmPercentile / 100.0), 0, recent.Count - 1)];
            var lo = Tx(HmThreshold);
            var hi = Math.Max(Tx(top), lo + 1e-9);
            if (HmBrightAt <= 0 && hi - lo < 0.3) hi = lo + 0.3; // all levels about the same size: keep them cool, not all hot
            double Heat(decimal v) => Math.Pow(Math.Clamp((Tx(v) - lo) / (hi - lo), 0, 1), HmContrast);

            // one price row (one tick) in pixels
            var tick = InstrumentInfo?.TickSize ?? 0.25m;
            var p0 = visible[0].Node.Price;
            var rowH = HmRowHeight > 0 ? HmRowHeight : Math.Max(1, Math.Abs(ChartInfo.GetYByPrice(p0, false) - ChartInfo.GetYByPrice(p0 + tick, false)));
            var opacity = HmOpacity / 100.0;

            g.SetClip(region);
            try
            {
                // thin first, heavy last: the strongest levels always sit on top
                foreach (var (node, x1, x2, y, vol) in visible.OrderBy(v => v.Volume))
                {
                    var t = Heat(vol);
                    var c = ramp[(int)Math.Round(t * 255)];
                    var strength = HmFadeThin ? 0.10 + 0.90 * Math.Pow(t, 1.35) : 0.85;
                    var a = (int)Math.Round(255 * strength * opacity);
                    var w = x2 - x1;

                    // 1) a wide soft halo, fading to nothing above and below
                    var halo = rowH + (HmGlow > 0 ? HmGlow : Math.Max(3, rowH)) * (0.6 + 0.8 * t);
                    SoftBand(g, HmAlpha(c, (int)(a * 0.55)), x1, y, w, (int)Math.Round(halo));

                    // 2) the row itself, softer at its edges
                    SoftBand(g, HmAlpha(c, a), x1, y, w, Math.Max(1, (int)Math.Round(rowH * 0.75)));

                    // 3) a hot core: heavy levels burn toward white in the middle
                    if (t > 0.35)
                    {
                        var core = HmMix(HmAlpha(c, Math.Min(255, a + 30)), Color.FromArgb(255, 255, 255), Math.Clamp((t - 0.35) * 0.9, 0, 0.6));
                        var coreH = Math.Max(1, (int)Math.Round(rowH * (0.25 + 0.25 * t)));
                        g.FillRectangle(core, new Rectangle(x1, y - coreH / 2, w, Math.Max(1, coreH)));
                    }

                    // 4) live levels fade out toward the right edge
                    if (node.IsActive && HmExtendLive && HmTailFade > 0 && w > HmTailFade)
                    {
                        var fadeRect = new Rectangle(x2 - HmTailFade, y - (int)halo, HmTailFade, (int)halo * 2);
                        var bg = HmTint ? HmTintColor : HmFadeColor;
                        g.FillRectangle(HmAlpha(bg, 0), HmAlpha(bg, 170), fadeRect, false);
                    }
                }

                // size tags on the biggest live levels (no two on top of each other)
                if (HmTags)
                {
                    var used = new List<Rectangle>();
                    foreach (var (node, _, _, y, vol) in visible.Where(v => v.Node.IsActive).OrderByDescending(v => v.Volume).Take(HmTagCount * 2))
                    {
                        if (used.Count >= HmTagCount) break;
                        var c = ramp[(int)Math.Round(Heat(vol) * 255)];
                        var text = vol.ToString("N0");
                        var size = g.MeasureString(text, _hmFont);
                        var rect = new Rectangle(region.Right - size.Width - 18, y - size.Height / 2 - 2, size.Width + 10, size.Height + 4);
                        if (used.Any(u => u.IntersectsWith(rect))) continue;
                        used.Add(rect);
                        g.FillRectangle(Color.FromArgb(215, 8, 8, 10), rect, 3);
                        g.DrawRectangle(new RenderPen(HmAlpha(c, 230), 1), rect, 3);
                        g.FillRectangle(c, new Rectangle(rect.X, rect.Y + 2, 2, rect.Height - 4));
                        g.DrawString(text, _hmFont, HmTagText, rect.X + 6, rect.Y + 2);
                    }
                }
            }
            finally
            {
                g.ResetClip();
            }
        }

        /// <summary>The heatmap's on/off switch on the chart (always drawn on top).</summary>
        private void DrawHeatmapButton(RenderContext g)
        {
            var on = _hmEnabled;
            var text = on ? "HEATMAP ON" : "HEATMAP OFF";
            var size = g.MeasureString("HEATMAP OFF", _hmFont); // sized for the longer label, so it doesn't jump
            const int swatchW = 22, padX = 12, gap = 9;
            var w = padX + swatchW + gap + size.Width + padX + 2;
            var h = Math.Max(26, size.Height + 14);
            var p = Place(HmButtonPlacement, w, h, HmButtonX, HmButtonY);
            _hmButton = new Rectangle(p.X, p.Y, w, h);

            var accent = on ? PositiveColor : NegativeColor;
            g.FillRectangle(A(Background, 240), _hmButton, Math.Max(2, Radius));
            g.DrawRectangle(new RenderPen(HmAlpha(accent, 150), 1), _hmButton, Math.Max(2, Radius));

            HmBuildRamp();
            var ramp = _hmRamp;
            var sw = new Rectangle(p.X + padX, p.Y + h / 2 - 3, swatchW, 6);
            for (var i = 0; i < sw.Width; i++)
            {
                var c = on ? ramp[i * 255 / (sw.Width - 1)] : Color.FromArgb(70, 70, 75);
                g.FillRectangle(c, new Rectangle(sw.X + i, sw.Y, 1, sw.Height));
            }
            var ts = g.MeasureString(text, _hmFont);
            g.DrawString(text, _hmFont, on ? TextColor : MutedColor, sw.Right + gap, p.Y + (h - ts.Height) / 2);
        }
    }
}
