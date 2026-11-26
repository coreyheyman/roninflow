// RoninFlow Suite — custom candles, drawn over the native ones on exactly the pixels ATAS uses.
//
//   * A template sets the whole look in one pick (Classic, Diagonal stripes, Neon glow, Arrow bodies, 3D …).
//   * Up and down candles each have their own fill and outline, which override the template when set
//     ("From template" keeps the template's choice). Shape, wicks, markers and pattern highlights override it too.
//   * Wicks never cross a body: they run from the high to the body's top edge and from its bottom edge to the low.
//   * Backfill: the native candle under each one is painted over with the chart background first, so hollow bodies
//     and non-square shapes (pills, arrows, gems, 3D) never show the native rectangle behind them.
//   * Every size — pattern spacing, glow, 3D depth, corner and cap lengths, arrows and dots — is worked out from the
//     candle's width and height on screen, so the styles follow the zoom. When a candle gets too small for a detail,
//     it steps down: patterns become solid, special shapes become rectangles, and very thin bars become a single line.

using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Drawing;

using ATAS.Indicators;

using OFT.Attributes;
using OFT.Rendering.Context;
using OFT.Rendering.Tools;

namespace TradeJournal
{
    public partial class RoninFlowHud
    {
        public enum CandleTemplate
        {
            [Display(Name = "Classic")] Classic,
            [Display(Name = "Hollow up / filled down")] HollowUp,
            [Display(Name = "Diagonal stripes")] Stripes,
            [Display(Name = "Shapes inside")] ShapesInside,
            [Display(Name = "Gradient body")] Gradient,
            [Display(Name = "Neon glow")] Neon,
            [Display(Name = "Volume-weighted fill")] VolumeFill,
            [Display(Name = "Buy / sell split")] BuySellSplit,
            [Display(Name = "Dot pattern")] Dots,
            [Display(Name = "Rounded pills")] Pills,
            [Display(Name = "Open / close ticks")] CloseTicks,
            [Display(Name = "Pattern highlights")] PatternHighlights,
            [Display(Name = "Arrow bodies")] Arrows,
            [Display(Name = "Hex / gem")] Gem,
            [Display(Name = "Corner brackets")] CornerBrackets,
            [Display(Name = "Double border")] DoubleBorder,
            [Display(Name = "Scanlines")] Scanlines,
            [Display(Name = "Chevron fill")] Chevrons,
            [Display(Name = "Capped wicks")] CappedWicks,
            [Display(Name = "Range ghost")] RangeGhost,
            [Display(Name = "Close-in-range fill")] CloseInRange,
            [Display(Name = "POC marker")] PocMarker,
            [Display(Name = "Momentum heat")] MomentumHeat,
            [Display(Name = "3D extruded")] Extruded,
        }

        public enum CandleShape
        {
            [Display(Name = "From template")] FromTemplate,
            [Display(Name = "Rectangle")] Rectangle,
            [Display(Name = "Rounded corners")] Rounded,
            [Display(Name = "Pill")] Pill,
            [Display(Name = "Arrow (points the way price went)")] Arrow,
            [Display(Name = "Hex / gem")] Gem,
            [Display(Name = "3D extruded")] Extruded,
        }

        public enum CandleFill
        {
            [Display(Name = "From template")] FromTemplate,
            [Display(Name = "Solid")] Solid,
            [Display(Name = "Hollow")] Hollow,
            [Display(Name = "Light tint")] Tint,
            [Display(Name = "Diagonal stripes")] Stripes,
            [Display(Name = "Dots")] Dots,
            [Display(Name = "Scanlines")] Scanlines,
            [Display(Name = "Chevrons")] Chevrons,
            [Display(Name = "Gradient (close → open)")] Gradient,
            [Display(Name = "Arrow inside")] ArrowInside,
            [Display(Name = "Volume-weighted")] Volume,
            [Display(Name = "Buy / sell split")] BuySell,
            [Display(Name = "Close-in-range")] CloseInRange,
            [Display(Name = "Momentum heat")] Momentum,
        }

        public enum CandleOutline
        {
            [Display(Name = "From template")] FromTemplate,
            [Display(Name = "None")] None,
            [Display(Name = "Full")] Full,
            [Display(Name = "Corner brackets")] Corners,
            [Display(Name = "Double")] Double,
            [Display(Name = "Neon glow")] Glow,
        }

        public enum CandleWick
        {
            [Display(Name = "From template")] FromTemplate,
            [Display(Name = "Line")] Line,
            [Display(Name = "Capped (T at the high and low)")] Capped,
            [Display(Name = "Range ghost (faint column, no line)")] RangeGhost,
            [Display(Name = "Hidden")] Hidden,
        }

        public enum CandleMarker
        {
            [Display(Name = "From template")] FromTemplate,
            [Display(Name = "None")] None,
            [Display(Name = "Close tick")] CloseTick,
            [Display(Name = "POC dot (most-traded price)")] PocDot,
        }

        public enum CandleToggle
        {
            [Display(Name = "From template")] FromTemplate,
            [Display(Name = "On")] On,
            [Display(Name = "Off")] Off,
        }

        public enum CandleTagColor
        {
            [Display(Name = "Candle body colour")] Body,
            [Display(Name = "Candle border colour")] Border,
            [Display(Name = "Custom")] Custom,
        }

        #region Settings — candles

        [Display(Name = "Restyle the candles", GroupName = "Candles", Order = 700)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public bool ShowCandles { get; set; } = false;

        [Display(Name = "Template (the whole look in one pick)", GroupName = "Candles", Order = 701)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public CandleTemplate CcTemplate { get; set; } = CandleTemplate.Classic;

        [Display(Name = "Up candle style", GroupName = "Up candles", Order = 710)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public CandleFill CcUpFill { get; set; } = CandleFill.FromTemplate;

        [Display(Name = "Up candle outline", GroupName = "Up candles", Order = 711)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public CandleOutline CcUpOutline { get; set; } = CandleOutline.FromTemplate;

        [Display(Name = "Body", GroupName = "Up candles", Order = 712)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcBullBody { get; set; } = Color.FromArgb(255, 38, 166, 154);

        [Display(Name = "Border", GroupName = "Up candles", Order = 713)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcBullBorder { get; set; } = Color.FromArgb(255, 38, 166, 154);

        [Display(Name = "Wick", GroupName = "Up candles", Order = 714)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcBullWick { get; set; } = Color.FromArgb(255, 38, 166, 154);

        [Display(Name = "Pattern (stripes, dots, arrows …)", GroupName = "Up candles", Order = 715)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcBullPattern { get; set; } = Color.FromArgb(255, 38, 166, 154);

        [Display(Name = "Down candle style", GroupName = "Down candles", Order = 720)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public CandleFill CcDownFill { get; set; } = CandleFill.FromTemplate;

        [Display(Name = "Down candle outline", GroupName = "Down candles", Order = 721)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public CandleOutline CcDownOutline { get; set; } = CandleOutline.FromTemplate;

        [Display(Name = "Body", GroupName = "Down candles", Order = 722)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcBearBody { get; set; } = Color.FromArgb(255, 156, 77, 204);

        [Display(Name = "Border", GroupName = "Down candles", Order = 723)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcBearBorder { get; set; } = Color.FromArgb(255, 156, 77, 204);

        [Display(Name = "Wick", GroupName = "Down candles", Order = 724)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcBearWick { get; set; } = Color.FromArgb(255, 156, 77, 204);

        [Display(Name = "Pattern (stripes, dots, arrows …)", GroupName = "Down candles", Order = 725)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcBearPattern { get; set; } = Color.FromArgb(255, 156, 77, 204);

        [Display(Name = "Shape", GroupName = "Shape & wicks", Order = 730)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public CandleShape CcShape { get; set; } = CandleShape.FromTemplate;

        [Display(Name = "Wicks", GroupName = "Shape & wicks", Order = 731)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public CandleWick CcWick { get; set; } = CandleWick.FromTemplate;

        [Display(Name = "Marker", GroupName = "Shape & wicks", Order = 732)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public CandleMarker CcMarker { get; set; } = CandleMarker.FromTemplate;

        [Display(Name = "Pattern highlights (inside bars, engulfing bars)", GroupName = "Shape & wicks", Order = 733)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public CandleToggle CcHighlights { get; set; } = CandleToggle.FromTemplate;

        private double _ccOpacity = 1.0;
        [Display(Name = "Body opacity (0–1)", GroupName = "Shape & wicks", Order = 734)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        [Range(0.0, 1.0)]
        public double CcOpacity { get => _ccOpacity; set => _ccOpacity = Math.Clamp(value, 0.0, 1.0); }

        [Display(Name = "Border thickness", GroupName = "Shape & wicks", Order = 735)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        [Range(1, 5)]
        public int CcBorderWidth { get; set; } = 1;

        [Display(Name = "Wick thickness", GroupName = "Shape & wicks", Order = 736)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        [Range(1, 5)]
        public int CcWickWidth { get; set; } = 1;

        [Display(Name = "Body inset each side (px, 0 = same as native)", GroupName = "Shape & wicks", Order = 737)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        [Range(0, 20)]
        public int CcInset { get; set; } = 0;

        [Display(Name = "X nudge (px)", GroupName = "Shape & wicks", Order = 738)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        [Range(-20, 20)]
        public int CcOffsetX { get; set; } = 0;

        [Display(Name = "Doji (open = close)", GroupName = "Shape & wicks", Order = 739)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcDoji { get; set; } = Color.FromArgb(255, 139, 139, 143);

        [Display(Name = "Middle closes (close-in-range fill)", GroupName = "Extra colours", Order = 742)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcNeutral { get; set; } = Color.FromArgb(255, 214, 165, 67);

        [Display(Name = "Inside bars (pattern highlights)", GroupName = "Extra colours", Order = 743)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcInsideColor { get; set; } = Color.FromArgb(255, 139, 109, 255);

        [Display(Name = "Engulfing outline (pattern highlights)", GroupName = "Extra colours", Order = 744)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcEngulfColor { get; set; } = Color.FromArgb(255, 244, 244, 245);

        [Display(Name = "Other candles while highlighting (opacity %)", GroupName = "Extra colours", Order = 745)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        [Range(10, 100)]
        public int CcHighlightFade { get; set; } = 40;

        [Display(Name = "POC dot", GroupName = "Extra colours", Order = 746)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcPocColor { get; set; } = Color.FromArgb(255, 244, 244, 245);

        [Display(Name = "Hide the native candles underneath (backfill)", GroupName = "Native candles", Order = 750)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public bool CcMask { get; set; } = true;

        [Display(Name = "Chart background colour (used for the backfill and hollow bodies)", GroupName = "Native candles", Order = 751)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcMaskColor { get; set; } = Color.FromArgb(255, 10, 10, 10);

        [Display(Name = "Show live price line", GroupName = "Live price line", Order = 760)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public bool CcPriceLine { get; set; } = false;

        [Display(Name = "Line thickness", GroupName = "Live price line", Order = 761)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        [Range(1, 10)]
        public int CcPriceLineWidth { get; set; } = 1;

        [Display(Name = "Line opacity (%)", GroupName = "Live price line", Order = 762)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        [Range(10, 100)]
        public int CcPriceLineOpacity { get; set; } = 70;

        [Display(Name = "Start the line at the live candle (not the left edge)", GroupName = "Live price line", Order = 763)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public bool CcLineFromCandle { get; set; } = false;

        [Display(Name = "Paint the live price tag on the price scale", GroupName = "Price scale tag", Order = 770)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public bool CcAxisTag { get; set; } = true;

        [Display(Name = "Tag colour", GroupName = "Price scale tag", Order = 771)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public CandleTagColor CcAxisTagSource { get; set; } = CandleTagColor.Body;

        [Display(Name = "Custom colour when up", GroupName = "Price scale tag", Order = 772)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcAxisTagUp { get; set; } = Color.FromArgb(255, 38, 166, 154);

        [Display(Name = "Custom colour when down", GroupName = "Price scale tag", Order = 773)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcAxisTagDown { get; set; } = Color.FromArgb(255, 156, 77, 204);

        [Display(Name = "Pick the text colour automatically (black or white)", GroupName = "Price scale tag", Order = 774)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public bool CcAxisTagAutoText { get; set; } = true;

        [Display(Name = "Text colour", GroupName = "Price scale tag", Order = 775)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public Color CcAxisTagText { get; set; } = Color.White;

        [Display(Name = "Extra height (px, covers the native tag)", GroupName = "Price scale tag", Order = 776)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        [Range(0, 12)]
        public int CcAxisTagPad { get; set; } = 3;

        [Display(Name = "Pointer on the left edge", GroupName = "Price scale tag", Order = 777)]
        [Tab(TabName = "Candles", TabOrder = 7)]
        public bool CcAxisTagPointer { get; set; } = false;

        #endregion

        // ======================================================================================================
        // templates
        // ======================================================================================================

        private struct CcLook
        {
            public CandleShape Shape;
            public CandleFill Up, Down;
            public CandleOutline UpLine, DownLine;
            public CandleWick Wick;
            public CandleMarker Marker;
            public bool Highlights;
        }

        private static CcLook CcPreset(CandleShape shape, CandleFill up, CandleFill down, CandleOutline upLine, CandleOutline downLine,
            CandleWick wick = CandleWick.Line, CandleMarker marker = CandleMarker.None, bool highlights = false)
            => new CcLook { Shape = shape, Up = up, Down = down, UpLine = upLine, DownLine = downLine, Wick = wick, Marker = marker, Highlights = highlights };

        private static CcLook CcTemplateLook(CandleTemplate t)
        {
            const CandleShape R = CandleShape.Rectangle;
            const CandleOutline Full = CandleOutline.Full, None = CandleOutline.None;
            return t switch
            {
                CandleTemplate.HollowUp => CcPreset(R, CandleFill.Hollow, CandleFill.Solid, Full, Full),
                CandleTemplate.Stripes => CcPreset(R, CandleFill.Stripes, CandleFill.Stripes, Full, Full),
                CandleTemplate.ShapesInside => CcPreset(R, CandleFill.ArrowInside, CandleFill.ArrowInside, Full, Full),
                CandleTemplate.Gradient => CcPreset(R, CandleFill.Gradient, CandleFill.Gradient, None, None),
                CandleTemplate.Neon => CcPreset(CandleShape.Rounded, CandleFill.Hollow, CandleFill.Hollow, CandleOutline.Glow, CandleOutline.Glow),
                CandleTemplate.VolumeFill => CcPreset(R, CandleFill.Volume, CandleFill.Volume, Full, Full),
                CandleTemplate.BuySellSplit => CcPreset(R, CandleFill.BuySell, CandleFill.BuySell, None, None),
                CandleTemplate.Dots => CcPreset(R, CandleFill.Dots, CandleFill.Dots, Full, Full),
                CandleTemplate.Pills => CcPreset(CandleShape.Pill, CandleFill.Solid, CandleFill.Solid, None, None),
                CandleTemplate.CloseTicks => CcPreset(R, CandleFill.Hollow, CandleFill.Hollow, Full, Full, marker: CandleMarker.CloseTick),
                CandleTemplate.PatternHighlights => CcPreset(R, CandleFill.Solid, CandleFill.Solid, None, None, highlights: true),
                CandleTemplate.Arrows => CcPreset(CandleShape.Arrow, CandleFill.Tint, CandleFill.Tint, Full, Full),
                CandleTemplate.Gem => CcPreset(CandleShape.Gem, CandleFill.Solid, CandleFill.Solid, None, None),
                CandleTemplate.CornerBrackets => CcPreset(R, CandleFill.Tint, CandleFill.Tint, CandleOutline.Corners, CandleOutline.Corners),
                CandleTemplate.DoubleBorder => CcPreset(R, CandleFill.Tint, CandleFill.Tint, CandleOutline.Double, CandleOutline.Double),
                CandleTemplate.Scanlines => CcPreset(R, CandleFill.Scanlines, CandleFill.Scanlines, Full, Full),
                CandleTemplate.Chevrons => CcPreset(R, CandleFill.Chevrons, CandleFill.Chevrons, Full, Full),
                CandleTemplate.CappedWicks => CcPreset(R, CandleFill.Hollow, CandleFill.Solid, Full, Full, wick: CandleWick.Capped),
                CandleTemplate.RangeGhost => CcPreset(R, CandleFill.Solid, CandleFill.Solid, None, None, wick: CandleWick.RangeGhost),
                CandleTemplate.CloseInRange => CcPreset(R, CandleFill.CloseInRange, CandleFill.CloseInRange, Full, Full),
                CandleTemplate.PocMarker => CcPreset(R, CandleFill.Tint, CandleFill.Tint, Full, Full, marker: CandleMarker.PocDot),
                CandleTemplate.MomentumHeat => CcPreset(R, CandleFill.Momentum, CandleFill.Momentum, None, None),
                CandleTemplate.Extruded => CcPreset(CandleShape.Extruded, CandleFill.Solid, CandleFill.Solid, None, None),
                _ => CcPreset(R, CandleFill.Solid, CandleFill.Solid, Full, Full), // Classic
            };
        }

        /// <summary>the template, with every setting that isn't "From template" laid over it</summary>
        private CcLook CcResolve()
        {
            var l = CcTemplateLook(CcTemplate);
            if (CcShape != CandleShape.FromTemplate) l.Shape = CcShape;
            if (CcUpFill != CandleFill.FromTemplate) l.Up = CcUpFill;
            if (CcDownFill != CandleFill.FromTemplate) l.Down = CcDownFill;
            if (CcUpOutline != CandleOutline.FromTemplate) l.UpLine = CcUpOutline;
            if (CcDownOutline != CandleOutline.FromTemplate) l.DownLine = CcDownOutline;
            if (CcWick != CandleWick.FromTemplate) l.Wick = CcWick;
            if (CcMarker != CandleMarker.FromTemplate) l.Marker = CcMarker;
            if (CcHighlights != CandleToggle.FromTemplate) l.Highlights = CcHighlights == CandleToggle.On;
            return l;
        }

        // ======================================================================================================
        // drawing helpers
        // ======================================================================================================

        private struct CcBar
        {
            public int Left, Width, Center, High, Low, OpenY, CloseY, Top, Bottom, PocY;
            public bool Bull, Doji, Inside, Engulf;
            public double Volume, BuyShare, BodySize, RangePos;
        }

        private readonly Dictionary<long, RenderPen> _ccPens = new();

        /// <summary>pens are cached by colour, width and dash — candles ask for the same few thousands of times a frame</summary>
        private RenderPen CcPen(Color c, int width = 1, bool dashed = false)
        {
            width = Math.Clamp(width, 1, 60);
            var key = ((long)(uint)c.ToArgb() << 8) | ((long)width << 1) | (dashed ? 1L : 0L);
            if (_ccPens.TryGetValue(key, out var pen)) return pen;
            if (_ccPens.Count > 600) _ccPens.Clear();
            pen = dashed ? new RenderPen(c, width, System.Drawing.Drawing2D.DashStyle.Dash) : new RenderPen(c, width);
            _ccPens[key] = pen;
            return pen;
        }

        private static Color WithOpacity(Color c, double opacity) => Color.FromArgb((int)Math.Round(Math.Clamp(opacity, 0, 1) * c.A), c.R, c.G, c.B);

        private static Color CcMix(Color a, Color b, double t) => Color.FromArgb(a.A,
            (int)Math.Round(a.R + (b.R - a.R) * t), (int)Math.Round(a.G + (b.G - a.G) * t), (int)Math.Round(a.B + (b.B - a.B) * t));

        private static int CcClamp(double v, int lo, int hi) => (int)Math.Round(Math.Clamp(v, lo, hi));

        private static bool CcPatterned(CandleFill f) => f is CandleFill.Stripes or CandleFill.Dots or CandleFill.Scanlines or CandleFill.Chevrons
            or CandleFill.Gradient or CandleFill.ArrowInside or CandleFill.BuySell or CandleFill.CloseInRange;

        /// <summary>
        /// The body's outline as a convex polygon, clockwise from the top-centre point; <paramref name="bottomIndex"/> is the
        /// bottom-centre point. (Splitting it there gives the right and left edges, used to backfill outside the shape.)
        /// </summary>
        private static Point[] CcShapePoints(CandleShape shape, bool bull, int l, int t, int r, int b, out int bottomIndex)
        {
            var w = r - l + 1; var h = b - t + 1;
            var cx = l + (w - 1) / 2;
            var pts = new List<Point>(32);
            switch (shape)
            {
                case CandleShape.Arrow:
                {
                    var k = (int)Math.Round(Math.Min((w - 1) / 2.0, h * 0.45));
                    if (bull) pts.AddRange(new[] { new Point(cx, t), new Point(r, t + k), new Point(r, b), new Point(cx, b), new Point(l, b), new Point(l, t + k) });
                    else pts.AddRange(new[] { new Point(cx, t), new Point(r, t), new Point(r, b - k), new Point(cx, b), new Point(l, b - k), new Point(l, t) });
                    bottomIndex = 3;
                    return pts.ToArray();
                }
                case CandleShape.Gem:
                {
                    var k = (int)Math.Round(Math.Min((w - 1) / 2.2, h * 0.3));
                    pts.AddRange(new[] { new Point(cx, t), new Point(r, t + k), new Point(r, b - k), new Point(cx, b), new Point(l, b - k), new Point(l, t + k) });
                    bottomIndex = 3;
                    return pts.ToArray();
                }
                case CandleShape.Rounded:
                case CandleShape.Pill:
                {
                    var rad = shape == CandleShape.Pill ? (w - 1) / 2.0 : Math.Clamp(Math.Min(w, h) / 4.0, 1, 4);
                    rad = Math.Min(rad, Math.Min((w - 1) / 2.0, (h - 1) / 2.0));
                    var segs = Math.Clamp((int)Math.Round(rad / 1.5), 2, 10);
                    void Arc(double ccx, double ccy, double from)
                    {
                        for (var s = 0; s <= segs; s++)
                        {
                            var a = (from + 90.0 * s / segs) * Math.PI / 180;
                            var p = new Point((int)Math.Round(ccx + Math.Cos(a) * rad), (int)Math.Round(ccy + Math.Sin(a) * rad));
                            if (pts.Count == 0 || pts[pts.Count - 1] != p) pts.Add(p);
                        }
                    }
                    pts.Add(new Point(cx, t));
                    Arc(r - rad, t + rad, -90);   // top right
                    Arc(r - rad, b - rad, 0);     // bottom right
                    if (pts[pts.Count - 1] != new Point(cx, b)) pts.Add(new Point(cx, b));
                    bottomIndex = pts.IndexOf(new Point(cx, b));
                    Arc(l + rad, b - rad, 90);    // bottom left
                    Arc(l + rad, t + rad, 180);   // top left
                    if (pts[pts.Count - 1] == pts[0]) pts.RemoveAt(pts.Count - 1);
                    return pts.ToArray();
                }
                default:
                    bottomIndex = 3;
                    return new[] { new Point(cx, t), new Point(r, t), new Point(r, b), new Point(cx, b), new Point(l, b), new Point(l, t) };
            }
        }

        /// <summary>
        /// Paints the corners of the body's box that fall outside the shape with the chart background — so a pattern
        /// drawn over the whole box, or the native candle underneath, never shows past a pill's or arrow's edge.
        /// Built from small trapezoids, one per edge segment, so it works with any polygon fill.
        /// </summary>
        private void CcBackfillOutside(RenderContext g, Point[] pts, int bottomIndex, int l, int r)
        {
            var bg = CcMaskColor;
            for (var j = 0; j < bottomIndex; j++)
            {
                var p = pts[j]; var q = pts[j + 1];
                if (p.X >= r && q.X >= r) continue;
                g.FillPolygon(bg, new[] { p, new Point(r + 1, p.Y), new Point(r + 1, q.Y), q });
            }
            for (var j = bottomIndex; j < pts.Length; j++)
            {
                var p = pts[j]; var q = pts[(j + 1) % pts.Length];
                if (p.X <= l && q.X <= l) continue;
                g.FillPolygon(bg, new[] { p, q, new Point(l - 1, q.Y), new Point(l - 1, p.Y) });
            }
        }

        // ======================================================================================================
        // the candles
        // ======================================================================================================

        private void DrawCandles(RenderContext g)
        {
            if (CurrentBar <= 0) return;
            var look = CcResolve();
            var region = Container.Region;
            var barWidthExact = ChartInfo.PriceChartContainer.BarsWidth;
            var first = Math.Max(0, FirstVisibleBarNumber);
            var last = Math.Min(CurrentBar - 1, LastVisibleBarNumber);
            if (last < first) return;

            // measure every visible bar once; averages drive the volume and momentum fills
            var bars = new CcBar[last - first + 1];
            double volSum = 0, bodySum = 0;
            for (var i = first; i <= last; i++)
            {
                var c = GetCandle(i);
                ref var b = ref bars[i - first];
                b.Width = -1;
                if (c == null) continue;
                b.Left = ChartInfo.GetXByBar(i, true) + CcOffsetX;
                b.Width = Math.Max(1, (int)Math.Round(barWidthExact));
                if (b.Width > 2 && b.Width % 2 == 0) b.Width--; // an odd width has a true middle pixel for the wick
                b.Center = b.Left + b.Width / 2;
                b.High = ChartInfo.GetYByPrice(c.High, false);
                b.Low = ChartInfo.GetYByPrice(c.Low, false);
                b.OpenY = ChartInfo.GetYByPrice(c.Open, false);
                b.CloseY = ChartInfo.GetYByPrice(c.Close, false);
                b.Top = Math.Min(b.OpenY, b.CloseY);
                b.Bottom = Math.Max(b.OpenY, b.CloseY);
                b.Bull = c.Close > c.Open;
                b.Doji = c.Close == c.Open;
                b.Volume = (double)c.Volume;
                var flow = (double)(c.Ask + c.Bid);
                b.BuyShare = flow > 0 ? (double)c.Ask / flow : -1;
                b.BodySize = (double)Math.Abs(c.Close - c.Open);
                b.RangePos = c.High > c.Low ? (double)((c.Close - c.Low) / (c.High - c.Low)) : 0.5;
                var poc = c.MaxVolumePriceInfo;
                b.PocY = poc != null && poc.Price > 0 ? ChartInfo.GetYByPrice(poc.Price, false) : int.MinValue;
                if (look.Highlights && i > 0)
                {
                    var p = GetCandle(i - 1);
                    if (p != null)
                    {
                        b.Inside = c.High < p.High && c.Low > p.Low;
                        var pBull = p.Close > p.Open;
                        b.Engulf = !b.Doji && b.Bull != pBull && p.Close != p.Open
                            && Math.Max(c.Open, c.Close) > Math.Max(p.Open, p.Close) && Math.Min(c.Open, c.Close) < Math.Min(p.Open, p.Close);
                    }
                }
                volSum += b.Volume;
                bodySum += b.BodySize;
            }
            var n = Math.Max(1, bars.Length);
            var avgVol = volSum / n;
            var avgBody = bodySum / n;

            g.SetClip(region);
            try
            {
                // pass 1 — backfill: paint over every native candle first, so nothing we draw next (glow, 3D sides
                // reaching into the neighbour) gets cut off by the next candle's backfill
                if (CcMask)
                {
                    foreach (var b in bars)
                    {
                        if (b.Width < 0) continue;
                        if (!b.Doji && b.Bottom > b.Top)
                            g.FillRectangle(CcMaskColor, new Rectangle(b.Left, b.Top, b.Width, b.Bottom - b.Top + 1));
                        if (b.Low > b.High) // the native wick too — faded or see-through wicks would show it otherwise
                        {
                            var ww = Math.Max(3, CcWickWidth + 2);
                            g.FillRectangle(CcMaskColor, new Rectangle(b.Center - ww / 2, b.High, ww, b.Low - b.High + 1));
                        }
                    }
                }

                // pass 2 — the candles
                for (var k = 0; k < bars.Length; k++)
                {
                    if (bars[k].Width < 0) continue;
                    try { CcDrawOne(g, bars[k], look, avgVol, avgBody, region); } catch { /* one odd bar never stops the rest */ }
                }

                if (CcPriceLine)
                {
                    var live = GetCandle(CurrentBar - 1);
                    if (live != null)
                    {
                        var c = live.Close > live.Open ? CcBullBorder : live.Close < live.Open ? CcBearBorder : CcDoji;
                        var y = ChartInfo.GetYByPrice(live.Close, false);
                        var x1 = CcLineFromCandle ? ChartInfo.GetXByBar(CurrentBar - 1, true) + (int)Math.Round(barWidthExact) + 2 : region.Left;
                        g.DrawLine(CcPen(WithOpacity(c, CcPriceLineOpacity / 100.0), CcPriceLineWidth, true), x1, y, region.Right, y);
                    }
                }
            }
            finally
            {
                g.ResetClip();
            }

            if (CcAxisTag)
                try { CcDrawAxisTag(g); } catch { /* the scale tag is decoration; never break the chart */ }
        }

        /// <summary>
        /// The live price on the price scale, painted in the candles' own colours over ATAS's native tag (which keeps
        /// the native candle colours). Full scale width and a little taller than the native one, so it's covered.
        /// </summary>
        private void CcDrawAxisTag(RenderContext g)
        {
            var live = GetCandle(CurrentBar - 1);
            if (live == null) return;
            var up = live.Close >= live.Open;
            if (live.Close == live.Open && CurrentBar > 1) up = live.Close >= GetCandle(CurrentBar - 2).Close; // doji: against the last close
            var fill = CcAxisTagSource switch
            {
                CandleTagColor.Border => up ? CcBullBorder : CcBearBorder,
                CandleTagColor.Custom => up ? CcAxisTagUp : CcAxisTagDown,
                _ => up ? CcBullBody : CcBearBody,
            };
            fill = Color.FromArgb(255, fill.R, fill.G, fill.B); // a see-through tag would show the native one under it
            var ink = CcAxisTagAutoText ? (fill.R * 0.299 + fill.G * 0.587 + fill.B * 0.114 > 150 ? Color.Black : Color.White) : CcAxisTagText;

            var font = ChartInfo.PriceAxisFont;
            var text = ChartInfo.GetPriceString(live.Close);
            var size = g.MeasureString(text, font);
            var x = ChartInfo.PriceChartContainer.Region.Right;
            var right = ChartInfo.ChartContainer.Region.Right;
            if (right - x < 8) return; // no price scale showing
            var y = ChartInfo.GetYByPrice(live.Close, false);
            var half = size.Height / 2 + CcAxisTagPad;
            var chart = ChartInfo.PriceChartContainer.Region;
            if (y < chart.Top - half || y > chart.Bottom + half) return; // price is off screen

            var tip = CcAxisTagPointer ? Math.Max(3, half) : 0;
            var bounds = g.ClipBounds;
            g.ResetClip();
            try
            {
                if (tip > 0)
                {
                    g.FillPolygon(fill, new[] { new Point(x, y), new Point(x + tip, y - half), new Point(right, y - half), new Point(right, y + half), new Point(x + tip, y + half) });
                }
                else
                {
                    g.FillRectangle(fill, new Rectangle(x, y - half, right - x, half * 2 + 1), 2);
                }
                var tx = x + tip + Math.Max(3, (right - x - tip - size.Width) / 2);
                g.DrawString(text, font, ink, tx, y - size.Height / 2);
            }
            finally
            {
                g.SetClip(bounds);
            }
        }

        private void CcDrawOne(RenderContext g, CcBar b, CcLook look, double avgVol, double avgBody, Rectangle region)
        {
            var bull = b.Bull;
            var fade = look.Highlights && !b.Inside && !b.Engulf ? CcHighlightFade / 100.0 : 1.0;
            var body = WithOpacity(bull ? CcBullBody : CcBearBody, fade);
            var border = WithOpacity(bull ? CcBullBorder : CcBearBorder, fade);
            var wickColor = WithOpacity(bull ? CcBullWick : CcBearWick, fade);
            var pattern = WithOpacity(bull ? CcBullPattern : CcBearPattern, fade);
            var fill = bull ? look.Up : look.Down;
            var outline = bull ? look.UpLine : look.DownLine;
            var shape = look.Shape;
            var wick = look.Wick;

            // thin bars (zoomed far out): one line from high to low
            if (b.Width <= 2)
            {
                g.DrawLine(CcPen(b.Doji ? CcDoji : wickColor, CcWickWidth), b.Center, b.High, b.Center, Math.Max(b.Low, b.High + 1));
                return;
            }

            var l = b.Left + CcInset;
            var w = Math.Max(1, b.Width - CcInset * 2);
            var r = l + w - 1;
            var cx = l + (w - 1) / 2;

            if (b.Doji)
            {
                var dp = CcPen(WithOpacity(CcDoji, fade), Math.Max(CcBorderWidth, CcWickWidth));
                if (wick != CandleWick.Hidden && wick != CandleWick.RangeGhost && b.Low > b.High) g.DrawLine(CcPen(WithOpacity(CcDoji, fade), CcWickWidth), b.Center, b.High, b.Center, b.Low);
                if (wick == CandleWick.RangeGhost) g.FillRectangle(WithOpacity(CcDoji, 0.14 * fade), new Rectangle(l, b.High, w, Math.Max(1, b.Low - b.High)));
                g.DrawLine(dp, l, b.Top, r, b.Top);
                return;
            }

            var t = b.Top;
            var bt = Math.Max(t, b.Bottom);
            var h = bt - t + 1;

            // pattern highlights take over the inside bar's look
            if (b.Inside)
            {
                fill = CandleFill.Stripes; // drawn cross-hatched below
                outline = CandleOutline.Full;
                border = CcInsideColor; wickColor = CcInsideColor; pattern = CcInsideColor; body = CcInsideColor;
            }

            // step down detail as the candle shrinks with the zoom
            if (w < 4 && shape != CandleShape.Rectangle) shape = CandleShape.Rectangle;
            if (shape == CandleShape.Extruded && (w < 6 || h < 3)) shape = CandleShape.Rectangle;
            if (shape is CandleShape.Arrow or CandleShape.Gem && h < 4) shape = CandleShape.Rectangle;
            if (CcPatterned(fill) && fill != CandleFill.BuySell && fill != CandleFill.CloseInRange && (w < 5 || h < 4)) fill = CandleFill.Solid;
            if ((fill == CandleFill.BuySell || fill == CandleFill.CloseInRange) && w < 3) fill = CandleFill.Solid;
            if (outline is CandleOutline.Corners or CandleOutline.Double && (w < 6 || h < 6)) outline = CandleOutline.Full;
            if (outline == CandleOutline.Glow && w < 4) outline = CandleOutline.Full;
            if (fill == CandleFill.Hollow && outline == CandleOutline.None) outline = CandleOutline.Full; // a hollow body needs an edge

            // a pill shorter than it is wide becomes a circle centred on the body
            if (shape == CandleShape.Pill && h < w)
            {
                var mid = (t + bt) / 2;
                t = mid - (w - 1) / 2; bt = t + w - 1; h = w;
            }

            var isRect = shape is CandleShape.Rectangle or CandleShape.Extruded;
            var pts = CcShapePoints(shape, bull, l, t, r, bt, out var bottomIndex);
            var box = new Rectangle(l, t, w, h);
            var depth = shape == CandleShape.Extruded ? CcClamp(w / 4.0, 2, 6) : 0;

            // ---- wicks: from the high to the top edge, and from the bottom edge to the low — never through the body
            var wp = CcPen(wickColor, CcWickWidth);
            switch (wick)
            {
                case CandleWick.RangeGhost:
                    g.FillRectangle(WithOpacity(body, 0.14), new Rectangle(l, b.High, w, Math.Max(1, b.Low - b.High + 1)));
                    break;
                case CandleWick.Line:
                case CandleWick.Capped:
                {
                    var topEnd = t - depth; // with 3D, the wick meets the top face's upper edge
                    var wx = cx;
                    if (b.High < topEnd) g.DrawLine(wp, wx, b.High, wx, topEnd);
                    if (b.Low > bt) g.DrawLine(wp, cx, bt, cx, b.Low);
                    if (wick == CandleWick.Capped)
                    {
                        var half = Math.Max(1, (int)Math.Round(w * 0.25));
                        if (b.High < topEnd) g.DrawLine(wp, wx - half, b.High, wx + half, b.High);
                        if (b.Low > bt) g.DrawLine(wp, cx - half, b.Low, cx + half, b.Low);
                    }
                    break;
                }
            }

            // ---- body fill
            Color? edgeOverride = null;
            var solidAlpha = CcOpacity;
            void FillShape(Color c)
            {
                if (isRect) g.FillRectangle(c, box);
                else g.FillPolygon(c, pts);
            }
            void Clip(Action draw)
            {
                var clip = Rectangle.Intersect(box, region);
                if (clip.Width <= 0 || clip.Height <= 0) return;
                g.SetClip(clip);
                try { draw(); } finally { g.SetClip(region); }
                if (!isRect) CcBackfillOutside(g, pts, bottomIndex, l, r);
            }

            switch (fill)
            {
                case CandleFill.Solid:
                    FillShape(WithOpacity(body, solidAlpha));
                    break;
                case CandleFill.Tint:
                    FillShape(WithOpacity(body, 0.18 * solidAlpha));
                    break;
                case CandleFill.Hollow:
                    break; // the backfill already cleared it
                case CandleFill.Stripes:
                {
                    var gap = CcClamp(w / 3.0, 3, 8);
                    var pw = w >= 18 ? 2 : 1;
                    var pen = CcPen(pattern, pw);
                    var cross = b.Inside;
                    Clip(() =>
                    {
                        for (var k = -h; k < w + h; k += gap)
                        {
                            if (bull || cross) g.DrawLine(pen, l + k, t + h, l + k + h, t);      // rising  ╱
                            if (!bull || cross) g.DrawLine(pen, l + k, t, l + k + h, t + h);     // falling ╲
                        }
                    });
                    break;
                }
                case CandleFill.Dots:
                {
                    var gap = CcClamp(w / 3.0, 3, 8);
                    var size = Math.Max(1, gap / 3);
                    Clip(() =>
                    {
                        var row = 0;
                        for (var y = t + gap / 2; y < t + h; y += gap, row++)
                            for (var x = l + gap / 2 + (row % 2 == 1 ? gap / 2 : 0); x < l + w; x += gap)
                                g.FillRectangle(pattern, new Rectangle(x - size / 2, y - size / 2, size, size));
                    });
                    break;
                }
                case CandleFill.Scanlines:
                {
                    var gap = CcClamp(w / 4.0, 2, 6);
                    var pen = CcPen(pattern, gap >= 5 ? 2 : 1);
                    Clip(() => { for (var y = t + 1; y < t + h; y += gap) g.DrawLine(pen, l, y, l + w, y); });
                    break;
                }
                case CandleFill.Chevrons:
                {
                    var step = CcClamp(w / 2.0, 3, 10);
                    var rise = Math.Max(2, (int)Math.Round(step * 0.75));
                    var pen = CcPen(pattern, w >= 16 ? 2 : 1);
                    Clip(() =>
                    {
                        for (var y = t + 1; y < t + h + rise; y += step)
                        {
                            if (bull) { g.DrawLine(pen, l, y + rise, cx, y); g.DrawLine(pen, cx, y, r, y + rise); }   // ^
                            else { g.DrawLine(pen, l, y, cx, y + rise); g.DrawLine(pen, cx, y + rise, r, y); }       // v
                        }
                    });
                    break;
                }
                case CandleFill.Gradient:
                {
                    var band = h > 40 ? 2 : 1;
                    Clip(() =>
                    {
                        for (var y = 0; y < h; y += band)
                        {
                            var f = (double)y / Math.Max(1, h - 1); // 0 at the top, 1 at the bottom
                            var a = bull ? 1 - 0.85 * f : 0.15 + 0.85 * f;  // brightest at the close
                            g.FillRectangle(WithOpacity(body, a * solidAlpha), new Rectangle(l, t + y, w, Math.Min(band, h - y)));
                        }
                    });
                    break;
                }
                case CandleFill.ArrowInside:
                {
                    FillShape(WithOpacity(body, 0.14 * solidAlpha));
                    var a = Math.Min(w * 0.32, h * 0.3);
                    if (a >= 2)
                    {
                        var cy = t + h / 2.0;
                        Point P(double x, double y) => new Point((int)Math.Round(x), (int)Math.Round(y));
                        var tri = bull
                            ? new[] { P(cx, cy - a), P(cx + a, cy + a * 0.7), P(cx - a, cy + a * 0.7) }
                            : new[] { P(cx, cy + a), P(cx + a, cy - a * 0.7), P(cx - a, cy - a * 0.7) };
                        g.FillPolygon(pattern, tri);
                    }
                    break;
                }
                case CandleFill.Volume:
                {
                    var v = avgVol > 0 ? Math.Min(1, b.Volume / (1.6 * avgVol)) : 1;
                    FillShape(WithOpacity(body, (0.12 + 0.88 * v) * solidAlpha));
                    break;
                }
                case CandleFill.BuySell:
                {
                    if (b.BuyShare < 0) { FillShape(WithOpacity(body, solidAlpha)); break; }
                    var buyW = (int)Math.Round(w * b.BuyShare);
                    var buy = WithOpacity(CcBullBody, fade * solidAlpha);
                    var sell = WithOpacity(CcBearBody, fade * solidAlpha);
                    Clip(() =>
                    {
                        if (buyW > 0) g.FillRectangle(buy, new Rectangle(l, t, buyW, h));
                        if (w - buyW > 0) g.FillRectangle(sell, new Rectangle(l + buyW, t, w - buyW, h));
                    });
                    break;
                }
                case CandleFill.CloseInRange:
                {
                    var zone = b.RangePos > 0.66 ? CcBullBody : b.RangePos < 0.34 ? CcBearBody : CcNeutral;
                    zone = WithOpacity(zone, fade);
                    edgeOverride = zone;
                    var fh = (int)Math.Round(h * Math.Clamp(b.RangePos, 0, 1));
                    if (fh > 0) Clip(() => g.FillRectangle(WithOpacity(zone, 0.85 * solidAlpha), new Rectangle(l, t + h - fh, w, fh)));
                    if (outline == CandleOutline.None) outline = CandleOutline.Full;
                    break;
                }
                case CandleFill.Momentum:
                {
                    var m = avgBody > 0 ? Math.Min(1, b.BodySize / (1.8 * avgBody)) : 0.5;
                    if (m > 0.6 && w >= 4)
                    {
                        var gw = CcClamp(w / 4.0, 2, 6);
                        CcDrawEdge(g, isRect, box, pts, CcPen(WithOpacity(body, 0.16 * m), 1 + gw * 2));
                        CcDrawEdge(g, isRect, box, pts, CcPen(WithOpacity(body, 0.28 * m), 1 + gw));
                    }
                    FillShape(WithOpacity(body, (0.15 + 0.85 * m) * solidAlpha));
                    break;
                }
            }

            // ---- 3D faces: a lit top and a shaded side, reaching up and to the right
            if (depth > 0)
            {
                var front = fill == CandleFill.Hollow ? border : body;
                var lit = CcMix(front, Color.White, 0.42);
                var shade = CcMix(front, Color.Black, 0.5);
                g.FillPolygon(WithOpacity(lit, solidAlpha), new[] { new Point(l, t), new Point(l + depth, t - depth), new Point(r + 1 + depth, t - depth), new Point(r + 1, t) });
                g.FillPolygon(WithOpacity(shade, solidAlpha), new[] { new Point(r + 1, t), new Point(r + 1 + depth, t - depth), new Point(r + 1 + depth, t + h - depth), new Point(r + 1, t + h) });
            }

            // ---- outline
            var edge = edgeOverride ?? border;
            var bw = CcBorderWidth;
            switch (outline)
            {
                case CandleOutline.Full:
                    CcDrawEdge(g, isRect, box, pts, CcPen(edge, bw));
                    break;
                case CandleOutline.Glow:
                {
                    var gw = CcClamp(w / 4.0, 2, 6);
                    CcDrawEdge(g, isRect, box, pts, CcPen(WithOpacity(edge, 0.14), bw + gw * 2));
                    CcDrawEdge(g, isRect, box, pts, CcPen(WithOpacity(edge, 0.3), bw + gw));
                    CcDrawEdge(g, isRect, box, pts, CcPen(edge, bw));
                    break;
                }
                case CandleOutline.Double:
                {
                    CcDrawEdge(g, isRect, box, pts, CcPen(edge, bw));
                    var ins = CcClamp(w / 5.0, 2, 5);
                    if (w > ins * 2 + 2 && h > ins * 2 + 2)
                    {
                        var inner = WithOpacity(edge, 0.65);
                        if (isRect) g.DrawRectangle(CcPen(inner, 1), new Rectangle(l + ins, t + ins, w - 1 - ins * 2, h - 1 - ins * 2));
                        else
                        {
                            double hx = (w - 1) / 2.0, hy = (h - 1) / 2.0, my = t + hy;
                            var sx = (hx - ins) / hx; var sy = (hy - ins) / hy;
                            var ip = new Point[pts.Length];
                            for (var j = 0; j < pts.Length; j++)
                                ip[j] = new Point((int)Math.Round(cx + (pts[j].X - cx) * sx), (int)Math.Round(my + (pts[j].Y - my) * sy));
                            g.DrawPolygon(CcPen(inner, 1), ip);
                        }
                    }
                    break;
                }
                case CandleOutline.Corners:
                {
                    var k = CcClamp(Math.Min(w, h) / 3.0, 2, 10);
                    var cp = CcPen(edge, bw + (w >= 14 ? 1 : 0));
                    int x0 = l, x1 = r, y0 = t, y1 = t + h - 1;
                    g.DrawLine(cp, x0, y0, x0 + k, y0); g.DrawLine(cp, x0, y0, x0, y0 + k);
                    g.DrawLine(cp, x1 - k, y0, x1, y0); g.DrawLine(cp, x1, y0, x1, y0 + k);
                    g.DrawLine(cp, x0, y1, x0 + k, y1); g.DrawLine(cp, x0, y1 - k, x0, y1);
                    g.DrawLine(cp, x1 - k, y1, x1, y1); g.DrawLine(cp, x1, y1 - k, x1, y1);
                    break;
                }
            }

            // ---- engulfing bars get a dashed frame just outside the body
            if (b.Engulf && w >= 4)
            {
                var pad = CcClamp(w / 6.0, 2, 4);
                g.DrawRectangle(CcPen(CcEngulfColor, 1, true), new Rectangle(l - pad, t - pad, w - 1 + pad * 2, h - 1 + pad * 2));
            }

            // ---- markers
            if (look.Marker == CandleMarker.CloseTick)
            {
                var tw = CcClamp(w / 6.0, 2, 4);
                var over = Math.Max(1, w / 8);
                g.DrawLine(CcPen(edge, tw), l - over, b.CloseY, r + over, b.CloseY);
                if (w >= 5) g.DrawLine(CcPen(WithOpacity(edge, 0.6), 1), l + 1, b.OpenY, cx, b.OpenY);
            }
            else if (look.Marker == CandleMarker.PocDot && b.PocY != int.MinValue && w >= 7)
            {
                var rad = CcClamp(w / 5.0, 2, 6);
                g.FillEllipse(CcMaskColor, new Rectangle(cx - rad - 1, b.PocY - rad - 1, rad * 2 + 3, rad * 2 + 3));
                g.FillEllipse(WithOpacity(CcPocColor, fade), new Rectangle(cx - rad, b.PocY - rad, rad * 2 + 1, rad * 2 + 1));
            }
        }

        private static void CcDrawEdge(RenderContext g, bool isRect, Rectangle box, Point[] pts, RenderPen pen)
        {
            if (isRect) g.DrawRectangle(pen, new Rectangle(box.X, box.Y, Math.Max(1, box.Width - 1), Math.Max(1, box.Height - 1)));
            else g.DrawPolygon(pen, pts);
        }
    }
}
