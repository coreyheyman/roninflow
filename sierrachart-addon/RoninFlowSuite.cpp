// RoninFlow Suite — Sierra Chart custom study (ACSIL)
//
// RoninFlow on your chart, each part switched on or off in the study's inputs: the account panel (risk tier, gamma
// regime, today's P&L, buffer to the profit target, trade stats, GEX line), your trades on the chart, gamma levels,
// the news feed with pop-ups, today's economic events, and alerts (Sierra Chart alert numbers, so the sounds are the
// ones set under Global Settings → Alerts). Sierra Chart's own Market Depth Historical Graph is the heatmap, and bar
// colours are set in the chart's Graphics Settings, so those two parts aren't repeated here.
//
// It reads RoninFlow through files in %LOCALAPPDATA%\TradeJournal\drop (RoninFlow on this PC answers within a couple
// of seconds), so no network settings are needed.
//
// Install: npm run addon:sierra copies it to ACS_Source; Analysis → Build Custom Studies DLL → RoninFlowSuite.cpp →
// Remote Build; then add "RoninFlow Suite" to a chart.
#include "sierrachart.h"
#include <windows.h>
#include <string>
#include <vector>
#include <cstdlib>
#include <cmath>

SCDLLName("RoninFlow Suite")

enum InputIndex { I_AccountName = 0, I_RefreshSeconds = 1, I_FontSize = 2, I_ShowAccount = 3, I_AccountPlacement = 4, I_AccountX = 5, I_AccountY = 6, I_AccountWidth = 7, I_ShowTierChip = 8, I_ShowGammaChip = 9, I_ShowPnlTiles = 10, I_ShowBuffer = 11, I_BufferClosedOnly = 12, I_ShowStats = 13, I_ShowGexLine = 14, I_ShowAllPositions = 15, I_ShowExecutions = 16, I_ExecMarker = 17, I_ExecSize = 18, I_ExecBuyColor = 19, I_ExecSellColor = 20, I_ExecShowQty = 21, I_ExecConnect = 22, I_ExecWinColor = 23, I_ExecLossColor = 24, I_ExecLineWidth = 25, I_ExecLineStyle = 26, I_ExecShowResult = 27, I_ExecResultUnit = 28, I_ExecShowAvg = 29, I_ExecAvgColor = 30, I_ShowGamma = 31, I_GammaZones = 32, I_ZoneTicks = 33, I_ShowFlip = 34, I_ShowWalls = 35, I_ShowOtherLevels = 36, I_LabelSide = 37, I_CallWallColor = 38, I_PutWallColor = 39, I_FlipColor = 40, I_PosLevelColor = 41, I_NegLevelColor = 42, I_LevelWidth = 43, I_ShowNews = 44, I_NewsPlacement = 45, I_NewsX = 46, I_NewsY = 47, I_NewsWidth = 48, I_NewsRows = 49, I_NewsMinImportance = 50, I_ShowPopups = 51, I_PopupPlacement = 52, I_PopupX = 53, I_PopupY = 54, I_PopupSeconds = 55, I_PopupMinImportance = 56, I_ShowEventMarkers = 57, I_EventMinImpact = 58, I_AlertEntry = 59, I_EntrySound = 60, I_AlertFill = 61, I_FillSound = 62, I_AlertWin = 63, I_WinSound = 64, I_AlertLoss = 65, I_LossSound = 66, I_AlertDll = 67, I_DllSound = 68, I_DllWarnPercent = 69, I_AlertTarget = 70, I_TargetSound = 71, I_ProfitTarget = 72, I_AlertIncludeOpen = 73, I_BackColor = 74, I_BorderColor = 75, I_TileColor = 76, I_TextColor = 77, I_MutedColor = 78, I_PositiveColor = 79, I_NegativeColor = 80, I_WarningColor = 81, I_AccentColor = 82, I_PanelOpacity = 83 };

struct NewsRow { std::string id, src, title; long long t = 0; int imp = 0, dir = 0; };
struct EventRow { long long t = 0; std::string impact, title; };
struct Trip { SCDateTime open, close; double openPrice = 0, closePrice = 0, qty = 0, pnl = 0; bool lng = true, complete = false; };

struct SuiteState
{
	std::string tier, tierColor, reason, marketLabel, gexIndex, gexZone, gexError;
	int level = 0, of = 0, maxTrades = 0;
	double dll = 0, trail = 0, target = 0, gexTotal = 0, flip = 0, call = 0, put = 0;
	bool hasAcct = false, blocked = false, paused = false, enforcing = false, hasGex = false, hasFlip = false, hasCall = false, hasPut = false, delayed = false;
	std::vector<double> pos, neg;
	long long dayStart = 0;
	DWORD got = 0;
	std::vector<NewsRow> news;
	std::vector<EventRow> events;
	std::string seen = "|";
	bool primed = false;
	std::vector<NewsRow> popups; std::vector<DWORD> popupUntil;
	std::vector<Trip> trips;
	double realised = 0, peak = 0, grossWin = 0, grossLoss = 0, best = 0, worst = 0, openPnl = 0;
	int trades = 0, wins = 0, losses = 0, lastFills = -1;
	double lastQty = 0;
	bool dllWarned = false, dllHit = false, targetHit = false; long long alertDay = 0;
	DWORD lastRequest = 0, lastRead = 0;
	std::string req, resp;
};

static std::string Folder()
{
	char base[MAX_PATH] = { 0 };
	DWORD n = GetEnvironmentVariableA("LOCALAPPDATA", base, MAX_PATH);
	std::string dir = std::string(n > 0 && n < MAX_PATH ? base : "C:") + "\\TradeJournal";
	CreateDirectoryA(dir.c_str(), NULL);
	dir += "\\drop";
	CreateDirectoryA(dir.c_str(), NULL);
	return dir;
}

static bool WriteText(const std::string& path, const std::string& text)
{
	HANDLE h = CreateFileA(path.c_str(), GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
	if (h == INVALID_HANDLE_VALUE) return false;
	DWORD done = 0;
	BOOL ok = WriteFile(h, text.data(), (DWORD)text.size(), &done, NULL);
	CloseHandle(h);
	return ok != 0;
}

static bool ReadText(const std::string& path, std::string& out)
{
	HANDLE h = CreateFileA(path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
	if (h == INVALID_HANDLE_VALUE) return false;
	DWORD size = GetFileSize(h, NULL);
	out.assign(size, '\0');
	DWORD done = 0;
	BOOL ok = size == 0 || ReadFile(h, &out[0], size, &done, NULL);
	CloseHandle(h);
	if (ok) out.resize(done);
	return ok != 0;
}

static std::vector<std::string> Split(const std::string& s, char sep)
{
	std::vector<std::string> out; size_t a = 0;
	while (true) { size_t b = s.find(sep, a); out.push_back(s.substr(a, b == std::string::npos ? std::string::npos : b - a)); if (b == std::string::npos) break; a = b + 1; }
	return out;
}

static double D(const std::string& s) { return s.empty() ? 0 : atof(s.c_str()); }
static long long LL(const std::string& s) { return s.empty() ? 0 : _atoi64(s.c_str()); }

static void Parse(SuiteState& st, const std::string& text)
{
	st.hasAcct = false; st.hasGex = false; st.pos.clear(); st.neg.clear(); st.events.clear();
	std::vector<NewsRow> fresh;
	for (auto& raw : Split(text, '\n'))
	{
		std::string line = raw;
		if (!line.empty() && line.back() == '\r') line.pop_back();
		auto c = Split(line, '\t');
		auto at = [&](size_t i) { return i < c.size() ? c[i] : std::string(); };
		const std::string& k = c[0];
		if (k == "RF") { st.dayStart = LL(at(3)); st.marketLabel = at(5); st.got = GetTickCount(); }
		else if (k == "A")
		{
			st.hasAcct = true; st.tier = at(1); st.level = (int)LL(at(2)); st.of = (int)LL(at(3)); st.tierColor = at(4);
			st.dll = D(at(5)); st.trail = D(at(6)); st.target = D(at(7)); st.maxTrades = (int)LL(at(8));
			st.enforcing = at(10) == "1"; st.blocked = at(11) == "1"; st.paused = at(12) == "1"; st.reason = at(15);
		}
		else if (k == "G")
		{
			st.hasGex = true; st.gexIndex = at(1); st.gexZone = at(2); st.gexTotal = D(at(3));
			st.hasFlip = !at(4).empty(); st.flip = D(at(4)); st.hasCall = !at(5).empty(); st.call = D(at(5)); st.hasPut = !at(6).empty(); st.put = D(at(6));
			st.delayed = at(8) == "1"; st.gexError = at(9);
		}
		else if (k == "P") st.pos.push_back(D(at(1)));
		else if (k == "Q") st.neg.push_back(D(at(1)));
		else if (k == "E") { EventRow e; e.t = LL(at(1)); e.impact = at(2); e.title = at(4); st.events.push_back(e); }
		else if (k == "N") { NewsRow n; n.id = at(1); n.t = LL(at(2)); n.imp = (int)LL(at(3)); n.dir = (int)LL(at(4)); n.src = at(5); n.title = at(6); fresh.push_back(n); }
	}
	st.news = fresh;
}

static SCDateTime FromUnixMs(long long ms) { return SCDateTime(ms / 86400000.0 + 25569.0); }

static std::string Money(double v, bool sign = false)
{
	char b[64]; snprintf(b, sizeof(b), "%s%.2f", v < 0 ? "-$" : (sign && v > 0 ? "+$" : "$"), fabs(v)); return b;
}
static std::string Num(double v, bool sign = false) { char b[64]; snprintf(b, sizeof(b), "%s%.2f", sign && v > 0 ? "+" : "", v); return b; }
static std::string Mask(const std::string& id) { return id.size() > 9 ? id.substr(0, 4) + "..." + id.substr(id.size() - 3) : id; }
static COLORREF HexColor(const std::string& h, COLORREF fb)
{
	if (h.size() < 7 || h[0] != '#') return fb;
	return RGB(strtol(h.substr(1, 2).c_str(), NULL, 16), strtol(h.substr(3, 2).c_str(), NULL, 16), strtol(h.substr(5, 2).c_str(), NULL, 16));
}
static COLORREF Mix(COLORREF a, COLORREF b, double t)
{
	return RGB((int)(GetRValue(a) + (GetRValue(b) - GetRValue(a)) * t), (int)(GetGValue(a) + (GetGValue(b) - GetGValue(a)) * t), (int)(GetBValue(a) + (GetBValue(b) - GetBValue(a)) * t));
}

// ---------------------------------------------------------------------------------- today's trades from the fills

static void ComputeTrades(SCStudyInterfaceRef sc, SuiteState& st)
{
	double pointValue = (sc.TickSize > 0 && sc.CurrencyValuePerTick > 0) ? sc.CurrencyValuePerTick / sc.TickSize : 1;
	std::string account = sc.SelectedTradeAccount.GetChars();
	int total = sc.GetOrderFillArraySize();
	std::vector<std::pair<s_SCOrderFillData, double>> open;
	std::vector<Trip> trips;
	for (int i = 0; i < total; ++i)
	{
		s_SCOrderFillData f;
		if (!sc.GetOrderFillEntry(i, f) || f.Quantity == 0) continue;
		if (!account.empty() && f.TradeAccount.GetLength() > 0 && account != f.TradeAccount.GetChars()) continue;
		double q = f.BuySell == BSE_BUY ? (double)f.Quantity : -(double)f.Quantity;
		while (q != 0 && !open.empty() && ((open[0].second > 0) != (q > 0)))
		{
			auto& head = open[0];
			double take = fmin(fabs(head.second), fabs(q));
			bool lng = head.second > 0;
			Trip t; t.open = head.first.FillDateTime; t.close = f.FillDateTime; t.openPrice = head.first.FillPrice; t.closePrice = f.FillPrice; t.qty = take; t.lng = lng; t.complete = true;
			t.pnl = (f.FillPrice - head.first.FillPrice) * (lng ? 1 : -1) * take * pointValue;
			trips.push_back(t);
			head.second -= (head.second > 0 ? take : -take);
			q += (lng ? take : -take);
			if (head.second == 0) open.erase(open.begin());
		}
		if (q != 0) open.push_back(std::make_pair(f, q));
	}
	for (auto& o : open) { Trip t; t.open = o.first.FillDateTime; t.openPrice = o.first.FillPrice; t.qty = fabs(o.second); t.lng = o.second > 0; trips.push_back(t); }
	st.trips = trips;
	SCDateTime from = st.dayStart > 0 ? sc.ConvertDateTimeToChartTimeZone(FromUnixMs(st.dayStart), TIMEZONE_UTC) : SCDateTime(floor(sc.CurrentSystemDateTime.GetAsDouble()));
	double r = 0, peak = 0, gw = 0, gl = 0, bst = 0, wst = 0; int n = 0, w = 0, l = 0;
	for (auto& t : trips)
	{
		if (!t.complete || t.close < from) continue;
		r += t.pnl; peak = fmax(peak, r); n++;
		if (t.pnl > 0) { w++; gw += t.pnl; } else if (t.pnl < 0) { l++; gl -= t.pnl; }
		bst = fmax(bst, t.pnl); wst = fmin(wst, t.pnl);
	}
	st.realised = r; st.peak = peak; st.trades = n; st.wins = w; st.losses = l; st.grossWin = gw; st.grossLoss = gl; st.best = bst; st.worst = wst;
	s_SCPositionData p;
	if (sc.GetTradePosition(p)) st.openPnl = p.OpenProfitLoss;
}

static void Ring(SCStudyInterfaceRef sc, int alertNumber, const std::string& message)
{
	sc.SetAlert(alertNumber, sc.ArraySize - 1, SCString(("RoninFlow: " + message).c_str()));
}

static void CheckAlerts(SCStudyInterfaceRef sc, SuiteState& st)
{
	double qty = 0;
	for (auto& t : st.trips) if (!t.complete) qty += t.lng ? t.qty : -t.qty;
	int fills = sc.GetOrderFillArraySize();
	if (st.lastFills >= 0)
	{
		if (fills > st.lastFills && sc.Input[I_AlertFill].GetYesNo()) Ring(sc, sc.Input[I_FillSound].GetInt(), "fill");
		if (st.lastQty == 0 && qty != 0 && sc.Input[I_AlertEntry].GetYesNo()) Ring(sc, sc.Input[I_EntrySound].GetInt(), qty > 0 ? "entered LONG" : "entered SHORT");
		if (st.lastQty != 0 && qty == 0)
		{
			double pnl = 0; SCDateTime last;
			for (auto& t : st.trips) if (t.complete && t.close > last) last = t.close;
			for (auto& t : st.trips) if (t.complete && t.close == last) pnl += t.pnl;
			if (pnl > 0 && sc.Input[I_AlertWin].GetYesNo()) Ring(sc, sc.Input[I_WinSound].GetInt(), "win " + Money(pnl, true) + " / day " + Money(st.realised, true));
			else if (pnl < 0 && sc.Input[I_AlertLoss].GetYesNo()) Ring(sc, sc.Input[I_LossSound].GetInt(), "loss " + Money(pnl, true) + " / day " + Money(st.realised, true));
		}
	}
	st.lastFills = fills; st.lastQty = qty;
	if (st.dayStart != st.alertDay) { st.alertDay = st.dayStart; st.dllWarned = st.dllHit = st.targetHit = false; }
	double now = st.realised + (sc.Input[I_AlertIncludeOpen].GetYesNo() ? st.openPnl : 0);
	if (sc.Input[I_AlertDll].GetYesNo() && st.dll > 0)
	{
		if (!st.dllHit && now <= -st.dll) { st.dllHit = true; Ring(sc, sc.Input[I_DllSound].GetInt(), "daily loss limit hit: " + Money(now, true)); }
		else if (!st.dllWarned && !st.dllHit && now <= -st.dll * sc.Input[I_DllWarnPercent].GetInt() / 100.0) { st.dllWarned = true; Ring(sc, sc.Input[I_DllSound].GetInt(), "loss limit warning: " + Money(now, true)); }
	}
	double target = sc.Input[I_ProfitTarget].GetFloat() > 0 ? sc.Input[I_ProfitTarget].GetFloat() : st.target;
	if (sc.Input[I_AlertTarget].GetYesNo() && target > 0 && !st.targetHit && now >= target) { st.targetHit = true; Ring(sc, sc.Input[I_TargetSound].GetInt(), "profit target hit: " + Money(now, true)); }
}

// ---------------------------------------------------------------------------------- drawing (Windows GDI)

struct Painter
{
	HDC dc; HFONT normal, small, bold, big;
	Painter(HDC d, int size) : dc(d)
	{
		normal = CreateFontA(-size, 0, 0, 0, FW_NORMAL, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, "Segoe UI");
		small = CreateFontA(-(size - 1), 0, 0, 0, FW_NORMAL, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, "Segoe UI");
		bold = CreateFontA(-size, 0, 0, 0, FW_SEMIBOLD, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, "Segoe UI");
		big = CreateFontA(-(size + 4), 0, 0, 0, FW_SEMIBOLD, 0, 0, 0, DEFAULT_CHARSET, 0, 0, CLEARTYPE_QUALITY, 0, "Segoe UI");
		SetBkMode(dc, TRANSPARENT);
	}
	~Painter() { DeleteObject(normal); DeleteObject(small); DeleteObject(bold); DeleteObject(big); }
	std::wstring W(const std::string& s) { int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, NULL, 0); std::wstring w(n > 0 ? n - 1 : 0, L'\0'); if (n > 1) MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &w[0], n); return w; }
	SIZE Measure(const std::string& s, HFONT f) { SelectObject(dc, f); std::wstring w = W(s); SIZE z = { 0, 0 }; GetTextExtentPoint32W(dc, w.c_str(), (int)w.size(), &z); return z; }
	int Text(const std::string& s, HFONT f, COLORREF c, int x, int y) { SelectObject(dc, f); SetTextColor(dc, c); std::wstring w = W(s); TextOutW(dc, x, y, w.c_str(), (int)w.size()); return Measure(s, f).cx; }
	std::string Fit(const std::string& s, HFONT f, int w) { if (Measure(s, f).cx <= w) return s; std::string t = s; while (t.size() > 1 && Measure(t + "...", f).cx > w) t.pop_back(); return t + "..."; }
	void Fill(int x1, int y1, int x2, int y2, COLORREF c) { RECT r = { x1, y1, x2, y2 }; HBRUSH b = CreateSolidBrush(c); FillRect(dc, &r, b); DeleteObject(b); }
	void Frame(int x1, int y1, int x2, int y2, COLORREF c) { RECT r = { x1, y1, x2, y2 }; HBRUSH b = CreateSolidBrush(c); FrameRect(dc, &r, b); DeleteObject(b); }
	void Line(int x1, int y1, int x2, int y2, COLORREF c, int width, int style) { HPEN p = CreatePen(width > 1 ? PS_SOLID : style, width, c); HGDIOBJ o = SelectObject(dc, p); MoveToEx(dc, x1, y1, NULL); LineTo(dc, x2, y2); SelectObject(dc, o); DeleteObject(p); }
	void Triangle(int x, int y, int half, int h, bool up, COLORREF c)
	{
		POINT pts[3] = { { x, y }, { x - half, y + (up ? h : -h) }, { x + half, y + (up ? h : -h) } };
		HBRUSH b = CreateSolidBrush(c); HPEN p = CreatePen(PS_SOLID, 1, RGB(0, 0, 0));
		HGDIOBJ ob = SelectObject(dc, b), op = SelectObject(dc, p); Polygon(dc, pts, 3); SelectObject(dc, ob); SelectObject(dc, op); DeleteObject(b); DeleteObject(p);
	}
	void Circle(int x, int y, int r, COLORREF c)
	{
		HBRUSH b = CreateSolidBrush(c); HPEN p = CreatePen(PS_SOLID, 1, RGB(0, 0, 0));
		HGDIOBJ ob = SelectObject(dc, b), op = SelectObject(dc, p); Ellipse(dc, x - r, y - r, x + r, y + r); SelectObject(dc, ob); SelectObject(dc, op); DeleteObject(b); DeleteObject(p);
	}
};

static void PlaceXY(int corner, int w, int h, int dx, int dy, int L, int T, int R, int B, int& x, int& y)
{
	switch (corner)
	{
	case 0: x = L + dx; y = T + dy; break;
	case 1: x = R - w - dx; y = T + dy; break;
	case 2: x = L + dx; y = B - h - dy; break;
	case 3: x = R - w - dx; y = B - h - dy; break;
	case 4: x = L + (R - L - w) / 2 + dx; y = T + dy; break;
	default: x = L + (R - L - w) / 2 + dx; y = B - h - dy; break;
	}
}

static int BarOf(SCStudyInterfaceRef sc, SCDateTime t) { return sc.GetContainingIndexForSCDateTime(sc.ChartNumber, t); }

void DrawToChart(HWND WindowHandle, HDC DeviceContext, SCStudyInterfaceRef sc)
{
	SuiteState* st = (SuiteState*)sc.GetPersistentPointer(1);
	if (!st) return;
	int L = sc.StudyRegionLeftCoordinate, T = sc.StudyRegionTopCoordinate, R = sc.StudyRegionRightCoordinate, B = sc.StudyRegionBottomCoordinate;
	Painter p(DeviceContext, sc.Input[I_FontSize].GetInt());
	COLORREF back = sc.Input[I_BackColor].GetColor(), border = sc.Input[I_BorderColor].GetColor(), tile = sc.Input[I_TileColor].GetColor();
	COLORREF text = sc.Input[I_TextColor].GetColor(), muted = sc.Input[I_MutedColor].GetColor(), pos = sc.Input[I_PositiveColor].GetColor(), neg = sc.Input[I_NegativeColor].GetColor();
	COLORREF warn = sc.Input[I_WarningColor].GetColor(), accent = sc.Input[I_AccentColor].GetColor();
	int lh = p.Measure("Ag", p.normal).cy, sh = p.Measure("Ag", p.small).cy, bh = p.Measure("Ag", p.big).cy;
	auto Y = [&](double price) { return sc.RegionValueToYPixelCoordinate((float)price, sc.GraphRegion); };
	auto X = [&](int bar) { return sc.BarIndexToXPixelCoordinate(bar); };

	// gamma levels
	if (sc.Input[I_ShowGamma].GetYesNo() && st->hasGex && st->gexError.empty())
	{
		auto level = [&](double price, const std::string& name, COLORREF c, bool major)
		{
			int y = Y(price);
			if (y < T - 40 || y > B + 40) return;
			if (sc.Input[I_GammaZones].GetYesNo())
			{
				int half = abs(Y(price + sc.TickSize * sc.Input[I_ZoneTicks].GetInt() / 2.0) - y);
				p.Fill(L, y - half, R, y + half + 1, Mix(back, c, major ? 0.25 : 0.14));
			}
			else p.Line(L, y, R, y, c, sc.Input[I_LevelWidth].GetInt(), major ? PS_SOLID : PS_DASH);
			char label[96]; snprintf(label, sizeof(label), "%s %.2f", name.c_str(), price);
			SIZE m = p.Measure(label, p.small);
			int side = sc.Input[I_LabelSide].GetIndex(), lx = side == 0 ? L + 6 : side == 1 ? L + (R - L - m.cx) / 2 : R - m.cx - 80;
			p.Fill(lx - 5, y - m.cy / 2 - 2, lx + m.cx + 5, y + m.cy / 2 + 2, back); p.Frame(lx - 5, y - m.cy / 2 - 2, lx + m.cx + 5, y + m.cy / 2 + 2, c);
			p.Text(label, p.small, c, lx, y - m.cy / 2);
		};
		if (sc.Input[I_ShowWalls].GetYesNo() && st->hasCall) level(st->call, "Call wall", sc.Input[I_CallWallColor].GetColor(), true);
		if (sc.Input[I_ShowWalls].GetYesNo() && st->hasPut) level(st->put, "Put wall", sc.Input[I_PutWallColor].GetColor(), true);
		if (sc.Input[I_ShowFlip].GetYesNo() && st->hasFlip) level(st->flip, "Gamma flip", sc.Input[I_FlipColor].GetColor(), true);
		if (sc.Input[I_ShowOtherLevels].GetYesNo())
		{
			for (double v : st->pos) level(v, "+G", sc.Input[I_PosLevelColor].GetColor(), false);
			for (double v : st->neg) level(v, "-G", sc.Input[I_NegLevelColor].GetColor(), false);
		}
	}

	// executions
	if (sc.Input[I_ShowExecutions].GetYesNo())
	{
		int size = sc.Input[I_ExecSize].GetInt(), half = max(2, size / 2), h = max(3, (int)(size * 0.9));
		COLORREF buyC = sc.Input[I_ExecBuyColor].GetColor(), sellC = sc.Input[I_ExecSellColor].GetColor();
		int style = sc.Input[I_ExecLineStyle].GetIndex() == 0 ? PS_SOLID : sc.Input[I_ExecLineStyle].GetIndex() == 2 ? PS_DOT : PS_DASH;
		auto mark = [&](int x, int y, bool buy, double qty)
		{
			COLORREF c = buy ? buyC : sellC;
			if (sc.Input[I_ExecMarker].GetIndex() == 2) p.Circle(x, y, half, c); else p.Triangle(x, y, half, h, buy, c);
			if (sc.Input[I_ExecShowQty].GetYesNo()) { char q[32]; snprintf(q, sizeof(q), "%g", qty); SIZE m = p.Measure(q, p.small); p.Text(q, p.small, c, x - m.cx / 2, buy ? y + h + 1 : y - h - 1 - m.cy); }
		};
		for (auto& t : st->trips)
		{
			int b1 = BarOf(sc, t.open);
			if (b1 < sc.IndexOfFirstVisibleBar - 500) continue;
			int x1 = X(b1), y1 = Y(t.openPrice);
			if (t.complete)
			{
				int b2 = BarOf(sc, t.close), x2 = X(b2), y2 = Y(t.closePrice);
				if (sc.Input[I_ExecConnect].GetYesNo()) p.Line(x1, y1, x2, y2, t.pnl >= 0 ? sc.Input[I_ExecWinColor].GetColor() : sc.Input[I_ExecLossColor].GetColor(), sc.Input[I_ExecLineWidth].GetInt(), style);
				mark(x1, y1, t.lng, t.qty); mark(x2, y2, !t.lng, t.qty);
				if (sc.Input[I_ExecShowResult].GetYesNo())
				{
					double move = (t.closePrice - t.openPrice) * (t.lng ? 1 : -1);
					int unit = sc.Input[I_ExecResultUnit].GetIndex();
					char r[48];
					if (unit == 1 && sc.TickSize > 0) snprintf(r, sizeof(r), "%+.0ft", move / sc.TickSize); else if (unit == 2) snprintf(r, sizeof(r), "%+.2f pts", move); else snprintf(r, sizeof(r), "%s", Money(t.pnl, true).c_str());
					COLORREF c = (unit == 0 ? t.pnl >= 0 : move >= 0) ? sc.Input[I_ExecWinColor].GetColor() : sc.Input[I_ExecLossColor].GetColor();
					SIZE m = p.Measure(r, p.small);
					int bx = x2 + size, by = !t.lng ? y2 + size : y2 - size - m.cy - 4;
					p.Fill(bx, by, bx + m.cx + 10, by + m.cy + 4, back); p.Frame(bx, by, bx + m.cx + 10, by + m.cy + 4, c);
					p.Text(r, p.small, c, bx + 5, by + 2);
				}
			}
			else
			{
				mark(x1, y1, t.lng, t.qty);
				if (sc.Input[I_ExecShowAvg].GetYesNo()) p.Line(L, y1, R, y1, sc.Input[I_ExecAvgColor].GetColor(), 1, PS_DASH);
			}
		}
	}

	// today's events on the time axis
	if (sc.Input[I_ShowEventMarkers].GetYesNo())
	{
		int lvl = sc.Input[I_EventMinImpact].GetIndex();
		for (auto& e : st->events)
		{
			if (lvl == 2 && e.impact != "high") continue;
			if (lvl == 1 && e.impact == "low") continue;
			SCDateTime t = sc.ConvertDateTimeToChartTimeZone(FromUnixMs(e.t), TIMEZONE_UTC);
			int b = BarOf(sc, t);
			if (b < sc.IndexOfFirstVisibleBar || b > sc.IndexOfLastVisibleBar) continue;
			int x = X(b);
			COLORREF c = e.impact == "high" ? neg : e.impact == "medium" ? warn : muted;
			p.Line(x, T, x, B - 18, Mix(back, c, 0.55), 1, PS_DOT);
			std::string tag = e.impact == "high" ? "HIGH" : e.impact == "medium" ? "MED" : "LOW";
			SIZE m = p.Measure(tag, p.small);
			p.Fill(x - m.cx / 2 - 5, B - m.cy - 6, x + m.cx / 2 + 5, B - 2, Mix(back, c, 0.6));
			p.Text(tag, p.small, RGB(255, 255, 255), x - m.cx / 2, B - m.cy - 4);
		}
	}

	// account panel
	int accountBottom = 0;
	if (sc.Input[I_ShowAccount].GetYesNo())
	{
		int w = sc.Input[I_AccountWidth].GetInt(), pad = 10, chipH = sh + 8, tileH = sh + bh + 14, statRowH = sh + lh + 10, cols = w >= 270 ? 4 : 2;
		double price = sc.Close[sc.ArraySize - 1];
		std::string gamma; COLORREF gc = muted;
		if (st->hasGex && st->gexError.empty() && (st->hasFlip || !st->gexZone.empty()))
		{
			bool positive = st->hasFlip ? price >= st->flip : st->gexZone == "positive";
			gamma = positive ? "G+ Positive gamma - pinning" : "G- Negative gamma - trending"; gc = positive ? pos : neg;
		}
		bool chips = (sc.Input[I_ShowTierChip].GetYesNo() && st->hasAcct && !st->tier.empty()) || (sc.Input[I_ShowGammaChip].GetYesNo() && !gamma.empty());
		double target = sc.Input[I_ProfitTarget].GetFloat() > 0 ? sc.Input[I_ProfitTarget].GetFloat() : st->target, dll = st->hasAcct ? st->dll : 0;
		int h = pad + lh + pad;
		if (chips) h += chipH + 8;
		if (st->blocked) h += sh + 16;
		if (sc.Input[I_ShowPnlTiles].GetYesNo()) h += tileH + 8;
		if (sc.Input[I_ShowBuffer].GetYesNo() && (dll > 0 || target > 0)) h += sh + 6 + 10 + sh + 10;
		if (sc.Input[I_ShowStats].GetYesNo() && st->trades > 0) h += statRowH * (8 / cols) + 2;
		if (sc.Input[I_ShowGexLine].GetYesNo() && st->hasGex) h += lh + 10;
		int x0, y0; PlaceXY(sc.Input[I_AccountPlacement].GetIndex(), w, h, sc.Input[I_AccountX].GetInt(), sc.Input[I_AccountY].GetInt(), L, T, R, B, x0, y0);
		p.Fill(x0, y0, x0 + w, y0 + h, back); p.Frame(x0, y0, x0 + w, y0 + h, border);
		int x = x0 + pad, y = y0 + pad;
		int cx = x + p.Text("Ronin", p.bold, text, x, y); cx += p.Text("Flow", p.bold, accent, cx, y) + 8;
		p.Text(Mask(sc.SelectedTradeAccount.GetChars()), p.normal, muted, cx, y);
		bool offline = st->got == 0 || GetTickCount() - st->got > 20000;
		std::string state = offline ? "offline" : st->blocked ? "blocked" : st->paused ? "rules paused" : st->enforcing ? "enforcing" : "live";
		COLORREF stc = offline ? muted : st->blocked ? neg : st->paused ? warn : pos;
		int sw = p.Measure(state, p.small).cx;
		p.Text(state, p.small, muted, x0 + w - pad - sw, y + (lh - sh) / 2);
		p.Circle(x0 + w - pad - sw - 8, y + lh / 2, 3, stc);
		y += lh + pad;
		p.Line(x0 + 1, y - pad / 2, x0 + w - 1, y - pad / 2, border, 1, PS_SOLID);
		if (chips)
		{
			int chx = x;
			auto chip = [&](const std::string& s, COLORREF c) { int cw = p.Measure(s, p.small).cx + 14; p.Fill(chx, y, chx + cw, y + chipH, Mix(back, c, 0.18)); p.Frame(chx, y, chx + cw, y + chipH, c); p.Text(s, p.small, c, chx + 7, y + 4); chx += cw + 6; };
			if (sc.Input[I_ShowTierChip].GetYesNo() && st->hasAcct && !st->tier.empty()) { char b[96]; snprintf(b, sizeof(b), "Tier %s %d/%d", st->tier.c_str(), st->level + 1, max(1, st->of)); chip(b, HexColor(st->tierColor, accent)); }
			if (sc.Input[I_ShowGammaChip].GetYesNo() && !gamma.empty()) chip(p.Fit(gamma, p.small, x0 + w - pad - chx - 14), gc);
			y += chipH + 8;
		}
		if (st->blocked)
		{
			p.Fill(x, y, x0 + w - pad, y + sh + 10, Mix(back, neg, 0.18)); p.Frame(x, y, x0 + w - pad, y + sh + 10, neg);
			p.Text(p.Fit("New orders blocked - " + (st->reason.empty() ? std::string("a risk rule is broken") : st->reason), p.small, w - pad * 2 - 14), p.small, neg, x + 7, y + 5);
			y += sh + 16;
		}
		if (sc.Input[I_ShowPnlTiles].GetYesNo())
		{
			int tw = (w - pad * 2 - 12) / 3;
			char trades[32]; if (st->maxTrades > 0) snprintf(trades, sizeof(trades), "%d / %d", st->trades, st->maxTrades); else snprintf(trades, sizeof(trades), "%d", st->trades);
			const char* labels[3] = { "OPEN", "CLOSED", "TRADES" };
			std::string vals[3] = { Num(st->openPnl, true), Num(st->realised, true), trades };
			double tones[3] = { st->openPnl, st->realised, 0 };
			for (int i = 0; i < 3; i++)
			{
				int tx = x + i * (tw + 6);
				COLORREF tc = tones[i] > 0 ? pos : tones[i] < 0 ? neg : text;
				p.Fill(tx, y, tx + tw, y + tileH, tones[i] == 0 ? tile : Mix(back, tc, 0.16)); p.Frame(tx, y, tx + tw, y + tileH, tones[i] == 0 ? border : tc);
				p.Text(labels[i], p.small, muted, tx + 8, y + 5); p.Text(vals[i], p.big, tc, tx + 8, y + 7 + sh);
			}
			y += tileH + 8;
		}
		if (sc.Input[I_ShowBuffer].GetYesNo() && (dll > 0 || target > 0))
		{
			double now = st->realised + (sc.Input[I_BufferClosedOnly].GetYesNo() ? 0 : st->openPnl);
			double stop = dll > 0 ? (st->trail > 0 ? fmax(-dll, st->peak - st->trail) : -dll) : 0;
			std::string left = dll > 0 ? "Buffer to loss limit" : "To profit target";
			std::string right = dll > 0 ? Money(fmax(0, now - stop)) + " of " + Money(dll) : (target - now > 0 ? Money(target - now) + " to go" : "hit");
			p.Text(left, p.small, muted, x, y);
			p.Text(right, p.small, dll > 0 && now - stop <= dll * 0.25 ? neg : text, x0 + w - pad - p.Measure(right, p.small).cx, y);
			y += sh + 6;
			int bw = w - pad * 2;
			double lo = dll > 0 ? -dll : fmin(fmin(0, now), -target / 2), hi = fmax(fmax(st->peak, now), target > 0 ? target : dll * 0.5);
			if (hi <= lo) hi = lo + 1;
			auto BX = [&](double v) { return x + (int)((fmax(lo, fmin(hi, v)) - lo) / (hi - lo) * bw); };
			for (int i = 0; i < bw; i += 2) p.Fill(x + i, y, x + i + 2, y + 6, Mix(Mix(back, neg, 0.45), Mix(back, pos, 0.45), (double)i / bw));
			if (dll > 0) p.Fill(BX(stop) - 1, y - 2, BX(stop) + 1, y + 8, neg);
			if (target > 0) p.Fill(min(x + bw - 2, BX(target)) - 1, y - 2, min(x + bw - 2, BX(target)) + 1, y + 8, pos);
			p.Fill(BX(now) - 1, y - 3, BX(now) + 2, y + 9, RGB(255, 255, 255));
			y += 10;
			if (dll > 0) p.Text("stop " + Num(stop, true), p.small, muted, x, y);
			std::string hiT = "high " + Num(st->peak, true);
			if (target > 0) { std::string tt = "target " + Num(target, true); p.Text(tt, p.small, pos, x0 + w - pad - p.Measure(tt, p.small).cx, y); p.Text(hiT, p.small, muted, x + (bw - p.Measure(hiT, p.small).cx) / 2, y); }
			else p.Text(hiT, p.small, muted, x0 + w - pad - p.Measure(hiT, p.small).cx, y);
			y += sh + 10;
		}
		if (sc.Input[I_ShowStats].GetYesNo() && st->trades > 0)
		{
			double wr = (double)st->wins / st->trades, aw = st->wins > 0 ? st->grossWin / st->wins : 0, al = st->losses > 0 ? st->grossLoss / st->losses : 0;
			double pf = st->grossLoss > 0 ? st->grossWin / st->grossLoss : (st->grossWin > 0 ? 99 : 0), ev = st->realised / st->trades, edge = al > 0 ? wr * aw / al : 0;
			char b[8][32];
			snprintf(b[0], 32, "%.0f%%", wr * 100); snprintf(b[1], 32, "%.2f", pf); snprintf(b[2], 32, "%s", Num(ev, true).c_str()); snprintf(b[3], 32, "%.2f", edge);
			snprintf(b[4], 32, "%.2f", aw); snprintf(b[5], 32, "%.2f", al); snprintf(b[6], 32, "%s", Num(st->best, true).c_str()); snprintf(b[7], 32, "%s", Num(st->worst, true).c_str());
			const char* names[8] = { "Win rate", "Profit f.", "EV", "Edge", "Avg win", "Avg loss", "Best", "Worst" };
			COLORREF cc[8] = { text, pf >= 1 ? pos : neg, ev >= 0 ? pos : neg, edge >= 0.75 ? pos : edge >= 0.5 ? warn : neg, pos, neg, pos, neg };
			int cw = (w - pad * 2) / cols;
			for (int i = 0; i < 8; i++) { int sx = x + (i % cols) * cw, sy = y + (i / cols) * statRowH; p.Text(names[i], p.small, muted, sx, sy + 3); p.Text(b[i], p.bold, cc[i], sx, sy + 4 + sh); }
			y += statRowH * (8 / cols) + 2;
		}
		if (sc.Input[I_ShowGexLine].GetYesNo() && st->hasGex)
		{
			char g[160];
			if (!st->gexError.empty()) snprintf(g, sizeof(g), "GEX: %s", st->gexError.c_str());
			else snprintf(g, sizeof(g), "%s GEX %s$%.2fB%s%s", st->gexIndex.c_str(), st->gexTotal >= 0 ? "+" : "-", fabs(st->gexTotal) / 1e9, st->hasFlip ? (" / flip " + Num(st->flip)).c_str() : "", st->delayed ? " / delayed" : "");
			p.Text(p.Fit(g, p.normal, w - pad * 2), p.normal, st->gexTotal >= 0 ? pos : neg, x, y + 2);
		}
		accountBottom = y0 + h;
	}

	// news feed
	if (sc.Input[I_ShowNews].GetYesNo() && st->got != 0)
	{
		std::vector<const NewsRow*> rows;
		for (auto& n : st->news) if (n.imp >= sc.Input[I_NewsMinImportance].GetInt() && (int)rows.size() < sc.Input[I_NewsRows].GetInt()) rows.push_back(&n);
		int w = sc.Input[I_NewsWidth].GetInt(), pad = 10, rowH = lh + sh + 10, h = pad + lh + 8 + max(1, (int)rows.size()) * rowH + 2;
		int x0, y0; PlaceXY(sc.Input[I_NewsPlacement].GetIndex(), w, h, sc.Input[I_NewsX].GetInt(), sc.Input[I_NewsY].GetInt(), L, T, R, B, x0, y0);
		p.Fill(x0, y0, x0 + w, y0 + h, back); p.Frame(x0, y0, x0 + w, y0 + h, border);
		int x = x0 + pad, y = y0 + pad;
		p.Text("News" + (st->marketLabel.empty() ? std::string() : " - " + st->marketLabel), p.bold, text, x, y);
		y += lh + 8;
		if (rows.empty()) p.Text("No headlines yet", p.small, muted, x, y);
		for (auto n : rows)
		{
			COLORREF c = n->imp >= 3 ? neg : n->imp >= 2 ? warn : muted;
			p.Fill(x0 + 1, y + 2, x0 + 3, y + rowH - 4, c);
			SCDateTime t = sc.ConvertDateTimeToChartTimeZone(FromUnixMs(n->t), TIMEZONE_UTC);
			char meta[160]; snprintf(meta, sizeof(meta), "%02d:%02d - %s%s", t.GetHour(), t.GetMinute(), n->src.c_str(), n->dir > 0 ? " - up" : n->dir < 0 ? " - down" : "");
			p.Text(meta, p.small, n->dir > 0 ? pos : n->dir < 0 ? neg : muted, x, y);
			p.Text(p.Fit(n->title, p.normal, w - pad * 2), p.normal, text, x, y + sh + 2);
			y += rowH;
		}
	}

	// pop-ups for new headlines
	if (sc.Input[I_ShowPopups].GetYesNo())
	{
		int w = 340, pad = 10, offset = 0, corner = sc.Input[I_PopupPlacement].GetIndex();
		for (int i = (int)st->popups.size() - 1; i >= 0 && i >= (int)st->popups.size() - 3; i--)
		{
			const NewsRow& n = st->popups[i];
			int h = pad * 2 + sh + 4 + lh;
			int x0, y0; PlaceXY(corner, w, h, sc.Input[I_PopupX].GetInt(), sc.Input[I_PopupY].GetInt(), L, T, R, B, x0, y0);
			y0 = (corner == 0 || corner == 1 || corner == 4) ? y0 + offset : y0 - offset;
			COLORREF c = n.imp >= 3 ? neg : n.imp >= 2 ? warn : accent;
			p.Fill(x0, y0, x0 + w, y0 + h, back); p.Frame(x0, y0, x0 + w, y0 + h, border); p.Fill(x0 + 1, y0 + 1, x0 + 4, y0 + h - 1, c);
			p.Text((n.imp >= 3 ? "HIGH IMPACT - " : "") + n.src, p.small, c, x0 + pad + 2, y0 + pad);
			p.Text(p.Fit(n.title, p.bold, w - pad * 2), p.bold, text, x0 + pad + 2, y0 + pad + sh + 4);
			offset += h + 8;
		}
	}
	(void)accountBottom;
}

SCSFExport scsf_RoninFlowSuite(SCStudyInterfaceRef sc)
{
	if (sc.SetDefaults)
	{
		sc.GraphName = "RoninFlow Suite";
		sc.StudyDescription = "RoninFlow on your chart: account panel, your trades, gamma levels, news and alerts.";
		sc.GraphRegion = 0;
		sc.AutoLoop = 0;
		sc.UpdateAlways = 1;
		sc.FreeDLL = 0;
		sc.DisplayStudyName = 0;
		sc.DisplayStudyInputValues = 0;
		sc.Input[I_AccountName].Name = "General: Account (empty = the chart's account)"; sc.Input[I_AccountName].SetString("");
		sc.Input[I_RefreshSeconds].Name = "General: Refresh every (seconds)"; sc.Input[I_RefreshSeconds].SetInt(3); sc.Input[I_RefreshSeconds].SetIntLimits(2, 60);
		sc.Input[I_FontSize].Name = "General: Text size"; sc.Input[I_FontSize].SetInt(11); sc.Input[I_FontSize].SetIntLimits(7, 20);
		sc.Input[I_ShowAccount].Name = "Account panel: Show the account panel"; sc.Input[I_ShowAccount].SetYesNo(1);
		sc.Input[I_AccountPlacement].Name = "Account panel: Placement"; sc.Input[I_AccountPlacement].SetCustomInputStrings("TopLeft;TopRight;BottomLeft;BottomRight;TopMiddle;BottomMiddle"); sc.Input[I_AccountPlacement].SetCustomInputIndex(1);
		sc.Input[I_AccountX].Name = "Account panel: X offset"; sc.Input[I_AccountX].SetInt(12); sc.Input[I_AccountX].SetIntLimits(-3000, 3000);
		sc.Input[I_AccountY].Name = "Account panel: Y offset"; sc.Input[I_AccountY].SetInt(12); sc.Input[I_AccountY].SetIntLimits(-3000, 3000);
		sc.Input[I_AccountWidth].Name = "Account panel: Width"; sc.Input[I_AccountWidth].SetInt(320); sc.Input[I_AccountWidth].SetIntLimits(180, 700);
		sc.Input[I_ShowTierChip].Name = "Account panel: Risk tier chip"; sc.Input[I_ShowTierChip].SetYesNo(1);
		sc.Input[I_ShowGammaChip].Name = "Account panel: Gamma regime chip"; sc.Input[I_ShowGammaChip].SetYesNo(1);
		sc.Input[I_ShowPnlTiles].Name = "Account panel: P&L tiles"; sc.Input[I_ShowPnlTiles].SetYesNo(1);
		sc.Input[I_ShowBuffer].Name = "Account panel: Buffer bar (loss limit to profit target)"; sc.Input[I_ShowBuffer].SetYesNo(1);
		sc.Input[I_BufferClosedOnly].Name = "Account panel: Buffer bar moves with closed P&L only"; sc.Input[I_BufferClosedOnly].SetYesNo(0);
		sc.Input[I_ShowStats].Name = "Account panel: Trade stats (click to collapse)"; sc.Input[I_ShowStats].SetYesNo(1);
		sc.Input[I_ShowGexLine].Name = "Account panel: GEX line"; sc.Input[I_ShowGexLine].SetYesNo(1);
		sc.Input[I_ShowAllPositions].Name = "Account panel: Open positions on every account"; sc.Input[I_ShowAllPositions].SetYesNo(1);
		sc.Input[I_ShowExecutions].Name = "Executions: Show your executions"; sc.Input[I_ShowExecutions].SetYesNo(1);
		sc.Input[I_ExecMarker].Name = "Executions: Marker style"; sc.Input[I_ExecMarker].SetCustomInputStrings("Triangles;Arrows;Circles"); sc.Input[I_ExecMarker].SetCustomInputIndex(0);
		sc.Input[I_ExecSize].Name = "Executions: Marker size"; sc.Input[I_ExecSize].SetInt(10); sc.Input[I_ExecSize].SetIntLimits(4, 40);
		sc.Input[I_ExecBuyColor].Name = "Executions: Buy colour"; sc.Input[I_ExecBuyColor].SetColor(RGB(43, 196, 138));
		sc.Input[I_ExecSellColor].Name = "Executions: Sell colour"; sc.Input[I_ExecSellColor].SetColor(RGB(229, 72, 77));
		sc.Input[I_ExecShowQty].Name = "Executions: Quantity next to each marker"; sc.Input[I_ExecShowQty].SetYesNo(1);
		sc.Input[I_ExecConnect].Name = "Executions: Join entry and exit with a line"; sc.Input[I_ExecConnect].SetYesNo(1);
		sc.Input[I_ExecWinColor].Name = "Executions: Winning trade line"; sc.Input[I_ExecWinColor].SetColor(RGB(43, 196, 138));
		sc.Input[I_ExecLossColor].Name = "Executions: Losing trade line"; sc.Input[I_ExecLossColor].SetColor(RGB(229, 72, 77));
		sc.Input[I_ExecLineWidth].Name = "Executions: Line width"; sc.Input[I_ExecLineWidth].SetInt(1); sc.Input[I_ExecLineWidth].SetIntLimits(1, 8);
		sc.Input[I_ExecLineStyle].Name = "Executions: Line style"; sc.Input[I_ExecLineStyle].SetCustomInputStrings("Solid;Dashed;Dotted"); sc.Input[I_ExecLineStyle].SetCustomInputIndex(1);
		sc.Input[I_ExecShowResult].Name = "Executions: Result at the exit"; sc.Input[I_ExecShowResult].SetYesNo(1);
		sc.Input[I_ExecResultUnit].Name = "Executions: Result in"; sc.Input[I_ExecResultUnit].SetCustomInputStrings("Money;Ticks;Points"); sc.Input[I_ExecResultUnit].SetCustomInputIndex(0);
		sc.Input[I_ExecShowAvg].Name = "Executions: Open position average price line"; sc.Input[I_ExecShowAvg].SetYesNo(1);
		sc.Input[I_ExecAvgColor].Name = "Executions: Average price line colour"; sc.Input[I_ExecAvgColor].SetColor(RGB(232, 176, 67));
		sc.Input[I_ShowGamma].Name = "Gamma: Show gamma levels"; sc.Input[I_ShowGamma].SetYesNo(1);
		sc.Input[I_GammaZones].Name = "Gamma: Zones instead of lines"; sc.Input[I_GammaZones].SetYesNo(0);
		sc.Input[I_ZoneTicks].Name = "Gamma: Zone height (ticks)"; sc.Input[I_ZoneTicks].SetInt(8); sc.Input[I_ZoneTicks].SetIntLimits(1, 200);
		sc.Input[I_ShowFlip].Name = "Gamma: Gamma flip"; sc.Input[I_ShowFlip].SetYesNo(1);
		sc.Input[I_ShowWalls].Name = "Gamma: Call and put walls"; sc.Input[I_ShowWalls].SetYesNo(1);
		sc.Input[I_ShowOtherLevels].Name = "Gamma: Other big strikes"; sc.Input[I_ShowOtherLevels].SetYesNo(1);
		sc.Input[I_LabelSide].Name = "Gamma: Level names"; sc.Input[I_LabelSide].SetCustomInputStrings("Left;Middle;Right"); sc.Input[I_LabelSide].SetCustomInputIndex(2);
		sc.Input[I_CallWallColor].Name = "Gamma: Call wall"; sc.Input[I_CallWallColor].SetColor(RGB(43, 196, 138));
		sc.Input[I_PutWallColor].Name = "Gamma: Put wall"; sc.Input[I_PutWallColor].SetColor(RGB(229, 72, 77));
		sc.Input[I_FlipColor].Name = "Gamma: Gamma flip colour"; sc.Input[I_FlipColor].SetColor(RGB(232, 176, 67));
		sc.Input[I_PosLevelColor].Name = "Gamma: Positive strikes"; sc.Input[I_PosLevelColor].SetColor(RGB(43, 196, 138));
		sc.Input[I_NegLevelColor].Name = "Gamma: Negative strikes"; sc.Input[I_NegLevelColor].SetColor(RGB(229, 72, 77));
		sc.Input[I_LevelWidth].Name = "Gamma: Line width"; sc.Input[I_LevelWidth].SetInt(1); sc.Input[I_LevelWidth].SetIntLimits(1, 6);
		sc.Input[I_ShowNews].Name = "News: Show the news feed (click the title to collapse)"; sc.Input[I_ShowNews].SetYesNo(1);
		sc.Input[I_NewsPlacement].Name = "News: Placement"; sc.Input[I_NewsPlacement].SetCustomInputStrings("TopLeft;TopRight;BottomLeft;BottomRight;TopMiddle;BottomMiddle"); sc.Input[I_NewsPlacement].SetCustomInputIndex(0);
		sc.Input[I_NewsX].Name = "News: X offset"; sc.Input[I_NewsX].SetInt(12); sc.Input[I_NewsX].SetIntLimits(-3000, 3000);
		sc.Input[I_NewsY].Name = "News: Y offset"; sc.Input[I_NewsY].SetInt(12); sc.Input[I_NewsY].SetIntLimits(-3000, 3000);
		sc.Input[I_NewsWidth].Name = "News: Width"; sc.Input[I_NewsWidth].SetInt(360); sc.Input[I_NewsWidth].SetIntLimits(200, 800);
		sc.Input[I_NewsRows].Name = "News: Headlines"; sc.Input[I_NewsRows].SetInt(6); sc.Input[I_NewsRows].SetIntLimits(1, 20);
		sc.Input[I_NewsMinImportance].Name = "News: Only headlines at least this important (0-3)"; sc.Input[I_NewsMinImportance].SetInt(0); sc.Input[I_NewsMinImportance].SetIntLimits(0, 3);
		sc.Input[I_ShowPopups].Name = "News: Pop-ups for new headlines"; sc.Input[I_ShowPopups].SetYesNo(1);
		sc.Input[I_PopupPlacement].Name = "News: Pop-up placement"; sc.Input[I_PopupPlacement].SetCustomInputStrings("TopLeft;TopRight;BottomLeft;BottomRight;TopMiddle;BottomMiddle"); sc.Input[I_PopupPlacement].SetCustomInputIndex(3);
		sc.Input[I_PopupX].Name = "News: Pop-up X offset"; sc.Input[I_PopupX].SetInt(12); sc.Input[I_PopupX].SetIntLimits(-3000, 3000);
		sc.Input[I_PopupY].Name = "News: Pop-up Y offset"; sc.Input[I_PopupY].SetInt(40); sc.Input[I_PopupY].SetIntLimits(-3000, 3000);
		sc.Input[I_PopupSeconds].Name = "News: Pop-up shows for (seconds)"; sc.Input[I_PopupSeconds].SetInt(12); sc.Input[I_PopupSeconds].SetIntLimits(3, 120);
		sc.Input[I_PopupMinImportance].Name = "News: Pop-ups only at least this important (0-3)"; sc.Input[I_PopupMinImportance].SetInt(2); sc.Input[I_PopupMinImportance].SetIntLimits(0, 3);
		sc.Input[I_ShowEventMarkers].Name = "News: Today's economic events on the time axis"; sc.Input[I_ShowEventMarkers].SetYesNo(1);
		sc.Input[I_EventMinImpact].Name = "News: Events shown"; sc.Input[I_EventMinImpact].SetCustomInputStrings("AllEvents;MediumAndHigh;HighOnly"); sc.Input[I_EventMinImpact].SetCustomInputIndex(1);
		sc.Input[I_AlertEntry].Name = "Alerts: Trade entered"; sc.Input[I_AlertEntry].SetYesNo(1);
		sc.Input[I_EntrySound].Name = "Alerts: Entry alert number (Global Settings > Alerts, 1-150)"; sc.Input[I_EntrySound].SetInt(1); sc.Input[I_EntrySound].SetIntLimits(1, 150);
		sc.Input[I_AlertFill].Name = "Alerts: Every fill"; sc.Input[I_AlertFill].SetYesNo(0);
		sc.Input[I_FillSound].Name = "Alerts: Fill alert number (Global Settings > Alerts, 1-150)"; sc.Input[I_FillSound].SetInt(1); sc.Input[I_FillSound].SetIntLimits(1, 150);
		sc.Input[I_AlertWin].Name = "Alerts: Winning trade"; sc.Input[I_AlertWin].SetYesNo(1);
		sc.Input[I_WinSound].Name = "Alerts: Win alert number (Global Settings > Alerts, 1-150)"; sc.Input[I_WinSound].SetInt(2); sc.Input[I_WinSound].SetIntLimits(1, 150);
		sc.Input[I_AlertLoss].Name = "Alerts: Losing trade"; sc.Input[I_AlertLoss].SetYesNo(1);
		sc.Input[I_LossSound].Name = "Alerts: Loss alert number (Global Settings > Alerts, 1-150)"; sc.Input[I_LossSound].SetInt(3); sc.Input[I_LossSound].SetIntLimits(1, 150);
		sc.Input[I_AlertDll].Name = "Alerts: Daily loss limit (warning and hit)"; sc.Input[I_AlertDll].SetYesNo(1);
		sc.Input[I_DllSound].Name = "Alerts: Loss limit alert number (Global Settings > Alerts, 1-150)"; sc.Input[I_DllSound].SetInt(4); sc.Input[I_DllSound].SetIntLimits(1, 150);
		sc.Input[I_DllWarnPercent].Name = "Alerts: Warn at (% of the limit used)"; sc.Input[I_DllWarnPercent].SetInt(75); sc.Input[I_DllWarnPercent].SetIntLimits(10, 99);
		sc.Input[I_AlertTarget].Name = "Alerts: Profit target hit"; sc.Input[I_AlertTarget].SetYesNo(1);
		sc.Input[I_TargetSound].Name = "Alerts: Target alert number (Global Settings > Alerts, 1-150)"; sc.Input[I_TargetSound].SetInt(2); sc.Input[I_TargetSound].SetIntLimits(1, 150);
		sc.Input[I_ProfitTarget].Name = "Alerts: Profit target ($, 0 = the account's target in RoninFlow)"; sc.Input[I_ProfitTarget].SetFloat(0.0f); sc.Input[I_ProfitTarget].SetFloatLimits(0f, 1000000f);
		sc.Input[I_AlertIncludeOpen].Name = "Alerts: Limits count open P&L"; sc.Input[I_AlertIncludeOpen].SetYesNo(1);
		sc.Input[I_BackColor].Name = "Look: Panel background"; sc.Input[I_BackColor].SetColor(RGB(14, 14, 18));
		sc.Input[I_BorderColor].Name = "Look: Panel border"; sc.Input[I_BorderColor].SetColor(RGB(38, 38, 46));
		sc.Input[I_TileColor].Name = "Look: Tiles"; sc.Input[I_TileColor].SetColor(RGB(22, 22, 28));
		sc.Input[I_TextColor].Name = "Look: Text"; sc.Input[I_TextColor].SetColor(RGB(230, 230, 234));
		sc.Input[I_MutedColor].Name = "Look: Muted text"; sc.Input[I_MutedColor].SetColor(RGB(138, 138, 150));
		sc.Input[I_PositiveColor].Name = "Look: Positive"; sc.Input[I_PositiveColor].SetColor(RGB(43, 196, 138));
		sc.Input[I_NegativeColor].Name = "Look: Negative"; sc.Input[I_NegativeColor].SetColor(RGB(229, 72, 77));
		sc.Input[I_WarningColor].Name = "Look: Warning"; sc.Input[I_WarningColor].SetColor(RGB(232, 176, 67));
		sc.Input[I_AccentColor].Name = "Look: Accent"; sc.Input[I_AccentColor].SetColor(RGB(139, 92, 246));
		sc.Input[I_PanelOpacity].Name = "Look: Panel opacity (%)"; sc.Input[I_PanelOpacity].SetInt(94); sc.Input[I_PanelOpacity].SetIntLimits(30, 100);
		return;
	}

	SuiteState* st = (SuiteState*)sc.GetPersistentPointer(1);
	if (sc.LastCallToFunction)
	{
		if (st) { DeleteFileA(st->req.c_str()); delete st; sc.SetPersistentPointer(1, NULL); }
		return;
	}
	if (!st)
	{
		st = new SuiteState();
		std::string folder = Folder();
		char id[64]; snprintf(id, sizeof(id), "sc-%d-%d", sc.ChartNumber, sc.StudyGraphInstanceID);
		st->req = folder + "\\suite-req-" + id + ".txt";
		st->resp = folder + "\\suite-" + id + ".txt";
		sc.SetPersistentPointer(1, st);
	}
	sc.p_GDIFunction = DrawToChart;

	DWORD now = GetTickCount();
	if (now - st->lastRequest > 5000 || st->lastRequest == 0)
	{
		st->lastRequest = now;
		std::string account = sc.Input[I_AccountName].GetString();
		if (account.empty()) account = sc.SelectedTradeAccount.GetChars();
		WriteText(st->req, std::string(sc.Symbol.GetChars()) + "\t" + account);
	}
	if (now - st->lastRead > (DWORD)max(2, sc.Input[I_RefreshSeconds].GetInt()) * 1000)
	{
		st->lastRead = now;
		std::string text;
		if (ReadText(st->resp, text) && !text.empty())
		{
			Parse(*st, text);
			for (auto& n : st->news)
			{
				if (st->seen.find("|" + n.id + "|") != std::string::npos) continue;
				st->seen += n.id + "|";
				if (st->primed && sc.Input[I_ShowPopups].GetYesNo() && n.imp >= sc.Input[I_PopupMinImportance].GetInt()) { st->popups.push_back(n); st->popupUntil.push_back(now + sc.Input[I_PopupSeconds].GetInt() * 1000); }
			}
			if (st->seen.size() > 20000) st->seen = "|";
			st->primed = true;
		}
	}
	for (int i = (int)st->popups.size() - 1; i >= 0; i--) if ((long)(st->popupUntil[i] - now) < 0) { st->popups.erase(st->popups.begin() + i); st->popupUntil.erase(st->popupUntil.begin() + i); }
	ComputeTrades(sc, *st);
	CheckAlerts(sc, *st);
}
