// RoninFlow — NinjaTrader 8 live sync add-on.
//
// Sends every execution (fill) from every connected NinjaTrader account to the journal's connector inbox
// (POST /api/connect/ingest), plus a heartbeat every 30 s with account balances and open P&L.
// The journal pairs fills into trades, so scale-ins, partial exits and reversals come out right.
//
// Install: copy this file to  Documents\NinjaTrader 8\bin\Custom\AddOns\  (npm run addon:nt does it),
//          then in NinjaTrader: New → NinjaScript Editor → press F5 to compile. It starts by itself after that
//          and every time NinjaTrader starts.
// Settings (optional): Documents\NinjaTrader 8\journal-sync.txt
//          url=http://127.0.0.1:5173/api/connect/ingest      (default — the journal on this PC, no token needed)
//          token=<token from Connections → Webhook / API>    (only when the journal runs on another machine)
//          accounts=Sim101,APEX-12345                        (optional: only these accounts)
//          timezone=Eastern Standard Time                    (only if NinjaTrader's time zone differs from this PC's)
// Messages appear in New → NinjaScript Output.
#region Using declarations
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using NinjaTrader.Cbi;
using NinjaTrader.Code;
#endregion

namespace NinjaTrader.NinjaScript.AddOns
{
	public class TradeJournalSync : AddOnBase
	{
		private const string SyncVersion = "1.0.0";
		private const string DefaultUrl = "http://127.0.0.1:5173/api/connect/ingest";

		private string url = DefaultUrl;
		private string token = "";
		private HashSet<string> onlyAccounts;
		private readonly ConcurrentQueue<string> queue = new ConcurrentQueue<string>();
		private readonly HashSet<Account> hooked = new HashSet<Account>();
		private readonly HashSet<string> sent = new HashSet<string>();
		private System.Threading.Timer flushTimer;
		private System.Threading.Timer heartbeatTimer;
		private int busy;
		private DateTime nextTry = DateTime.MinValue;
		private static TimeZoneInfo platformZone; // from journal-sync.txt "timezone=", else the PC's own zone
		private static bool running;              // NinjaTrader can create more than one instance — only one may attach
		private bool owner;
		private int failures;
		private string lastError = "";

		protected override void OnStateChange()
		{
			if (State == State.SetDefaults)
			{
				Name = "RoninFlow Sync";
				Description = "Sends your executions to RoninFlow for automatic trade logging.";
			}
			else if (State == State.Configure)
			{
				// runs once when NinjaTrader starts (and after a compile); SetDefaults also runs for listings, so attach here
				if (running) return;
				running = true;
				owner = true;
				LoadSettings();
				lock (Account.All)
					foreach (Account a in Account.All) Hook(a);
				Account.AccountStatusUpdate += OnAccountStatusUpdate;
				flushTimer = new System.Threading.Timer(_ => Flush(), null, 2000, 2000);
				heartbeatTimer = new System.Threading.Timer(_ => Heartbeat(), null, 3000, 30000);
				Log("started — sending to " + url);
			}
			else if (State == State.Terminated)
			{
				if (!owner) return;
				owner = false;
				running = false;
				Account.AccountStatusUpdate -= OnAccountStatusUpdate;
				lock (hooked)
				{
					foreach (Account a in hooked) a.ExecutionUpdate -= OnExecutionUpdate;
					hooked.Clear();
				}
				if (flushTimer != null) flushTimer.Dispose();
				if (heartbeatTimer != null) heartbeatTimer.Dispose();
				Flush(); // last attempt
			}
		}

		// ---------------------------------------------------------------- accounts & executions
		private bool Wanted(Account a)
		{
			if (a == null) return false;
			string n = a.Name ?? "";
			if (n.StartsWith("Backtest", StringComparison.OrdinalIgnoreCase) || n.StartsWith("Playback", StringComparison.OrdinalIgnoreCase)) return false;
			return onlyAccounts == null || onlyAccounts.Contains(n);
		}

		private void Hook(Account a)
		{
			if (!Wanted(a)) return;
			lock (hooked)
			{
				if (!hooked.Add(a)) return;
				a.ExecutionUpdate += OnExecutionUpdate;
			}
			// executions NinjaTrader already has for this account (today's session) — the journal ignores repeats
			try
			{
				List<Execution> existing;
				lock (a.Executions) existing = a.Executions.ToList();
				foreach (Execution e in existing) Enqueue(e);
				if (existing.Count > 0) Log(a.Name + ": queued " + existing.Count + " existing execution(s)");
			}
			catch (Exception ex) { Log("could not read executions for " + a.Name + ": " + ex.Message); }
		}

		private void OnAccountStatusUpdate(object sender, AccountStatusEventArgs e)
		{
			if (e.Status == ConnectionStatus.Connected) Hook(e.Account);
		}

		private void OnExecutionUpdate(object sender, ExecutionEventArgs e)
		{
			if (e != null && e.Execution != null) Enqueue(e.Execution);
		}

		private void Enqueue(Execution x)
		{
			try
			{
				string id = x.ExecutionId;
				if (string.IsNullOrEmpty(id)) id = x.Account.Name + "|" + x.Time.Ticks + "|" + x.Price + "|" + x.Quantity;
				lock (sent) { if (!sent.Add(id)) return; }
				var mi = x.Instrument.MasterInstrument;
				var sb = new StringBuilder("{");
				Prop(sb, "id", id); sb.Append(',');
				Prop(sb, "account", x.Account.Name); sb.Append(',');
				Prop(sb, "symbol", x.Instrument.FullName); sb.Append(',');
				Prop(sb, "side", x.MarketPosition == MarketPosition.Long ? "Buy" : "Sell"); sb.Append(',');
				Num(sb, "qty", x.Quantity); sb.Append(',');
				Num(sb, "price", x.Price); sb.Append(',');
				Prop(sb, "time", ToUtc(x.Time).ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture)); sb.Append(',');
				Num(sb, "commission", x.Commission); sb.Append(',');
				Num(sb, "pointValue", mi.PointValue);
				sb.Append('}');
				queue.Enqueue(sb.ToString());
			}
			catch (Exception ex) { Log("skipped an execution: " + ex.Message); }
		}

		// Execution times are wall-clock times in NinjaTrader's time zone (Tools → Options → General), which is the
		// PC's zone unless you changed it — in that case put e.g. "timezone=Eastern Standard Time" in journal-sync.txt.
		private static DateTime ToUtc(DateTime t)
		{
			if (t.Kind == DateTimeKind.Utc) return t;
			try { return TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(t, DateTimeKind.Unspecified), platformZone ?? TimeZoneInfo.Local); }
			catch { return t.ToUniversalTime(); }
		}

		// ---------------------------------------------------------------- sending
		private void Flush()
		{
			if (queue.IsEmpty || DateTime.UtcNow < nextTry) return;
			if (Interlocked.Exchange(ref busy, 1) == 1) return;
			var batch = new List<string>();
			try
			{
				string item;
				while (batch.Count < 500 && queue.TryDequeue(out item)) batch.Add(item);
				if (batch.Count == 0) return;
				string body = "{\"source\":\"ninjatrader\",\"platform\":\"NinjaTrader 8\",\"version\":\"" + SyncVersion + "\",\"fills\":[" + string.Join(",", batch) + "]}";
				string reply = Post(body);
				failures = 0;
				if (lastError != "") { Log("connected to the journal again"); lastError = ""; }
				Log("sent " + batch.Count + " execution(s) → " + Short(reply));
			}
			catch (Exception ex)
			{
				foreach (string b in batch) queue.Enqueue(b); // keep them; try again with back-off
				failures++;
				nextTry = DateTime.UtcNow.AddSeconds(Math.Min(60, 2 * failures));
				if (ex.Message != lastError) { lastError = ex.Message; Log("couldn't reach the journal (" + ex.Message + ") — will keep retrying"); }
			}
			finally { Interlocked.Exchange(ref busy, 0); }
		}

		private void Heartbeat()
		{
			try
			{
				var accts = new List<string>();
				var bals = new List<string>();
				lock (hooked)
				{
					foreach (Account a in hooked)
					{
						accts.Add(Quote(a.Name));
						double cash = Safe(() => a.Get(AccountItem.CashValue, Currency.UsDollar));
						double open = Safe(() => a.Get(AccountItem.UnrealizedProfitLoss, Currency.UsDollar));
						double realized = Safe(() => a.Get(AccountItem.RealizedProfitLoss, Currency.UsDollar));
						var sb = new StringBuilder("{");
						Prop(sb, "account", a.Name); sb.Append(',');
						Num(sb, "balance", cash); sb.Append(',');
						Num(sb, "openPnl", open); sb.Append(',');
						Num(sb, "realizedPnl", realized); sb.Append(',');
						string conn = "";
						try { if (a.Connection != null && a.Connection.Options != null) conn = a.Connection.Options.Name; } catch { }
						Prop(sb, "connection", conn);
						sb.Append('}');
						bals.Add(sb.ToString());
					}
				}
				string body = "{\"source\":\"ninjatrader\",\"heartbeat\":{\"platform\":\"NinjaTrader 8\",\"version\":\"" + SyncVersion + "\",\"queued\":" + queue.Count
					+ ",\"accounts\":[" + string.Join(",", accts) + "],\"balances\":[" + string.Join(",", bals) + "]}}";
				Post(body);
			}
			catch { /* the fill sender reports connection problems */ }
		}

		private string Post(string json)
		{
			var req = (HttpWebRequest)WebRequest.Create(url);
			req.Method = "POST";
			req.ContentType = "application/json";
			req.Timeout = 10000;
			if (!string.IsNullOrEmpty(token)) req.Headers["Authorization"] = "Bearer " + token;
			byte[] data = Encoding.UTF8.GetBytes(json);
			req.ContentLength = data.Length;
			using (Stream s = req.GetRequestStream()) s.Write(data, 0, data.Length);
			try
			{
				using (var res = (HttpWebResponse)req.GetResponse())
				using (var r = new StreamReader(res.GetResponseStream())) return r.ReadToEnd();
			}
			catch (WebException we)
			{
				var res = we.Response as HttpWebResponse;
				if (res == null) throw;
				string text;
				using (var r = new StreamReader(res.GetResponseStream())) text = r.ReadToEnd();
				throw new Exception((int)res.StatusCode + " " + Short(text));
			}
		}

		// ---------------------------------------------------------------- settings & helpers
		private void LoadSettings()
		{
			try
			{
				string file = Path.Combine(Core.Globals.UserDataDir, "journal-sync.txt");
				if (!File.Exists(file)) return;
				foreach (string raw in File.ReadAllLines(file))
				{
					string line = raw.Trim();
					if (line.Length == 0 || line.StartsWith("#")) continue;
					int i = line.IndexOf('=');
					if (i < 1) continue;
					string k = line.Substring(0, i).Trim().ToLowerInvariant(), v = line.Substring(i + 1).Trim();
					if (k == "url" && v.Length > 0) url = v;
					else if (k == "token") token = v;
					else if (k == "timezone" && v.Length > 0)
					{
						try { platformZone = TimeZoneInfo.FindSystemTimeZoneById(v); Log("using time zone " + platformZone.Id); }
						catch { Log("unknown timezone '" + v + "' — using this PC's time zone. Use a Windows zone name like Eastern Standard Time."); }
					}
					else if (k == "accounts" && v.Length > 0) onlyAccounts = new HashSet<string>(v.Split(',').Select(s => s.Trim()).Where(s => s.Length > 0), StringComparer.OrdinalIgnoreCase);
				}
			}
			catch (Exception ex) { Log("couldn't read journal-sync.txt: " + ex.Message); }
		}

		private static double Safe(Func<double> f) { try { double v = f(); return double.IsNaN(v) || double.IsInfinity(v) ? 0 : v; } catch { return 0; } }
		private static string Short(string s) { s = (s ?? "").Replace("\r", " ").Replace("\n", " "); return s.Length > 160 ? s.Substring(0, 160) + "…" : s; }
		private static string Quote(string s)
		{
			var sb = new StringBuilder("\"");
			foreach (char c in s ?? "")
			{
				if (c == '"' || c == '\\') sb.Append('\\').Append(c);
				else if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
				else sb.Append(c);
			}
			return sb.Append('"').ToString();
		}
		private static void Prop(StringBuilder sb, string k, string v) { sb.Append('"').Append(k).Append("\":").Append(Quote(v)); }
		private static void Num(StringBuilder sb, string k, double v) { sb.Append('"').Append(k).Append("\":").Append(v.ToString("R", CultureInfo.InvariantCulture)); }
		private static void Log(string msg) { try { Output.Process("[RoninFlow] " + msg, PrintTo.OutputTab1); } catch { } }
	}
}
