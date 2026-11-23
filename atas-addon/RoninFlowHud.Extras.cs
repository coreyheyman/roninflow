// RoninFlow Suite — the chart parts that live on the price itself, each with its own tab in the settings:
//   * Executions: your trades on the chart — entry and exit markers, the line joining them (win or loss colour), the
//     trade's result at the exit and the open position's average price.
//   * Heatmap: resting limit orders from the DOM drawn like an order-book heatmap, behind or over the candles, with
//     an on/off button on the chart.
//   * Candles: restyled candles drawn pixel-for-pixel over the native ones, with an optional body mask.

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Drawing;
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
        public enum CandleBody { Filled, Hollow, HollowBullsOnly }

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

        [Display(Name = "Average price line", GroupName = "Open position", Order = 341)]
        [Tab(TabName = "Executions", TabOrder = 3)]
        public Color ExecAvgColor { get; set; } = Color.FromArgb(255, 232, 176, 67);

        #endregion

        #region Settings — heatmap

        [Display(Name = "Show the DOM heatmap", GroupName = "Heatmap", Order = 600)]
        [Tab(TabName = "Heatmap", TabOrder = 6)]
        public bool ShowHeatmap { get; set; } = false;

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

        #region Settings — candles

        [Display(Name = "Restyle the candles", GroupName = "Candles", Order = 700)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public bool ShowCandles { get; set; } = false;

        [Display(Name = "Bullish body", GroupName = "Bullish", Order = 710)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcBullBody { get; set; } = Color.FromArgb(255, 38, 166, 154);

        [Display(Name = "Bullish border", GroupName = "Bullish", Order = 711)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcBullBorder { get; set; } = Color.FromArgb(255, 38, 166, 154);

        [Display(Name = "Bullish wick", GroupName = "Bullish", Order = 712)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcBullWick { get; set; } = Color.FromArgb(255, 38, 166, 154);

        [Display(Name = "Bearish body", GroupName = "Bearish", Order = 720)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcBearBody { get; set; } = Color.FromArgb(255, 156, 77, 204);

        [Display(Name = "Bearish border", GroupName = "Bearish", Order = 721)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcBearBorder { get; set; } = Color.FromArgb(255, 156, 77, 204);

        [Display(Name = "Bearish wick", GroupName = "Bearish", Order = 722)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcBearWick { get; set; } = Color.FromArgb(255, 156, 77, 204);

        [Display(Name = "Doji (open = close)", GroupName = "Bearish", Order = 723)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcDoji { get; set; } = Color.FromArgb(255, 139, 139, 143);

        private double _ccOpacity = 1.0;
        [Display(Name = "Body opacity (0–1)", GroupName = "Shape", Order = 730)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        [Range(0.0, 1.0)]
        public double CcOpacity { get => _ccOpacity; set => _ccOpacity = Math.Clamp(value, 0.0, 1.0); }

        [Display(Name = "Body style", GroupName = "Shape", Order = 731)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public CandleBody CcStyle { get; set; } = CandleBody.Filled;

        [Display(Name = "Draw borders", GroupName = "Shape", Order = 732)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public bool CcBorders { get; set; } = true;

        [Display(Name = "Border thickness", GroupName = "Shape", Order = 733)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        [Range(1, 5)]
        public int CcBorderWidth { get; set; } = 1;

        [Display(Name = "Wick thickness", GroupName = "Shape", Order = 734)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        [Range(1, 5)]
        public int CcWickWidth { get; set; } = 1;

        [Display(Name = "Body inset each side (px, 0 = same as native)", GroupName = "Shape", Order = 735)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        [Range(0, 20)]
        public int CcInset { get; set; } = 0;

        [Display(Name = "X nudge (px)", GroupName = "Shape", Order = 736)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        [Range(-20, 20)]
        public int CcOffsetX { get; set; } = 0;

        [Display(Name = "Hide the native candle body underneath", GroupName = "Native candles", Order = 740)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public bool CcMask { get; set; } = true;

        [Display(Name = "Chart background colour (for hiding them)", GroupName = "Native candles", Order = 741)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcMaskColor { get; set; } = Color.FromArgb(255, 10, 10, 10);

        [Display(Name = "Show live price line", GroupName = "Live price line", Order = 750)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public bool CcPriceLine { get; set; } = false;

        [Display(Name = "Line thickness", GroupName = "Live price line", Order = 751)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        [Range(1, 10)]
        public int CcPriceLineWidth { get; set; } = 1;

        [Display(Name = "Line opacity (%)", GroupName = "Live price line", Order = 752)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        [Range(10, 100)]
        public int CcPriceLineOpacity { get; set; } = 70;

        [Display(Name = "Start the line at the live candle (not the left edge)", GroupName = "Live price line", Order = 753)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public bool CcLineFromCandle { get; set; } = false;

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
        }

        private volatile List<Exec> _execs = new();
        private decimal? _avgPrice;
        private bool _avgLong;
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
                };
                if (all) seen[key] = row;
                rows.Add(row);
            }
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
                if (pos != null) { avg = pos.AveragePrice; lng = pos.Volume > 0; }
            }
            catch { }
            if (avg == null)
            {
                var open = rows.LastOrDefault(r => !r.Complete);
                if (open != null) { avg = open.OpenPrice; lng = open.Long; }
            }
            _avgPrice = avg;
            _avgLong = lng;
        }

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
                            g.DrawLine(e.Net >= 0 ? _execPenWin! : _execPenLoss!, x1, y1, x2, y2);
                        DrawMarker(g, x1, y1, e.Long, e.Qty);
                        DrawMarker(g, x2, y2, !e.Long, e.Qty);
                        if (ExecShowResult)
                            DrawResult(g, e, x2, y2, labels);
                    }
                    else
                    {
                        DrawMarker(g, x1, y1, e.Long, e.Qty);
                    }
                }

                if (ExecShowAvg && _avgPrice is decimal avg)
                {
                    var y = ChartInfo.GetYByPrice(avg, false);
                    var pen = new RenderPen(ExecAvgColor, 1, System.Drawing.Drawing2D.DashStyle.Dash);
                    g.DrawLine(pen, r.Left, y, r.Right, y);
                    var text = $"{(_avgLong ? "LONG" : "SHORT")} avg {ChartInfo.GetPriceString(avg)}";
                    var size = g.MeasureString(text, _small);
                    var box = new Rectangle(r.Right - size.Width - 90, y - size.Height / 2 - 2, size.Width + 10, size.Height + 4);
                    g.FillRectangle(A(Background, 235), box, 3);
                    g.DrawRectangle(new RenderPen(A(ExecAvgColor, 200), 1), box, 3);
                    g.DrawString(text, _small, ExecAvgColor, box.X + 5, box.Y + 2);
                }
            }
            finally
            {
                g.ResetClip();
            }
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
            var move = (e.ClosePrice - e.OpenPrice) * (e.Long ? 1 : -1);
            string text = ExecResultUnit switch
            {
                ExecResult.Ticks when tick > 0 => $"{(move / tick >= 0 ? "+" : "")}{move / tick:0.#}t",
                ExecResult.Points => $"{(move >= 0 ? "+" : "")}{move:0.##} pts",
                _ => (e.Net >= 0 ? "+$" : "-$") + Math.Abs(e.Net).ToString("N2"),
            };
            var good = ExecResultUnit == ExecResult.Money ? e.Net >= 0 : move >= 0;
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
        private void HeatmapTick()
        {
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

        // ======================================================================================================
        // candles (drawn on exactly the pixels ATAS uses for its own candles)
        // ======================================================================================================

        private RenderPen? _ccBullBorder, _ccBearBorder, _ccDojiPen, _ccBullWick, _ccBearWick;
        private string _ccPenKey = "";

        private void CandlePens()
        {
            var key = $"{CcBullBorder.ToArgb()}|{CcBearBorder.ToArgb()}|{CcDoji.ToArgb()}|{CcBullWick.ToArgb()}|{CcBearWick.ToArgb()}|{CcBorderWidth}|{CcWickWidth}";
            if (key == _ccPenKey) return;
            _ccPenKey = key;
            _ccBullBorder = new RenderPen(CcBullBorder, CcBorderWidth);
            _ccBearBorder = new RenderPen(CcBearBorder, CcBorderWidth);
            _ccDojiPen = new RenderPen(CcDoji, Math.Max(CcBorderWidth, CcWickWidth));
            _ccBullWick = new RenderPen(CcBullWick, CcWickWidth);
            _ccBearWick = new RenderPen(CcBearWick, CcWickWidth);
        }

        private static Color WithOpacity(Color c, double opacity) => Color.FromArgb((int)Math.Round(Math.Clamp(opacity, 0, 1) * c.A), c.R, c.G, c.B);

        private void DrawCandles(RenderContext g)
        {
            if (CurrentBar <= 0) return;
            CandlePens();
            var region = Container.Region;
            var barWidthExact = ChartInfo.PriceChartContainer.BarsWidth;
            var first = Math.Max(0, FirstVisibleBarNumber);
            var last = Math.Min(CurrentBar - 1, LastVisibleBarNumber);

            g.SetClip(region);
            try
            {
                for (var i = first; i <= last; i++)
                {
                    var candle = GetCandle(i);
                    if (candle == null) continue;

                    var bull = candle.Close > candle.Open;
                    var doji = candle.Close == candle.Open;

                    var left = ChartInfo.GetXByBar(i, true) + CcOffsetX;
                    var width = Math.Max(1, (int)Math.Round(barWidthExact));
                    if (width > 2 && width % 2 == 0) width--; // an odd width has a true middle pixel for the wick
                    var center = left + width / 2;

                    var high = ChartInfo.GetYByPrice(candle.High, false);
                    var low = ChartInfo.GetYByPrice(candle.Low, false);
                    var openY = ChartInfo.GetYByPrice(candle.Open, false);
                    var closeY = ChartInfo.GetYByPrice(candle.Close, false);
                    var top = Math.Min(openY, closeY);
                    var bottom = Math.Max(openY, closeY);

                    if (CcMask && !doji)
                        g.FillRectangle(CcMaskColor, new Rectangle(left + CcInset, top, Math.Max(1, width - CcInset * 2), Math.Max(1, bottom - top)));

                    var wick = doji ? _ccDojiPen! : bull ? _ccBullWick! : _ccBearWick!;
                    var border = doji ? _ccDojiPen! : bull ? _ccBullBorder! : _ccBearBorder!;

                    if (width <= 2)
                    {
                        g.DrawLine(wick, center, high, center, Math.Max(low, high + 1));
                        continue;
                    }

                    var bodyLeft = left + CcInset;
                    var bodyWidth = Math.Max(1, width - CcInset * 2);
                    var bodyHeight = Math.Max(1, bottom - top);

                    if (high < top) g.DrawLine(wick, center, high, center, top);
                    if (low > bottom) g.DrawLine(wick, center, bottom, center, low);

                    if (doji)
                    {
                        g.DrawLine(_ccDojiPen!, bodyLeft, top, bodyLeft + bodyWidth - 1, top);
                        continue;
                    }

                    var hollow = CcStyle == CandleBody.Hollow || (CcStyle == CandleBody.HollowBullsOnly && bull);
                    if (!hollow)
                        g.FillRectangle(WithOpacity(bull ? CcBullBody : CcBearBody, CcOpacity), new Rectangle(bodyLeft, top, bodyWidth, bodyHeight));
                    if (CcBorders || hollow)
                        g.DrawRectangle(border, new Rectangle(bodyLeft, top, Math.Max(1, bodyWidth - 1), Math.Max(1, bodyHeight - 1)));
                }

                if (CcPriceLine)
                {
                    var live = GetCandle(CurrentBar - 1);
                    if (live != null)
                    {
                        var c = live.Close > live.Open ? CcBullBorder : live.Close < live.Open ? CcBearBorder : CcDoji;
                        var y = ChartInfo.GetYByPrice(live.Close, false);
                        var x1 = CcLineFromCandle ? ChartInfo.GetXByBar(CurrentBar - 1, true) + (int)Math.Round(barWidthExact) + 2 : region.Left;
                        g.DrawLine(new RenderPen(WithOpacity(c, CcPriceLineOpacity / 100.0), CcPriceLineWidth, System.Drawing.Drawing2D.DashStyle.Dash), x1, y, region.Right, y);
                    }
                }
            }
            finally
            {
                g.ResetClip();
            }
        }
    }
}
