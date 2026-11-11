// RoninFlow Sync — Quantower strategy (beta)
//
// Sends every fill (trade) from your connected Quantower accounts to RoninFlow, plus account balances.
// The journal pairs fills into round-trip trades. Read-only: it never places or changes orders.
//
// Install: npm run addon:qt (builds it into Quantower's Strategies folder; needs the free .NET SDK).
// Then in Quantower: Strategies Manager → "RoninFlow Sync" → Run.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using TradingPlatform.BusinessLayer;

namespace TradeJournal
{
    public sealed class TradeJournalSync : Strategy
    {
        private const string SyncVersion = "1.0.0-beta";

        [InputParameter("Journal address", 0)]
        public string JournalUrl = "http://127.0.0.1:5173/api/connect/ingest";

        [InputParameter("Token (only for a journal on another computer)", 1)]
        public string Token = "";

        [InputParameter("Days of history to send at start", 2, minimum: 0, maximum: 365, increment: 1, decimalPlaces: 0)]
        public int BackfillDays = 30;

        // fully qualified: inside a Strategy, "Core" could also mean a member of the base class
        private static global::TradingPlatform.BusinessLayer.Core QCore { get { return global::TradingPlatform.BusinessLayer.Core.Instance; } }
        private static readonly HttpClient http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        private readonly ConcurrentQueue<string> queue = new ConcurrentQueue<string>();
        private readonly ConcurrentDictionary<string, bool> seen = new ConcurrentDictionary<string, bool>();
        private System.Threading.Timer timer;
        private int busy, failures;
        private DateTime lastHeartbeat = DateTime.MinValue;

        public TradeJournalSync() : base()
        {
            this.Name = "RoninFlow Sync";
            this.Description = "Sends your fills to RoninFlow (read-only, never trades).";
        }

        protected override void OnRun()
        {
            QCore.TradeAdded += this.OnTrade;
            this.Log("[RoninFlow] started — sending fills to " + this.JournalUrl);
            Task.Run(() => this.Backfill());
            this.timer = new System.Threading.Timer(_ => this.Tick(), null, 2000, 5000);
        }

        protected override void OnStop()
        {
            QCore.TradeAdded -= this.OnTrade;
            if (this.timer != null) { this.timer.Dispose(); this.timer = null; }
            this.Tick();
        }

        private void Backfill()
        {
            try
            {
                if (this.BackfillDays <= 0) return;
                var req = new TradesHistoryRequestParameters { From = DateTime.UtcNow.AddDays(-this.BackfillDays), To = DateTime.UtcNow.AddMinutes(1) };
                IList<Trade> list = QCore.GetTrades(req);
                int n = 0;
                if (list != null) foreach (Trade t in list) if (this.Enqueue(t)) n++;
                this.Log("[RoninFlow] queued " + n + " fill(s) from the last " + this.BackfillDays + " days");
            }
            catch (Exception e) { this.Log("[RoninFlow] couldn't load trade history: " + e.Message, StrategyLoggingLevel.Error); }
        }

        private void OnTrade(Trade t) { this.Enqueue(t); }

        private bool Enqueue(Trade t)
        {
            try
            {
                if (t == null || t.Symbol == null) return false;
                string account = t.Account != null ? (t.Account.Name ?? t.Account.Id) : "Default";
                string id = !string.IsNullOrEmpty(t.Id) ? t.Id : (account + "|" + t.Symbol.Name + "|" + t.DateTime.Ticks + "|" + t.Side + "|" + t.Quantity + "|" + t.Price);
                if (!this.seen.TryAdd(account + "|" + id, true)) return false;

                double pointValue = double.NaN;
                try
                {
                    double tick = t.Symbol.TickSize;
                    double cost = t.Symbol.GetTickCost(t.Price);
                    if (tick > 0 && tick < 1e9 && cost > 0 && cost < 1e9) pointValue = cost / tick;
                }
                catch { }

                var sb = new StringBuilder("{");
                Str(sb, "id", id); sb.Append(',');
                Str(sb, "account", account); sb.Append(',');
                Str(sb, "symbol", t.Symbol.Name); sb.Append(',');
                Str(sb, "side", t.Side == Side.Buy ? "Buy" : "Sell"); sb.Append(',');
                Num(sb, "qty", Math.Abs(t.Quantity)); sb.Append(',');
                Num(sb, "price", t.Price); sb.Append(',');
                Str(sb, "time", Iso(t.DateTime)); sb.Append(',');
                Num(sb, "commission", t.Fee != null ? Math.Abs(t.Fee.Value) : 0);
                if (!double.IsNaN(pointValue)) { sb.Append(','); Num(sb, "pointValue", pointValue); }
                sb.Append('}');
                this.queue.Enqueue(sb.ToString());
                return true;
            }
            catch (Exception e) { this.Log("[RoninFlow] skipped a fill: " + e.Message, StrategyLoggingLevel.Error); return false; }
        }

        private void Tick()
        {
            if (Interlocked.Exchange(ref this.busy, 1) == 1) return;
            try
            {
                while (!this.queue.IsEmpty)
                {
                    var batch = new List<string>();
                    string s;
                    while (batch.Count < 200 && this.queue.TryPeek(out s)) { batch.Add(s); this.queue.TryDequeue(out s); }
                    string body = "{\"source\":\"quantower\",\"platform\":\"Quantower\",\"version\":\"" + SyncVersion + "\",\"fills\":[" + string.Join(",", batch) + "]}";
                    if (!this.Post(body))
                    {
                        // put them back (at the end — the journal sorts fills by time anyway) and retry in 5 s
                        foreach (string b in batch) this.queue.Enqueue(b);
                        return;
                    }
                }
                if ((DateTime.UtcNow - this.lastHeartbeat).TotalSeconds >= 30) this.Heartbeat();
            }
            finally { Interlocked.Exchange(ref this.busy, 0); }
        }

        private void Heartbeat()
        {
            this.lastHeartbeat = DateTime.UtcNow;
            var accts = new List<string>();
            var bals = new List<string>();
            foreach (Account a in QCore.Accounts)
            {
                if (a == null) continue;
                string name = a.Name ?? a.Id;
                var q = new StringBuilder(); Str(q, "n", name); accts.Add(q.ToString().Substring(4));
                var sb = new StringBuilder("{");
                Str(sb, "account", name); sb.Append(',');
                Num(sb, "balance", a.Balance);
                sb.Append('}');
                bals.Add(sb.ToString());
            }
            this.Post("{\"source\":\"quantower\",\"heartbeat\":{\"platform\":\"Quantower\",\"version\":\"" + SyncVersion + "\",\"accounts\":[" + string.Join(",", accts) + "],\"balances\":[" + string.Join(",", bals) + "]}}");
        }

        private bool Post(string json)
        {
            try
            {
                var msg = new HttpRequestMessage(System.Net.Http.HttpMethod.Post, this.JournalUrl.Trim()) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
                if (!string.IsNullOrWhiteSpace(this.Token)) msg.Headers.TryAddWithoutValidation("Authorization", "Bearer " + this.Token.Trim());
                using (HttpResponseMessage res = http.SendAsync(msg).GetAwaiter().GetResult())
                {
                    if (res.IsSuccessStatusCode)
                    {
                        if (this.failures > 0) this.Log("[RoninFlow] connected again");
                        this.failures = 0;
                        return true;
                    }
                    this.Fail("the journal answered " + (int)res.StatusCode + ((int)res.StatusCode == 401 ? " — check the token" : ""));
                }
            }
            catch (Exception e) { this.Fail(e.Message); }
            return false;
        }

        private void Fail(string why)
        {
            this.failures++;
            if (this.failures == 1 || this.failures % 60 == 0)
                this.Log("[RoninFlow] couldn't reach " + this.JournalUrl + ": " + why + " (will keep retrying)", StrategyLoggingLevel.Error);
        }

        private static string Iso(DateTime t)
        {
            // Quantower keeps times in UTC; convert if a local time ever comes through
            DateTime u = t.Kind == DateTimeKind.Local ? t.ToUniversalTime() : t;
            return u.ToString("yyyy-MM-dd'T'HH:mm:ss.fff", CultureInfo.InvariantCulture) + "Z";
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
