// RoninFlow Suite — NinjaTrader 8 indicator.
//
// RoninFlow on your chart, each part switched on or off in the indicator's settings:
//   * Account panel: the chart's account with its RoninFlow risk tier, the gamma regime, today's P&L, the buffer from
//     your stop to the profit target, trade stats (click to collapse), the GEX line, and open positions on every account.
//   * Executions: your entries and exits, the line joining them in a win or loss colour, the result at the exit, and the
//     open position's average price.
//   * Gamma levels: flip, call and put walls and the other big strikes, as lines or zones.
//   * News: the feed (click the title to collapse, a headline to open it), pop-ups for new headlines, and today's
//     economic events on the time axis.
//   * DOM heatmap and custom candle colours.
//   * Alerts with sounds: entries, fills, wins, losses, the daily loss limit and the profit target.
//
// Install: npm run addon:nt copies this file to Documents\NinjaTrader 8\bin\Custom\Indicators\RoninFlowSuite.cs;
//          compile once (NinjaScript Editor → F5), then add "RoninFlow Suite" to a chart (Indicators window).
// RoninFlow's address and token come from Documents\NinjaTrader 8\journal-sync.txt (the same file RoninFlow Sync uses),
// unless set in the indicator.
#region Using declarations
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Xml.Serialization;
using NinjaTrader.Cbi;
using NinjaTrader.Data;
using NinjaTrader.Gui;
using NinjaTrader.Gui.Chart;
using NinjaTrader.NinjaScript;
using RoninFlowSuiteTypes;
using DX = SharpDX;
using D2D = SharpDX.Direct2D1;
using DW = SharpDX.DirectWrite;
#endregion

namespace RoninFlowSuiteTypes
{
	public enum Corner { TopLeft, TopRight, BottomLeft, BottomRight, TopMiddle, BottomMiddle }
	public enum MarkerStyle { Triangles, Arrows, Circles }
	public enum LineKind { Solid, Dashed, Dotted }
	public enum ResultUnit { Money, Ticks, Points }
	public enum LabelSide { Left, Middle, Right }
	public enum EventLevel { AllEvents, MediumAndHigh, HighOnly }
	public enum Palette { Bookmap, Thermal, Ocean, Mono }
}

namespace NinjaTrader.NinjaScript.Indicators
{
	public class RoninFlowSuite : Indicator
	{
		private const string Version = "1.0.0";

		// ---------- data from RoninFlow (tab-separated: /api/suite?format=tsv) ----------
		private sealed class AcctInfo { public string Tier = "", Color = "", Reason = ""; public int Level, Of, MaxTrades; public double DailyLoss, Trail, Target; public bool Enforced, Enforcing, Blocked, Paused, Manual, InWindow = true; }
		private sealed class GexInfo { public string Index = "", Zone = "", Error = ""; public double Total; public double? Flip, Call, Put, Spot; public bool Delayed; public List<double> Pos = new List<double>(), Neg = new List<double>(); }
		private sealed class EventItem { public long T; public string Impact = "", Ccy = "", Title = "", Actual = "", Forecast = "", Previous = ""; }
		private sealed class NewsItem { public string Id = "", Src = "", Title = "", Link = "", Summary = ""; public long T; public int Importance, Dir; }
		private sealed class Snap { public long At, DayStart; public string Market = "", MarketLabel = "", Error = ""; public bool Enforcer; public AcctInfo Acct; public GexInfo Gex; public List<EventItem> Events = new List<EventItem>(); public List<NewsItem> News = new List<NewsItem>(); public DateTime Got; }

		private volatile Snap snap;
		private System.Threading.Timer fetchTimer, tickTimer;
		private int fetching;
		private string baseUrl = "http://127.0.0.1:5173", token = "";
		private readonly HashSet<string> seenNews = new HashSet<string>();
		private bool newsPrimed;
		private readonly List<KeyValuePair<NewsItem, DateTime>> popups = new List<KeyValuePair<NewsItem, DateTime>>();
		private readonly object gate = new object();

		// ---------- the chart's account and today's trades ----------
		private Account account;
		private int accountTicks;
		private sealed class Trip { public DateTime Open, Close; public double OpenPrice, ClosePrice, Qty, Pnl; public bool Long, Complete; }
		private List<Trip> trips = new List<Trip>();
		private double dayRealised, dayPeak; private int dayTrades, dayWins, dayLosses; private double grossWin, grossLoss, best, worst;
		private sealed class PosRow { public string Account = "", Code = ""; public int Qty; public double Pnl; }
		private List<PosRow> positions = new List<PosRow>();
		private readonly Dictionary<string, int> lastQty = new Dictionary<string, int>();
		private bool dllWarned, dllHit, targetHit; private DateTime alertDay = DateTime.MinValue;

		// ---------- heatmap ----------
		private sealed class HmNode { public int Start, End; public double Price, Volume; public bool Active; }
		private readonly List<HmNode> hmNodes = new List<HmNode>();
		private readonly Dictionary<double, HmNode> hmLive = new Dictionary<double, HmNode>();
		private readonly object hmLock = new object();
		private DateTime hmRedraw = DateTime.MinValue;

		// ---------- clickable areas (device pixels) ----------
		private System.Windows.Rect newsHeader = Rect.Empty, statsRect = Rect.Empty, detailRect = Rect.Empty;
		private readonly List<KeyValuePair<Rect, NewsItem>> newsRows = new List<KeyValuePair<Rect, NewsItem>>();
		private readonly List<KeyValuePair<Rect, string>> buttons = new List<KeyValuePair<Rect, string>>();
		private bool newsCollapsed, statsCollapsed;
		private NewsItem detail;
		private bool mouseHooked;

		// ---------- rendering resources ----------
		private readonly Dictionary<uint, D2D.SolidColorBrush> brushes = new Dictionary<uint, D2D.SolidColorBrush>();
		private DW.TextFormat fNormal, fSmall, fBold, fBig;
		private int fontKey;

		#region Settings
		[Display(Name = "RoninFlow address (empty = this PC / the sync settings file)", GroupName = "01. General", Order = 0)]
		public string ServerUrl { get; set; }

		[Display(Name = "Token (RoninFlow on another computer only)", GroupName = "01. General", Order = 1)]
		public string Token { get; set; }

		[Display(Name = "Account (empty = the chart's account)", GroupName = "01. General", Order = 2)]
		public string AccountName { get; set; }

		[Display(Name = "Refresh every (seconds)", GroupName = "01. General", Order = 3)]
		[Range(2, 60)]
		public int RefreshSeconds { get; set; }

		[Display(Name = "Text size", GroupName = "01. General", Order = 4)]
		[Range(7, 20)]
		public int FontSize { get; set; }

		[Display(Name = "Show the account panel", GroupName = "02. Account panel", Order = 0)]
		public bool ShowAccount { get; set; }

		[Display(Name = "Placement", GroupName = "02. Account panel", Order = 1)]
		public Corner AccountPlacement { get; set; }

		[Display(Name = "X offset", GroupName = "02. Account panel", Order = 2)]
		[Range(-3000, 3000)]
		public int AccountX { get; set; }

		[Display(Name = "Y offset", GroupName = "02. Account panel", Order = 3)]
		[Range(-3000, 3000)]
		public int AccountY { get; set; }

		[Display(Name = "Width", GroupName = "02. Account panel", Order = 4)]
		[Range(180, 700)]
		public int AccountWidth { get; set; }

		[Display(Name = "Risk tier chip", GroupName = "02. Account panel", Order = 5)]
		public bool ShowTierChip { get; set; }

		[Display(Name = "Gamma regime chip", GroupName = "02. Account panel", Order = 6)]
		public bool ShowGammaChip { get; set; }

		[Display(Name = "P&L tiles", GroupName = "02. Account panel", Order = 7)]
		public bool ShowPnlTiles { get; set; }

		[Display(Name = "Buffer bar (loss limit to profit target)", GroupName = "02. Account panel", Order = 8)]
		public bool ShowBuffer { get; set; }

		[Display(Name = "Buffer bar moves with closed P&L only", GroupName = "02. Account panel", Order = 9)]
		public bool BufferClosedOnly { get; set; }

		[Display(Name = "Trade stats (click to collapse)", GroupName = "02. Account panel", Order = 10)]
		public bool ShowStats { get; set; }

		[Display(Name = "GEX line", GroupName = "02. Account panel", Order = 11)]
		public bool ShowGexLine { get; set; }

		[Display(Name = "Open positions on every account", GroupName = "02. Account panel", Order = 12)]
		public bool ShowAllPositions { get; set; }

		[Display(Name = "Show your executions", GroupName = "03. Executions", Order = 0)]
		public bool ShowExecutions { get; set; }

		[Display(Name = "Marker style", GroupName = "03. Executions", Order = 1)]
		public MarkerStyle ExecMarker { get; set; }

		[Display(Name = "Marker size", GroupName = "03. Executions", Order = 2)]
		[Range(4, 40)]
		public int ExecSize { get; set; }

		[XmlIgnore]
		[Display(Name = "Buy colour", GroupName = "03. Executions", Order = 3)]
		public System.Windows.Media.Brush ExecBuyColor { get; set; }
		[Browsable(false)]
		public string ExecBuyColorSerializable { get { return Serialize.BrushToString(ExecBuyColor); } set { ExecBuyColor = Serialize.StringToBrush(value); } }

		[XmlIgnore]
		[Display(Name = "Sell colour", GroupName = "03. Executions", Order = 4)]
		public System.Windows.Media.Brush ExecSellColor { get; set; }
		[Browsable(false)]
		public string ExecSellColorSerializable { get { return Serialize.BrushToString(ExecSellColor); } set { ExecSellColor = Serialize.StringToBrush(value); } }

		[Display(Name = "Quantity next to each marker", GroupName = "03. Executions", Order = 5)]
		public bool ExecShowQty { get; set; }

		[Display(Name = "Join entry and exit with a line", GroupName = "03. Executions", Order = 6)]
		public bool ExecConnect { get; set; }

		[XmlIgnore]
		[Display(Name = "Winning trade line", GroupName = "03. Executions", Order = 7)]
		public System.Windows.Media.Brush ExecWinColor { get; set; }
		[Browsable(false)]
		public string ExecWinColorSerializable { get { return Serialize.BrushToString(ExecWinColor); } set { ExecWinColor = Serialize.StringToBrush(value); } }

		[XmlIgnore]
		[Display(Name = "Losing trade line", GroupName = "03. Executions", Order = 8)]
		public System.Windows.Media.Brush ExecLossColor { get; set; }
		[Browsable(false)]
		public string ExecLossColorSerializable { get { return Serialize.BrushToString(ExecLossColor); } set { ExecLossColor = Serialize.StringToBrush(value); } }

		[Display(Name = "Line width", GroupName = "03. Executions", Order = 9)]
		[Range(1, 8)]
		public int ExecLineWidth { get; set; }

		[Display(Name = "Line style", GroupName = "03. Executions", Order = 10)]
		public LineKind ExecLineStyle { get; set; }

		[Display(Name = "Result at the exit", GroupName = "03. Executions", Order = 11)]
		public bool ExecShowResult { get; set; }

		[Display(Name = "Result in", GroupName = "03. Executions", Order = 12)]
		public ResultUnit ExecResultUnit { get; set; }

		[Display(Name = "Open position average price line", GroupName = "03. Executions", Order = 13)]
		public bool ExecShowAvg { get; set; }

		[XmlIgnore]
		[Display(Name = "Average price line colour", GroupName = "03. Executions", Order = 14)]
		public System.Windows.Media.Brush ExecAvgColor { get; set; }
		[Browsable(false)]
		public string ExecAvgColorSerializable { get { return Serialize.BrushToString(ExecAvgColor); } set { ExecAvgColor = Serialize.StringToBrush(value); } }

		[Display(Name = "Show gamma levels", GroupName = "04. Gamma", Order = 0)]
		public bool ShowGamma { get; set; }

		[Display(Name = "Zones instead of lines", GroupName = "04. Gamma", Order = 1)]
		public bool GammaZones { get; set; }

		[Display(Name = "Zone height (ticks)", GroupName = "04. Gamma", Order = 2)]
		[Range(1, 200)]
		public int ZoneTicks { get; set; }

		[Display(Name = "Gamma flip", GroupName = "04. Gamma", Order = 3)]
		public bool ShowFlip { get; set; }

		[Display(Name = "Call and put walls", GroupName = "04. Gamma", Order = 4)]
		public bool ShowWalls { get; set; }

		[Display(Name = "Other big strikes", GroupName = "04. Gamma", Order = 5)]
		public bool ShowOtherLevels { get; set; }

		[Display(Name = "Level names", GroupName = "04. Gamma", Order = 6)]
		public LabelSide LabelSide { get; set; }

		[XmlIgnore]
		[Display(Name = "Call wall", GroupName = "04. Gamma", Order = 7)]
		public System.Windows.Media.Brush CallWallColor { get; set; }
		[Browsable(false)]
		public string CallWallColorSerializable { get { return Serialize.BrushToString(CallWallColor); } set { CallWallColor = Serialize.StringToBrush(value); } }

		[XmlIgnore]
		[Display(Name = "Put wall", GroupName = "04. Gamma", Order = 8)]
		public System.Windows.Media.Brush PutWallColor { get; set; }
		[Browsable(false)]
		public string PutWallColorSerializable { get { return Serialize.BrushToString(PutWallColor); } set { PutWallColor = Serialize.StringToBrush(value); } }

		[XmlIgnore]
		[Display(Name = "Gamma flip colour", GroupName = "04. Gamma", Order = 9)]
		public System.Windows.Media.Brush FlipColor { get; set; }
		[Browsable(false)]
		public string FlipColorSerializable { get { return Serialize.BrushToString(FlipColor); } set { FlipColor = Serialize.StringToBrush(value); } }

		[XmlIgnore]
		[Display(Name = "Positive strikes", GroupName = "04. Gamma", Order = 10)]
		public System.Windows.Media.Brush PosLevelColor { get; set; }
		[Browsable(false)]
		public string PosLevelColorSerializable { get { return Serialize.BrushToString(PosLevelColor); } set { PosLevelColor = Serialize.StringToBrush(value); } }

		[XmlIgnore]
		[Display(Name = "Negative strikes", GroupName = "04. Gamma", Order = 11)]
		public System.Windows.Media.Brush NegLevelColor { get; set; }
		[Browsable(false)]
		public string NegLevelColorSerializable { get { return Serialize.BrushToString(NegLevelColor); } set { NegLevelColor = Serialize.StringToBrush(value); } }

		[Display(Name = "Line width", GroupName = "04. Gamma", Order = 12)]
		[Range(1, 6)]
		public int LevelWidth { get; set; }

		[Display(Name = "Show the news feed (click the title to collapse)", GroupName = "05. News", Order = 0)]
		public bool ShowNews { get; set; }

		[Display(Name = "Placement", GroupName = "05. News", Order = 1)]
		public Corner NewsPlacement { get; set; }

		[Display(Name = "X offset", GroupName = "05. News", Order = 2)]
		[Range(-3000, 3000)]
		public int NewsX { get; set; }

		[Display(Name = "Y offset", GroupName = "05. News", Order = 3)]
		[Range(-3000, 3000)]
		public int NewsY { get; set; }

		[Display(Name = "Width", GroupName = "05. News", Order = 4)]
		[Range(200, 800)]
		public int NewsWidth { get; set; }

		[Display(Name = "Headlines", GroupName = "05. News", Order = 5)]
		[Range(1, 20)]
		public int NewsRows { get; set; }

		[Display(Name = "Only headlines at least this important (0-3)", GroupName = "05. News", Order = 6)]
		[Range(0, 3)]
		public int NewsMinImportance { get; set; }

		[Display(Name = "Pop-ups for new headlines", GroupName = "05. News", Order = 7)]
		public bool ShowPopups { get; set; }

		[Display(Name = "Pop-up placement", GroupName = "05. News", Order = 8)]
		public Corner PopupPlacement { get; set; }

		[Display(Name = "Pop-up X offset", GroupName = "05. News", Order = 9)]
		[Range(-3000, 3000)]
		public int PopupX { get; set; }

		[Display(Name = "Pop-up Y offset", GroupName = "05. News", Order = 10)]
		[Range(-3000, 3000)]
		public int PopupY { get; set; }

		[Display(Name = "Pop-up shows for (seconds)", GroupName = "05. News", Order = 11)]
		[Range(3, 120)]
		public int PopupSeconds { get; set; }

		[Display(Name = "Pop-ups only at least this important (0-3)", GroupName = "05. News", Order = 12)]
		[Range(0, 3)]
		public int PopupMinImportance { get; set; }

		[Display(Name = "Today's economic events on the time axis", GroupName = "05. News", Order = 13)]
		public bool ShowEventMarkers { get; set; }

		[Display(Name = "Events shown", GroupName = "05. News", Order = 14)]
		public EventLevel EventMinImpact { get; set; }

		[Display(Name = "Show the DOM heatmap", GroupName = "06. Heatmap", Order = 0)]
		public bool ShowHeatmap { get; set; }

		[Display(Name = "Draw behind the candles", GroupName = "06. Heatmap", Order = 1)]
		public bool HeatmapBehind { get; set; }

		[Display(Name = "Minimum size shown", GroupName = "06. Heatmap", Order = 2)]
		[Range(1, 100000)]
		public int HmThreshold { get; set; }

		[Display(Name = "New shade when size changes by (%)", GroupName = "06. Heatmap", Order = 3)]
		[Range(5, 500)]
		public int HmReshade { get; set; }

		[Display(Name = "Live levels reach the right edge", GroupName = "06. Heatmap", Order = 4)]
		public bool HmExtendLive { get; set; }

		[Display(Name = "Colour palette", GroupName = "06. Heatmap", Order = 5)]
		public Palette HmPalette { get; set; }

		[Display(Name = "Contrast", GroupName = "06. Heatmap", Order = 6)]
		[Range(0.3, 3)]
		public double HmContrast { get; set; }

		[Display(Name = "Opacity (%)", GroupName = "06. Heatmap", Order = 7)]
		[Range(10, 100)]
		public int HmOpacity { get; set; }

		[Display(Name = "Size tags on the biggest live levels", GroupName = "06. Heatmap", Order = 8)]
		public bool HmTags { get; set; }

		[Display(Name = "How many tags", GroupName = "06. Heatmap", Order = 9)]
		[Range(1, 50)]
		public int HmTagCount { get; set; }

		[Display(Name = "Restyle the candles", GroupName = "07. Candles", Order = 0)]
		public bool ShowCandles { get; set; }

		[XmlIgnore]
		[Display(Name = "Bullish body", GroupName = "07. Candles", Order = 1)]
		public System.Windows.Media.Brush CcBullColor { get; set; }
		[Browsable(false)]
		public string CcBullColorSerializable { get { return Serialize.BrushToString(CcBullColor); } set { CcBullColor = Serialize.StringToBrush(value); } }

		[XmlIgnore]
		[Display(Name = "Bearish body", GroupName = "07. Candles", Order = 2)]
		public System.Windows.Media.Brush CcBearColor { get; set; }
		[Browsable(false)]
		public string CcBearColorSerializable { get { return Serialize.BrushToString(CcBearColor); } set { CcBearColor = Serialize.StringToBrush(value); } }

		[XmlIgnore]
		[Display(Name = "Bullish wick / outline", GroupName = "07. Candles", Order = 3)]
		public System.Windows.Media.Brush CcBullWick { get; set; }
		[Browsable(false)]
		public string CcBullWickSerializable { get { return Serialize.BrushToString(CcBullWick); } set { CcBullWick = Serialize.StringToBrush(value); } }

		[XmlIgnore]
		[Display(Name = "Bearish wick / outline", GroupName = "07. Candles", Order = 4)]
		public System.Windows.Media.Brush CcBearWick { get; set; }
		[Browsable(false)]
		public string CcBearWickSerializable { get { return Serialize.BrushToString(CcBearWick); } set { CcBearWick = Serialize.StringToBrush(value); } }

		[XmlIgnore]
		[Display(Name = "Doji", GroupName = "07. Candles", Order = 5)]
		public System.Windows.Media.Brush CcDojiColor { get; set; }
		[Browsable(false)]
		public string CcDojiColorSerializable { get { return Serialize.BrushToString(CcDojiColor); } set { CcDojiColor = Serialize.StringToBrush(value); } }

		[Display(Name = "Body opacity (%)", GroupName = "07. Candles", Order = 6)]
		[Range(0, 100)]
		public int CcOpacity { get; set; }

		[Display(Name = "Trade entered", GroupName = "08. Alerts", Order = 0)]
		public bool AlertEntry { get; set; }

		[Display(Name = "Entry sound", GroupName = "08. Alerts", Order = 1)]
		public string EntrySound { get; set; }

		[Display(Name = "Every fill", GroupName = "08. Alerts", Order = 2)]
		public bool AlertFill { get; set; }

		[Display(Name = "Fill sound", GroupName = "08. Alerts", Order = 3)]
		public string FillSound { get; set; }

		[Display(Name = "Winning trade", GroupName = "08. Alerts", Order = 4)]
		public bool AlertWin { get; set; }

		[Display(Name = "Win sound", GroupName = "08. Alerts", Order = 5)]
		public string WinSound { get; set; }

		[Display(Name = "Losing trade", GroupName = "08. Alerts", Order = 6)]
		public bool AlertLoss { get; set; }

		[Display(Name = "Loss sound", GroupName = "08. Alerts", Order = 7)]
		public string LossSound { get; set; }

		[Display(Name = "Daily loss limit (warning and hit)", GroupName = "08. Alerts", Order = 8)]
		public bool AlertDll { get; set; }

		[Display(Name = "Loss limit sound", GroupName = "08. Alerts", Order = 9)]
		public string DllSound { get; set; }

		[Display(Name = "Warn at (% of the limit used)", GroupName = "08. Alerts", Order = 10)]
		[Range(10, 99)]
		public int DllWarnPercent { get; set; }

		[Display(Name = "Profit target hit", GroupName = "08. Alerts", Order = 11)]
		public bool AlertTarget { get; set; }

		[Display(Name = "Target sound", GroupName = "08. Alerts", Order = 12)]
		public string TargetSound { get; set; }

		[Display(Name = "Profit target ($, 0 = the account's target in RoninFlow)", GroupName = "08. Alerts", Order = 13)]
		[Range(0, 1000000)]
		public double ProfitTarget { get; set; }

		[Display(Name = "Limits count open P&L", GroupName = "08. Alerts", Order = 14)]
		public bool AlertIncludeOpen { get; set; }

		[XmlIgnore]
		[Display(Name = "Panel background", GroupName = "09. Look", Order = 0)]
		public System.Windows.Media.Brush BackColor { get; set; }
		[Browsable(false)]
		public string BackColorSerializable { get { return Serialize.BrushToString(BackColor); } set { BackColor = Serialize.StringToBrush(value); } }

		[XmlIgnore]
		[Display(Name = "Panel border", GroupName = "09. Look", Order = 1)]
		public System.Windows.Media.Brush BorderColor { get; set; }
		[Browsable(false)]
		public string BorderColorSerializable { get { return Serialize.BrushToString(BorderColor); } set { BorderColor = Serialize.StringToBrush(value); } }

		[XmlIgnore]
		[Display(Name = "Tiles", GroupName = "09. Look", Order = 2)]
		public System.Windows.Media.Brush TileColor { get; set; }
		[Browsable(false)]
		public string TileColorSerializable { get { return Serialize.BrushToString(TileColor); } set { TileColor = Serialize.StringToBrush(value); } }

		[XmlIgnore]
		[Display(Name = "Text", GroupName = "09. Look", Order = 3)]
		public System.Windows.Media.Brush TextColor { get; set; }
		[Browsable(false)]
		public string TextColorSerializable { get { return Serialize.BrushToString(TextColor); } set { TextColor = Serialize.StringToBrush(value); } }

		[XmlIgnore]
		[Display(Name = "Muted text", GroupName = "09. Look", Order = 4)]
		public System.Windows.Media.Brush MutedColor { get; set; }
		[Browsable(false)]
		public string MutedColorSerializable { get { return Serialize.BrushToString(MutedColor); } set { MutedColor = Serialize.StringToBrush(value); } }

		[XmlIgnore]
		[Display(Name = "Positive", GroupName = "09. Look", Order = 5)]
		public System.Windows.Media.Brush PositiveColor { get; set; }
		[Browsable(false)]
		public string PositiveColorSerializable { get { return Serialize.BrushToString(PositiveColor); } set { PositiveColor = Serialize.StringToBrush(value); } }

		[XmlIgnore]
		[Display(Name = "Negative", GroupName = "09. Look", Order = 6)]
		public System.Windows.Media.Brush NegativeColor { get; set; }
		[Browsable(false)]
		public string NegativeColorSerializable { get { return Serialize.BrushToString(NegativeColor); } set { NegativeColor = Serialize.StringToBrush(value); } }

		[XmlIgnore]
		[Display(Name = "Warning", GroupName = "09. Look", Order = 7)]
		public System.Windows.Media.Brush WarningColor { get; set; }
		[Browsable(false)]
		public string WarningColorSerializable { get { return Serialize.BrushToString(WarningColor); } set { WarningColor = Serialize.StringToBrush(value); } }

		[XmlIgnore]
		[Display(Name = "Accent", GroupName = "09. Look", Order = 8)]
		public System.Windows.Media.Brush AccentColor { get; set; }
		[Browsable(false)]
		public string AccentColorSerializable { get { return Serialize.BrushToString(AccentColor); } set { AccentColor = Serialize.StringToBrush(value); } }

		[Display(Name = "Panel opacity (%)", GroupName = "09. Look", Order = 9)]
		[Range(30, 100)]
		public int PanelOpacity { get; set; }
		#endregion

		private static System.Windows.Media.Brush Hex(string h)
		{
			var c = (System.Windows.Media.Color)ColorConverter.ConvertFromString(h);
			var b = new SolidColorBrush(c); b.Freeze(); return b;
		}

		protected override void OnStateChange()
		{
			if (State == State.SetDefaults)
			{
				Name = "RoninFlow Suite";
				Description = "RoninFlow on your chart: account panel, executions, gamma levels, news, heatmap, candles and alerts.";
				Calculate = Calculate.OnPriceChange;
				IsOverlay = true;
				DisplayInDataBox = false;
				DrawOnPricePanel = true;
				PaintPriceMarkers = false;
				IsSuspendedWhileInactive = false;
				ScaleJustification = ScaleJustification.Right;
				ServerUrl = "";
				Token = "";
				AccountName = "";
				RefreshSeconds = 3;
				FontSize = 11;
				ShowAccount = true;
				AccountPlacement = Corner.TopRight;
				AccountX = 12;
				AccountY = 12;
				AccountWidth = 320;
				ShowTierChip = true;
				ShowGammaChip = true;
				ShowPnlTiles = true;
				ShowBuffer = true;
				BufferClosedOnly = false;
				ShowStats = true;
				ShowGexLine = true;
				ShowAllPositions = true;
				ShowExecutions = true;
				ExecMarker = MarkerStyle.Triangles;
				ExecSize = 10;
				ExecBuyColor = Hex("#2BC48A");
				ExecSellColor = Hex("#E5484D");
				ExecShowQty = true;
				ExecConnect = true;
				ExecWinColor = Hex("#2BC48A");
				ExecLossColor = Hex("#E5484D");
				ExecLineWidth = 1;
				ExecLineStyle = LineKind.Dashed;
				ExecShowResult = true;
				ExecResultUnit = ResultUnit.Money;
				ExecShowAvg = true;
				ExecAvgColor = Hex("#E8B043");
				ShowGamma = true;
				GammaZones = false;
				ZoneTicks = 8;
				ShowFlip = true;
				ShowWalls = true;
				ShowOtherLevels = true;
				LabelSide = LabelSide.Right;
				CallWallColor = Hex("#2BC48A");
				PutWallColor = Hex("#E5484D");
				FlipColor = Hex("#E8B043");
				PosLevelColor = Hex("#2BC48A");
				NegLevelColor = Hex("#E5484D");
				LevelWidth = 1;
				ShowNews = true;
				NewsPlacement = Corner.TopLeft;
				NewsX = 12;
				NewsY = 12;
				NewsWidth = 360;
				NewsRows = 6;
				NewsMinImportance = 0;
				ShowPopups = true;
				PopupPlacement = Corner.BottomRight;
				PopupX = 12;
				PopupY = 40;
				PopupSeconds = 12;
				PopupMinImportance = 2;
				ShowEventMarkers = true;
				EventMinImpact = EventLevel.MediumAndHigh;
				ShowHeatmap = false;
				HeatmapBehind = true;
				HmThreshold = 15;
				HmReshade = 25;
				HmExtendLive = true;
				HmPalette = Palette.Bookmap;
				HmContrast = 1.2;
				HmOpacity = 100;
				HmTags = true;
				HmTagCount = 8;
				ShowCandles = false;
				CcBullColor = Hex("#26A69A");
				CcBearColor = Hex("#9C4DCC");
				CcBullWick = Hex("#26A69A");
				CcBearWick = Hex("#9C4DCC");
				CcDojiColor = Hex("#8B8B8F");
				CcOpacity = 100;
				AlertEntry = true;
				EntrySound = "Alert1.wav";
				AlertFill = false;
				FillSound = "Alert1.wav";
				AlertWin = true;
				WinSound = "Alert2.wav";
				AlertLoss = true;
				LossSound = "Alert3.wav";
				AlertDll = true;
				DllSound = "Alert4.wav";
				DllWarnPercent = 75;
				AlertTarget = true;
				TargetSound = "Alert2.wav";
				ProfitTarget = 0.0;
				AlertIncludeOpen = true;
				BackColor = Hex("#0E0E12");
				BorderColor = Hex("#26262E");
				TileColor = Hex("#16161C");
				TextColor = Hex("#E6E6EA");
				MutedColor = Hex("#8A8A96");
				PositiveColor = Hex("#2BC48A");
				NegativeColor = Hex("#E5484D");
				WarningColor = Hex("#E8B043");
				AccentColor = Hex("#8B5CF6");
				PanelOpacity = 94;
			}
			else if (State == State.DataLoaded)
			{
				LoadSettings();
				fetchTimer = new System.Threading.Timer(_ => Fetch(), null, 500, Math.Max(2, RefreshSeconds) * 1000);
				tickTimer = new System.Threading.Timer(_ => Tick(), null, 1000, 1000);
			}
			else if (State == State.Historical)
			{
				if (ShowHeatmap && HeatmapBehind && !ShowCandles) SetZOrder(-1); // under the bars
				if (ChartControl != null && !mouseHooked)
				{
					ChartControl.Dispatcher.InvokeAsync(() => { ChartControl.MouseLeftButtonDown += OnMouseDown; });
					mouseHooked = true;
				}
			}
			else if (State == State.Terminated)
			{
				if (fetchTimer != null) fetchTimer.Dispose();
				if (tickTimer != null) tickTimer.Dispose();
				if (account != null) { account.ExecutionUpdate -= OnExecution; account = null; }
				if (ChartControl != null && mouseHooked) ChartControl.Dispatcher.InvokeAsync(() => { ChartControl.MouseLeftButtonDown -= OnMouseDown; });
				DisposeResources();
			}
		}

		protected override void OnBarUpdate()
		{
			if (!ShowCandles || CurrentBar < 0) return;
			bool bull = Close[0] > Open[0], doji = Close[0] == Open[0];
			var body = doji ? CcDojiColor : bull ? CcBullColor : CcBearColor;
			BarBrush = WithOpacity(body, CcOpacity / 100.0);
			CandleOutlineBrush = doji ? CcDojiColor : bull ? CcBullWick : CcBearWick;
		}

		private static System.Windows.Media.Brush WithOpacity(System.Windows.Media.Brush b, double o)
		{
			var s = b as SolidColorBrush;
			if (s == null || o >= 0.999) return b;
			var c = s.Color; var nb = new SolidColorBrush(System.Windows.Media.Color.FromArgb((byte)Math.Round(c.A * Math.Max(0, Math.Min(1, o))), c.R, c.G, c.B)); nb.Freeze(); return nb;
		}

		// ======================================================================================== settings and data

		private void LoadSettings()
		{
			try
			{
				string file = Path.Combine(NinjaTrader.Core.Globals.UserDataDir, "journal-sync.txt");
				if (File.Exists(file))
					foreach (string raw in File.ReadAllLines(file))
					{
						string line = raw.Trim();
						if (line.Length == 0 || line.StartsWith("#")) continue;
						int i = line.IndexOf('=');
						if (i < 1) continue;
						string k = line.Substring(0, i).Trim().ToLowerInvariant(), v = line.Substring(i + 1).Trim();
						if (k == "url" && v.Length > 0) { int a = v.IndexOf("/api/", StringComparison.OrdinalIgnoreCase); baseUrl = (a > 0 ? v.Substring(0, a) : v).TrimEnd('/'); }
						else if (k == "token") token = v;
					}
			}
			catch { }
			if (!string.IsNullOrWhiteSpace(ServerUrl)) baseUrl = ServerUrl.Trim().TrimEnd('/');
			if (!string.IsNullOrWhiteSpace(Token)) token = Token.Trim();
		}

		private Account FindAccount()
		{
			if (!string.IsNullOrWhiteSpace(AccountName))
				lock (Account.All) return Account.All.FirstOrDefault(a => string.Equals(a.Name, AccountName.Trim(), StringComparison.OrdinalIgnoreCase));
			Account found = null;
			try
			{
				if (ChartControl != null)
					ChartControl.Dispatcher.Invoke(() =>
					{
						// the account picked in this chart's Chart Trader (read by name, so a NinjaTrader update can't break the build)
						var window = Window.GetWindow(ChartControl.Parent);
						var trader = window != null ? window.GetType().GetProperty("ChartTrader") : null;
						var ct = trader != null ? trader.GetValue(window) : null;
						var acc = ct != null ? ct.GetType().GetProperty("Account") : null;
						found = acc != null ? acc.GetValue(ct) as Account : null;
					});
			}
			catch { }
			if (found != null) return found;
			lock (Account.All) return Account.All.FirstOrDefault(a => a.Connection != null && a.Name != "Backtest" && a.Name != "Playback101") ?? Account.All.FirstOrDefault();
		}

		private void Fetch()
		{
			if (Interlocked.Exchange(ref fetching, 1) == 1) return;
			try
			{
				string symbol = Instrument != null ? Instrument.FullName : "";
				string acct = account != null ? account.Name : "";
				string url = baseUrl + "/api/suite?format=tsv&symbol=" + Uri.EscapeDataString(symbol) + "&account=" + Uri.EscapeDataString(acct);
				using (var wc = new WebClient())
				{
					wc.Encoding = Encoding.UTF8;
					if (token.Length > 0) wc.Headers[HttpRequestHeader.Authorization] = "Bearer " + token;
					var s = Parse(wc.DownloadString(url));
					OnNews(s);
					snap = s;
				}
			}
			catch (Exception e)
			{
				var old = snap;
				snap = old == null ? new Snap { Error = e.Message, Got = DateTime.UtcNow } : old;
				if (old != null) old.Error = e.Message;
			}
			finally { Interlocked.Exchange(ref fetching, 0); }
			Redraw();
		}

		private static double D(string s) { double v; return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out v) ? v : 0; }
		private static double? DN(string s) { double v; return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out v) ? (double?)v : null; }
		private static long L(string s) { long v; return long.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out v) ? v : 0; }

		private static Snap Parse(string text)
		{
			var s = new Snap { Got = DateTime.UtcNow };
			foreach (var raw in text.Split('\n'))
			{
				var c = raw.TrimEnd('\r').Split('\t');
				Func<int, string> at = i => i < c.Length ? c[i] : "";
				switch (at(0))
				{
					case "RF": s.At = L(at(2)); s.DayStart = L(at(3)); s.Market = at(4); s.MarketLabel = at(5); s.Enforcer = at(6) == "1"; break;
					case "A":
						s.Acct = new AcctInfo { Tier = at(1), Level = (int)L(at(2)), Of = (int)L(at(3)), Color = at(4), DailyLoss = D(at(5)), Trail = D(at(6)), Target = D(at(7)), MaxTrades = (int)L(at(8)),
							Enforced = at(9) == "1", Enforcing = at(10) == "1", Blocked = at(11) == "1", Paused = at(12) == "1", Manual = at(13) == "1", InWindow = at(14) != "0", Reason = at(15) };
						break;
					case "G": s.Gex = new GexInfo { Index = at(1), Zone = at(2), Total = D(at(3)), Flip = DN(at(4)), Call = DN(at(5)), Put = DN(at(6)), Spot = DN(at(7)), Delayed = at(8) == "1", Error = at(9) }; break;
					case "P": if (s.Gex != null) s.Gex.Pos.Add(D(at(1))); break;
					case "Q": if (s.Gex != null) s.Gex.Neg.Add(D(at(1))); break;
					case "E": s.Events.Add(new EventItem { T = L(at(1)), Impact = at(2), Ccy = at(3), Title = at(4), Actual = at(5), Forecast = at(6), Previous = at(7) }); break;
					case "N": s.News.Add(new NewsItem { Id = at(1), T = L(at(2)), Importance = (int)L(at(3)), Dir = (int)L(at(4)), Src = at(5), Title = at(6), Link = at(7), Summary = at(8) }); break;
				}
			}
			return s;
		}

		private void OnNews(Snap s)
		{
			lock (gate)
			{
				foreach (var n in s.News)
				{
					if (seenNews.Contains(n.Id)) continue;
					seenNews.Add(n.Id);
					if (newsPrimed && ShowPopups && n.Importance >= PopupMinImportance)
						popups.Insert(0, new KeyValuePair<NewsItem, DateTime>(n, DateTime.UtcNow.AddSeconds(PopupSeconds)));
				}
				newsPrimed = true;
				if (popups.Count > 3) popups.RemoveRange(3, popups.Count - 3);
			}
		}

		private void Redraw()
		{
			try { if (ChartControl != null) ChartControl.Dispatcher.InvokeAsync(() => { try { ChartControl.InvalidateVisual(); } catch { } }); } catch { }
		}

		// ======================================================================================== account, trades, alerts

		private DateTime DayStartLocal()
		{
			var s = snap;
			if (s != null && s.DayStart > 0)
				return TimeZoneInfo.ConvertTimeFromUtc(DateTimeOffset.FromUnixTimeMilliseconds(s.DayStart).UtcDateTime, NinjaTrader.Core.Globals.GeneralOptions.TimeZoneInfo);
			return NinjaTrader.Core.Globals.Now.Date;
		}

		private void Tick()
		{
			try
			{
				var a = account == null || ++accountTicks % 5 == 0 ? FindAccount() : account; // the Chart Trader account, checked every 5 s
				if (a != account)
				{
					if (account != null) account.ExecutionUpdate -= OnExecution;
					account = a;
					if (account != null) account.ExecutionUpdate += OnExecution;
					lastQty.Clear();
				}
				ComputeDay();
				RefreshPositions();
				CheckLimits();
				lock (gate) popups.RemoveAll(p => p.Value < DateTime.UtcNow);
			}
			catch { }
			Redraw();
		}

		/// <summary>Today's round trips on the chart's account, paired first in, first out per instrument.</summary>
		private void ComputeDay()
		{
			var a = account;
			if (a == null) return;
			var from = DayStartLocal();
			List<Execution> list;
			lock (a.Executions) list = a.Executions.Where(e => e != null && e.Instrument != null).OrderBy(e => e.Time).ToList();
			var all = new List<Trip>();
			foreach (var g in list.GroupBy(e => e.Instrument.FullName))
			{
				var open = new List<KeyValuePair<Execution, double>>(); // remaining quantity per entry, signed
				double pv = g.First().Instrument.MasterInstrument.PointValue;
				foreach (var e in g)
				{
					double q = e.MarketPosition == MarketPosition.Long ? e.Quantity : -e.Quantity;
					while (q != 0 && open.Count > 0 && Math.Sign(open[0].Value) != Math.Sign(q))
					{
						var head = open[0];
						double take = Math.Min(Math.Abs(head.Value), Math.Abs(q));
						bool lng = head.Value > 0;
						all.Add(new Trip { Open = head.Key.Time, Close = e.Time, OpenPrice = head.Key.Price, ClosePrice = e.Price, Qty = take, Long = lng, Complete = true,
							Pnl = (e.Price - head.Key.Price) * (lng ? 1 : -1) * take * pv - (head.Key.Commission + e.Commission) * take / Math.Max(1, e.Quantity) });
						double left = head.Value - Math.Sign(head.Value) * take;
						if (left == 0) open.RemoveAt(0); else open[0] = new KeyValuePair<Execution, double>(head.Key, left);
						q += Math.Sign(head.Value) * take;
					}
					if (q != 0) open.Add(new KeyValuePair<Execution, double>(e, q));
				}
				foreach (var o in open) all.Add(new Trip { Open = o.Key.Time, OpenPrice = o.Key.Price, Qty = Math.Abs(o.Value), Long = o.Value > 0 });
			}
			trips = all;
			double r = 0, peak = 0, gw = 0, gl = 0, bst = 0, wst = 0; int n = 0, w = 0, l = 0;
			foreach (var t in all.Where(t => t.Complete && t.Close >= from).OrderBy(t => t.Close))
			{
				r += t.Pnl; peak = Math.Max(peak, r); n++;
				if (t.Pnl > 0) { w++; gw += t.Pnl; } else if (t.Pnl < 0) { l++; gl += -t.Pnl; }
				bst = Math.Max(bst, t.Pnl); wst = Math.Min(wst, t.Pnl);
			}
			dayRealised = r; dayPeak = peak; dayTrades = n; dayWins = w; dayLosses = l; grossWin = gw; grossLoss = gl; best = bst; worst = wst;
		}

		private double OpenPnl()
		{
			var a = account;
			if (a == null) return 0;
			try { return a.Get(AccountItem.UnrealizedProfitLoss, Currency.UsDollar); } catch { return 0; }
		}

		private void RefreshPositions()
		{
			var rows = new List<PosRow>();
			lock (Account.All)
				foreach (var a in Account.All)
				{
					if (a.Name == "Backtest" || a.Name == "Playback101") continue;
					lock (a.Positions)
						foreach (var p in a.Positions)
						{
							if (p == null || p.MarketPosition == MarketPosition.Flat || p.Quantity == 0) continue;
							double last = p.Instrument.MarketData != null && p.Instrument.MarketData.Last != null ? p.Instrument.MarketData.Last.Price : p.AveragePrice;
							rows.Add(new PosRow { Account = a.Name, Code = p.Instrument.FullName, Qty = p.MarketPosition == MarketPosition.Long ? p.Quantity : -p.Quantity, Pnl = p.GetUnrealizedProfitLoss(PerformanceUnit.Currency, last) });
						}
				}
			positions = rows.OrderBy(r => r.Account).ThenBy(r => r.Code).ToList();
		}

		private string SoundPath(string s)
		{
			if (string.IsNullOrWhiteSpace(s)) return "";
			return Path.IsPathRooted(s) ? s : Path.Combine(NinjaTrader.Core.Globals.InstallDir, "sounds", s);
		}

		private void Ring(string id, string sound, string message, System.Windows.Media.Brush back)
		{
			try { Alert("RoninFlow" + id + DateTime.UtcNow.Ticks, Priority.High, "RoninFlow: " + message, SoundPath(sound), 0, back, Brushes.White); } catch { }
		}

		private void OnExecution(object sender, ExecutionEventArgs e)
		{
			try
			{
				if (e == null || e.Execution == null) return;
				var x = e.Execution;
				string key = x.Instrument != null ? x.Instrument.FullName : "";
				if (AlertFill) Ring("fill", FillSound, string.Format(CultureInfo.InvariantCulture, "fill {0} {1} {2} @ {3}", x.MarketPosition == MarketPosition.Long ? "BUY" : "SELL", x.Quantity, key, x.Price), AccentColor);
				// entry (flat → open) and the result when it goes flat again
				int before; lastQty.TryGetValue(key, out before);
				ComputeDay();
				int now = 0;
				var a = account;
				if (a != null) lock (a.Positions) { var p = a.Positions.FirstOrDefault(pp => pp.Instrument.FullName == key); if (p != null) now = p.MarketPosition == MarketPosition.Long ? p.Quantity : p.MarketPosition == MarketPosition.Short ? -p.Quantity : 0; }
				lastQty[key] = now;
				if (before == 0 && now != 0 && AlertEntry) Ring("entry", EntrySound, string.Format(CultureInfo.InvariantCulture, "entered {0} {1} {2} @ {3}", now > 0 ? "LONG" : "SHORT", Math.Abs(now), key, x.Price), AccentColor);
				if (before != 0 && now == 0)
				{
					var t = trips.Where(tt => tt.Complete).OrderByDescending(tt => tt.Close).FirstOrDefault();
					double pnl = trips.Where(tt => tt.Complete && t != null && tt.Close == t.Close).Sum(tt => tt.Pnl);
					if (pnl > 0 && AlertWin) Ring("win", WinSound, "win " + Money(pnl, true) + " · day " + Money(dayRealised, true), PositiveColor);
					else if (pnl < 0 && AlertLoss) Ring("loss", LossSound, "loss " + Money(pnl, true) + " · day " + Money(dayRealised, true), NegativeColor);
				}
				CheckLimits();
			}
			catch { }
			Redraw();
		}

		private double TargetValue() { var s = snap; return ProfitTarget > 0 ? ProfitTarget : s != null && s.Acct != null ? s.Acct.Target : 0; }

		private void CheckLimits()
		{
			var s = snap;
			var day = DayStartLocal();
			if (day != alertDay) { alertDay = day; dllWarned = dllHit = targetHit = false; }
			double now = dayRealised + (AlertIncludeOpen ? OpenPnl() : 0);
			double dll = s != null && s.Acct != null ? s.Acct.DailyLoss : 0;
			if (AlertDll && dll > 0)
			{
				if (!dllHit && now <= -dll) { dllHit = true; Ring("dll", DllSound, "daily loss limit hit: " + Money(now, true), NegativeColor); }
				else if (!dllWarned && !dllHit && now <= -dll * DllWarnPercent / 100.0) { dllWarned = true; Ring("dllwarn", DllSound, DllWarnPercent + "% of the daily loss limit used: " + Money(now, true), WarningColor); }
			}
			double target = TargetValue();
			if (AlertTarget && target > 0 && !targetHit && now >= target) { targetHit = true; Ring("target", TargetSound, "profit target hit: " + Money(now, true), PositiveColor); }
		}

		// ======================================================================================== heatmap

		protected override void OnMarketDepth(MarketDepthEventArgs e)
		{
			if (!ShowHeatmap || e == null) return;
			int bar = Math.Max(0, CurrentBars[0]);
			lock (hmLock)
			{
				HmNode node;
				bool remove = e.Operation == Operation.Remove || e.Volume < HmThreshold;
				if (remove)
				{
					if (hmLive.TryGetValue(e.Price, out node)) { node.End = bar; node.Active = false; hmLive.Remove(e.Price); }
				}
				else if (hmLive.TryGetValue(e.Price, out node))
				{
					node.End = bar;
					double change = node.Volume > 0 ? Math.Abs(e.Volume - node.Volume) / node.Volume * 100 : 100;
					if (change >= HmReshade && bar > node.Start) { node.Active = false; HmStart(e.Price, e.Volume, bar); }
					else node.Volume = e.Volume;
				}
				else HmStart(e.Price, e.Volume, bar);
				if (hmNodes.Count > 6000) hmNodes.RemoveAll(n => !n.Active && n.End < bar - 2000);
			}
			if ((DateTime.UtcNow - hmRedraw).TotalMilliseconds > 80) { hmRedraw = DateTime.UtcNow; Redraw(); }
		}

		private void HmStart(double price, double vol, int bar)
		{
			var n = new HmNode { Start = bar, End = bar, Price = price, Volume = vol, Active = true };
			hmLive[price] = n; hmNodes.Add(n);
		}

		private static System.Windows.Media.Color[] PaletteStops(Palette p)
		{
			Func<byte, byte, byte, System.Windows.Media.Color> c = (r, g, b) => System.Windows.Media.Color.FromRgb(r, g, b);
			switch (p)
			{
				case Palette.Thermal: return new[] { c(20, 0, 40), c(90, 10, 120), c(180, 20, 110), c(240, 70, 40), c(255, 160, 20), c(255, 230, 90), c(255, 255, 235) };
				case Palette.Ocean: return new[] { c(5, 15, 40), c(10, 60, 120), c(0, 130, 190), c(40, 200, 220), c(170, 240, 245), c(255, 255, 255) };
				case Palette.Mono: return new[] { c(25, 25, 30), c(90, 90, 100), c(170, 170, 180), c(255, 255, 255) };
				default: return new[] { c(10, 20, 70), c(0, 90, 200), c(0, 190, 230), c(40, 210, 110), c(240, 230, 40), c(255, 140, 0), c(235, 30, 30), c(255, 245, 230) };
			}
		}

		private static System.Windows.Media.Color Ramp(System.Windows.Media.Color[] stops, double t)
		{
			t = Math.Max(0, Math.Min(1, t));
			double pos = t * (stops.Length - 1); int k = Math.Min(stops.Length - 2, (int)Math.Floor(pos)); double f = pos - k;
			var a = stops[k]; var b = stops[k + 1];
			return System.Windows.Media.Color.FromRgb((byte)(a.R + (b.R - a.R) * f), (byte)(a.G + (b.G - a.G) * f), (byte)(a.B + (b.B - a.B) * f));
		}

		// ======================================================================================== drawing helpers

		private void DisposeResources()
		{
			foreach (var b in brushes.Values) b.Dispose();
			brushes.Clear();
			if (fNormal != null) { fNormal.Dispose(); fSmall.Dispose(); fBold.Dispose(); fBig.Dispose(); fNormal = null; }
		}

		public override void OnRenderTargetChanged() { DisposeResources(); }

		private D2D.SolidColorBrush B(System.Windows.Media.Color c, int alpha = -1)
		{
			byte a = alpha < 0 ? c.A : (byte)Math.Max(0, Math.Min(255, alpha * c.A / 255));
			uint key = ((uint)a << 24) | ((uint)c.R << 16) | ((uint)c.G << 8) | c.B;
			D2D.SolidColorBrush b;
			if (!brushes.TryGetValue(key, out b)) { b = new D2D.SolidColorBrush(RenderTarget, new DX.Color4(c.R / 255f, c.G / 255f, c.B / 255f, a / 255f)); brushes[key] = b; }
			return b;
		}
		private D2D.SolidColorBrush B(System.Windows.Media.Brush br, int alpha = -1) { var s = br as SolidColorBrush; return B(s != null ? s.Color : Colors.Gray, alpha); }
		private static System.Windows.Media.Color C(System.Windows.Media.Brush br) { var s = br as SolidColorBrush; return s != null ? s.Color : Colors.Gray; }

		private void Fonts()
		{
			if (fNormal != null && fontKey == FontSize) return;
			if (fNormal != null) { fNormal.Dispose(); fSmall.Dispose(); fBold.Dispose(); fBig.Dispose(); }
			fontKey = FontSize;
			var f = NinjaTrader.Core.Globals.DirectWriteFactory;
			fNormal = new DW.TextFormat(f, "Segoe UI", DW.FontWeight.Normal, DW.FontStyle.Normal, FontSize * 96f / 72f);
			fSmall = new DW.TextFormat(f, "Segoe UI", DW.FontWeight.Normal, DW.FontStyle.Normal, (FontSize - 1.5f) * 96f / 72f);
			fBold = new DW.TextFormat(f, "Segoe UI", DW.FontWeight.SemiBold, DW.FontStyle.Normal, FontSize * 96f / 72f);
			fBig = new DW.TextFormat(f, "Segoe UI", DW.FontWeight.SemiBold, DW.FontStyle.Normal, (FontSize + 3) * 96f / 72f);
			foreach (var x in new[] { fNormal, fSmall, fBold, fBig }) { x.WordWrapping = DW.WordWrapping.NoWrap; }
		}

		private DX.Size2F Measure(string s, DW.TextFormat f)
		{
			using (var l = new DW.TextLayout(NinjaTrader.Core.Globals.DirectWriteFactory, s ?? "", f, 4000, 400)) return new DX.Size2F(l.Metrics.WidthIncludingTrailingWhitespace, l.Metrics.Height);
		}
		private float Text(string s, DW.TextFormat f, System.Windows.Media.Color c, float x, float y, int alpha = -1)
		{
			using (var l = new DW.TextLayout(NinjaTrader.Core.Globals.DirectWriteFactory, s ?? "", f, 4000, 400))
			{
				RenderTarget.DrawTextLayout(new DX.Vector2(x, y), l, B(c, alpha), D2D.DrawTextOptions.NoSnap);
				return l.Metrics.WidthIncludingTrailingWhitespace;
			}
		}
		private string Fit(string s, DW.TextFormat f, float w)
		{
			if (Measure(s, f).Width <= w) return s;
			while (s.Length > 1 && Measure(s + "…", f).Width > w) s = s.Substring(0, s.Length - 1);
			return s + "…";
		}
		private List<string> Wrap(string s, DW.TextFormat f, float w, int max)
		{
			var lines = new List<string>(); var cur = "";
			foreach (var word in (s ?? "").Split(' '))
			{
				var next = cur.Length == 0 ? word : cur + " " + word;
				if (Measure(next, f).Width <= w || cur.Length == 0) cur = next;
				else { lines.Add(cur); cur = word; if (lines.Count == max) break; }
			}
			if (lines.Count < max && cur.Length > 0) lines.Add(cur);
			if (lines.Count == max && cur.Length > 0 && !lines.Contains(cur)) lines[max - 1] = Fit(lines[max - 1] + " " + cur, f, w);
			return lines;
		}
		private void Round(DX.RectangleF r, System.Windows.Media.Color fill, int fillAlpha, System.Windows.Media.Color? border, float radius = 5)
		{
			var rr = new D2D.RoundedRectangle { Rect = r, RadiusX = radius, RadiusY = radius };
			RenderTarget.FillRoundedRectangle(rr, B(fill, fillAlpha));
			if (border.HasValue) RenderTarget.DrawRoundedRectangle(rr, B(border.Value), 1);
		}
		private float Chip(string text, System.Windows.Media.Color c, float x, float y, float h)
		{
			float w = Measure(text, fSmall).Width + 14;
			Round(new DX.RectangleF(x, y, w, h), c, 40, System.Windows.Media.Color.FromArgb(150, c.R, c.G, c.B), h / 2);
			Text(text, fSmall, c, x + 7, y + (h - Measure("Ag", fSmall).Height) / 2);
			return w;
		}
		private DX.Vector2 Place(Corner corner, float w, float h, int dx, int dy)
		{
			float lft = ChartPanel.X, tp = ChartPanel.Y, rgt = ChartPanel.X + ChartPanel.W, btm = ChartPanel.Y + ChartPanel.H;
			switch (corner)
			{
				case Corner.TopLeft: return new DX.Vector2(lft + dx, tp + dy);
				case Corner.TopRight: return new DX.Vector2(rgt - w - dx, tp + dy);
				case Corner.BottomLeft: return new DX.Vector2(lft + dx, btm - h - dy);
				case Corner.BottomRight: return new DX.Vector2(rgt - w - dx, btm - h - dy);
				case Corner.TopMiddle: return new DX.Vector2(lft + (rgt - lft - w) / 2 + dx, tp + dy);
				default: return new DX.Vector2(lft + (rgt - lft - w) / 2 + dx, btm - h - dy);
			}
		}
		private static string Money(double v, bool sign = false)
		{
			string s = Math.Abs(v).ToString("N2", CultureInfo.InvariantCulture);
			return (v < 0 ? "-$" : sign && v > 0 ? "+$" : "$") + s;
		}
		private static string Num(double v, bool sign = false) { return (sign && v > 0 ? "+" : "") + v.ToString("0.00", CultureInfo.InvariantCulture); }
		private static string Mask(string id) { return id.Length > 9 ? id.Substring(0, 4) + "•••" + id.Substring(id.Length - 3) : id; }
		private static System.Windows.Media.Color Parse(string hex, System.Windows.Media.Color fallback)
		{
			try { return (System.Windows.Media.Color)ColorConverter.ConvertFromString(hex.StartsWith("#") ? hex : "#" + hex); } catch { return fallback; }
		}

		// ======================================================================================== rendering

		protected override void OnRender(ChartControl chartControl, ChartScale chartScale)
		{
			if (RenderTarget == null || ChartBars == null) return;
			Fonts();
			var oldAA = RenderTarget.AntialiasMode;
			newsRows.Clear(); buttons.Clear();
			try
			{
				var s = snap;
				if (ShowHeatmap) try { DrawHeatmap(chartControl, chartScale); } catch { }
				if (ShowGamma && s != null && s.Gex != null && s.Gex.Error.Length == 0) try { DrawGamma(chartScale, s.Gex); } catch { }
				if (ShowExecutions) try { DrawExecutions(chartControl, chartScale); } catch { }
				if (ShowEventMarkers && s != null) try { DrawEvents(chartControl, s); } catch { }
				RenderTarget.AntialiasMode = D2D.AntialiasMode.PerPrimitive;
				float accountBottom = 0;
				if (ShowAccount) try { accountBottom = DrawAccount(s); } catch { }
				if (ShowAllPositions && positions.Count > 0) try { DrawPositions(accountBottom); } catch { }
				if (ShowNews && s != null) try { DrawNews(s); } catch { }
				if (ShowPopups) try { DrawPopups(); } catch { }
				if (detail != null) try { DrawDetail(detail); } catch { } else detailRect = Rect.Empty;
			}
			finally { RenderTarget.AntialiasMode = oldAA; }
		}

		private void DrawGamma(ChartScale scale, GexInfo g)
		{
			float lft = ChartPanel.X, rgt = ChartPanel.X + ChartPanel.W;
			double tick = Instrument.MasterInstrument.TickSize;
			var levels = new List<Tuple<double, string, System.Windows.Media.Color>>();
			if (ShowWalls && g.Call.HasValue) levels.Add(Tuple.Create(g.Call.Value, "Call wall", C(CallWallColor)));
			if (ShowWalls && g.Put.HasValue) levels.Add(Tuple.Create(g.Put.Value, "Put wall", C(PutWallColor)));
			if (ShowFlip && g.Flip.HasValue) levels.Add(Tuple.Create(g.Flip.Value, "Gamma flip", C(FlipColor)));
			if (ShowOtherLevels)
			{
				foreach (var p in g.Pos) levels.Add(Tuple.Create(p, "+γ", C(PosLevelColor)));
				foreach (var p in g.Neg) levels.Add(Tuple.Create(p, "−γ", C(NegLevelColor)));
			}
			foreach (var lv in levels)
			{
				float y = scale.GetYByValue(lv.Item1);
				if (y < ChartPanel.Y - 40 || y > ChartPanel.Y + ChartPanel.H + 40) continue;
				bool major = lv.Item2.Length > 2;
				if (GammaZones)
				{
					float h = Math.Max(2, Math.Abs(scale.GetYByValue(lv.Item1 + tick * ZoneTicks / 2.0) - scale.GetYByValue(lv.Item1 - tick * ZoneTicks / 2.0)));
					RenderTarget.FillRectangle(new DX.RectangleF(lft, y - h / 2, rgt - lft, h), B(lv.Item3, major ? 45 : 25));
				}
				else
				{
					using (var style = new D2D.StrokeStyle(NinjaTrader.Core.Globals.D2DFactory, new D2D.StrokeStyleProperties { DashStyle = major ? D2D.DashStyle.Solid : D2D.DashStyle.Dash }))
						RenderTarget.DrawLine(new DX.Vector2(lft, y), new DX.Vector2(rgt, y), B(lv.Item3, major ? 220 : 140), LevelWidth, style);
				}
				string label = lv.Item2 + " " + lv.Item1.ToString("0.##", CultureInfo.InvariantCulture);
				float w = Measure(label, fSmall).Width + 10, h2 = Measure("Ag", fSmall).Height + 4;
				float x = LabelSide == RoninFlowSuiteTypes.LabelSide.Left ? lft + 6 : LabelSide == RoninFlowSuiteTypes.LabelSide.Middle ? lft + (rgt - lft - w) / 2 : rgt - w - 70;
				Round(new DX.RectangleF(x, y - h2 / 2, w, h2), C(BackColor), 220, System.Windows.Media.Color.FromArgb(160, lv.Item3.R, lv.Item3.G, lv.Item3.B), 3);
				Text(label, fSmall, lv.Item3, x + 5, y - h2 / 2 + 2);
			}
		}

		private int BarOf(DateTime t)
		{
			if (Bars == null || Bars.Count == 0) return -1;
			if (t < Bars.GetTime(0)) return -1;
			return Bars.GetBar(t);
		}

		private void DrawExecutions(ChartControl cc, ChartScale scale)
		{
			var a = account;
			if (a == null) return;
			string key = Instrument.FullName;
			using (var dash = new D2D.StrokeStyle(NinjaTrader.Core.Globals.D2DFactory, new D2D.StrokeStyleProperties { DashStyle = ExecLineStyle == LineKind.Solid ? D2D.DashStyle.Solid : ExecLineStyle == LineKind.Dotted ? D2D.DashStyle.Dot : D2D.DashStyle.Dash }))
			{
				RenderTarget.AntialiasMode = D2D.AntialiasMode.PerPrimitive;
				var used = new List<DX.RectangleF>();
				foreach (var t in ExecTrips(a, key))
				{
					int b1 = BarOf(t.Open);
					if (b1 < 0) continue;
					float x1 = cc.GetXByBarIndex(ChartBars, b1), y1 = scale.GetYByValue(t.OpenPrice);
					if (t.Complete)
					{
						int b2 = BarOf(t.Close);
						float x2 = cc.GetXByBarIndex(ChartBars, b2), y2 = scale.GetYByValue(t.ClosePrice);
						if (ExecConnect) RenderTarget.DrawLine(new DX.Vector2(x1, y1), new DX.Vector2(x2, y2), B(t.Pnl >= 0 ? ExecWinColor : ExecLossColor), ExecLineWidth, dash);
						Marker(x1, y1, t.Long, t.Qty);
						Marker(x2, y2, !t.Long, t.Qty);
						if (ExecShowResult) Result(t, x2, y2, used);
					}
					else Marker(x1, y1, t.Long, t.Qty);
				}
				if (ExecShowAvg)
				{
					Position p = null;
					lock (a.Positions) p = a.Positions.FirstOrDefault(pp => pp.Instrument.FullName == key && pp.MarketPosition != MarketPosition.Flat);
					if (p != null)
					{
						float y = scale.GetYByValue(p.AveragePrice);
						RenderTarget.DrawLine(new DX.Vector2(ChartPanel.X, y), new DX.Vector2(ChartPanel.X + ChartPanel.W, y), B(ExecAvgColor), 1, dash);
						string label = (p.MarketPosition == MarketPosition.Long ? "LONG " : "SHORT ") + p.Quantity + " avg " + p.AveragePrice.ToString("0.00##", CultureInfo.InvariantCulture);
						float w = Measure(label, fSmall).Width + 10, h = Measure("Ag", fSmall).Height + 4, x = ChartPanel.X + ChartPanel.W - w - 90;
						Round(new DX.RectangleF(x, y - h / 2, w, h), C(BackColor), 235, C(ExecAvgColor), 3);
						Text(label, fSmall, C(ExecAvgColor), x + 5, y - h / 2 + 2);
					}
				}
			}
		}

		/// <summary>Round trips for one instrument (all of the account's sessions NinjaTrader still holds, not just today).</summary>
		private IEnumerable<Trip> ExecTrips(Account a, string key)
		{
			List<Execution> list;
			lock (a.Executions) list = a.Executions.Where(e => e != null && e.Instrument != null && e.Instrument.FullName == key).OrderBy(e => e.Time).ToList();
			var open = new List<KeyValuePair<Execution, double>>();
			double pv = Instrument.MasterInstrument.PointValue;
			var res = new List<Trip>();
			foreach (var e in list)
			{
				double q = e.MarketPosition == MarketPosition.Long ? e.Quantity : -e.Quantity;
				while (q != 0 && open.Count > 0 && Math.Sign(open[0].Value) != Math.Sign(q))
				{
					var head = open[0]; double take = Math.Min(Math.Abs(head.Value), Math.Abs(q)); bool lng = head.Value > 0;
					res.Add(new Trip { Open = head.Key.Time, Close = e.Time, OpenPrice = head.Key.Price, ClosePrice = e.Price, Qty = take, Long = lng, Complete = true, Pnl = (e.Price - head.Key.Price) * (lng ? 1 : -1) * take * pv });
					double left = head.Value - Math.Sign(head.Value) * take;
					if (left == 0) open.RemoveAt(0); else open[0] = new KeyValuePair<Execution, double>(head.Key, left);
					q += Math.Sign(head.Value) * take;
				}
				if (q != 0) open.Add(new KeyValuePair<Execution, double>(e, q));
			}
			foreach (var o in open) res.Add(new Trip { Open = o.Key.Time, OpenPrice = o.Key.Price, Qty = Math.Abs(o.Value), Long = o.Value > 0 });
			return res;
		}

		private void Marker(float x, float y, bool buy, double qty)
		{
			var c = C(buy ? ExecBuyColor : ExecSellColor);
			float s = ExecSize, h = Math.Max(3, s * 0.9f), half = Math.Max(2, s / 2);
			float d = buy ? 1 : -1, labelY;
			if (ExecMarker == MarkerStyle.Circles)
			{
				RenderTarget.FillEllipse(new D2D.Ellipse(new DX.Vector2(x, y), half, half), B(c));
				RenderTarget.DrawEllipse(new D2D.Ellipse(new DX.Vector2(x, y), half, half), B(Colors.Black, 200), 1);
				labelY = buy ? y + half + 1 : y - half - 1;
			}
			else
			{
				if (ExecMarker == MarkerStyle.Arrows)
				{
					float sw = Math.Max(2, half / 2);
					RenderTarget.FillRectangle(new DX.RectangleF(x - sw / 2, buy ? y + h : y - 2 * h, sw, h), B(c));
				}
				using (var geo = new D2D.PathGeometry(NinjaTrader.Core.Globals.D2DFactory))
				{
					using (var sink = geo.Open())
					{
						sink.BeginFigure(new DX.Vector2(x, y), D2D.FigureBegin.Filled);
						sink.AddLine(new DX.Vector2(x - half, y + d * h));
						sink.AddLine(new DX.Vector2(x + half, y + d * h));
						sink.EndFigure(D2D.FigureEnd.Closed);
						sink.Close();
					}
					RenderTarget.FillGeometry(geo, B(c));
					RenderTarget.DrawGeometry(geo, B(Colors.Black, 200), 1);
				}
				labelY = buy ? y + h * (ExecMarker == MarkerStyle.Arrows ? 2 : 1) + 1 : y - h * (ExecMarker == MarkerStyle.Arrows ? 2 : 1) - 1;
			}
			if (ExecShowQty && qty > 0)
			{
				string t = qty.ToString("0.##", CultureInfo.InvariantCulture);
				var m = Measure(t, fSmall);
				Text(t, fSmall, c, x - m.Width / 2, buy ? labelY : labelY - m.Height);
			}
		}

		private void Result(Trip t, float x, float y, List<DX.RectangleF> used)
		{
			double tick = Instrument.MasterInstrument.TickSize, move = (t.ClosePrice - t.OpenPrice) * (t.Long ? 1 : -1);
			string text = ExecResultUnit == ResultUnit.Ticks && tick > 0 ? (move >= 0 ? "+" : "") + (move / tick).ToString("0.#", CultureInfo.InvariantCulture) + "t"
				: ExecResultUnit == ResultUnit.Points ? (move >= 0 ? "+" : "") + move.ToString("0.##", CultureInfo.InvariantCulture) + " pts" : Money(t.Pnl, true);
			bool good = ExecResultUnit == ResultUnit.Money ? t.Pnl >= 0 : move >= 0;
			var c = C(good ? ExecWinColor : ExecLossColor);
			var m = Measure(text, fSmall);
			float w = m.Width + 10, h = m.Height + 4, gap = ExecSize + 4;
			bool exitBuy = !t.Long;
			var box = new DX.RectangleF(x + gap / 2, exitBuy ? y + gap : y - gap - h, w, h);
			for (int k = 0; k < 4 && used.Any(u => u.Intersects(box)); k++) box.Y += exitBuy ? h + 2 : -(h + 2);
			used.Add(box);
			Round(box, C(BackColor), 235, System.Windows.Media.Color.FromArgb(200, c.R, c.G, c.B), 3);
			Text(text, fSmall, c, box.X + 5, box.Y + 2);
		}

		private void DrawHeatmap(ChartControl cc, ChartScale scale)
		{
			var stops = PaletteStops(HmPalette);
			float barW = (float)cc.Properties.BarDistance;
			var vis = new List<Tuple<HmNode, float, float, float>>();
			List<double> recent;
			lock (hmLock)
			{
				if (hmNodes.Count == 0) return;
				recent = hmNodes.Skip(Math.Max(0, hmNodes.Count - 3000)).Select(n => n.Volume).ToList();
				foreach (var n in hmNodes)
				{
					if (n.Start > ChartBars.ToIndex || (!n.Active && n.End < ChartBars.FromIndex)) continue;
					float x1 = cc.GetXByBarIndex(ChartBars, Math.Max(n.Start, ChartBars.FromIndex)) - barW / 2;
					float x2 = n.Active && HmExtendLive ? ChartPanel.X + ChartPanel.W : cc.GetXByBarIndex(ChartBars, Math.Min(n.End, ChartBars.ToIndex)) + barW / 2;
					float y = scale.GetYByValue(n.Price);
					if (y < ChartPanel.Y - 30 || y > ChartPanel.Y + ChartPanel.H + 30) continue;
					vis.Add(Tuple.Create(n, x1, Math.Max(x2, x1 + 2), y));
				}
			}
			if (vis.Count == 0) return;
			recent.Sort();
			double top = recent[Math.Max(0, Math.Min(recent.Count - 1, (int)Math.Round((recent.Count - 1) * 0.99)))];
			double lo = Math.Log10(1 + HmThreshold), hi = Math.Max(Math.Log10(1 + top), lo + 0.3);
			Func<double, double> heat = v => Math.Pow(Math.Max(0, Math.Min(1, (Math.Log10(1 + v) - lo) / (hi - lo))), HmContrast);
			double tick = Instrument.MasterInstrument.TickSize;
			float rowH = Math.Max(1, Math.Abs(scale.GetYByValue(vis[0].Item1.Price) - scale.GetYByValue(vis[0].Item1.Price + tick)));
			RenderTarget.AntialiasMode = D2D.AntialiasMode.Aliased;
			foreach (var v in vis.OrderBy(v => v.Item1.Volume))
			{
				double t = heat(v.Item1.Volume);
				var c = Ramp(stops, t);
				int a = (int)Math.Round(255 * (0.10 + 0.90 * Math.Pow(t, 1.35)) * HmOpacity / 100.0);
				float w = v.Item3 - v.Item2, halo = rowH + Math.Max(3, rowH) * (float)(0.6 + 0.8 * t);
				RenderTarget.FillRectangle(new DX.RectangleF(v.Item2, v.Item4 - halo, w, halo * 2), B(c, a / 5));
				RenderTarget.FillRectangle(new DX.RectangleF(v.Item2, v.Item4 - halo / 2, w, halo), B(c, a / 3));
				RenderTarget.FillRectangle(new DX.RectangleF(v.Item2, v.Item4 - rowH / 2, w, Math.Max(1, rowH)), B(c, a));
				if (t > 0.35) RenderTarget.FillRectangle(new DX.RectangleF(v.Item2, v.Item4 - Math.Max(1, rowH * 0.2f), w, Math.Max(1, rowH * 0.4f)), B(Colors.White, (int)(a * Math.Min(0.6, (t - 0.35) * 0.9))));
			}
			if (HmTags)
			{
				var used = new List<DX.RectangleF>();
				foreach (var v in vis.Where(v => v.Item1.Active).OrderByDescending(v => v.Item1.Volume))
				{
					if (used.Count >= HmTagCount) break;
					string text = v.Item1.Volume.ToString("N0", CultureInfo.InvariantCulture);
					var m = Measure(text, fSmall);
					var r = new DX.RectangleF(ChartPanel.X + ChartPanel.W - m.Width - 18, v.Item4 - m.Height / 2 - 2, m.Width + 10, m.Height + 4);
					if (used.Any(u => u.Intersects(r))) continue;
					used.Add(r);
					var c = Ramp(stops, heat(v.Item1.Volume));
					RenderTarget.FillRectangle(r, B(Colors.Black, 215));
					RenderTarget.FillRectangle(new DX.RectangleF(r.X, r.Y + 2, 2, r.Height - 4), B(c));
					Text(text, fSmall, Colors.White, r.X + 6, r.Y + 2);
				}
			}
		}

		private void DrawEvents(ChartControl cc, Snap s)
		{
			var zone = NinjaTrader.Core.Globals.GeneralOptions.TimeZoneInfo;
			float bottom = ChartPanel.Y + ChartPanel.H;
			double step = cc.Properties.BarDistance;
			int last = ChartBars.Count - 1;
			DateTime lastTime = Bars.GetTime(last);
			double span = last > 0 ? Math.Max(1, (Bars.GetTime(last) - Bars.GetTime(Math.Max(0, last - 1))).TotalSeconds) : 60;
			foreach (var e in s.Events)
			{
				if (EventMinImpact == EventLevel.HighOnly && e.Impact != "high") continue;
				if (EventMinImpact == EventLevel.MediumAndHigh && e.Impact == "low") continue;
				var t = TimeZoneInfo.ConvertTimeFromUtc(DateTimeOffset.FromUnixTimeMilliseconds(e.T).UtcDateTime, zone);
				float x;
				if (t > lastTime) x = (float)(cc.GetXByBarIndex(ChartBars, last) + (t - lastTime).TotalSeconds / span * step);
				else { int b = BarOf(t); if (b < ChartBars.FromIndex) continue; x = cc.GetXByBarIndex(ChartBars, b); }
				if (x < ChartPanel.X || x > ChartPanel.X + ChartPanel.W) continue;
				var c = e.Impact == "high" ? C(NegativeColor) : e.Impact == "medium" ? C(WarningColor) : C(MutedColor);
				using (var dash = new D2D.StrokeStyle(NinjaTrader.Core.Globals.D2DFactory, new D2D.StrokeStyleProperties { DashStyle = D2D.DashStyle.Dot }))
					RenderTarget.DrawLine(new DX.Vector2(x, ChartPanel.Y), new DX.Vector2(x, bottom - 18), B(c, 90), 1, dash);
				string tag = e.Impact == "high" ? "HIGH" : e.Impact == "medium" ? "MED" : "LOW";
				var m = Measure(tag, fSmall);
				var r = new DX.RectangleF(x - m.Width / 2 - 5, bottom - m.Height - 6, m.Width + 10, m.Height + 4);
				Round(r, c, 60, c, 3);
				Text(tag, fSmall, Colors.White, r.X + 5, r.Y + 2);
			}
		}

		private void Box(DX.RectangleF r) { Round(r, C(BackColor), (int)(255 * PanelOpacity / 100.0), C(BorderColor), 6); }

		private float DrawAccount(Snap s)
		{
			var acct = s != null ? s.Acct : null;
			float w = AccountWidth, pad = 10;
			float lh = Measure("Ag", fNormal).Height, sh = Measure("Ag", fSmall).Height, bh = Measure("Ag", fBig).Height;
			float chipH = sh + 8, tileH = sh + bh + 14, statRowH = sh + lh + 10;
			var gx = s != null ? s.Gex : null;
			double price = Bars != null && Bars.Count > 0 ? Bars.GetClose(Bars.Count - 1) : 0;
			string gammaText = null; var gammaColor = C(MutedColor);
			if (gx != null && gx.Error.Length == 0)
			{
				if (gx.Flip.HasValue && price > 0) { bool pos = price >= gx.Flip.Value; gammaText = pos ? "γ+ Positive gamma · pinning" : "γ− Negative gamma · trending"; gammaColor = C(pos ? PositiveColor : NegativeColor); }
				else if (gx.Zone.Length > 0) { bool pos = gx.Zone == "positive"; gammaText = pos ? "γ+ Positive gamma · pinning" : "γ− Negative gamma · trending"; gammaColor = C(pos ? PositiveColor : NegativeColor); }
			}
			bool chips = (ShowTierChip && acct != null && acct.Tier.Length > 0) || (ShowGammaChip && gammaText != null);
			bool blocked = acct != null && acct.Blocked;
			var blockLines = blocked ? Wrap("New orders blocked — " + (acct.Reason.Length > 0 ? acct.Reason : "a risk rule is broken"), fSmall, w - pad * 2 - 14, 3) : new List<string>();
			double dll = acct != null ? acct.DailyLoss : 0, target = TargetValue();
			int cols = w >= 270 ? 4 : 2;
			float h = pad + lh + pad;
			if (chips) h += chipH + 8;
			if (blocked) h += blockLines.Count * (sh + 2) + 16;
			if (ShowPnlTiles) h += tileH + 8;
			if (ShowBuffer && (dll > 0 || target > 0)) h += sh + 6 + 6 + 4 + sh + 10;
			if (ShowStats && dayTrades > 0) h += statsCollapsed ? sh + 12 : statRowH * (8 / cols) + 2;
			if (ShowGexLine && gx != null) h += lh + 10;
			var p = Place(AccountPlacement, w, h, AccountX, AccountY);
			var rect = new DX.RectangleF(p.X, p.Y, w, h);
			Box(rect);
			float x = p.X + pad, y = p.Y + pad;

			// header
			float cx = x + Text("Ronin", fBold, C(TextColor), x, y);
			cx += Text("Flow", fBold, C(AccentColor), cx, y) + 8;
			Text(account != null ? Mask(account.Name) : "no account", fNormal, C(MutedColor), cx, y);
			string state = s == null || (DateTime.UtcNow - s.Got).TotalSeconds > 20 || s.Error.Length > 0 ? "offline" : blocked ? "blocked" : acct != null && acct.Paused ? "rules paused" : acct != null && acct.Enforcing ? "enforcing" : "live";
			var stc = state == "offline" ? C(MutedColor) : state == "blocked" ? C(NegativeColor) : state == "rules paused" ? C(WarningColor) : C(PositiveColor);
			float sw = Measure(state, fSmall).Width;
			Text(state, fSmall, C(MutedColor), rect.Right - pad - sw, y + (lh - sh) / 2);
			RenderTarget.FillEllipse(new D2D.Ellipse(new DX.Vector2(rect.Right - pad - sw - 8, y + lh / 2), 3, 3), B(stc));
			y += lh + pad;
			RenderTarget.DrawLine(new DX.Vector2(rect.Left + 1, y - pad / 2), new DX.Vector2(rect.Right - 1, y - pad / 2), B(BorderColor), 1);

			if (chips)
			{
				float chx = x;
				if (ShowTierChip && acct != null && acct.Tier.Length > 0) chx += Chip("● Tier " + acct.Tier + " " + (acct.Level + 1) + "/" + Math.Max(1, acct.Of), Parse(acct.Color, C(AccentColor)), chx, y, chipH) + 6;
				if (ShowGammaChip && gammaText != null) Chip(Fit(gammaText, fSmall, rect.Right - pad - chx - 14), gammaColor, chx, y, chipH);
				y += chipH + 8;
			}
			if (blocked)
			{
				float bhh = blockLines.Count * (sh + 2) + 10;
				var br = new DX.RectangleF(x, y, w - pad * 2, bhh);
				Round(br, C(NegativeColor), 30, System.Windows.Media.Color.FromArgb(120, C(NegativeColor).R, C(NegativeColor).G, C(NegativeColor).B), 4);
				float ty = br.Y + 5;
				foreach (var l in blockLines) { Text(l, fSmall, C(NegativeColor), br.X + 7, ty); ty += sh + 2; }
				y += bhh + 6;
			}
			double open = OpenPnl();
			if (ShowPnlTiles)
			{
				float tw = (w - pad * 2 - 12) / 3;
				var tiles = new[]
				{
					Tuple.Create("OPEN", Num(open, true), open),
					Tuple.Create("CLOSED", Num(dayRealised, true), dayRealised),
					Tuple.Create("TRADES", acct != null && acct.MaxTrades > 0 ? dayTrades + " / " + acct.MaxTrades : dayTrades.ToString(CultureInfo.InvariantCulture), 0.0),
				};
				for (int i = 0; i < 3; i++)
				{
					var tr = new DX.RectangleF(x + i * (tw + 6), y, tw, tileH);
					var tone = tiles[i].Item3 > 0 ? C(PositiveColor) : tiles[i].Item3 < 0 ? C(NegativeColor) : C(TileColor);
					Round(tr, tiles[i].Item3 == 0 ? C(TileColor) : tone, tiles[i].Item3 == 0 ? 255 : 40, tiles[i].Item3 == 0 ? C(BorderColor) : System.Windows.Media.Color.FromArgb(110, tone.R, tone.G, tone.B), 5);
					Text(tiles[i].Item1, fSmall, C(MutedColor), tr.X + 8, tr.Y + 5);
					Text(tiles[i].Item2, fBig, tiles[i].Item3 > 0 ? C(PositiveColor) : tiles[i].Item3 < 0 ? C(NegativeColor) : C(TextColor), tr.X + 8, tr.Y + 7 + sh);
				}
				y += tileH + 8;
			}
			if (ShowBuffer && (dll > 0 || target > 0))
			{
				double now = dayRealised + (BufferClosedOnly ? 0 : open);
				double trail = acct != null ? acct.Trail : 0;
				double stop = dll > 0 ? (trail > 0 ? Math.Max(-dll, dayPeak - trail) : -dll) : 0;
				if (dll > 0)
				{
					Text(BufferClosedOnly ? "Buffer to loss limit (closed)" : "Buffer to loss limit", fSmall, C(MutedColor), x, y);
					string right = Money(Math.Max(0, now - stop)) + " of " + Money(dll);
					Text(right, fSmall, now - stop <= dll * 0.25 ? C(NegativeColor) : C(TextColor), rect.Right - pad - Measure(right, fSmall).Width, y);
				}
				else
				{
					Text("To profit target", fSmall, C(MutedColor), x, y);
					string right = target - now > 0 ? Money(target - now) + " to go" : "hit";
					Text(right, fSmall, target - now > 0 ? C(TextColor) : C(PositiveColor), rect.Right - pad - Measure(right, fSmall).Width, y);
				}
				y += sh + 6;
				var bar = new DX.RectangleF(x, y, w - pad * 2, 6);
				double lo = dll > 0 ? -dll : Math.Min(Math.Min(0, now), -target / 2), hi = Math.Max(Math.Max(dayPeak, now), target > 0 ? target : dll * 0.5);
				if (hi <= lo) hi = lo + 1;
				Func<double, float> X = v => bar.X + (float)((Math.Max(lo, Math.Min(hi, v)) - lo) / (hi - lo)) * bar.Width;
				using (var stops = new D2D.GradientStopCollection(RenderTarget, new[] { new D2D.GradientStop { Position = 0, Color = new DX.Color4(C(NegativeColor).R / 255f, C(NegativeColor).G / 255f, C(NegativeColor).B / 255f, 0.35f) }, new D2D.GradientStop { Position = 1, Color = new DX.Color4(C(PositiveColor).R / 255f, C(PositiveColor).G / 255f, C(PositiveColor).B / 255f, 0.35f) } }))
				using (var grad = new D2D.LinearGradientBrush(RenderTarget, new D2D.LinearGradientBrushProperties { StartPoint = new DX.Vector2(bar.Left, 0), EndPoint = new DX.Vector2(bar.Right, 0) }, stops))
					RenderTarget.FillRoundedRectangle(new D2D.RoundedRectangle { Rect = bar, RadiusX = 3, RadiusY = 3 }, grad);
				if (dll > 0) RenderTarget.FillRectangle(new DX.RectangleF(X(stop) - 1, bar.Y - 2, 2, bar.Height + 4), B(NegativeColor));
				if (target > 0) RenderTarget.FillRectangle(new DX.RectangleF(Math.Min(bar.Right - 2, X(target)) - 1, bar.Y - 2, 2, bar.Height + 4), B(PositiveColor));
				RenderTarget.FillRectangle(new DX.RectangleF(X(now) - 1, bar.Y - 3, 3, bar.Height + 6), B(Colors.White));
				y += 6 + 4;
				if (dll > 0) Text("stop " + Num(stop, true), fSmall, C(MutedColor), x, y);
				string hiT = "high " + Num(dayPeak, true);
				if (target > 0)
				{
					string tt = "target " + Num(target, true);
					float tw2 = Measure(tt, fSmall).Width;
					Text(tt, fSmall, C(PositiveColor), rect.Right - pad - tw2, y);
					float mw = Measure(hiT, fSmall).Width;
					Text(hiT, fSmall, C(MutedColor), x + (w - pad * 2 - mw) / 2, y);
				}
				else Text(hiT, fSmall, C(MutedColor), rect.Right - pad - Measure(hiT, fSmall).Width, y);
				y += sh + 10;
			}
			if (ShowStats && dayTrades > 0)
			{
				if (statsCollapsed)
				{
					statsRect = ToRect(new DX.RectangleF(x, y, w - pad * 2, sh + 6));
					Text("Stats ▸  " + dayTrades + " trades · " + (dayTrades > 0 ? (100.0 * dayWins / dayTrades).ToString("0", CultureInfo.InvariantCulture) : "0") + "% won", fSmall, C(MutedColor), x, y);
					y += sh + 12;
				}
				else
				{
					double wr = dayTrades > 0 ? (double)dayWins / dayTrades : 0, aw = dayWins > 0 ? grossWin / dayWins : 0, al = dayLosses > 0 ? grossLoss / dayLosses : 0;
					double pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0, ev = dayTrades > 0 ? dayRealised / dayTrades : 0, edge = al > 0 ? wr * aw / al : 0;
					var cells = new[]
					{
						Tuple.Create("Win rate", (wr * 100).ToString("0", CultureInfo.InvariantCulture) + "%", C(TextColor)),
						Tuple.Create("Profit f.", pf.ToString("0.00", CultureInfo.InvariantCulture), pf >= 1 ? C(PositiveColor) : C(NegativeColor)),
						Tuple.Create("EV", Num(ev, true), ev >= 0 ? C(PositiveColor) : C(NegativeColor)),
						Tuple.Create("Edge", edge.ToString("0.00", CultureInfo.InvariantCulture), edge >= 0.75 ? C(PositiveColor) : edge >= 0.5 ? C(WarningColor) : C(NegativeColor)),
						Tuple.Create("Avg win", aw.ToString("0.00", CultureInfo.InvariantCulture), C(PositiveColor)),
						Tuple.Create("Avg loss", al.ToString("0.00", CultureInfo.InvariantCulture), C(NegativeColor)),
						Tuple.Create("Best", Num(best, true), C(PositiveColor)),
						Tuple.Create("Worst", Num(worst, true), C(NegativeColor)),
					};
					float cw = (w - pad * 2) / cols;
					statsRect = ToRect(new DX.RectangleF(x, y, w - pad * 2, statRowH * (8 / cols)));
					for (int i = 0; i < 8; i++)
					{
						float sx = x + (i % cols) * cw, sy = y + (i / cols) * statRowH;
						Text(cells[i].Item1, fSmall, C(MutedColor), sx, sy + 3);
						Text(cells[i].Item2, fBold, cells[i].Item3, sx, sy + 4 + sh);
					}
					y += statRowH * (8 / cols) + 2;
				}
			}
			else statsRect = Rect.Empty;
			if (ShowGexLine && gx != null)
			{
				string t = gx.Error.Length > 0 ? "GEX: " + gx.Error : gx.Index + " GEX " + (gx.Total >= 0 ? "+" : "-") + "$" + (Math.Abs(gx.Total) / 1e9).ToString("0.00", CultureInfo.InvariantCulture) + "B" + (gx.Flip.HasValue ? " · flip " + gx.Flip.Value.ToString("0.##", CultureInfo.InvariantCulture) : "") + (gx.Delayed ? " · delayed" : "");
				Text(Fit(t, fNormal, w - pad * 2), fNormal, gx.Total >= 0 ? C(PositiveColor) : C(NegativeColor), x, y + 2);
			}
			return rect.Bottom;
		}

		private void DrawPositions(float top)
		{
			var rows = positions;
			float pad = 8, lh = Measure("Ag", fNormal).Height, rowH = lh + 5, w = AccountWidth;
			float h = pad * 2 + rows.Count * rowH;
			var p = Place(AccountPlacement, w, h, AccountX, AccountY);
			bool below = AccountPlacement == Corner.TopLeft || AccountPlacement == Corner.TopRight || AccountPlacement == Corner.TopMiddle;
			float y0 = ShowAccount ? (below ? top + 6 : p.Y - h - 6) : p.Y;
			var r = new DX.RectangleF(p.X, y0, w, h);
			Box(r);
			float y = y0 + pad;
			foreach (var row in rows)
			{
				Text(Mask(row.Account), fNormal, C(MutedColor), r.X + pad, y);
				string dir = (row.Qty > 0 ? "LONG " : "SHORT ") + Math.Abs(row.Qty) + " " + row.Code.Split(' ')[0];
				Text(dir, fBold, row.Qty > 0 ? C(PositiveColor) : C(NegativeColor), r.X + w * 0.38f, y);
				string pnl = Num(row.Pnl, true);
				Text(pnl, fBold, row.Pnl >= 0 ? C(PositiveColor) : C(NegativeColor), r.Right - pad - Measure(pnl, fBold).Width, y);
				y += rowH;
			}
		}

		private static Rect ToRect(DX.RectangleF r) { return new Rect(r.X, r.Y, r.Width, r.Height); }

		private void DrawNews(Snap s)
		{
			var items = s.News.Where(n => n.Importance >= NewsMinImportance).Take(NewsRows).ToList();
			float w = NewsWidth, pad = 10, lh = Measure("Ag", fNormal).Height, sh = Measure("Ag", fSmall).Height, rowH = lh + sh + 10;
			float h = pad + lh + (newsCollapsed ? pad : 8 + Math.Max(1, items.Count) * rowH + 2);
			var p = Place(NewsPlacement, w, h, NewsX, NewsY);
			var r = new DX.RectangleF(p.X, p.Y, w, h);
			Box(r);
			float x = r.X + pad, y = r.Y + pad;
			string title = (newsCollapsed ? "▸ " : "▾ ") + "News" + (s.MarketLabel.Length > 0 ? " · " + s.MarketLabel : "");
			Text(title, fBold, C(TextColor), x, y);
			newsHeader = ToRect(new DX.RectangleF(r.X, r.Y, w, lh + pad * 2));
			if (newsCollapsed) return;
			y += lh + 8;
			if (items.Count == 0) { Text("No headlines yet", fSmall, C(MutedColor), x, y); return; }
			foreach (var n in items)
			{
				var c = n.Importance >= 3 ? C(NegativeColor) : n.Importance >= 2 ? C(WarningColor) : C(MutedColor);
				RenderTarget.FillRectangle(new DX.RectangleF(r.X + 1, y + 2, 2, rowH - 6), B(c));
				var local = DateTimeOffset.FromUnixTimeMilliseconds(n.T).LocalDateTime;
				string meta = local.ToString("HH:mm", CultureInfo.InvariantCulture) + " · " + n.Src + (n.Dir > 0 ? " · ↑" : n.Dir < 0 ? " · ↓" : "");
				Text(meta, fSmall, n.Dir > 0 ? C(PositiveColor) : n.Dir < 0 ? C(NegativeColor) : C(MutedColor), x, y);
				Text(Fit(n.Title, fNormal, w - pad * 2), fNormal, C(TextColor), x, y + sh + 2);
				newsRows.Add(new KeyValuePair<Rect, NewsItem>(ToRect(new DX.RectangleF(r.X, y - 2, w, rowH)), n));
				y += rowH;
			}
		}

		private void DrawPopups()
		{
			List<KeyValuePair<NewsItem, DateTime>> list;
			lock (gate) list = popups.ToList();
			if (list.Count == 0) return;
			float w = 340, pad = 10, lh = Measure("Ag", fNormal).Height, sh = Measure("Ag", fSmall).Height;
			float offset = 0;
			foreach (var kv in list)
			{
				var n = kv.Key;
				var lines = Wrap(n.Title, fBold, w - pad * 2, 3);
				float h = pad * 2 + sh + 4 + lines.Count * (lh + 2);
				var p = Place(PopupPlacement, w, h, PopupX, PopupY);
				bool top = PopupPlacement == Corner.TopLeft || PopupPlacement == Corner.TopRight || PopupPlacement == Corner.TopMiddle;
				var r = new DX.RectangleF(p.X, top ? p.Y + offset : p.Y - offset, w, h);
				var c = n.Importance >= 3 ? C(NegativeColor) : n.Importance >= 2 ? C(WarningColor) : C(AccentColor);
				Box(r);
				RenderTarget.FillRectangle(new DX.RectangleF(r.X + 1, r.Y + 1, 3, r.Height - 2), B(c));
				Text((n.Importance >= 3 ? "HIGH IMPACT · " : "") + n.Src, fSmall, c, r.X + pad + 2, r.Y + pad);
				float y = r.Y + pad + sh + 4;
				foreach (var l in lines) { Text(l, fBold, C(TextColor), r.X + pad + 2, y); y += lh + 2; }
				newsRows.Add(new KeyValuePair<Rect, NewsItem>(ToRect(r), n));
				offset += h + 8;
			}
		}

		private void DrawDetail(NewsItem n)
		{
			float w = Math.Min(540, ChartPanel.W - 40), pad = 16;
			float lh = Measure("Ag", fNormal).Height, sh = Measure("Ag", fSmall).Height, bh = Measure("Ag", fBig).Height;
			var title = Wrap(n.Title, fBig, w - pad * 2 - 20, 4);
			var body = n.Summary.Length > 0 && n.Summary != n.Title ? Wrap(n.Summary, fNormal, w - pad * 2, 8) : new List<string>();
			float h = pad + sh + 8 + title.Count * (bh + 3) + 8 + body.Count * (lh + 3) + 12 + lh + 12 + pad;
			var r = new DX.RectangleF(ChartPanel.X + (ChartPanel.W - w) / 2, ChartPanel.Y + Math.Max(16, (ChartPanel.H - h) / 2), w, h);
			detailRect = ToRect(r);
			var c = n.Importance >= 3 ? C(NegativeColor) : n.Importance >= 2 ? C(WarningColor) : C(AccentColor);
			Round(r, C(BackColor), 252, C(BorderColor), 8);
			RenderTarget.FillRectangle(new DX.RectangleF(r.X + 2, r.Y + 1, r.Width - 4, 3), B(c));
			float x = r.X + pad, y = r.Y + pad;
			Text(n.Src + " · " + DateTimeOffset.FromUnixTimeMilliseconds(n.T).LocalDateTime.ToString("ddd HH:mm", CultureInfo.InvariantCulture), fSmall, c, x, y);
			y += sh + 8;
			foreach (var l in title) { Text(l, fBig, C(TextColor), x, y); y += bh + 3; }
			y += 8;
			foreach (var l in body) { Text(l, fNormal, C(TextColor), x, y, 220); y += lh + 3; }
			y += 12;
			float bx = x;
			var list = new List<Tuple<string, string, bool>>();
			if (n.Link.StartsWith("http", StringComparison.OrdinalIgnoreCase)) list.Add(Tuple.Create("Open the article", n.Link, true));
			list.Add(Tuple.Create("Open News Flow", baseUrl + "/#/macro/news", n.Link.Length == 0));
			list.Add(Tuple.Create("Close", "close", false));
			foreach (var b in list)
			{
				float bw = Measure(b.Item1, fNormal).Width + 22;
				var br = new DX.RectangleF(bx, y, bw, lh + 10);
				Round(br, b.Item3 ? C(AccentColor) : C(TileColor), 255, b.Item3 ? C(AccentColor) : C(BorderColor), 5);
				Text(b.Item1, fNormal, b.Item3 ? Colors.White : C(TextColor), br.X + 11, br.Y + 5);
				buttons.Add(new KeyValuePair<Rect, string>(ToRect(br), b.Item2));
				bx += bw + 8;
			}
		}

		// ======================================================================================== clicks

		private void OnMouseDown(object sender, MouseButtonEventArgs e)
		{
			try
			{
				var pt = e.GetPosition(ChartControl as IInputElement);
				var p = new Point(ChartingExtensions.ConvertToHorizontalPixels(pt.X, ChartControl.PresentationSource), ChartingExtensions.ConvertToVerticalPixels(pt.Y, ChartControl.PresentationSource));
				if (detail != null)
				{
					foreach (var b in buttons.ToList())
					{
						if (!b.Key.Contains(p)) continue;
						if (b.Value != "close") try { System.Diagnostics.Process.Start(b.Value); } catch { }
						detail = null; e.Handled = true; Redraw(); return;
					}
					if (!detailRect.Contains(p)) { detail = null; Redraw(); }
					e.Handled = true; return;
				}
				if (ShowNews && newsHeader.Contains(p)) { newsCollapsed = !newsCollapsed; e.Handled = true; Redraw(); return; }
				if (ShowAccount && ShowStats && statsRect.Contains(p)) { statsCollapsed = !statsCollapsed; e.Handled = true; Redraw(); return; }
				foreach (var kv in newsRows.ToList())
					if (kv.Key.Contains(p)) { detail = kv.Value; lock (gate) popups.RemoveAll(x => x.Key == kv.Value); e.Handled = true; Redraw(); return; }
			}
			catch { }
		}
	}
}
