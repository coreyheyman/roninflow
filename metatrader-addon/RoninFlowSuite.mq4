//+------------------------------------------------------------------+
//| RoninFlow Suite — MetaTrader indicator (the same file builds as   |
//| RoninFlowSuite.mq5 and RoninFlowSuite.mq4)                        |
//|                                                                  |
//| RoninFlow on your chart, each part switched on or off in the     |
//| inputs: the account panel (risk tier, gamma regime, today's P&L, |
//| buffer to the profit target, trade stats, GEX line, open         |
//| positions), your trades on the chart, gamma levels, the news     |
//| feed (click the title to collapse, a headline to read it) with   |
//| pop-ups and today's economic events, a DOM heatmap (MT5, where   |
//| the broker sends market depth), candle colours and alerts.       |
//|                                                                  |
//| MetaTrader indicators can't make web requests, so it swaps files |
//| with RoninFlow in Common\Files\TradeJournal (RoninFlow on this   |
//| PC answers within a couple of seconds).                          |
//|                                                                  |
//| Install: npm run addon:mt copies it to MQL5\Indicators and       |
//| MQL4\Indicators; compile in MetaEditor (F7), then drag           |
//| "RoninFlowSuite" onto a chart.                                   |
//+------------------------------------------------------------------+
#property copyright "RoninFlow"
#property version   "1.00"
#property description "RoninFlow on your chart: account panel, your trades, gamma levels, news, heatmap and alerts."
#property indicator_chart_window
#property indicator_buffers 0
#property indicator_plots   0
#include <Canvas\Canvas.mqh>
#ifdef __MQL5__
#define ServerNow() TimeTradeServer()
#else
#define ServerNow() TimeCurrent()
#endif

enum ECorner { CORNER_TOPLEFT, CORNER_TOPRIGHT, CORNER_BOTTOMLEFT, CORNER_BOTTOMRIGHT, CORNER_TOPMIDDLE, CORNER_BOTTOMMIDDLE };
enum EMarkerStyle { MARKERSTYLE_TRIANGLES, MARKERSTYLE_ARROWS, MARKERSTYLE_CIRCLES };
enum ELineKind { LINEKIND_SOLID, LINEKIND_DASHED, LINEKIND_DOTTED };
enum EResultUnit { RESULTUNIT_MONEY, RESULTUNIT_TICKS, RESULTUNIT_POINTS };
enum ELabelSide { LABELSIDE_LEFT, LABELSIDE_MIDDLE, LABELSIDE_RIGHT };
enum EEventLevel { EVENTLEVEL_ALLEVENTS, EVENTLEVEL_MEDIUMANDHIGH, EVENTLEVEL_HIGHONLY };
enum EPalette { PALETTE_BOOKMAP, PALETTE_THERMAL, PALETTE_OCEAN, PALETTE_MONO };
input string _g0 = "===== General =====";
input string InAccountName = ""; // Account (empty = the chart's account)
input int    InRefreshSeconds = 3; // Refresh every (seconds)
input int    InFontSize = 11; // Text size
input string _g1 = "===== Account panel =====";
input bool   InShowAccount = true; // Show the account panel
input ECorner InAccountPlacement = CORNER_TOPRIGHT; // Placement
input int    InAccountX = 12; // X offset
input int    InAccountY = 12; // Y offset
input int    InAccountWidth = 320; // Width
input bool   InShowTierChip = true; // Risk tier chip
input bool   InShowGammaChip = true; // Gamma regime chip
input bool   InShowPnlTiles = true; // P&L tiles
input bool   InShowBuffer = true; // Buffer bar (loss limit to profit target)
input bool   InBufferClosedOnly = false; // Buffer bar moves with closed P&L only
input bool   InShowStats = true; // Trade stats (click to collapse)
input bool   InShowGexLine = true; // GEX line
input bool   InShowAllPositions = true; // Open positions on every account
input string _g2 = "===== Executions =====";
input bool   InShowExecutions = true; // Show your executions
input EMarkerStyle InExecMarker = MARKERSTYLE_TRIANGLES; // Marker style
input int    InExecSize = 10; // Marker size
input color  InExecBuyColor = C'43,196,138'; // Buy colour
input color  InExecSellColor = C'229,72,77'; // Sell colour
input bool   InExecShowQty = true; // Quantity next to each marker
input bool   InExecConnect = true; // Join entry and exit with a line
input color  InExecWinColor = C'43,196,138'; // Winning trade line
input color  InExecLossColor = C'229,72,77'; // Losing trade line
input int    InExecLineWidth = 1; // Line width
input ELineKind InExecLineStyle = LINEKIND_DASHED; // Line style
input bool   InExecShowResult = true; // Result at the exit
input EResultUnit InExecResultUnit = RESULTUNIT_MONEY; // Result in
input bool   InExecShowAvg = true; // Open position average price line
input color  InExecAvgColor = C'232,176,67'; // Average price line colour
input string _g3 = "===== Gamma =====";
input bool   InShowGamma = true; // Show gamma levels
input bool   InGammaZones = false; // Zones instead of lines
input int    InZoneTicks = 8; // Zone height (ticks)
input bool   InShowFlip = true; // Gamma flip
input bool   InShowWalls = true; // Call and put walls
input bool   InShowOtherLevels = true; // Other big strikes
input ELabelSide InLabelSide = LABELSIDE_RIGHT; // Level names
input color  InCallWallColor = C'43,196,138'; // Call wall
input color  InPutWallColor = C'229,72,77'; // Put wall
input color  InFlipColor = C'232,176,67'; // Gamma flip colour
input color  InPosLevelColor = C'43,196,138'; // Positive strikes
input color  InNegLevelColor = C'229,72,77'; // Negative strikes
input int    InLevelWidth = 1; // Line width
input string _g4 = "===== News =====";
input bool   InShowNews = true; // Show the news feed (click the title to collapse)
input ECorner InNewsPlacement = CORNER_TOPLEFT; // Placement
input int    InNewsX = 12; // X offset
input int    InNewsY = 12; // Y offset
input int    InNewsWidth = 360; // Width
input int    InNewsRows = 6; // Headlines
input int    InNewsMinImportance = 0; // Only headlines at least this important (0-3)
input bool   InShowPopups = true; // Pop-ups for new headlines
input ECorner InPopupPlacement = CORNER_BOTTOMRIGHT; // Pop-up placement
input int    InPopupX = 12; // Pop-up X offset
input int    InPopupY = 40; // Pop-up Y offset
input int    InPopupSeconds = 12; // Pop-up shows for (seconds)
input int    InPopupMinImportance = 2; // Pop-ups only at least this important (0-3)
input bool   InShowEventMarkers = true; // Today's economic events on the time axis
input EEventLevel InEventMinImpact = EVENTLEVEL_MEDIUMANDHIGH; // Events shown
input string _g5 = "===== Heatmap =====";
input bool   InShowHeatmap = false; // Show the DOM heatmap
input bool   InHeatmapBehind = true; // Draw behind the candles
input int    InHmThreshold = 15; // Minimum size shown
input int    InHmReshade = 25; // New shade when size changes by (%)
input bool   InHmExtendLive = true; // Live levels reach the right edge
input EPalette InHmPalette = PALETTE_BOOKMAP; // Colour palette
input double InHmContrast = 1.2; // Contrast
input int    InHmOpacity = 100; // Opacity (%)
input bool   InHmTags = true; // Size tags on the biggest live levels
input int    InHmTagCount = 8; // How many tags
input string _g6 = "===== Candles =====";
input bool   InShowCandles = false; // Restyle the candles
input color  InCcBullColor = C'38,166,154'; // Bullish body
input color  InCcBearColor = C'156,77,204'; // Bearish body
input color  InCcBullWick = C'38,166,154'; // Bullish wick / outline
input color  InCcBearWick = C'156,77,204'; // Bearish wick / outline
input color  InCcDojiColor = C'139,139,143'; // Doji
input int    InCcOpacity = 100; // Body opacity (%)
input string _g7 = "===== Alerts =====";
input bool   InAlertEntry = true; // Trade entered
input string InEntrySound = "Alert1.wav"; // Entry sound
input bool   InAlertFill = false; // Every fill
input string InFillSound = "Alert1.wav"; // Fill sound
input bool   InAlertWin = true; // Winning trade
input string InWinSound = "Alert2.wav"; // Win sound
input bool   InAlertLoss = true; // Losing trade
input string InLossSound = "Alert3.wav"; // Loss sound
input bool   InAlertDll = true; // Daily loss limit (warning and hit)
input string InDllSound = "Alert4.wav"; // Loss limit sound
input int    InDllWarnPercent = 75; // Warn at (% of the limit used)
input bool   InAlertTarget = true; // Profit target hit
input string InTargetSound = "Alert2.wav"; // Target sound
input double InProfitTarget = 0.0; // Profit target ($, 0 = the account's target in RoninFlow)
input bool   InAlertIncludeOpen = true; // Limits count open P&L
input string _g8 = "===== Look =====";
input color  InBackColor = C'14,14,18'; // Panel background
input color  InBorderColor = C'38,38,46'; // Panel border
input color  InTileColor = C'22,22,28'; // Tiles
input color  InTextColor = C'230,230,234'; // Text
input color  InMutedColor = C'138,138,150'; // Muted text
input color  InPositiveColor = C'43,196,138'; // Positive
input color  InNegativeColor = C'229,72,77'; // Negative
input color  InWarningColor = C'232,176,67'; // Warning
input color  InAccentColor = C'139,92,246'; // Accent
input int    InPanelOpacity = 94; // Panel opacity (%)

//--- data from RoninFlow
struct NewsRow { string id; long t; int imp; int dir; string src; string title; string summary; };
struct EventRow { long t; string impact; string title; };
string   g_tier = "", g_tierColor = "", g_reason = "", g_marketLabel = "", g_gexIndex = "", g_gexZone = "", g_gexError = "";
int      g_level = 0, g_of = 0, g_maxTrades = 0;
double   g_dll = 0, g_trail = 0, g_target = 0, g_gexTotal = 0, g_flip = 0, g_call = 0, g_put = 0;
bool     g_hasAcct = false, g_blocked = false, g_paused = false, g_enforcing = false, g_hasGex = false, g_hasFlip = false, g_hasCall = false, g_hasPut = false, g_delayed = false;
double   g_pos[], g_neg[];
long     g_dayStart = 0;
datetime g_got = 0;
NewsRow  g_news[];
EventRow g_events[];
string   g_seen = "|";
bool     g_primed = false;
NewsRow  g_popups[]; datetime g_popupUntil[];
int      g_detail = -1;
bool     g_newsCollapsed = false, g_statsCollapsed = false;

//--- today's trades
double g_realised = 0, g_peak = 0, g_grossWin = 0, g_grossLoss = 0, g_best = 0, g_worst = 0;
int    g_trades = 0, g_wins = 0, g_losses = 0, g_lastDeals = -1, g_lastPositions = -1;
bool   g_dllWarned = false, g_dllHit = false, g_targetHit = false; long g_alertDay = 0;

//--- heatmap
struct HmNode { int start; int end; double price; double vol; bool active; };
HmNode g_hm[];

//--- canvases and clickable areas
CCanvas g_front, g_back;
int g_w = 0, g_h = 0;
int g_newsHdr[4], g_stats[4], g_detailBox[4], g_close[4];
int g_rows[][4]; int g_rowIndex[];
string g_req, g_resp;
int g_tick = 0;
color g_oldBull, g_oldBear, g_oldUp, g_oldDown; bool g_colorsSaved = false;

//+------------------------------------------------------------------+
int OnInit()
  {
   string id = IntegerToString(ChartID());
   g_req = "TradeJournal\\suite-req-" + id + ".txt";
   g_resp = "TradeJournal\\suite-" + id + ".txt";
   g_w = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS);
   g_h = (int)ChartGetInteger(0, CHART_HEIGHT_IN_PIXELS);
   if(!g_back.CreateBitmapLabel(0, 0, "rf_suite_back", 0, 0, MathMax(g_w, 10), MathMax(g_h, 10), COLOR_FORMAT_ARGB_NORMALIZE)) return INIT_FAILED;
   if(!g_front.CreateBitmapLabel(0, 0, "rf_suite_front", 0, 0, MathMax(g_w, 10), MathMax(g_h, 10), COLOR_FORMAT_ARGB_NORMALIZE)) return INIT_FAILED;
   ObjectSetInteger(0, "rf_suite_back", OBJPROP_BACK, InHeatmapBehind);
   ObjectSetInteger(0, "rf_suite_back", OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, "rf_suite_front", OBJPROP_SELECTABLE, false);
   ChartSetInteger(0, CHART_EVENT_MOUSE_MOVE, false);
   if(InShowCandles)
     {
      g_oldBull = (color)ChartGetInteger(0, CHART_COLOR_CANDLE_BULL); g_oldBear = (color)ChartGetInteger(0, CHART_COLOR_CANDLE_BEAR);
      g_oldUp = (color)ChartGetInteger(0, CHART_COLOR_CHART_UP); g_oldDown = (color)ChartGetInteger(0, CHART_COLOR_CHART_DOWN);
      g_colorsSaved = true;
      ChartSetInteger(0, CHART_COLOR_CANDLE_BULL, InCcBullColor); ChartSetInteger(0, CHART_COLOR_CANDLE_BEAR, InCcBearColor);
      ChartSetInteger(0, CHART_COLOR_CHART_UP, InCcBullWick); ChartSetInteger(0, CHART_COLOR_CHART_DOWN, InCcBearWick);
     }
#ifdef __MQL5__
   if(InShowHeatmap) MarketBookAdd(_Symbol);
#endif
   EventSetTimer(1);
   Request();
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
#ifdef __MQL5__
   if(InShowHeatmap) MarketBookRelease(_Symbol);
#endif
   if(g_colorsSaved)
     {
      ChartSetInteger(0, CHART_COLOR_CANDLE_BULL, g_oldBull); ChartSetInteger(0, CHART_COLOR_CANDLE_BEAR, g_oldBear);
      ChartSetInteger(0, CHART_COLOR_CHART_UP, g_oldUp); ChartSetInteger(0, CHART_COLOR_CHART_DOWN, g_oldDown);
     }
   g_front.Destroy(); g_back.Destroy();
   FileDelete(g_req, FILE_COMMON);
  }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[], const double &high[], const double &low[], const double &close[], const long &tick_volume[], const long &volume[], const int &spread[])
  {
   return rates_total;
  }

void OnTimer()
  {
   g_tick++;
   if(g_tick % MathMax(2, InRefreshSeconds) == 0) { Request(); Read(); }
   ComputeDay();
   CheckTrades();
   CheckLimits();
#ifdef __MQL5__
   if(InShowHeatmap) SampleBook();
#endif
   Render();
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(id == CHARTEVENT_CHART_CHANGE) { Render(); return; }
   if(id != CHARTEVENT_CLICK) return;
   int x = (int)lparam, y = (int)dparam;
   if(g_detail >= 0) { g_detail = -1; Render(); return; }   // any click closes the headline
   if(InShowNews && In(x, y, g_newsHdr)) { g_newsCollapsed = !g_newsCollapsed; Render(); return; }
   if(InShowStats && In(x, y, g_stats)) { g_statsCollapsed = !g_statsCollapsed; Render(); return; }
   for(int i = 0; i < ArraySize(g_rowIndex); i++)
      if(x >= g_rows[i][0] && x <= g_rows[i][2] && y >= g_rows[i][1] && y <= g_rows[i][3]) { g_detail = g_rowIndex[i]; Render(); return; }
  }

bool In(int x, int y, const int &r[]) { return r[2] > r[0] && x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]; }
void SetR(int &r[], int x1, int y1, int x2, int y2) { r[0] = x1; r[1] = y1; r[2] = x2; r[3] = y2; }

//+------------------------------------------------------------------+
//| the file bridge                                                    |
//+------------------------------------------------------------------+
string Login()
  {
   if(InAccountName != "") return InAccountName;
#ifdef __MQL5__
   return IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
#else
   return IntegerToString(AccountNumber());
#endif
  }

void Request()
  {
   int h = FileOpen(g_req, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(h == INVALID_HANDLE) return;
   FileWriteString(h, _Symbol + "\t" + Login());
   FileClose(h);
  }

void Read()
  {
   if(!FileIsExist(g_resp, FILE_COMMON)) return;
   int h = FileOpen(g_resp, FILE_READ | FILE_TXT | FILE_ANSI | FILE_COMMON | FILE_SHARE_READ | FILE_SHARE_WRITE, 0, CP_UTF8);
   if(h == INVALID_HANDLE) return;
   g_hasAcct = false; g_hasGex = false;
   ArrayResize(g_pos, 0); ArrayResize(g_neg, 0); ArrayResize(g_events, 0);
   NewsRow fresh[]; ArrayResize(fresh, 0);
   while(!FileIsEnding(h))
     {
      string line = FileReadString(h);
      string c[];
      int n = StringSplit(line, '\t', c);
      if(n < 1) continue;
      string k = c[0];
      if(k == "RF" && n >= 6) { g_dayStart = StringToInteger(c[3]); g_marketLabel = c[5]; g_got = TimeLocal(); }
      else if(k == "A" && n >= 15)
        {
         g_hasAcct = true; g_tier = c[1]; g_level = (int)StringToInteger(c[2]); g_of = (int)StringToInteger(c[3]); g_tierColor = c[4];
         g_dll = StringToDouble(c[5]); g_trail = StringToDouble(c[6]); g_target = StringToDouble(c[7]); g_maxTrades = (int)StringToInteger(c[8]);
         g_enforcing = c[10] == "1"; g_blocked = c[11] == "1"; g_paused = c[12] == "1"; g_reason = n > 15 ? c[15] : "";
        }
      else if(k == "G" && n >= 10)
        {
         g_hasGex = true; g_gexIndex = c[1]; g_gexZone = c[2]; g_gexTotal = StringToDouble(c[3]);
         g_hasFlip = c[4] != ""; g_flip = StringToDouble(c[4]); g_hasCall = c[5] != ""; g_call = StringToDouble(c[5]); g_hasPut = c[6] != ""; g_put = StringToDouble(c[6]);
         g_delayed = c[8] == "1"; g_gexError = c[9];
        }
      else if(k == "P" && n >= 2) { int m = ArraySize(g_pos); ArrayResize(g_pos, m + 1); g_pos[m] = StringToDouble(c[1]); }
      else if(k == "Q" && n >= 2) { int m = ArraySize(g_neg); ArrayResize(g_neg, m + 1); g_neg[m] = StringToDouble(c[1]); }
      else if(k == "E" && n >= 5) { int m = ArraySize(g_events); ArrayResize(g_events, m + 1); g_events[m].t = StringToInteger(c[1]); g_events[m].impact = c[2]; g_events[m].title = c[4]; }
      else if(k == "N" && n >= 7)
        {
         int m = ArraySize(fresh); ArrayResize(fresh, m + 1);
         fresh[m].id = c[1]; fresh[m].t = StringToInteger(c[2]); fresh[m].imp = (int)StringToInteger(c[3]); fresh[m].dir = (int)StringToInteger(c[4]);
         fresh[m].src = c[5]; fresh[m].title = c[6]; fresh[m].summary = n > 8 ? c[8] : "";
        }
     }
   FileClose(h);
   for(int i = 0; i < ArraySize(fresh); i++)
     {
      if(StringFind(g_seen, "|" + fresh[i].id + "|") >= 0) continue;
      g_seen += fresh[i].id + "|";
      if(g_primed && InShowPopups && fresh[i].imp >= InPopupMinImportance)
        {
         int m = ArraySize(g_popups); ArrayResize(g_popups, m + 1); ArrayResize(g_popupUntil, m + 1);
         g_popups[m] = fresh[i]; g_popupUntil[m] = TimeLocal() + InPopupSeconds;
        }
     }
   if(StringLen(g_seen) > 20000) g_seen = "|";
   g_primed = true;
   ArrayResize(g_news, ArraySize(fresh));
   for(int i = 0; i < ArraySize(fresh); i++) g_news[i] = fresh[i];
  }

//+------------------------------------------------------------------+
//| today's trades and alerts                                          |
//+------------------------------------------------------------------+
datetime DayStartServer()
  {
   // RoninFlow's midnight (UTC ms) in the broker's server time
   long off = (long)(ServerNow() - TimeGMT());
   if(g_dayStart > 0) return (datetime)(g_dayStart / 1000 + off);
   MqlDateTime d; TimeToStruct(ServerNow(), d); d.hour = 0; d.min = 0; d.sec = 0; return StructToTime(d);
  }

void ComputeDay()
  {
   datetime from = DayStartServer();
   double r = 0, peak = 0, gw = 0, gl = 0, bst = 0, wst = 0; int n = 0, w = 0, l = 0;
#ifdef __MQL5__
   if(!HistorySelect(from, ServerNow() + 60)) return;
   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
     {
      ulong tk = HistoryDealGetTicket(i);
      long type = HistoryDealGetInteger(tk, DEAL_TYPE);
      if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;
      double p = HistoryDealGetDouble(tk, DEAL_PROFIT) + HistoryDealGetDouble(tk, DEAL_SWAP) + HistoryDealGetDouble(tk, DEAL_COMMISSION);
      long entry = HistoryDealGetInteger(tk, DEAL_ENTRY);
      r += p;
      if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_INOUT || entry == DEAL_ENTRY_OUT_BY)
        {
         n++; if(p > 0) { w++; gw += p; } else if(p < 0) { l++; gl -= p; }
         bst = MathMax(bst, p); wst = MathMin(wst, p); peak = MathMax(peak, r);
        }
     }
#else
   for(int i = 0; i < OrdersHistoryTotal(); i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;
      if(OrderType() > OP_SELL || OrderCloseTime() < from) continue;
      double p = OrderProfit() + OrderSwap() + OrderCommission();
      r += p; n++; if(p > 0) { w++; gw += p; } else if(p < 0) { l++; gl -= p; }
      bst = MathMax(bst, p); wst = MathMin(wst, p); peak = MathMax(peak, r);
     }
#endif
   g_realised = r; g_peak = peak; g_trades = n; g_wins = w; g_losses = l; g_grossWin = gw; g_grossLoss = gl; g_best = bst; g_worst = wst;
  }

double OpenPnl()
  {
#ifdef __MQL5__
   return AccountInfoDouble(ACCOUNT_PROFIT);
#else
   return AccountProfit();
#endif
  }

int OpenCount()
  {
#ifdef __MQL5__
   return PositionsTotal();
#else
   int n = 0; for(int i = 0; i < OrdersTotal(); i++) if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES) && OrderType() <= OP_SELL) n++; return n;
#endif
  }

void Ring(string sound, string message)
  {
   if(!PlaySound(sound)) PlaySound("alert.wav");
   Print("RoninFlow: ", message);
  }

void CheckTrades()
  {
   int positions = OpenCount();
   int deals = g_trades;
   if(g_lastPositions >= 0)
     {
      if(positions > g_lastPositions && InAlertEntry) Ring(InEntrySound, "trade entered");
      else if(positions != g_lastPositions && InAlertFill) Ring(InFillSound, "fill");
      if(deals > g_lastDeals && g_lastDeals >= 0)
        {
         double last = LastTradePnl();
         if(last > 0 && InAlertWin) Ring(InWinSound, "win " + Money(last, true) + " · day " + Money(g_realised, true));
         else if(last < 0 && InAlertLoss) Ring(InLossSound, "loss " + Money(last, true) + " · day " + Money(g_realised, true));
        }
     }
   g_lastPositions = positions; g_lastDeals = deals;
  }

double LastTradePnl()
  {
#ifdef __MQL5__
   int total = HistoryDealsTotal();
   for(int i = total - 1; i >= 0; i--)
     {
      ulong tk = HistoryDealGetTicket(i);
      long entry = HistoryDealGetInteger(tk, DEAL_ENTRY);
      if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_INOUT || entry == DEAL_ENTRY_OUT_BY)
         return HistoryDealGetDouble(tk, DEAL_PROFIT) + HistoryDealGetDouble(tk, DEAL_SWAP) + HistoryDealGetDouble(tk, DEAL_COMMISSION);
     }
#else
   datetime best = 0; double p = 0;
   for(int i = 0; i < OrdersHistoryTotal(); i++)
      if(OrderSelect(i, SELECT_BY_POS, MODE_HISTORY) && OrderType() <= OP_SELL && OrderCloseTime() > best) { best = OrderCloseTime(); p = OrderProfit() + OrderSwap() + OrderCommission(); }
   return p;
#endif
   return 0;
  }

double TargetValue() { return InProfitTarget > 0 ? InProfitTarget : g_target; }

void CheckLimits()
  {
   if(g_dayStart != g_alertDay) { g_alertDay = g_dayStart; g_dllWarned = false; g_dllHit = false; g_targetHit = false; }
   double now = g_realised + (InAlertIncludeOpen ? OpenPnl() : 0);
   if(InAlertDll && g_dll > 0)
     {
      if(!g_dllHit && now <= -g_dll) { g_dllHit = true; Ring(InDllSound, "daily loss limit hit: " + Money(now, true)); }
      else if(!g_dllWarned && !g_dllHit && now <= -g_dll * InDllWarnPercent / 100.0) { g_dllWarned = true; Ring(InDllSound, IntegerToString(InDllWarnPercent) + "% of the daily loss limit used: " + Money(now, true)); }
     }
   double target = TargetValue();
   if(InAlertTarget && target > 0 && !g_targetHit && now >= target) { g_targetHit = true; Ring(InTargetSound, "profit target hit: " + Money(now, true)); }
  }

//+------------------------------------------------------------------+
//| heatmap (MT5 market depth)                                         |
//+------------------------------------------------------------------+
#ifdef __MQL5__
void SampleBook()
  {
   MqlBookInfo book[];
   if(!MarketBookGet(_Symbol, book)) return;
   int bar = Bars(_Symbol, _Period) - 1;
   int n = ArraySize(g_hm);
   for(int i = 0; i < n; i++)
     {
      if(!g_hm[i].active) continue;
      bool found = false;
      for(int j = 0; j < ArraySize(book); j++)
         if(MathAbs(book[j].price - g_hm[i].price) < _Point / 2 && book[j].volume_real >= InHmThreshold)
           {
            found = true;
            double change = g_hm[i].vol > 0 ? MathAbs(book[j].volume_real - g_hm[i].vol) / g_hm[i].vol * 100 : 100;
            g_hm[i].end = bar;
            if(change >= InHmReshade && bar > g_hm[i].start) { g_hm[i].active = false; found = false; }
            else g_hm[i].vol = book[j].volume_real;
            break;
           }
      if(!found) { g_hm[i].active = false; g_hm[i].end = bar; }
     }
   for(int j = 0; j < ArraySize(book); j++)
     {
      if(book[j].volume_real < InHmThreshold) continue;
      bool live = false;
      for(int i = 0; i < ArraySize(g_hm); i++) if(g_hm[i].active && MathAbs(g_hm[i].price - book[j].price) < _Point / 2) { live = true; break; }
      if(live) continue;
      int m = ArraySize(g_hm); ArrayResize(g_hm, m + 1);
      g_hm[m].start = bar; g_hm[m].end = bar; g_hm[m].price = book[j].price; g_hm[m].vol = book[j].volume_real; g_hm[m].active = true;
     }
   if(ArraySize(g_hm) > 4000)
     {
      HmNode keep[]; int k = 0; ArrayResize(keep, 0);
      for(int i = 0; i < ArraySize(g_hm); i++) if(g_hm[i].active || g_hm[i].end > bar - 1500) { ArrayResize(keep, k + 1); keep[k++] = g_hm[i]; }
      ArrayResize(g_hm, k); for(int i = 0; i < k; i++) g_hm[i] = keep[i];
     }
  }
#endif

color RampColor(double t)
  {
   static color bookmap[] = { C'10,20,70', C'0,90,200', C'0,190,230', C'40,210,110', C'240,230,40', C'255,140,0', C'235,30,30', C'255,245,230' };
   static color thermal[] = { C'20,0,40', C'90,10,120', C'180,20,110', C'240,70,40', C'255,160,20', C'255,230,90', C'255,255,235' };
   static color ocean[] = { C'5,15,40', C'10,60,120', C'0,130,190', C'40,200,220', C'170,240,245', C'255,255,255' };
   static color mono[] = { C'25,25,30', C'90,90,100', C'170,170,180', C'255,255,255' };
   color s[];
   if(InHmPalette == PALETTE_THERMAL) ArrayCopy(s, thermal); else if(InHmPalette == PALETTE_OCEAN) ArrayCopy(s, ocean); else if(InHmPalette == PALETTE_MONO) ArrayCopy(s, mono); else ArrayCopy(s, bookmap);
   t = MathMax(0, MathMin(1, t));
   int n = ArraySize(s);
   double pos = t * (n - 1); int k = MathMin(n - 2, (int)MathFloor(pos)); double f = pos - k;
   int r1 = s[k] & 0xFF, g1 = (s[k] >> 8) & 0xFF, b1 = (s[k] >> 16) & 0xFF, r2 = s[k + 1] & 0xFF, g2 = (s[k + 1] >> 8) & 0xFF, b2 = (s[k + 1] >> 16) & 0xFF;
   return (color)((int)(r1 + (r2 - r1) * f) | ((int)(g1 + (g2 - g1) * f) << 8) | ((int)(b1 + (b2 - b1) * f) << 16));
  }

//+------------------------------------------------------------------+
//| drawing                                                            |
//+------------------------------------------------------------------+
uint A(color c, int a) { return ColorToARGB(c, (uchar)MathMax(0, MathMin(255, a))); }
string Money(double v, bool sign = false) { return (v < 0 ? "-$" : (sign && v > 0 ? "+$" : "$")) + DoubleToString(MathAbs(v), 2); }
string NumS(double v, bool sign = false) { return (sign && v > 0 ? "+" : "") + DoubleToString(v, 2); }
string Mask(string id) { return StringLen(id) > 9 ? StringSubstr(id, 0, 4) + "•••" + StringSubstr(id, StringLen(id) - 3) : id; }
color HexColor(string h, color fb)
  {
   if(StringLen(h) < 7) return fb;
   int r = (int)StringToInteger("0x" + StringSubstr(h, 1, 2)), g = (int)StringToInteger("0x" + StringSubstr(h, 3, 2)), b = (int)StringToInteger("0x" + StringSubstr(h, 5, 2));
   return (color)(r | (g << 8) | (b << 16));
  }

void Font(CCanvas &c, int size, bool bold) { c.FontSet("Segoe UI", -size * 10, bold ? FW_SEMIBOLD : FW_NORMAL); }
int TW(CCanvas &c, string s) { return c.TextWidth(s); }
int TH(CCanvas &c) { return c.TextHeight("Ag"); }
string Fit(CCanvas &c, string s, int w) { if(TW(c, s) <= w) return s; while(StringLen(s) > 1 && TW(c, s + "…") > w) s = StringSubstr(s, 0, StringLen(s) - 1); return s + "…"; }

void PlaceXY(int corner, int w, int h, int dx, int dy, int &x, int &y)
  {
   if(corner == CORNER_TOPLEFT) { x = dx; y = dy; }
   else if(corner == CORNER_TOPRIGHT) { x = g_w - w - dx; y = dy; }
   else if(corner == CORNER_BOTTOMLEFT) { x = dx; y = g_h - h - dy; }
   else if(corner == CORNER_BOTTOMRIGHT) { x = g_w - w - dx; y = g_h - h - dy; }
   else if(corner == CORNER_TOPMIDDLE) { x = (g_w - w) / 2 + dx; y = dy; }
   else { x = (g_w - w) / 2 + dx; y = g_h - h - dy; }
  }

void Box(int x, int y, int w, int h)
  {
   g_front.FillRectangle(x, y, x + w, y + h, A(InBackColor, (int)(255 * InPanelOpacity / 100.0)));
   g_front.Rectangle(x, y, x + w, y + h, A(InBorderColor, 255));
  }

int Chip(string text, color c, int x, int y, int h)
  {
   Font(g_front, InFontSize - 1, false);
   int w = TW(g_front, text) + 14;
   g_front.FillRectangle(x, y, x + w, y + h, A(c, 45));
   g_front.Rectangle(x, y, x + w, y + h, A(c, 160));
   g_front.TextOut(x + 7, y + (h - TH(g_front)) / 2, text, A(c, 255));
   return w;
  }

void PrunePopups()
  {
   int k = 0, n = ArraySize(g_popups);
   for(int i = 0; i < n; i++) if(g_popupUntil[i] >= TimeLocal()) { if(k != i) { g_popups[k] = g_popups[i]; g_popupUntil[k] = g_popupUntil[i]; } k++; }
   if(k != n) { ArrayResize(g_popups, k); ArrayResize(g_popupUntil, k); }
  }

// solid, dashed or dotted line on a canvas (drawn as short segments, so it works with every Canvas.mqh version)
void DashLine(CCanvas &c, int x1, int y1, int x2, int y2, uint clr, int style)
  {
   if(style == STYLE_SOLID) { c.Line(x1, y1, x2, y2, clr); return; }
   double len = MathSqrt((double)(x2 - x1) * (x2 - x1) + (double)(y2 - y1) * (y2 - y1));
   if(len < 1) return;
   double on = style == STYLE_DOT ? 2 : 6, off = style == STYLE_DOT ? 3 : 4;
   for(double d = 0; d < len; d += on + off)
     {
      double e = MathMin(len, d + on);
      c.Line(x1 + (int)((x2 - x1) * d / len), y1 + (int)((y2 - y1) * d / len), x1 + (int)((x2 - x1) * e / len), y1 + (int)((y2 - y1) * e / len), clr);
     }
  }

bool XY(datetime t, double price, int &x, int &y) { return ChartTimePriceToXY(0, 0, t, price, x, y); }

void Render()
  {
   int w = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS), h = (int)ChartGetInteger(0, CHART_HEIGHT_IN_PIXELS);
   if(w != g_w || h != g_h) { g_w = w; g_h = h; g_front.Resize(MathMax(w, 10), MathMax(h, 10)); g_back.Resize(MathMax(w, 10), MathMax(h, 10)); }
   g_front.Erase(0); g_back.Erase(0);
   ArrayResize(g_rows, 0); ArrayResize(g_rowIndex, 0);
   SetR(g_newsHdr, 0, 0, 0, 0); SetR(g_stats, 0, 0, 0, 0);
   PrunePopups();
   if(InShowHeatmap) DrawHeatmap();
   if(InShowGamma && g_hasGex && g_gexError == "") DrawGamma();
   if(InShowExecutions) DrawExecutions();
   if(InShowEventMarkers) DrawEvents();
   int bottom = 0;
   if(InShowAccount) bottom = DrawAccount();
   if(InShowAllPositions) DrawPositions(bottom);
   if(InShowNews) DrawNews();
   if(InShowPopups) DrawPopups();
   if(g_detail >= 0 && g_detail < ArraySize(g_news)) DrawDetail(g_news[g_detail]);
   g_back.Update(false); g_front.Update(true);
  }

void Level(double price, string name, color c, bool major)
  {
   int x, y;
   if(!XY(TimeCurrent(), price, x, y) || y < -40 || y > g_h + 40) return;
   if(InGammaZones)
     {
      int x2, y2; XY(TimeCurrent(), price + _Point * InZoneTicks / 2.0, x2, y2);
      int half = MathMax(1, MathAbs(y - y2));
      g_front.FillRectangle(0, y - half, g_w, y + half, A(c, major ? 45 : 25));
     }
   else
     {
      for(int k = 0; k < InLevelWidth; k++) DashLine(g_front, 0, y + k, g_w, y + k, A(c, major ? 220 : 140), major ? STYLE_SOLID : STYLE_DASH);
     }
   string label = name + " " + DoubleToString(price, _Digits);
   Font(g_front, InFontSize - 1, false);
   int lw = TW(g_front, label) + 10, lh = TH(g_front) + 4;
   int lx = InLabelSide == LABELSIDE_LEFT ? 6 : InLabelSide == LABELSIDE_MIDDLE ? (g_w - lw) / 2 : g_w - lw - 70;
   g_front.FillRectangle(lx, y - lh / 2, lx + lw, y + lh / 2, A(InBackColor, 220));
   g_front.Rectangle(lx, y - lh / 2, lx + lw, y + lh / 2, A(c, 160));
   g_front.TextOut(lx + 5, y - lh / 2 + 2, label, A(c, 255));
  }

void DrawGamma()
  {
   if(InShowWalls && g_hasCall) Level(g_call, "Call wall", InCallWallColor, true);
   if(InShowWalls && g_hasPut) Level(g_put, "Put wall", InPutWallColor, true);
   if(InShowFlip && g_hasFlip) Level(g_flip, "Gamma flip", InFlipColor, true);
   if(InShowOtherLevels)
     {
      for(int i = 0; i < ArraySize(g_pos); i++) Level(g_pos[i], "+γ", InPosLevelColor, false);
      for(int i = 0; i < ArraySize(g_neg); i++) Level(g_neg[i], "−γ", InNegLevelColor, false);
     }
  }

void Marker(int x, int y, bool buy, double qty)
  {
   color c = buy ? InExecBuyColor : InExecSellColor;
   int s = InExecSize, h = MathMax(3, (int)(s * 0.9)), half = MathMax(2, s / 2), d = buy ? 1 : -1, labelY;
   if(InExecMarker == MARKERSTYLE_CIRCLES) { g_front.FillCircle(x, y, half, A(c, 255)); g_front.Circle(x, y, half, A(clrBlack, 200)); labelY = buy ? y + half + 1 : y - half - 1; }
   else
     {
      if(InExecMarker == MARKERSTYLE_ARROWS) { int sw = MathMax(2, half / 2); g_front.FillRectangle(x - sw / 2, buy ? y + h : y - 2 * h, x + sw / 2, buy ? y + 2 * h : y - h, A(c, 255)); }
      g_front.FillTriangle(x, y, x - half, y + d * h, x + half, y + d * h, A(c, 255));
      labelY = buy ? y + h * (InExecMarker == MARKERSTYLE_ARROWS ? 2 : 1) + 1 : y - h * (InExecMarker == MARKERSTYLE_ARROWS ? 2 : 1) - 1;
     }
   if(InExecShowQty && qty > 0)
     {
      Font(g_front, InFontSize - 1, false);
      string t = DoubleToString(qty, 2); while(StringFind(t, ".") >= 0 && (StringSubstr(t, StringLen(t) - 1) == "0" || StringSubstr(t, StringLen(t) - 1) == ".")) { bool dot = StringSubstr(t, StringLen(t) - 1) == "."; t = StringSubstr(t, 0, StringLen(t) - 1); if(dot) break; }
      g_front.TextOut(x - TW(g_front, t) / 2, buy ? labelY : labelY - TH(g_front), t, A(c, 255));
     }
  }

void Trip(datetime t1, double p1, datetime t2, double p2, bool lng, double qty, double pnl, bool complete)
  {
   int x1, y1, x2, y2;
   if(!XY(t1, p1, x1, y1)) return;
   if(complete && XY(t2, p2, x2, y2))
     {
      if(InExecConnect)
        {
         int st = InExecLineStyle == LINEKIND_SOLID ? STYLE_SOLID : InExecLineStyle == LINEKIND_DOTTED ? STYLE_DOT : STYLE_DASH;
         for(int k = 0; k < InExecLineWidth; k++) DashLine(g_front, x1, y1 + k, x2, y2 + k, A(pnl >= 0 ? InExecWinColor : InExecLossColor, 230), st);
        }
      Marker(x1, y1, lng, qty); Marker(x2, y2, !lng, qty);
      if(InExecShowResult)
        {
         double move = (p2 - p1) * (lng ? 1 : -1);
         string text = InExecResultUnit == RESULTUNIT_TICKS ? (move >= 0 ? "+" : "") + DoubleToString(move / _Point, 0) + "t" : InExecResultUnit == RESULTUNIT_POINTS ? (move >= 0 ? "+" : "") + DoubleToString(move, _Digits) : Money(pnl, true);
         color c = (InExecResultUnit == RESULTUNIT_MONEY ? pnl >= 0 : move >= 0) ? InExecWinColor : InExecLossColor;
         Font(g_front, InFontSize - 1, false);
         int w = TW(g_front, text) + 10, h = TH(g_front) + 4, gap = InExecSize + 4;
         int bx = x2 + gap / 2, by = !lng ? y2 + gap : y2 - gap - h;
         g_front.FillRectangle(bx, by, bx + w, by + h, A(InBackColor, 235)); g_front.Rectangle(bx, by, bx + w, by + h, A(c, 200));
         g_front.TextOut(bx + 5, by + 2, text, A(c, 255));
        }
     }
   else Marker(x1, y1, lng, qty);
  }

void DrawExecutions()
  {
   int first = (int)ChartGetInteger(0, CHART_FIRST_VISIBLE_BAR);
   datetime from = iTime(_Symbol, _Period, MathMin(first, Bars(_Symbol, _Period) - 1));
#ifdef __MQL5__
   if(!HistorySelect(from - 86400, ServerNow() + 60)) return;
   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
     {
      ulong tk = HistoryDealGetTicket(i);
      if(HistoryDealGetString(tk, DEAL_SYMBOL) != _Symbol) continue;
      long entry = HistoryDealGetInteger(tk, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY && entry != DEAL_ENTRY_INOUT) continue;
      long pid = HistoryDealGetInteger(tk, DEAL_POSITION_ID);
      // the position's opening deal
      datetime t1 = 0; double p1 = 0;
      for(int j = 0; j < total; j++)
        {
         ulong tj = HistoryDealGetTicket(j);
         if(HistoryDealGetInteger(tj, DEAL_POSITION_ID) == pid && HistoryDealGetInteger(tj, DEAL_ENTRY) == DEAL_ENTRY_IN) { t1 = (datetime)HistoryDealGetInteger(tj, DEAL_TIME); p1 = HistoryDealGetDouble(tj, DEAL_PRICE); break; }
        }
      if(t1 == 0) continue;
      bool lng = HistoryDealGetInteger(tk, DEAL_TYPE) == DEAL_TYPE_SELL; // closing a long is a sell
      double pnl = HistoryDealGetDouble(tk, DEAL_PROFIT) + HistoryDealGetDouble(tk, DEAL_SWAP) + HistoryDealGetDouble(tk, DEAL_COMMISSION);
      Trip(t1, p1, (datetime)HistoryDealGetInteger(tk, DEAL_TIME), HistoryDealGetDouble(tk, DEAL_PRICE), lng, HistoryDealGetDouble(tk, DEAL_VOLUME), pnl, true);
     }
   for(int i = 0; i < PositionsTotal(); i++)
     {
      ulong tk = PositionGetTicket(i);
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      bool lng = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY;
      double price = PositionGetDouble(POSITION_PRICE_OPEN), vol = PositionGetDouble(POSITION_VOLUME);
      Trip((datetime)PositionGetInteger(POSITION_TIME), price, 0, 0, lng, vol, 0, false);
      if(InExecShowAvg) AvgLine(price, lng, vol);
     }
#else
   for(int i = 0; i < OrdersHistoryTotal(); i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY) || OrderSymbol() != _Symbol || OrderType() > OP_SELL || OrderCloseTime() < from) continue;
      Trip(OrderOpenTime(), OrderOpenPrice(), OrderCloseTime(), OrderClosePrice(), OrderType() == OP_BUY, OrderLots(), OrderProfit() + OrderSwap() + OrderCommission(), true);
     }
   for(int i = 0; i < OrdersTotal(); i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES) || OrderSymbol() != _Symbol || OrderType() > OP_SELL) continue;
      Trip(OrderOpenTime(), OrderOpenPrice(), 0, 0, OrderType() == OP_BUY, OrderLots(), 0, false);
      if(InExecShowAvg) AvgLine(OrderOpenPrice(), OrderType() == OP_BUY, OrderLots());
     }
#endif
  }

void AvgLine(double price, bool lng, double vol)
  {
   int x, y;
   if(!XY(TimeCurrent(), price, x, y)) return;
   DashLine(g_front, 0, y, g_w, y, A(InExecAvgColor, 255), STYLE_DASH);
   string label = (lng ? "LONG " : "SHORT ") + DoubleToString(vol, 2) + " avg " + DoubleToString(price, _Digits);
   Font(g_front, InFontSize - 1, false);
   int w = TW(g_front, label) + 10, h = TH(g_front) + 4, bx = g_w - w - 90;
   g_front.FillRectangle(bx, y - h / 2, bx + w, y + h / 2, A(InBackColor, 235)); g_front.Rectangle(bx, y - h / 2, bx + w, y + h / 2, A(InExecAvgColor, 255));
   g_front.TextOut(bx + 5, y - h / 2 + 2, label, A(InExecAvgColor, 255));
  }

void DrawHeatmap()
  {
   int n = ArraySize(g_hm);
   if(n == 0) return;
   double vols[]; ArrayResize(vols, 0);
   for(int i = MathMax(0, n - 3000); i < n; i++) { int m = ArraySize(vols); ArrayResize(vols, m + 1); vols[m] = g_hm[i].vol; }
   ArraySort(vols);
   double top = vols[MathMin(ArraySize(vols) - 1, (int)MathRound((ArraySize(vols) - 1) * 0.99))];
   double lo = MathLog10(1 + InHmThreshold), hi = MathMax(MathLog10(1 + top), lo + 0.3);
   int bars = Bars(_Symbol, _Period);
   int px = (int)MathPow(2, (int)ChartGetInteger(0, CHART_SCALE));
   for(int i = 0; i < n; i++)
     {
      int x1, y, x2, yy;
      datetime t1 = iTime(_Symbol, _Period, MathMax(0, bars - 1 - g_hm[i].start));
      if(!XY(t1, g_hm[i].price, x1, y)) continue;
      if(g_hm[i].active && InHmExtendLive) x2 = g_w;
      else { datetime t2 = iTime(_Symbol, _Period, MathMax(0, bars - 1 - g_hm[i].end)); XY(t2, g_hm[i].price, x2, yy); x2 += px; }
      if(x2 < 0 || x1 > g_w || y < -20 || y > g_h + 20) continue;
      double t = MathPow(MathMax(0, MathMin(1, (MathLog10(1 + g_hm[i].vol) - lo) / (hi - lo))), InHmContrast);
      color c = RampColor(t);
      int a = (int)MathRound(255 * (0.15 + 0.85 * MathPow(t, 1.35)) * InHmOpacity / 100.0);
      int row = 2, halo = (int)(3 + 4 * t);
      g_back.FillRectangle(x1, y - halo, MathMax(x1 + 1, x2), y + halo, A(c, a / 4));
      g_back.FillRectangle(x1, y - row, MathMax(x1 + 1, x2), y + row, A(c, a));
      if(InHmTags && g_hm[i].active && t > 0.6)
        {
         Font(g_back, InFontSize - 2, false);
         string s = DoubleToString(g_hm[i].vol, 0);
         int tw = TW(g_back, s) + 8;
         g_back.FillRectangle(g_w - tw - 16, y - 7, g_w - 16, y + 7, A(clrBlack, 215));
         g_back.TextOut(g_w - tw - 12, y - 6, s, A(clrWhite, 255));
        }
     }
  }

void DrawEvents()
  {
   long off = (long)(ServerNow() - TimeGMT());
   for(int i = 0; i < ArraySize(g_events); i++)
     {
      string imp = g_events[i].impact;
      if(InEventMinImpact == EVENTLEVEL_HIGHONLY && imp != "high") continue;
      if(InEventMinImpact == EVENTLEVEL_MEDIUMANDHIGH && imp == "low") continue;
      int x, y;
      if(!XY((datetime)(g_events[i].t / 1000 + off), SymbolInfoDouble(_Symbol, SYMBOL_BID), x, y) || x < 0 || x > g_w) continue;
      color c = imp == "high" ? InNegativeColor : imp == "medium" ? InWarningColor : InMutedColor;
      DashLine(g_front, x, 0, x, g_h - 18, A(c, 110), STYLE_DOT);
      string tag = imp == "high" ? "HIGH" : imp == "medium" ? "MED" : "LOW";
      Font(g_front, InFontSize - 2, true);
      int w = TW(g_front, tag) + 10, h = TH(g_front) + 4;
      g_front.FillRectangle(x - w / 2, g_h - h - 4, x + w / 2, g_h - 4, A(c, 90));
      g_front.TextOut(x - w / 2 + 5, g_h - h - 2, tag, A(clrWhite, 255));
     }
  }

int DrawAccount()
  {
   int w = InAccountWidth, pad = 10;
   Font(g_front, InFontSize, false); int lh = TH(g_front);
   Font(g_front, InFontSize - 1, false); int sh = TH(g_front);
   Font(g_front, InFontSize + 3, true); int bh = TH(g_front);
   int chipH = sh + 8, tileH = sh + bh + 14, statRowH = sh + lh + 10, cols = w >= 270 ? 4 : 2;
   double price = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   string gamma = ""; color gc = InMutedColor;
   if(g_hasGex && g_gexError == "")
     {
      bool pos = g_hasFlip && price > 0 ? price >= g_flip : g_gexZone == "positive";
      if(g_hasFlip || g_gexZone != "") { gamma = pos ? "γ+ Positive gamma · pinning" : "γ− Negative gamma · trending"; gc = pos ? InPositiveColor : InNegativeColor; }
     }
   bool chips = (InShowTierChip && g_hasAcct && g_tier != "") || (InShowGammaChip && gamma != "");
   double dll = g_hasAcct ? g_dll : 0, target = TargetValue(), open = OpenPnl();
   int h = pad + lh + pad;
   if(chips) h += chipH + 8;
   if(g_blocked) h += sh + 16;
   if(InShowPnlTiles) h += tileH + 8;
   if(InShowBuffer && (dll > 0 || target > 0)) h += sh + 6 + 10 + sh + 10;
   if(InShowStats && g_trades > 0) h += g_statsCollapsed ? sh + 12 : statRowH * (8 / cols) + 2;
   if(InShowGexLine && g_hasGex) h += lh + 10;
   int x0, y0; PlaceXY(InAccountPlacement, w, h, InAccountX, InAccountY, x0, y0);
   Box(x0, y0, w, h);
   int x = x0 + pad, y = y0 + pad;
   Font(g_front, InFontSize, true);
   g_front.TextOut(x, y, "Ronin", A(InTextColor, 255)); int cx = x + TW(g_front, "Ronin");
   g_front.TextOut(cx, y, "Flow", A(InAccentColor, 255)); cx += TW(g_front, "Flow") + 8;
   Font(g_front, InFontSize, false); g_front.TextOut(cx, y, Mask(Login()), A(InMutedColor, 255));
   string state = g_got == 0 || TimeLocal() - g_got > 20 ? "offline" : g_blocked ? "blocked" : g_paused ? "rules paused" : g_enforcing ? "enforcing" : "live";
   color stc = state == "offline" ? InMutedColor : state == "blocked" ? InNegativeColor : state == "rules paused" ? InWarningColor : InPositiveColor;
   Font(g_front, InFontSize - 1, false);
   int sw = TW(g_front, state);
   g_front.TextOut(x0 + w - pad - sw, y + (lh - sh) / 2, state, A(InMutedColor, 255));
   g_front.FillCircle(x0 + w - pad - sw - 8, y + lh / 2, 3, A(stc, 255));
   y += lh + pad;
   g_front.Line(x0 + 1, y - pad / 2, x0 + w - 1, y - pad / 2, A(InBorderColor, 255));
   if(chips)
     {
      int chx = x;
      if(InShowTierChip && g_hasAcct && g_tier != "") chx += Chip("● Tier " + g_tier + " " + IntegerToString(g_level + 1) + "/" + IntegerToString(MathMax(1, g_of)), HexColor(g_tierColor, InAccentColor), chx, y, chipH) + 6;
      if(InShowGammaChip && gamma != "") { Font(g_front, InFontSize - 1, false); Chip(Fit(g_front, gamma, x0 + w - pad - chx - 14), gc, chx, y, chipH); }
      y += chipH + 8;
     }
   if(g_blocked)
     {
      Font(g_front, InFontSize - 1, false);
      g_front.FillRectangle(x, y, x0 + w - pad, y + sh + 10, A(InNegativeColor, 35)); g_front.Rectangle(x, y, x0 + w - pad, y + sh + 10, A(InNegativeColor, 130));
      g_front.TextOut(x + 7, y + 5, Fit(g_front, "New orders blocked — " + (g_reason != "" ? g_reason : "a risk rule is broken"), w - pad * 2 - 14), A(InNegativeColor, 255));
      y += sh + 16;
     }
   if(InShowPnlTiles)
     {
      int tw = (w - pad * 2 - 12) / 3;
      string labels[3] = { "OPEN", "CLOSED", "TRADES" };
      string vals[3]; vals[0] = NumS(open, true); vals[1] = NumS(g_realised, true); vals[2] = g_maxTrades > 0 ? IntegerToString(g_trades) + " / " + IntegerToString(g_maxTrades) : IntegerToString(g_trades);
      double tones[3]; tones[0] = open; tones[1] = g_realised; tones[2] = 0;
      for(int i = 0; i < 3; i++)
        {
         int tx = x + i * (tw + 6);
         color tone = tones[i] > 0 ? InPositiveColor : tones[i] < 0 ? InNegativeColor : InTileColor;
         g_front.FillRectangle(tx, y, tx + tw, y + tileH, tones[i] == 0 ? A(InTileColor, 255) : A(tone, 40));
         g_front.Rectangle(tx, y, tx + tw, y + tileH, tones[i] == 0 ? A(InBorderColor, 255) : A(tone, 110));
         Font(g_front, InFontSize - 1, false); g_front.TextOut(tx + 8, y + 5, labels[i], A(InMutedColor, 255));
         Font(g_front, InFontSize + 3, true); g_front.TextOut(tx + 8, y + 7 + sh, vals[i], A(tones[i] > 0 ? InPositiveColor : tones[i] < 0 ? InNegativeColor : InTextColor, 255));
        }
      y += tileH + 8;
     }
   if(InShowBuffer && (dll > 0 || target > 0))
     {
      double now = g_realised + (InBufferClosedOnly ? 0 : open);
      double stop = dll > 0 ? (g_trail > 0 ? MathMax(-dll, g_peak - g_trail) : -dll) : 0;
      Font(g_front, InFontSize - 1, false);
      string left = dll > 0 ? "Buffer to loss limit" : "To profit target";
      string right = dll > 0 ? Money(MathMax(0, now - stop)) + " of " + Money(dll) : (target - now > 0 ? Money(target - now) + " to go" : "hit");
      g_front.TextOut(x, y, left, A(InMutedColor, 255));
      g_front.TextOut(x0 + w - pad - TW(g_front, right), y, right, A(dll > 0 && now - stop <= dll * 0.25 ? InNegativeColor : InTextColor, 255));
      y += sh + 6;
      int bw = w - pad * 2;
      double lo = dll > 0 ? -dll : MathMin(MathMin(0, now), -target / 2), hi = MathMax(MathMax(g_peak, now), target > 0 ? target : dll * 0.5);
      if(hi <= lo) hi = lo + 1;
      for(int i = 0; i < bw; i++) { double f = (double)i / bw; g_front.FillRectangle(x + i, y, x + i + 1, y + 6, A(f < 0.5 ? InNegativeColor : InPositiveColor, 90)); }
      if(dll > 0) { int sx = x + (int)((MathMax(lo, MathMin(hi, stop)) - lo) / (hi - lo) * bw); g_front.FillRectangle(sx - 1, y - 2, sx + 1, y + 8, A(InNegativeColor, 255)); }
      if(target > 0) { int txx = MathMin(x + bw - 2, x + (int)((MathMax(lo, MathMin(hi, target)) - lo) / (hi - lo) * bw)); g_front.FillRectangle(txx - 1, y - 2, txx + 1, y + 8, A(InPositiveColor, 255)); }
      int nx = x + (int)((MathMax(lo, MathMin(hi, now)) - lo) / (hi - lo) * bw); g_front.FillRectangle(nx - 1, y - 3, nx + 2, y + 9, A(clrWhite, 255));
      y += 10;
      if(dll > 0) g_front.TextOut(x, y, "stop " + NumS(stop, true), A(InMutedColor, 255));
      string hiT = "high " + NumS(g_peak, true);
      if(target > 0) { string tt = "target " + NumS(target, true); g_front.TextOut(x0 + w - pad - TW(g_front, tt), y, tt, A(InPositiveColor, 255)); g_front.TextOut(x + (bw - TW(g_front, hiT)) / 2, y, hiT, A(InMutedColor, 255)); }
      else g_front.TextOut(x0 + w - pad - TW(g_front, hiT), y, hiT, A(InMutedColor, 255));
      y += sh + 10;
     }
   if(InShowStats && g_trades > 0)
     {
      if(g_statsCollapsed)
        {
         Font(g_front, InFontSize - 1, false);
         g_front.TextOut(x, y, "Stats ▸  " + IntegerToString(g_trades) + " trades · " + DoubleToString(100.0 * g_wins / g_trades, 0) + "% won", A(InMutedColor, 255));
         SetR(g_stats, x, y, x0 + w - pad, y + sh + 6);
         y += sh + 12;
        }
      else
        {
         double wr = (double)g_wins / g_trades, aw = g_wins > 0 ? g_grossWin / g_wins : 0, al = g_losses > 0 ? g_grossLoss / g_losses : 0;
         double pf = g_grossLoss > 0 ? g_grossWin / g_grossLoss : (g_grossWin > 0 ? 99 : 0), ev = g_realised / g_trades, edge = al > 0 ? wr * aw / al : 0;
         string names[8] = { "Win rate", "Profit f.", "EV", "Edge", "Avg win", "Avg loss", "Best", "Worst" };
         string v[8]; color cc[8];
         v[0] = DoubleToString(wr * 100, 0) + "%"; cc[0] = InTextColor;
         v[1] = DoubleToString(pf, 2); cc[1] = pf >= 1 ? InPositiveColor : InNegativeColor;
         v[2] = NumS(ev, true); cc[2] = ev >= 0 ? InPositiveColor : InNegativeColor;
         v[3] = DoubleToString(edge, 2); cc[3] = edge >= 0.75 ? InPositiveColor : edge >= 0.5 ? InWarningColor : InNegativeColor;
         v[4] = DoubleToString(aw, 2); cc[4] = InPositiveColor; v[5] = DoubleToString(al, 2); cc[5] = InNegativeColor;
         v[6] = NumS(g_best, true); cc[6] = InPositiveColor; v[7] = NumS(g_worst, true); cc[7] = InNegativeColor;
         int cw = (w - pad * 2) / cols;
         SetR(g_stats, x, y, x0 + w - pad, y + statRowH * (8 / cols));
         for(int i = 0; i < 8; i++)
           {
            int sx = x + (i % cols) * cw, sy = y + (i / cols) * statRowH;
            Font(g_front, InFontSize - 1, false); g_front.TextOut(sx, sy + 3, names[i], A(InMutedColor, 255));
            Font(g_front, InFontSize, true); g_front.TextOut(sx, sy + 4 + sh, v[i], A(cc[i], 255));
           }
         y += statRowH * (8 / cols) + 2;
        }
     }
   if(InShowGexLine && g_hasGex)
     {
      Font(g_front, InFontSize, false);
      string t = g_gexError != "" ? "GEX: " + g_gexError : g_gexIndex + " GEX " + (g_gexTotal >= 0 ? "+" : "-") + "$" + DoubleToString(MathAbs(g_gexTotal) / 1e9, 2) + "B" + (g_hasFlip ? " · flip " + DoubleToString(g_flip, _Digits) : "") + (g_delayed ? " · delayed" : "");
      g_front.TextOut(x, y + 2, Fit(g_front, t, w - pad * 2), A(g_gexTotal >= 0 ? InPositiveColor : InNegativeColor, 255));
     }
   return y0 + h;
  }

void DrawPositions(int top)
  {
   int n = 0;
#ifdef __MQL5__
   n = PositionsTotal();
#else
   n = OpenCount();
#endif
   if(n == 0) return;
   Font(g_front, InFontSize, false);
   int pad = 8, lh = TH(g_front), rowH = lh + 5, w = InAccountWidth, h = pad * 2 + n * rowH;
   int x0, y0; PlaceXY(InAccountPlacement, w, h, InAccountX, InAccountY, x0, y0);
   bool below = InAccountPlacement == CORNER_TOPLEFT || InAccountPlacement == CORNER_TOPRIGHT || InAccountPlacement == CORNER_TOPMIDDLE;
   if(InShowAccount) y0 = below ? top + 6 : y0 - h - 6;
   Box(x0, y0, w, h);
   int y = y0 + pad;
#ifdef __MQL5__
   for(int i = 0; i < n; i++)
     {
      ulong tk = PositionGetTicket(i);
      bool lng = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY;
      double pnl = PositionGetDouble(POSITION_PROFIT);
      PosRow(x0, y, w, pad, PositionGetString(POSITION_SYMBOL), lng, PositionGetDouble(POSITION_VOLUME), pnl);
      y += rowH;
     }
#else
   for(int i = 0; i < OrdersTotal(); i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES) || OrderType() > OP_SELL) continue;
      PosRow(x0, y, w, pad, OrderSymbol(), OrderType() == OP_BUY, OrderLots(), OrderProfit() + OrderSwap() + OrderCommission());
      y += rowH;
     }
#endif
  }

void PosRow(int x0, int y, int w, int pad, string sym, bool lng, double vol, double pnl)
  {
   Font(g_front, InFontSize, true);
   g_front.TextOut(x0 + pad, y, (lng ? "LONG " : "SHORT ") + DoubleToString(vol, 2) + " " + sym, A(lng ? InPositiveColor : InNegativeColor, 255));
   string p = NumS(pnl, true);
   g_front.TextOut(x0 + w - pad - TW(g_front, p), y, p, A(pnl >= 0 ? InPositiveColor : InNegativeColor, 255));
  }

void DrawNews()
  {
   if(g_got == 0) return;
   Font(g_front, InFontSize, false); int lh = TH(g_front);
   Font(g_front, InFontSize - 1, false); int sh = TH(g_front);
   int w = InNewsWidth, pad = 10, rowH = lh + sh + 10;
   int idx[]; ArrayResize(idx, 0);
   for(int i = 0; i < ArraySize(g_news) && ArraySize(idx) < InNewsRows; i++) if(g_news[i].imp >= InNewsMinImportance) { int m = ArraySize(idx); ArrayResize(idx, m + 1); idx[m] = i; }
   int h = pad + lh + (g_newsCollapsed ? pad : 8 + MathMax(1, ArraySize(idx)) * rowH + 2);
   int x0, y0; PlaceXY(InNewsPlacement, w, h, InNewsX, InNewsY, x0, y0);
   Box(x0, y0, w, h);
   int x = x0 + pad, y = y0 + pad;
   Font(g_front, InFontSize, true);
   g_front.TextOut(x, y, (g_newsCollapsed ? "▸ " : "▾ ") + "News" + (g_marketLabel != "" ? " · " + g_marketLabel : ""), A(InTextColor, 255));
   SetR(g_newsHdr, x0, y0, x0 + w, y0 + lh + pad * 2);
   if(g_newsCollapsed) return;
   y += lh + 8;
   if(ArraySize(idx) == 0) { Font(g_front, InFontSize - 1, false); g_front.TextOut(x, y, "No headlines yet", A(InMutedColor, 255)); return; }
   for(int k = 0; k < ArraySize(idx); k++)
     {
      NewsRow n = g_news[idx[k]];
      color c = n.imp >= 3 ? InNegativeColor : n.imp >= 2 ? InWarningColor : InMutedColor;
      g_front.FillRectangle(x0 + 1, y + 2, x0 + 3, y + rowH - 4, A(c, 255));
      Font(g_front, InFontSize - 1, false);
      string meta = TimeToString((datetime)(n.t / 1000 + (TimeLocal() - TimeGMT())), TIME_MINUTES) + " · " + n.src + (n.dir > 0 ? " · ↑" : n.dir < 0 ? " · ↓" : "");
      g_front.TextOut(x, y, meta, A(n.dir > 0 ? InPositiveColor : n.dir < 0 ? InNegativeColor : InMutedColor, 255));
      Font(g_front, InFontSize, false);
      g_front.TextOut(x, y + sh + 2, Fit(g_front, n.title, w - pad * 2), A(InTextColor, 255));
      int m = ArraySize(g_rowIndex); ArrayResize(g_rowIndex, m + 1); ArrayResize(g_rows, m + 1);
      g_rowIndex[m] = idx[k]; g_rows[m][0] = x0; g_rows[m][1] = y - 2; g_rows[m][2] = x0 + w; g_rows[m][3] = y + rowH - 2;
      y += rowH;
     }
  }

void DrawPopups()
  {
   int n = ArraySize(g_popups);
   if(n == 0) return;
   Font(g_front, InFontSize, true); int lh = TH(g_front);
   Font(g_front, InFontSize - 1, false); int sh = TH(g_front);
   int w = 340, pad = 10, offset = 0;
   for(int i = n - 1; i >= 0 && i >= n - 3; i--)
     {
      int h = pad * 2 + sh + 4 + lh;
      int x0, y0; PlaceXY(InPopupPlacement, w, h, InPopupX, InPopupY, x0, y0);
      bool top = InPopupPlacement == CORNER_TOPLEFT || InPopupPlacement == CORNER_TOPRIGHT || InPopupPlacement == CORNER_TOPMIDDLE;
      y0 = top ? y0 + offset : y0 - offset;
      color c = g_popups[i].imp >= 3 ? InNegativeColor : g_popups[i].imp >= 2 ? InWarningColor : InAccentColor;
      Box(x0, y0, w, h);
      g_front.FillRectangle(x0 + 1, y0 + 1, x0 + 4, y0 + h - 1, A(c, 255));
      Font(g_front, InFontSize - 1, false); g_front.TextOut(x0 + pad + 2, y0 + pad, (g_popups[i].imp >= 3 ? "HIGH IMPACT · " : "") + g_popups[i].src, A(c, 255));
      Font(g_front, InFontSize, true); g_front.TextOut(x0 + pad + 2, y0 + pad + sh + 4, Fit(g_front, g_popups[i].title, w - pad * 2), A(InTextColor, 255));
      offset += h + 8;
     }
  }

void DrawDetail(NewsRow &n)
  {
   int w = MathMin(540, g_w - 40), pad = 16;
   Font(g_front, InFontSize, false); int lh = TH(g_front);
   string lines[]; int count = 0; ArrayResize(lines, 0);
   string words[]; int nw = StringSplit(n.summary != "" ? n.summary : n.title, ' ', words);
   string cur = "";
   for(int i = 0; i < nw && count < 8; i++)
     {
      string next = cur == "" ? words[i] : cur + " " + words[i];
      if(TW(g_front, next) > w - pad * 2 && cur != "") { ArrayResize(lines, count + 1); lines[count++] = cur; cur = words[i]; }
      else cur = next;
     }
   if(cur != "" && count < 8) { ArrayResize(lines, count + 1); lines[count++] = cur; }
   Font(g_front, InFontSize + 2, true); int bh = TH(g_front);
   int h = pad * 2 + bh + 10 + count * (lh + 3) + lh + 6;
   int x0 = (g_w - w) / 2, y0 = MathMax(16, (g_h - h) / 2);
   g_front.FillRectangle(x0, y0, x0 + w, y0 + h, A(InBackColor, 252)); g_front.Rectangle(x0, y0, x0 + w, y0 + h, A(InBorderColor, 255));
   g_front.TextOut(x0 + pad, y0 + pad, Fit(g_front, n.title, w - pad * 2), A(InTextColor, 255));
   Font(g_front, InFontSize, false);
   int y = y0 + pad + bh + 10;
   if(n.summary != "") for(int i = 0; i < count; i++) { g_front.TextOut(x0 + pad, y, lines[i], A(InTextColor, 230)); y += lh + 3; }
   Font(g_front, InFontSize - 1, false);
   g_front.TextOut(x0 + pad, y0 + h - pad - TH(g_front), n.src + " · click anywhere to close", A(InMutedColor, 255));
  }
//+------------------------------------------------------------------+
