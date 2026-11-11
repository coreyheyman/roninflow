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
    [Description("Sends closed trades from every connected account to your local RoninFlow (http://localhost:5173).")]
    public class JournalSync : Indicator
    {
        private const string SyncVersion = "1.2.0";
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

        [Display(Name = "Journal URL", GroupName = "Connection", Order = 10)]
        public string Endpoint { get; set; } = "http://localhost:5173/api/atas";

        [Display(Name = "Send this chart's candles to the journal (price data for the diary charts)", GroupName = "Price data", Order = 30)]
        public bool SendBars { get; set; } = true;

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
            TradingStatisticsProvider.RawStatisticsSourceChanged -= OnStatisticsSourceChanged;
            TradingStatisticsProvider.StatisticsRebuilt -= OnStatisticsRebuilt;
            if (_statistics != null)
                _statistics.HistoryMyTrades.Added -= OnTradeAdded;
            _cts?.Cancel();
        }

        protected override void OnCalculate(int bar, decimal value)
        {
            // Nothing to draw. Each finished candle (the one before the current bar) is queued as price data, so the
            // journal's execution charts can use your own feed instead of an outside data provider.
            if (!SendBars || bar < 1)
                return;
            try
            {
                var c = GetCandle(bar - 1);
                if (c == null || c.Time <= _lastBarTime)
                    return;
                _lastBarTime = c.Time;
                var utc = DateTime.SpecifyKind(c.Time, DateTimeKind.Utc); // ATAS keeps candle times in UTC
                if (DateTime.UtcNow - utc > TimeSpan.FromDays(7))
                    return; // older history isn't needed
                var t = new DateTimeOffset(utc).ToUnixTimeSeconds();
                lock (_lock)
                {
                    if (_bars.Count < 20000)
                        _bars.Add(new[] { t, (double)c.Open, (double)c.High, (double)c.Low, (double)c.Close, (double)c.Volume });
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
                    using var response = await Http.PostAsync(url, content, token);
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

        private async Task<bool> Post(string route, object payload, CancellationToken token)
        {
            try
            {
                var url = Endpoint.TrimEnd('/') + "/" + route;
                using var content = new StringContent(JsonSerializer.Serialize(payload, Json), Encoding.UTF8, "application/json");
                using var response = await Http.PostAsync(url, content, token);
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
