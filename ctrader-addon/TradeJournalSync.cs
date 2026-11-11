// RoninFlow Sync — cTrader cBot (cTrader 5 or newer)
//
// Sends every closed trade on this account to your RoninFlow, plus the live balance. Read-only: it never
// places, changes or closes orders.
//
// Two ways out, so it works even if one is blocked:
//   1. a web request to the journal (default: the journal on this PC, http://127.0.0.1:5173)
//   2. the same trades written to Documents\cAlgo\Data\cBots (the journal on this PC watches that folder)
// The journal ignores repeats, so getting a trade both ways is fine.
//
// Install: cTrader → Algo → cBots → New → paste this file over the template → Build (Ctrl+B).
// Then add an instance on any symbol/chart and press Start. One instance per account you want synced.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using cAlgo.API;
using cAlgo.API.Internals;

namespace cAlgo.Robots
{
    [Robot(AccessRights = AccessRights.None, TimeZone = TimeZones.UTC)]
    public class TradeJournalSync : Robot
    {
        private const string SyncVersion = "1.0.0";

        [Parameter("Journal address", DefaultValue = "http://127.0.0.1:5173/api/connect/ingest")]
        public string JournalUrl { get; set; }

        [Parameter("Token (only for a journal on another computer)", DefaultValue = "")]
        public string Token { get; set; }

        [Parameter("Days of history to send at start", DefaultValue = 30, MinValue = 0, MaxValue = 365)]
        public int BackfillDays { get; set; }

        private readonly HashSet<long> seen = new HashSet<long>();      // closing deals already handled
        private readonly HashSet<string> inFile = new HashSet<string>(); // ids already in the drop file
        private readonly List<string> pending = new List<string>();     // trade JSON not yet accepted by the journal
        private string account, tradesFile, statusFile;
        private int lastHistoryCount = -1;
        private DateTime lastHeartbeat = DateTime.MinValue;
        private int failures;

        protected override void OnStart()
        {
            account = Account.Number.ToString(CultureInfo.InvariantCulture);
            tradesFile = "trade-journal-ctrader-" + account + ".jsonl";
            statusFile = "trade-journal-ctrader-" + account + ".status.json";
            LoadFileIds();
            int n = Scan(Server.Time.AddDays(-BackfillDays));
            Print("[RoninFlow] started for account {0} ({1}) — {2} closed trade(s) from the last {3} days", account, Account.BrokerName, n, BackfillDays);
            Positions.Closed += OnPositionClosed;
            Flush();
            Heartbeat();
            Timer.Start(TimeSpan.FromSeconds(5));
        }

        protected override void OnStop()
        {
            Positions.Closed -= OnPositionClosed;
        }

        private void OnPositionClosed(PositionClosedEventArgs args)
        {
            Scan(Server.Time.AddDays(-7));
            Flush();
        }

        protected override void OnTimer()
        {
            if (History.Count != lastHistoryCount) Scan(Server.Time.AddDays(-7));
            Flush();
            WriteStatus();
            if ((DateTime.UtcNow - lastHeartbeat).TotalSeconds >= 30) Heartbeat();
        }

        // Every closing deal is one journal trade (a partial close is its own trade, with its own P&L).
        private int Scan(DateTime from)
        {
            int added = 0;
            lastHistoryCount = History.Count;
            foreach (HistoricalTrade t in History)
            {
                if (t.ClosingTime < from) continue;
                long deal = t.ClosingDealId;
                if (seen.Contains(deal)) continue;
                seen.Add(deal);
                string id = "ctrader-" + account + "-" + deal.ToString(CultureInfo.InvariantCulture);
                var sb = new StringBuilder("{");
                Str(sb, "id", id); sb.Append(',');
                Str(sb, "platform", "cTrader"); sb.Append(',');
                Str(sb, "version", SyncVersion); sb.Append(',');
                Str(sb, "account", account); sb.Append(',');
                Str(sb, "symbol", t.SymbolName); sb.Append(',');
                Str(sb, "direction", t.TradeType == TradeType.Buy ? "Long" : "Short"); sb.Append(',');
                Num(sb, "qty", t.Quantity); sb.Append(',');
                Num(sb, "units", t.VolumeInUnits); sb.Append(',');
                Str(sb, "entryTime", Iso(t.EntryTime)); sb.Append(',');
                Str(sb, "exitTime", Iso(t.ClosingTime)); sb.Append(',');
                Num(sb, "entryPrice", t.EntryPrice); sb.Append(',');
                Num(sb, "exitPrice", t.ClosingPrice); sb.Append(',');
                Num(sb, "pnl", t.NetProfit); sb.Append(',');          // net of commissions and swap
                Num(sb, "fees", -t.Commissions); sb.Append(',');      // cTrader reports commissions as a negative number
                Num(sb, "swap", t.Swap); sb.Append(',');
                Str(sb, "positionId", t.PositionId.ToString(CultureInfo.InvariantCulture)); sb.Append(',');
                Str(sb, "label", t.Label ?? "");
                sb.Append('}');
                string line = sb.ToString();
                pending.Add(line);
                if (!inFile.Contains(id))
                {
                    try { File.AppendAllText(tradesFile, line + "\n"); inFile.Add(id); }
                    catch (Exception e) { if (added == 0) Print("[RoninFlow] couldn't write the backup file: {0}", e.Message); }
                }
                added++;
            }
            return added;
        }

        private void Flush()
        {
            while (pending.Count > 0)
            {
                int take = Math.Min(200, pending.Count);
                string body = "{\"source\":\"ctrader\",\"platform\":\"cTrader\",\"version\":\"" + SyncVersion + "\",\"trades\":["
                    + string.Join(",", pending.GetRange(0, take)) + "]}";
                if (!Post(body)) return; // keep them and try again in 5 seconds
                pending.RemoveRange(0, take);
            }
        }

        private void Heartbeat()
        {
            lastHeartbeat = DateTime.UtcNow;
            var sb = new StringBuilder("{\"source\":\"ctrader\",\"heartbeat\":{");
            Str(sb, "platform", "cTrader"); sb.Append(',');
            Str(sb, "version", SyncVersion); sb.Append(',');
            sb.Append("\"accounts\":[\"").Append(account).Append("\"],\"balances\":[{");
            Str(sb, "account", account); sb.Append(',');
            Num(sb, "balance", Account.Balance); sb.Append(',');
            Num(sb, "openPnl", Account.Equity - Account.Balance); sb.Append(',');
            Str(sb, "broker", Account.BrokerName ?? ""); sb.Append(',');
            sb.Append("\"live\":").Append(Account.IsLive ? "true" : "false");
            sb.Append("}]}}");
            Post(sb.ToString());
        }

        private void WriteStatus()
        {
            try
            {
                var sb = new StringBuilder("{");
                Str(sb, "platform", "cTrader"); sb.Append(',');
                Str(sb, "version", SyncVersion); sb.Append(',');
                Str(sb, "account", account); sb.Append(',');
                Num(sb, "balance", Account.Balance); sb.Append(',');
                Num(sb, "equity", Account.Equity);
                sb.Append('}');
                File.WriteAllText(statusFile, sb.ToString());
            }
            catch { /* the web request path still works */ }
        }

        private bool Post(string json)
        {
            if (string.IsNullOrWhiteSpace(JournalUrl)) return false;
            try
            {
                var req = new HttpRequest(new Uri(JournalUrl.Trim()));
                req.Method = HttpMethod.Post;
                req.Body = json;
                req.Timeout = TimeSpan.FromSeconds(8);
                // no Content-Type header: cTrader manages it itself, and the journal reads the body as JSON either way
                if (!string.IsNullOrWhiteSpace(Token)) req.Headers.Add("Authorization", "Bearer " + Token.Trim());
                HttpResponse res = Http.Send(req);
                if (res.IsSuccessful)
                {
                    if (failures > 0) Print("[RoninFlow] connected again");
                    failures = 0;
                    return true;
                }
                Report("the journal answered " + res.StatusCode + (res.StatusCode == 401 ? " — check the token" : "") + " " + (res.Body ?? ""));
            }
            catch (Exception e) { Report(e.Message); }
            return false;
        }

        private void Report(string why)
        {
            failures++;
            if (failures == 1 || failures % 60 == 0)
                Print("[RoninFlow] couldn't reach {0}: {1}. Trades are still saved to the backup file, which the journal on this PC reads.", JournalUrl, why);
        }

        private void LoadFileIds()
        {
            try
            {
                if (!File.Exists(tradesFile)) return;
                foreach (string l in File.ReadAllLines(tradesFile))
                {
                    int i = l.IndexOf("\"id\":\"", StringComparison.Ordinal);
                    if (i < 0) continue;
                    int j = l.IndexOf('"', i + 6);
                    if (j > i) inFile.Add(l.Substring(i + 6, j - i - 6));
                }
            }
            catch { }
        }

        // the robot runs in UTC (TimeZone above), so these are UTC times
        private static string Iso(DateTime t)
        {
            return t.ToString("yyyy-MM-dd'T'HH:mm:ss.fff", CultureInfo.InvariantCulture) + "Z";
        }

        private static void Str(StringBuilder sb, string k, string v)
        {
            sb.Append('"').Append(k).Append("\":\"");
            foreach (char c in v ?? "")
            {
                if (c == '"' || c == '\\') sb.Append('\\').Append(c);
                else if (c < ' ') sb.Append(' ');
                else sb.Append(c);
            }
            sb.Append('"');
        }

        private static void Num(StringBuilder sb, string k, double v)
        {
            sb.Append('"').Append(k).Append("\":");
            if (double.IsNaN(v) || double.IsInfinity(v)) sb.Append("null");
            else sb.Append(v.ToString("R", CultureInfo.InvariantCulture));
        }
    }
}
