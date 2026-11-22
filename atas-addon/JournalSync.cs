// Journal Sync — ATAS X indicator that streams closed trades (all accounts) to your local RoninFlow.
//
// It reads ATAS's own trading statistics (the same data as the Statistics window / "Journal" sheet):
//   TradingStatisticsProvider.RawStatistics.HistoryMyTrades
// On start it sends every complete round trip ATAS has loaded, then each new one as it closes,
// and re-sends everything every 10 minutes so nothing is lost if the journal wasn't running.
// The journal de-duplicates by ATAS trade Id, so re-sending is harmless.

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

using ATAS.DataFeedsCore;
using ATAS.DataFeedsCore.Statistics;
using ATAS.Indicators;

namespace TradeJournal
{
    [DisplayName("Journal Sync")]
    [Description("Sends closed trades from every connected account to RoninFlow (http://localhost:5173, or set Journal URL + Token for a journal on another computer).")]
    public class JournalSync : Indicator
    {
        private const string SyncVersion = "1.6.0";
        internal const string AddonVersion = SyncVersion;
        private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(10) };
        private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

        private readonly object _lock = new();
        private readonly List<TradeDto> _queue = new();
        private ITradingStatistics? _statistics;
        private CancellationTokenSource? _cts;
        private DateTime _lastFullSync = DateTime.MinValue;
        private bool _fullSyncRequested = true;
        private readonly List<double[]> _bars = new();   // finished candles waiting to be sent (price data for charts)
        private DateTime _lastBarTime = DateTime.MinValue;
        // every finished candle on this chart, by time — sent in full only when RoninFlow asks (history for backtests)
        private readonly Dictionary<long, double[]> _allBars = new();
        private int _historySentCount;
        private DateTime _lastHistoryAsk = DateTime.MinValue;
        // tick data for RoninFlow's tick-by-tick replay: one hour at a time, when it asks
        private CumulativeTradesRequest? _tickRequest;
        private long _tickFrom, _tickTo;
        private DateTime _tickAskedAt = DateTime.MinValue;
        private DateTime _lastTickAsk = DateTime.MinValue;
        private CumulativeTradesRequest? _tickToIssue;   // made on ATAS's calculation thread (OnCalculate), or after 8 s
        private DateTime _tickQueuedAt = DateTime.MinValue;
        private string _tickState = "idle";              // reported to RoninFlow, shown on its Ticks button

        [Display(Name = "Journal URL", GroupName = "Connection", Order = 10)]
        public string Endpoint { get; set; } = "http://localhost:5173/api/atas";

        // Only needed when the journal runs on another computer (a Mac, Linux box or home server):
        // RoninFlow → Connections → Webhook / API → token. Leave empty for a journal on this PC.
        [Display(Name = "Token (journal on another computer only)", GroupName = "Connection", Order = 15)]
        public string Token { get; set; } = "";

        [Display(Name = "Send this chart's candles to the journal (price data for the diary charts)", GroupName = "Price data", Order = 30)]
        public bool SendBars { get; set; } = true;

        [Display(Name = "Send this chart's full history when RoninFlow asks (automated backtests)", GroupName = "Price data", Order = 31)]
        public bool SendHistory { get; set; } = true;

        [Display(Name = "Send tick data when RoninFlow asks (tick-by-tick replay)", GroupName = "Price data", Order = 32)]
        public bool SendTicks { get; set; } = true;

        // Risk enforcement: rules come from RoninFlow → Settings → Risk enforcement (per account, with its risk tier)
        [Display(Name = "Enforce RoninFlow risk rules (all accounts set up in RoninFlow)", GroupName = "Risk", Order = 40)]
        public bool EnforceRisk { get; set; } = false;

        [Display(Name = "Also keep ATAS Risk Management in step (loss limit, max trades, losses in a row)", GroupName = "Risk", Order = 41)]
        public bool SetAtasRiskManagement { get; set; } = true;

        [Display(Name = "Resend history every (minutes)", GroupName = "Connection", Order = 20)]
        [Range(1, 1440)]
        public int ResendMinutes { get; set; } = 10;

        public JournalSync() : base(true)
        {
            DenyToChangePanel = true;
            DataSeries[0].IsHidden = true;
            ((ValueDataSeries)DataSeries[0]).VisualType = VisualMode.Hide;
        }

        protected override void OnInitialize()
        {
            // ATAS holds back trade-history requests from an indicator it counts as hidden unless its alerts are on.
            // Journal Sync draws nothing, so switch them on (it never raises an alert). By name, so older ATAS builds compile.
            try { GetType().GetProperty("AlertsEnabled")?.SetValue(this, true); } catch { }
            TradingStatisticsProvider.RawStatisticsSourceChanged -= OnStatisticsSourceChanged;
            TradingStatisticsProvider.StatisticsRebuilt -= OnStatisticsRebuilt;
            TradingStatisticsProvider.RawStatisticsSourceChanged += OnStatisticsSourceChanged;
            TradingStatisticsProvider.StatisticsRebuilt += OnStatisticsRebuilt;
            AttachStatistics();

            _cts?.Cancel();
            _cts = new CancellationTokenSource();
            var token = _cts.Token;
            Task.Run(() => SenderLoop(token), token);
        }

        protected override void OnDispose()
        {
            RiskEnforcer.Detach(this);
            TradingStatisticsProvider.RawStatisticsSourceChanged -= OnStatisticsSourceChanged;
            TradingStatisticsProvider.StatisticsRebuilt -= OnStatisticsRebuilt;
            if (_statistics != null)
                _statistics.HistoryMyTrades.Added -= OnTradeAdded;
            _cts?.Cancel();
        }

        protected override void OnCalculate(int bar, decimal value)
        {
            IssueTickRequest();
            // Nothing to draw. Each finished candle (the one before the current bar) is queued as price data, so the
            // journal's execution charts can use your own feed instead of an outside data provider.
            if (bar < 1 || (!SendBars && !SendHistory))
                return;
            try
            {
                var c = GetCandle(bar - 1);
                if (c == null)
                    return;
                var utc = DateTime.SpecifyKind(c.Time, DateTimeKind.Utc); // ATAS keeps candle times in UTC
                var t = new DateTimeOffset(utc).ToUnixTimeSeconds();
                if (SendHistory)
                {
                    lock (_lock)
                    {
                        if (!_allBars.ContainsKey(t) && _allBars.Count < 1500000)
                            _allBars[t] = new double[] { t, (double)c.Open, (double)c.High, (double)c.Low, (double)c.Close, (double)c.Volume };
                    }
                }
                if (!SendBars || c.Time <= _lastBarTime)
                    return;
                _lastBarTime = c.Time;
                if (DateTime.UtcNow - utc > TimeSpan.FromDays(7))
                    return; // older candles only go when RoninFlow asks for history (below)
                lock (_lock)
                {
                    if (_bars.Count < 20000)
                        _bars.Add(new double[] { t, (double)c.Open, (double)c.High, (double)c.Low, (double)c.Close, (double)c.Volume });
                }
            }
            catch
            {
                // never let price data affect the chart
            }
        }

        private void OnStatisticsSourceChanged(ITradingStatistics stat) => AttachStatistics();

        private void OnStatisticsRebuilt() => _fullSyncRequested = true;

        private void AttachStatistics()
        {
            var stat = TradingStatisticsProvider.RawStatistics;
            if (ReferenceEquals(stat, _statistics))
                return;

            if (_statistics != null)
                _statistics.HistoryMyTrades.Added -= OnTradeAdded;

            _statistics = stat;

            if (_statistics != null)
                _statistics.HistoryMyTrades.Added += OnTradeAdded;

            _fullSyncRequested = true;
        }

        private void OnTradeAdded(HistoryMyTrade trade)
        {
            RiskEnforcer.TradeSeen(trade);
            var dto = ToDto(trade);
            if (dto == null)
                return;

            lock (_lock)
                _queue.Add(dto);
        }

        private List<HistoryMyTrade> Snapshot()
        {
            var stat = _statistics;
            if (stat == null)
                return new List<HistoryMyTrade>();

            // The collection can change while ATAS loads history; retry a few times.
            for (var attempt = 0; attempt < 5; attempt++)
            {
                try
                {
                    return stat.HistoryMyTrades.ToList();
                }
                catch (InvalidOperationException)
                {
                    Thread.Sleep(200);
                }
            }

            return new List<HistoryMyTrade>();
        }

        private async Task SenderLoop(CancellationToken token)
        {
            var nextHeartbeat = DateTime.MinValue;

            while (!token.IsCancellationRequested)
            {
                try
                {
                    var resendDue = DateTime.UtcNow - _lastFullSync > TimeSpan.FromMinutes(Math.Max(1, ResendMinutes));

                    if (_fullSyncRequested || resendDue)
                    {
                        var all = Snapshot().Select(ToDto).Where(d => d != null).Cast<TradeDto>().ToList();

                        if (await PostBatches(all, token))
                        {
                            _fullSyncRequested = false;
                            _lastFullSync = DateTime.UtcNow;
                        }
                    }

                    List<TradeDto> pending;
                    lock (_lock)
                    {
                        pending = new List<TradeDto>(_queue);
                        _queue.Clear();
                    }

                    if (pending.Count > 0 && !await PostBatches(pending, token))
                    {
                        lock (_lock)
                            _queue.InsertRange(0, pending); // journal offline: keep and retry
                    }

                    List<double[]> bars;
                    lock (_lock)
                    {
                        bars = new List<double[]>(_bars);
                        _bars.Clear();
                    }
                    if (bars.Count > 0 && !await PostBars(bars, token))
                    {
                        lock (_lock)
                            _bars.InsertRange(0, bars); // journal offline: keep and retry
                    }

                    if (SendHistory && DateTime.UtcNow - _lastHistoryAsk > TimeSpan.FromSeconds(30))
                    {
                        _lastHistoryAsk = DateTime.UtcNow;
                        await SendHistoryIfAsked(token);
                    }

                    if (SendTicks && DateTime.UtcNow - _lastTickAsk > TimeSpan.FromSeconds(5))
                    {
                        _lastTickAsk = DateTime.UtcNow;
                        await RequestTicksIfAsked(token);
                    }

                    RiskEnforcer.Heartbeat(this, EnforceRisk, SetAtasRiskManagement);

                    if (DateTime.UtcNow >= nextHeartbeat)
                    {
                        var trades = Snapshot();
                        var heartbeat = new
                        {
                            version = SyncVersion,
                            accounts = trades.Select(t => t.AccountID).Where(a => !string.IsNullOrEmpty(a)).Distinct().ToArray(),
                            trades = trades.Count(t => t.IsComplete),
                            selectedAccount = TradingManager?.Portfolio?.AccountID,
                            machineUtcOffsetMinutes = (int)TimeZoneInfo.Local.GetUtcOffset(DateTime.Now).TotalMinutes,
                            balances = Balances(),
                        };
                        await Post("heartbeat", heartbeat, token);
                        nextHeartbeat = DateTime.UtcNow.AddSeconds(15);
                    }
                }
                catch (OperationCanceledException)
                {
                    return;
                }
                catch
                {
                    // Never let a sync problem affect the trading platform.
                }

                try
                {
                    await Task.Delay(2000, token);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
            }
        }

        private async Task<bool> PostBatches(List<TradeDto> trades, CancellationToken token)
        {
            for (var i = 0; i < trades.Count; i += 500)
            {
                var batch = trades.Skip(i).Take(500).ToList();
                if (!await Post("trades", new { source = "atas", version = SyncVersion, trades = batch }, token))
                    return false;
            }

            return true;
        }

        private async Task<bool> PostBars(List<double[]> bars, CancellationToken token)
        {
            var symbol = InstrumentInfo?.Instrument ?? "";
            if (string.IsNullOrEmpty(symbol))
                return true; // nothing to label them with — drop
            // http://localhost:5173/api/atas → http://localhost:5173/api/candles/ingest
            var root = Endpoint.TrimEnd('/');
            var i = root.IndexOf("/api/", StringComparison.OrdinalIgnoreCase);
            var url = (i >= 0 ? root.Substring(0, i) : root) + "/api/candles/ingest";
            for (var k = 0; k < bars.Count; k += 2000)
            {
                try
                {
                    var payload = new { source = "atas", symbol, bars = bars.Skip(k).Take(2000).ToArray() };
                    using var content = new StringContent(JsonSerializer.Serialize(payload, Json), Encoding.UTF8, "application/json");
                    using var response = await Send(url, content, token);
                    if (!response.IsSuccessStatusCode)
                        return response.StatusCode == System.Net.HttpStatusCode.NotFound; // older journal without price data: drop
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch
                {
                    return false;
                }
            }
            return true;
        }

        // ---------- used by RiskEnforcer ----------

        internal ITradingStatistics? RiskStatistics => _statistics;

        /// <summary>The connector behind this chart's trading (a fallback when ATAS's trading core can't be found).</summary>
        internal IDataFeedConnector? ChartConnector()
        {
            var tm = TradingManager;
            foreach (var o in new[] { Prop(tm, "TradingProvider"), Prop(tm, "Connector"), Prop(tm, "DataFeedConnector"), Prop(tm, "TradingConnector") })
                if (o is IDataFeedConnector c)
                    return c;
            return null;
        }

        internal async Task<string> GetText(string path, CancellationToken token)
        {
            var ask = new HttpRequestMessage(HttpMethod.Get, BaseUrl() + path);
            if (!string.IsNullOrWhiteSpace(Token))
                ask.Headers.TryAddWithoutValidation("Authorization", "Bearer " + Token.Trim());
            using var reply = await Http.SendAsync(ask, token);
            reply.EnsureSuccessStatusCode();
            return await reply.Content.ReadAsStringAsync(token);
        }

        internal async Task PostRiskStatus(object payload, CancellationToken token)
        {
            try
            {
                using var content = new StringContent(JsonSerializer.Serialize(payload, Json), Encoding.UTF8, "application/json");
                using var response = await Send(BaseUrl() + "/api/atas/risk/status", content, token);
            }
            catch
            {
                // RoninFlow not running: try again next time
            }
        }

        private string BaseUrl()
        {
            var root = Endpoint.TrimEnd('/');
            var i = root.IndexOf("/api/", StringComparison.OrdinalIgnoreCase);
            return i >= 0 ? root.Substring(0, i) : root;
        }

        /// <summary>
        /// When RoninFlow is downloading history for this chart's market (Backtesting → Automated → Download history), send
        /// every candle the chart has loaded — as far back as the chart's "Days to load" reaches. Only 1-minute time charts.
        /// </summary>
        private async Task SendHistoryIfAsked(CancellationToken token)
        {
            var symbol = InstrumentInfo?.Instrument ?? "";
            if (string.IsNullOrEmpty(symbol))
                return;
            int count;
            lock (_lock)
                count = _allBars.Count;
            if (count < 10 || count <= _historySentCount)
                return; // nothing new since the last time it was sent

            string answer;
            try
            {
                var ask = new HttpRequestMessage(HttpMethod.Get, BaseUrl() + "/api/candles/history/chart?source=atas&symbol=" + Uri.EscapeDataString(symbol));
                if (!string.IsNullOrWhiteSpace(Token))
                    ask.Headers.TryAddWithoutValidation("Authorization", "Bearer " + Token.Trim());
                using var reply = await Http.SendAsync(ask, token);
                if (!reply.IsSuccessStatusCode)
                    return; // an older journal without history downloads
                answer = await reply.Content.ReadAsStringAsync();
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch
            {
                return;
            }
            if (answer.IndexOf("\"want\":true", StringComparison.Ordinal) < 0)
                return;

            List<double[]> rows;
            lock (_lock)
                rows = _allBars.Values.OrderBy(r => r[0]).ToList();
            // a 1-minute time chart? most gaps between candles are exactly 60 seconds
            int minute = 0, other = 0;
            for (var k = 1; k < rows.Count && k < 5000; k++)
            {
                var gap = rows[k][0] - rows[k - 1][0];
                if (gap == 60) minute++;
                else if (gap > 0 && gap < 3600) other++;
            }
            var oneMinute = minute > other * 3;
            var sent = 0;
            if (oneMinute)
            {
                var url = BaseUrl() + "/api/candles/ingest";
                for (var k = 0; k < rows.Count; k += 5000)
                {
                    var part = rows.Skip(k).Take(5000).ToArray();
                    var payload = new { source = "atas", symbol, history = true, bars = part };
                    using var content = new StringContent(JsonSerializer.Serialize(payload, Json), Encoding.UTF8, "application/json");
                    using var response = await Send(url, content, token);
                    if (!response.IsSuccessStatusCode)
                        return; // try again on the next round
                    sent += part.Length;
                }
            }
            var done = new { source = "atas", symbol, first = rows[0][0], last = rows[rows.Count - 1][0], count = sent, oneMinute };
            using (var doneBody = new StringContent(JsonSerializer.Serialize(done, Json), Encoding.UTF8, "application/json"))
            using (var doneReply = await Send(BaseUrl() + "/api/candles/history/chart", doneBody, token))
            {
            }
            _historySentCount = count;
        }

        // ---------- ticks for the tick-by-tick replay ----------
        // RoninFlow asks for one hour of this chart's market at a time; ATAS answers with its trade history
        // (OnCumulativeTradesResponse), and every tick of every trade goes back as [ms, price, size, side].

        private void IssueTickRequest()
        {
            var request = _tickToIssue;
            if (request == null)
                return;
            _tickToIssue = null;
            try
            {
                _tickRequest = request;
                _tickAskedAt = DateTime.UtcNow;
                _tickState = "asked ATAS for " + DateTimeOffset.FromUnixTimeSeconds(_tickFrom).UtcDateTime.ToString("yyyy-MM-dd HH:mm") + " UTC";
                RequestForCumulativeTrades(request);
            }
            catch (Exception e)
            {
                _tickRequest = null;
                _tickState = "ATAS refused the request: " + e.Message;
            }
        }

        private async Task RequestTicksIfAsked(CancellationToken token)
        {
            if (_tickToIssue != null && DateTime.UtcNow - _tickQueuedAt > TimeSpan.FromSeconds(8))
                IssueTickRequest(); // no new data on the chart (market closed): ask from here
            if (_tickRequest != null && DateTime.UtcNow - _tickAskedAt > TimeSpan.FromMinutes(3))
            {
                _tickRequest = null;
                _tickState = "ATAS didn't answer within 3 minutes";
            }
            var busy = _tickRequest != null || _tickToIssue != null;
            var symbol = InstrumentInfo?.Instrument ?? "";
            if (string.IsNullOrEmpty(symbol))
                return;
            string answer;
            try
            {
                var ask = new HttpRequestMessage(HttpMethod.Get, BaseUrl() + "/api/candles/ticks/want?source=atas&symbol=" + Uri.EscapeDataString(symbol)
                    + "&busy=" + (busy ? "1" : "0") + "&state=" + Uri.EscapeDataString(_tickState));
                if (!string.IsNullOrWhiteSpace(Token))
                    ask.Headers.TryAddWithoutValidation("Authorization", "Bearer " + Token.Trim());
                using var reply = await Http.SendAsync(ask, token);
                if (!reply.IsSuccessStatusCode)
                    return; // an older journal without tick replay
                answer = await reply.Content.ReadAsStringAsync();
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch
            {
                return;
            }
            long from, to;
            try
            {
                using var doc = JsonDocument.Parse(answer);
                var root = doc.RootElement;
                if (!root.TryGetProperty("want", out var want) || want.ValueKind != JsonValueKind.True)
                    return;
                from = root.GetProperty("from").GetInt64();
                to = root.GetProperty("to").GetInt64();
            }
            catch
            {
                return;
            }
            if (busy || to <= from || to - from > 6 * 3600)
                return;
            try
            {
                _tickFrom = from;
                _tickTo = to;
                _tickQueuedAt = DateTime.UtcNow;
                _tickState = "queued " + DateTimeOffset.FromUnixTimeSeconds(from).UtcDateTime.ToString("yyyy-MM-dd HH:mm") + " UTC";
                _tickToIssue = new CumulativeTradesRequest(
                    DateTimeOffset.FromUnixTimeSeconds(from).UtcDateTime,
                    DateTimeOffset.FromUnixTimeSeconds(to).UtcDateTime,
                    0, int.MaxValue);
            }
            catch (Exception e)
            {
                _tickToIssue = null;
                _tickState = "couldn't make the request: " + e.Message;
            }
        }

        protected override void OnCumulativeTradesResponse(CumulativeTradesRequest request, IEnumerable<CumulativeTrade> cumulativeTrades)
        {
            var mine = _tickRequest;
            if (mine == null)
                return;
            if (!ReferenceEquals(request, mine) && request.RequestId != mine.RequestId && request.BeginTime != mine.BeginTime)
                return; // another indicator's request
            var symbol = InstrumentInfo?.Instrument ?? "";
            long from = _tickFrom, to = _tickTo;
            var ticks = new List<double[]>();
            try
            {
                foreach (var trade in cumulativeTrades ?? Enumerable.Empty<CumulativeTrade>())
                {
                    if (trade?.Ticks == null)
                        continue;
                    var side = trade.Direction == ATAS.Indicators.TradeDirection.Buy ? 1 : trade.Direction == ATAS.Indicators.TradeDirection.Sell ? -1 : 0;
                    foreach (var tick in trade.Ticks)
                    {
                        if (tick == null)
                            continue;
                        var utc = DateTime.SpecifyKind(tick.Time, DateTimeKind.Utc); // ATAS keeps times in UTC
                        ticks.Add(new double[] { new DateTimeOffset(utc).ToUnixTimeMilliseconds(), (double)tick.Price, (double)tick.Volume, side });
                    }
                }
            }
            catch
            {
                // keep what was read
            }
            _tickState = "ATAS answered: " + ticks.Count + " ticks, sending";
            var token = _cts?.Token ?? CancellationToken.None;
            _ = Task.Run(async () =>
            {
                try
                {
                    _tickState = await PostTicks(symbol, from, to, ticks, token) ? "sent " + ticks.Count + " ticks" : "RoninFlow didn't take the ticks";
                }
                catch (Exception e)
                {
                    _tickState = "sending ticks failed: " + e.Message; // never let tick data affect the platform
                }
                finally
                {
                    _tickRequest = null;
                }
            });
        }

        private async Task<bool> PostTicks(string symbol, long from, long to, List<double[]> ticks, CancellationToken token)
        {
            ticks.Sort((a, b) => a[0].CompareTo(b[0]));
            var url = BaseUrl() + "/api/candles/ticks/ingest";
            var parts = Math.Max(1, (ticks.Count + 19999) / 20000);
            for (var part = 0; part < parts; part++)
            {
                var payload = new { source = "atas", symbol, from, to, part, last = part == parts - 1, ticks = ticks.Skip(part * 20000).Take(20000).ToArray() };
                using var content = new StringContent(JsonSerializer.Serialize(payload, Json), Encoding.UTF8, "application/json");
                using var response = await Send(url, content, token);
                if (!response.IsSuccessStatusCode)
                    return false; // RoninFlow asks again
            }
            return true;
        }

        /// <summary>POST, with the token when one is set (a journal on another computer needs it).</summary>
        private Task<HttpResponseMessage> Send(string url, HttpContent content, CancellationToken token)
        {
            var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = content };
            if (!string.IsNullOrWhiteSpace(Token))
                request.Headers.TryAddWithoutValidation("Authorization", "Bearer " + Token.Trim());
            return Http.SendAsync(request, token);
        }

        private async Task<bool> Post(string route, object payload, CancellationToken token)
        {
            try
            {
                var url = Endpoint.TrimEnd('/') + "/" + route;
                using var content = new StringContent(JsonSerializer.Serialize(payload, Json), Encoding.UTF8, "application/json");
                using var response = await Send(url, content, token);
                return response.IsSuccessStatusCode;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch
            {
                return false;
            }
        }

        private static TradeDto? ToDto(HistoryMyTrade t)
        {
            if (t == null || !t.IsComplete)
                return null;

            return new TradeDto
            {
                Id = t.Id.ToString(),
                Account = t.AccountID ?? t.Portfolio?.AccountID ?? "",
                Security = t.Security?.Code ?? t.SecurityCode ?? t.SecurityId ?? "",
                OpenTime = t.OpenTime.ToString("o"),
                CloseTime = t.CloseTime.ToString("o"),
                TimeKind = t.OpenTime.Kind.ToString(),
                OpenPrice = t.OpenPrice,
                ClosePrice = t.ClosePrice,
                OpenVolume = t.OpenVolume,
                CloseVolume = t.CloseVolume,
                Pnl = t.PnL,
                PricePnl = t.PricePnL,
                TicksPnl = t.TicksPnL,
                Commission = t.Commission,
                Comment = t.Comment ?? "",
            };
        }

        // ---------- live account balances ----------
        // ATAS keeps a Portfolio per connected account. The selected one is TradingManager.Portfolio; the full list
        // is looked up by reflection so this builds on every ATAS X version (and simply reports less if it can't).

        private static object? Prop(object? o, string name)
        {
            try { return o?.GetType().GetProperty(name)?.GetValue(o); }
            catch { return null; }
        }

        private static decimal? Dec(object? o, string name)
        {
            var v = Prop(o, name);
            try { return v == null ? null : Convert.ToDecimal(v); }
            catch { return null; }
        }

        private List<object> AllPortfolios()
        {
            var found = new List<object>();
            var tm = TradingManager;
            var selected = Prop(tm, "Portfolio");
            if (selected != null) found.Add(selected);
            foreach (var root in new[] { tm, Prop(tm, "TradingProvider"), Prop(tm, "Connector"), Prop(tm, "DataFeedConnector"), Prop(tm, "TradingConnector") })
            {
                if (Prop(root, "Portfolios") is System.Collections.IEnumerable list)
                {
                    try
                    {
                        foreach (var p in list)
                            if (p != null) found.Add(p);
                    }
                    catch
                    {
                        // collection changed while reading — next heartbeat will catch up
                    }
                }
            }
            return found;
        }

        private object[] Balances()
        {
            try
            {
                return AllPortfolios()
                    .Select(p => new
                    {
                        account = Prop(p, "AccountID") as string ?? "",
                        balance = Dec(p, "Balance"),
                        available = Dec(p, "BalanceAvailable"),
                        openPnl = Dec(p, "OpenPnL"),
                        closedPnl = Dec(p, "ClosedPnL"),
                        totalClosedPnl = Dec(p, "TotalClosedPnL"),
                        commission = Dec(p, "Commission"),
                        currency = Prop(p, "Currency")?.ToString(),
                    })
                    .Where(b => b.account.Length > 0)
                    .GroupBy(b => b.account)
                    .Select(g => (object)g.First())
                    .ToArray();
            }
            catch
            {
                return Array.Empty<object>();
            }
        }

        private sealed class TradeDto
        {
            public string Id { get; set; } = "";
            public string Account { get; set; } = "";
            public string Security { get; set; } = "";
            public string OpenTime { get; set; } = "";
            public string CloseTime { get; set; } = "";
            public string TimeKind { get; set; } = "";
            public decimal OpenPrice { get; set; }
            public decimal ClosePrice { get; set; }
            public decimal OpenVolume { get; set; }
            public decimal CloseVolume { get; set; }
            public decimal Pnl { get; set; }
            public decimal PricePnl { get; set; }
            public decimal TicksPnl { get; set; }
            public decimal? Commission { get; set; }
            public string Comment { get; set; } = "";
        }
    }
}
