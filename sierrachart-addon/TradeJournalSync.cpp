// RoninFlow Sync — Sierra Chart custom study (ACSIL)
//
// Add it to the chart(s) you trade from. Every fill for that chart's symbol and trade account is written to
// %LOCALAPPDATA%\TradeJournal\drop, which the journal on this PC reads every 10 seconds and pairs into trades.
// Read-only: it never places or changes orders.
//
// Install: npm run addon:sierra (copies this file into C:\SierraChart\ACS_Source), then in Sierra Chart:
// Analysis → Build Custom Studies DLL → select TradeJournalSync.cpp → Remote Build. Then add the study
// "RoninFlow Sync" to your trading chart(s) (Analysis → Studies → Add Custom Study).
#include "sierrachart.h"
#include <windows.h>
#include <cstdio>
#include <cctype>
#include <string>

SCDLLName("RoninFlow Sync")

static std::string JsonEscape(const char* s)
{
	std::string out;
	for (const char* p = s ? s : ""; *p; ++p)
	{
		if (*p == '"' || *p == '\\') { out += '\\'; out += *p; }
		else if ((unsigned char)*p < 0x20) out += ' ';
		else out += *p;
	}
	return out;
}

// "ESZ25_FUT_CME", "ESZ25-CME", "ESZ5.CME" -> "ESZ25" / "ESZ5" (the journal recognises the root from that)
static std::string BaseSymbol(const char* s)
{
	std::string sym = s ? s : "";
	size_t cut = sym.find_first_of("_-.");
	if (cut != std::string::npos && cut > 0) sym = sym.substr(0, cut);
	return sym;
}

static std::string IsoUtc(const SCDateTime& t)
{
	int y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0, ms = 0;
	t.GetDateTimeYMDHMS_MS(y, mo, d, h, mi, s, ms);
	char buf[40];
	snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", y, mo, d, h, mi, s, ms);
	return buf;
}

static std::string DropFolder()
{
	char base[MAX_PATH] = { 0 };
	DWORD n = GetEnvironmentVariableA("LOCALAPPDATA", base, MAX_PATH);
	std::string dir = std::string(n > 0 && n < MAX_PATH ? base : "C:") + "\\TradeJournal";
	CreateDirectoryA(dir.c_str(), NULL);
	dir += "\\drop";
	CreateDirectoryA(dir.c_str(), NULL);
	return dir;
}

// Win32 file writes (no CRT fopen, so no "deprecated function" build errors)
static bool WriteFileText(const std::string& path, const std::string& text, bool append)
{
	HANDLE h = CreateFileA(path.c_str(), append ? FILE_APPEND_DATA : GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL,
		append ? OPEN_ALWAYS : CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
	if (h == INVALID_HANDLE_VALUE) return false;
	DWORD done = 0;
	BOOL ok = WriteFile(h, text.data(), (DWORD)text.size(), &done, NULL);
	CloseHandle(h);
	return ok && done == text.size();
}

static std::string SafeName(const std::string& s)
{
	std::string out;
	for (char c : s) out += (isalnum((unsigned char)c) ? c : '_');
	return out;
}

SCSFExport scsf_TradeJournalSync(SCStudyInterfaceRef sc)
{
	SCInputRef InTimesAreUtc = sc.Input[0];

	if (sc.SetDefaults)
	{
		sc.GraphName = "RoninFlow Sync";
		sc.StudyDescription = "Sends this chart's fills (symbol + trade account) to RoninFlow. Read-only, never trades.";
		sc.AutoLoop = 0;
		sc.GraphRegion = 0;
		sc.UpdateAlways = 1; // keep running (and writing the 'alive' status) even when the market is quiet

		InTimesAreUtc.Name = "Fill times are already UTC (leave No unless times show up shifted)";
		InTimesAreUtc.SetYesNo(0);
		return;
	}

	int& written = sc.GetPersistentInt(1);       // fills already written this session
	int& announced = sc.GetPersistentInt(2);
	SCDateTime& lastStatus = sc.GetPersistentSCDateTime(1);

	std::string account = sc.SelectedTradeAccount.GetChars();
	if (account.empty()) account = "Sim1";
	std::string folder = DropFolder();
	std::string tag = SafeName(account + "-" + BaseSymbol(sc.Symbol.GetChars()));
	std::string fillsFile = folder + "\\sierrachart-" + tag + ".jsonl";
	std::string statusFile = folder + "\\sierrachart-" + tag + ".status.json";

	double pointValue = (sc.TickSize > 0 && sc.CurrencyValuePerTick > 0) ? sc.CurrencyValuePerTick / sc.TickSize : 0;

	int total = sc.GetOrderFillArraySize();
	if (total < written) written = 0; // fills reloaded (e.g. trade mode switched) — write again, repeats are ignored
	if (total > written)
	{
		std::string lines;
		for (int i = written; i < total; ++i)
		{
			s_SCOrderFillData fill;
			if (!sc.GetOrderFillEntry(i, fill)) continue;
			if (fill.Quantity == 0) continue;
			SCDateTime t = fill.FillDateTime;
			if (!InTimesAreUtc.GetYesNo()) t = sc.AdjustDateTimeToGMT(fill.FillDateTime); // Sierra Chart time zone → UTC
			std::string sym = BaseSymbol(fill.Symbol.GetChars());
			std::string acct = fill.TradeAccount.GetChars();
			if (acct.empty()) acct = account;
			std::string id = fill.FillExecutionServiceID.GetChars();
			if (id.empty()) { char b[64]; snprintf(b, sizeof(b), "%d-%d", fill.InternalOrderID, i); id = std::string(b) + "-" + IsoUtc(t); }
			char nums[200];
			snprintf(nums, sizeof(nums), "\"qty\":%u,\"price\":%.10g", (unsigned int)fill.Quantity, fill.FillPrice);
			std::string line = "{\"id\":\"" + JsonEscape(id.c_str()) + "\",\"platform\":\"Sierra Chart\",\"version\":\"1.0.0\",\"account\":\"" + JsonEscape(acct.c_str())
				+ "\",\"symbol\":\"" + JsonEscape(sym.c_str()) + "\",\"side\":\"" + (fill.BuySell == BSE_BUY ? "Buy" : "Sell") + "\"," + nums
				+ ",\"time\":\"" + IsoUtc(t) + "\"";
			if (pointValue > 0) { char pv[64]; snprintf(pv, sizeof(pv), ",\"pointValue\":%.10g", pointValue); line += pv; }
			if (fill.IsSimulated) line += ",\"simulated\":true";
			line += "}\n";
			lines += line;
		}
		if (lines.empty() || WriteFileText(fillsFile, lines, true)) written = total;
		else if (!announced)
		{
			std::string m = "RoninFlow Sync: can't write to " + folder;
			sc.AddMessageToLog(SCString(m.c_str()), 1);
		}
	}

	// 'alive' status every 5 seconds — the journal shows Sierra Chart as connected while this keeps changing
	if (sc.CurrentSystemDateTime - lastStatus > SCDateTime::SECONDS(5))
	{
		lastStatus = sc.CurrentSystemDateTime;
		std::string st = "{\"platform\":\"Sierra Chart\",\"version\":\"1.0.0\",\"account\":\"" + JsonEscape(account.c_str()) + "\",\"symbol\":\"" + JsonEscape(sc.Symbol.GetChars()) + "\"}";
		WriteFileText(statusFile, st, false);
	}

	if (!announced)
	{
		announced = 1;
		char msg[400];
		snprintf(msg, sizeof(msg), "RoninFlow Sync started: %s on %s (%d fill(s) loaded) -> %s", sc.Symbol.GetChars(), account.c_str(), total, folder.c_str());
		sc.AddMessageToLog(SCString(msg), 0);
	}
}
