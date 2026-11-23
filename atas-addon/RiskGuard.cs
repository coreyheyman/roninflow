// Risk enforcement for Journal Sync ("Enforce RoninFlow risk rules" in the indicator's settings).
//
// RoninFlow works out each account's rules (its risk tier's daily loss limit, a trailing drawdown on the day's closed
// P&L, trading windows, trade counts, position size) and serves them at /api/atas/risk/rules. This reads them every few
// seconds and, for every connected account (not just the chart's — copy-trade followers too):
//   * joins ATAS's own pre-order check (the trading core's OrderRiskGuard, which ATAS Risk Management uses): while a
//     rule is broken the account is "reduce only" — new positions are refused, closing still works;
//   * keeps the account's ATAS Risk Management settings in step (loss limit, max trades, losses in a row) through the
//     same service ATAS's Risk Management window uses;
//   * closes positions when the loss limit or trailing drawdown is hit, or the profit target (each if asked; and, if
//     asked, when a trading window ends), and trims positions bigger than the contract limit.
// Everything is found by reflection and wrapped in try/catch: if ATAS changes, enforcement reports what it couldn't do
// to RoninFlow (Settings → Risk enforcement) instead of affecting the platform.

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

using ATAS.DataFeedsCore;
using ATAS.DataFeedsCore.Statistics;

namespace TradeJournal
{
    internal sealed class AccountRules
    {
        public string Account = "";
        public bool SetAtas = true;
        public decimal DailyLoss;
        public decimal Trail;
        public bool Windowed;
        public bool InWindow = true;
        public bool Flatten;                // close positions when a trading window ends
        public bool FlattenLoss = true;     // close positions when the loss limit / trailing drawdown is hit
        public decimal Target;              // the day's profit target (0 = none)
        public bool TargetOpen = true;      // open P&L counts toward it
        public bool FlattenTarget;          // close positions and stop for the day when it's hit
        public bool ManualLock;             // you blocked it from the HUD for the rest of the day
        public bool ManualFlatten;          // …and asked for its positions to be closed
        public bool ManualOnly;             // blocked from the HUD but not otherwise enforced by RoninFlow
        public int MaxTrades;
        public int MaxConsec;
        public decimal ConsecMin;
        public int MaxContracts;
        public string Tier = "";
    }

    internal sealed class AccountView
    {
        public decimal Realised, Unrealised, Peak;
        public int Trades, Streak;
        public List<Position> Positions = new();
        public List<Order> Orders = new();
        public Portfolio? Portfolio;
    }

    internal sealed class AccountState
    {
        public long LockedDay;              // dayStartUtc of the day the loss limit / trailing drawdown was hit
        public string LockReason = "";
        public bool LockIsTarget;           // locked by the profit target (not the loss limit)
        public bool? WasInWindow;
        public DateTime LastAction = DateTime.MinValue;
        public DateTime NativeCheckedAt = DateTime.MinValue;
        public string NativeKey = "";
        public object? Native;              // what ATAS Risk Management is set to (for the status report)
        public object? Report;
    }

    /// <summary>The check ATAS runs before each order: "is this account reduce-only?" — ATAS's answer, or ours.</summary>
    public class RiskGuardProxy : DispatchProxy
    {
        public object? Inner;

        protected override object? Invoke(MethodInfo? method, object?[]? args)
        {
            if (method == null)
                return null;
            if (method.Name == "IsReduceOnly" && args != null && args.Length == 1)
            {
                try
                {
                    if (Inner != null && method.Invoke(Inner, args) is bool b && b)
                        return true;
                }
                catch
                {
                    // ATAS's own answer failed: fall through to ours
                }
                try { return args[0] is string id && RiskEnforcer.IsBlocked(id); }
                catch { return false; }
            }
            if (Inner != null)
                return method.Invoke(Inner, args);
            return method.ReturnType.IsValueType && method.ReturnType != typeof(void) ? Activator.CreateInstance(method.ReturnType) : null;
        }
    }

    internal static class RiskEnforcer
    {
        private static readonly object Gate = new();
        private static readonly ConcurrentDictionary<string, bool> Blocked = new(StringComparer.OrdinalIgnoreCase);
        private static readonly ConcurrentDictionary<string, DateTime> Arrived = new(); // trade id → when it closed (seen live)
        private static readonly Dictionary<string, AccountState> States = new(StringComparer.OrdinalIgnoreCase);
        private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

        private static JournalSync? _leader;
        private static DateTime _leaderSeen = DateTime.MinValue;
        private static bool _enforce, _setAtas = true;
        private static CancellationTokenSource? _cts;
        private static DateTime _lastOffReport = DateTime.MinValue;

        private static List<AccountRules> _rules = new();
        private static long _dayStartUtc;
        private static DateTime _rulesAt = DateTime.MinValue;
        private static string _rulesError = "";

        private static IDataFeedConnector? _core;
        private static object? _rms;
        private static Type? _rmsType;
        private static DateTime _servicesTriedAt = DateTime.MinValue;
        private static string _coreError = "", _rmsError = "", _guardError = "";
        private static object? _proxy;
        private static PropertyInfo? _guardProp;

        private static DateTime _coreTriedAt = DateTime.MinValue;

        /// <summary>ATAS's trading core (every connected account's positions and orders), for the RoninFlow HUD too.</summary>
        internal static IDataFeedConnector? TradingCore(object anchor)
        {
            if (_core != null)
                return _core;
            if (DateTime.UtcNow - _coreTriedAt < TimeSpan.FromSeconds(30))
                return null;
            _coreTriedAt = DateTime.UtcNow;
            try
            {
                var t = FindType("OFT.Platform.Core.Providers.IPlatformTradingCore");
                _core = t != null ? Resolve(t, anchor) as IDataFeedConnector : null;
            }
            catch
            {
                _core = null;
            }
            return _core;
        }

        /// <summary>Fetch the rules on the next pass (after a block from the HUD) instead of waiting for the usual refresh.</summary>
        public static void RefreshSoon() => _rulesAt = DateTime.MinValue;

        /// <summary>Is the enforcer running in this ATAS (a chart with Journal Sync and enforcement switched on)?</summary>
        public static bool Running => _leader != null && DateTime.UtcNow - _leaderSeen < TimeSpan.FromSeconds(30);

        public static bool IsBlocked(string account) => Blocked.TryGetValue(account ?? "", out var b) && b;

        public static void TradeSeen(HistoryMyTrade t)
        {
            try { if (t != null && t.IsComplete) Arrived.TryAdd(t.Id.ToString(), DateTime.UtcNow); }
            catch { }
        }

        /// <summary>Called by every Journal Sync every couple of seconds. One of them (the first with enforcement on) leads.</summary>
        public static void Heartbeat(JournalSync owner, bool enforce, bool setAtas)
        {
            lock (Gate)
            {
                var leaderGone = _leader == null || DateTime.UtcNow - _leaderSeen > TimeSpan.FromSeconds(20);
                if (enforce && (leaderGone || ReferenceEquals(_leader, owner)))
                {
                    _leader = owner;
                    _leaderSeen = DateTime.UtcNow;
                    _setAtas = setAtas;
                    if (!_enforce)
                    {
                        _enforce = true;
                        _cts = new CancellationTokenSource();
                        var token = _cts.Token;
                        Task.Run(() => Loop(token), token);
                    }
                    return;
                }
                if (!enforce && ReferenceEquals(_leader, owner))
                {
                    Stop();
                }
            }
            if (!enforce && !_enforce && DateTime.UtcNow - _lastOffReport > TimeSpan.FromSeconds(10))
            {
                _lastOffReport = DateTime.UtcNow;
                _ = owner.PostRiskStatus(new { version = JournalSync.AddonVersion, enforcing = false }, CancellationToken.None);
            }
        }

        public static void Detach(JournalSync owner)
        {
            lock (Gate)
            {
                if (ReferenceEquals(_leader, owner))
                    Stop();
            }
        }

        private static void Stop()
        {
            _enforce = false;
            _leader = null;
            _cts?.Cancel();
            _cts = null;
            Blocked.Clear();
            RemoveGuard();
        }

        private static async Task Loop(CancellationToken token)
        {
            var lastReport = DateTime.MinValue;
            while (!token.IsCancellationRequested)
            {
                var owner = _leader;
                if (owner == null || DateTime.UtcNow - _leaderSeen > TimeSpan.FromSeconds(30))
                {
                    lock (Gate) Stop(); // the chart with Journal Sync was closed
                    return;
                }
                try
                {
                    if (DateTime.UtcNow - _rulesAt > TimeSpan.FromSeconds(4))
                        await FetchRules(owner, token);
                    EnsureServices(owner);
                    EnsureGuard();
                    await Enforce(owner, token);
                    if (DateTime.UtcNow - lastReport > TimeSpan.FromSeconds(3))
                    {
                        lastReport = DateTime.UtcNow;
                        await Report(owner, token);
                    }
                }
                catch (OperationCanceledException)
                {
                    return;
                }
                catch (Exception e)
                {
                    _rulesError = "enforcement error: " + e.Message; // never let it affect the platform
                }
                try { await Task.Delay(1000, token); }
                catch (OperationCanceledException) { return; }
            }
        }

        // ---------- the rules from RoninFlow ----------

        private static async Task FetchRules(JournalSync owner, CancellationToken token)
        {
            _rulesAt = DateTime.UtcNow;
            string text;
            try
            {
                text = await owner.GetText("/api/atas/risk/rules", token);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception e)
            {
                _rulesError = "couldn't reach RoninFlow: " + e.Message; // keep the last rules
                return;
            }
            try
            {
                using var doc = JsonDocument.Parse(text);
                var root = doc.RootElement;
                var list = new List<AccountRules>();
                if (root.TryGetProperty("accounts", out var arr) && arr.ValueKind == JsonValueKind.Array)
                {
                    foreach (var a in arr.EnumerateArray())
                    {
                        if (!Bool(a, "on"))
                            continue;
                        list.Add(new AccountRules
                        {
                            Account = Str(a, "account"),
                            SetAtas = !a.TryGetProperty("setAtas", out var sa) || sa.ValueKind != JsonValueKind.False,
                            DailyLoss = Dec(a, "dailyLoss"),
                            Trail = Dec(a, "trail"),
                            Windowed = Bool(a, "windowed"),
                            InWindow = !a.TryGetProperty("inWindow", out var iw) || iw.ValueKind != JsonValueKind.False,
                            Flatten = Bool(a, "flatten"),
                            FlattenLoss = !a.TryGetProperty("flattenLoss", out var fl) || fl.ValueKind != JsonValueKind.False,
                            Target = Dec(a, "target"),
                            TargetOpen = !a.TryGetProperty("targetOpen", out var to) || to.ValueKind != JsonValueKind.False,
                            FlattenTarget = Bool(a, "flattenTarget"),
                            ManualLock = Bool(a, "manualLock"),
                            ManualFlatten = Bool(a, "manualFlatten"),
                            ManualOnly = Bool(a, "manualOnly"),
                            MaxTrades = (int)Dec(a, "maxTrades"),
                            MaxConsec = (int)Dec(a, "maxConsec"),
                            ConsecMin = Dec(a, "consecMin"),
                            MaxContracts = (int)Dec(a, "maxContracts"),
                            Tier = a.TryGetProperty("tier", out var t) && t.ValueKind == JsonValueKind.Object ? Str(t, "name") : "",
                        });
                    }
                }
                _rules = list.Where(r => r.Account.Length > 0).ToList();
                if (root.TryGetProperty("dayStartUtc", out var ds) && ds.ValueKind == JsonValueKind.Number)
                    _dayStartUtc = ds.GetInt64();
                _rulesError = "";
            }
            catch (Exception e)
            {
                _rulesError = "couldn't read the rules: " + e.Message;
            }
        }

        private static string Str(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";
        private static bool Bool(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;
        private static decimal Dec(JsonElement e, string name)
        {
            if (!e.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Number)
                return 0;
            try { return v.GetDecimal(); }
            catch { return 0; }
        }

        // ---------- finding ATAS's services ----------

        private static Type? FindType(string fullName)
        {
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                try
                {
                    var t = asm.GetType(fullName, false);
                    if (t != null)
                        return t;
                }
                catch
                {
                    // dynamic or unloadable assembly
                }
            }
            return null;
        }

        /// <summary>One of ATAS's services from its container (CommonServiceLocator, else ATAS's own Resolve helper).</summary>
        private static object? Resolve(Type type, object anchor)
        {
            try
            {
                var sl = FindType("CommonServiceLocator.ServiceLocator");
                var current = sl?.GetProperty("Current", BindingFlags.Public | BindingFlags.Static)?.GetValue(null);
                var get = current?.GetType().GetMethod("GetInstance", new[] { typeof(Type) });
                var r = get?.Invoke(current, new object[] { type });
                if (r != null)
                    return r;
            }
            catch
            {
                // not registered there
            }
            try
            {
                var re = FindType("OFT.Plarform.Core.Extensions.ResolveExtension") ?? FindType("OFT.Platform.Core.Extensions.ResolveExtension");
                var m = re?.GetMethod("Resolve", BindingFlags.Public | BindingFlags.Static, null, new[] { typeof(object), typeof(Type) }, null);
                var r = m?.Invoke(null, new object[] { anchor, type });
                if (r != null)
                    return r;
            }
            catch
            {
                // not there either
            }
            return null;
        }

        private static void EnsureServices(JournalSync owner)
        {
            if ((_core != null && _rms != null) || DateTime.UtcNow - _servicesTriedAt < TimeSpan.FromSeconds(30))
                return;
            _servicesTriedAt = DateTime.UtcNow;
            if (_core == null)
            {
                var t = FindType("OFT.Platform.Core.Providers.IPlatformTradingCore");
                _core = (t != null ? Resolve(t, owner) : null) as IDataFeedConnector ?? owner.ChartConnector();
                _coreError = _core == null ? (t == null ? "ATAS's trading core type wasn't found" : "ATAS's trading core couldn't be reached") : "";
            }
            if (_rms == null)
            {
                _rmsType = FindType("OFT.Platform.Core.Services.RiskManagement.IRmsApiService");
                _rms = _rmsType != null ? Resolve(_rmsType, owner) : null;
                _rmsError = _rms == null ? (_rmsType == null ? "this ATAS version has no Risk Management service" : "ATAS's Risk Management service couldn't be reached") : "";
            }
        }

        // ---------- the pre-order check ----------

        private static void EnsureGuard()
        {
            var core = _core;
            if (core == null)
            {
                _guardError = _coreError;
                return;
            }
            try
            {
                if (_guardProp == null)
                {
                    _guardProp = core.GetType().GetProperty("OrderRiskGuard", BindingFlags.Public | BindingFlags.Instance);
                    if (_guardProp == null)
                    {
                        var iface = FindType("OFT.Platform.Core.Providers.IPlatformTradingCore");
                        _guardProp = iface?.GetProperty("OrderRiskGuard");
                    }
                }
                if (_guardProp == null || !_guardProp.CanWrite)
                {
                    _guardError = "this ATAS version has no order check to join";
                    return;
                }
                var current = _guardProp.GetValue(core);
                if (current != null && ReferenceEquals(current, _proxy))
                {
                    _guardError = "";
                    return; // ours is in place
                }
                // ATAS (re)assigned its own: wrap it
                var proxy = DispatchProxy.Create(_guardProp.PropertyType, typeof(RiskGuardProxy));
                ((RiskGuardProxy)proxy).Inner = current;
                _guardProp.SetValue(core, proxy);
                _proxy = proxy;
                _guardError = "";
            }
            catch (Exception e)
            {
                _guardError = (e.InnerException ?? e).Message;
            }
        }

        private static void RemoveGuard()
        {
            try
            {
                if (_core != null && _guardProp != null && _proxy != null && ReferenceEquals(_guardProp.GetValue(_core), _proxy))
                    _guardProp.SetValue(_core, ((RiskGuardProxy)_proxy).Inner);
            }
            catch
            {
                // leave it: our check only adds to ATAS's
            }
            _proxy = null;
        }

        private static bool GuardOn => _proxy != null && _guardError.Length == 0;

        // ---------- each account ----------

        private static List<T> Snapshot<T>(Func<IEnumerable<T>?> get)
        {
            for (var i = 0; i < 4; i++)
            {
                try { return (get() ?? Enumerable.Empty<T>()).Where(x => x != null).ToList(); }
                catch (InvalidOperationException) { Thread.Sleep(50); }
                catch { break; }
            }
            return new List<T>();
        }

        private static DateTime CloseUtc(HistoryMyTrade t)
        {
            try
            {
                if (Arrived.TryGetValue(t.Id.ToString(), out var seen))
                    return seen;
            }
            catch { }
            return DateTime.SpecifyKind(t.CloseTime, DateTimeKind.Utc); // ATAS keeps trade times in UTC
        }

        private static AccountView View(AccountRules r, List<HistoryMyTrade> history, List<Position> positions, List<Order> orders, List<Portfolio> portfolios)
        {
            var v = new AccountView();
            var dayStart = DateTimeOffset.FromUnixTimeMilliseconds(_dayStartUtc > 0 ? _dayStartUtc : new DateTimeOffset(DateTime.UtcNow.Date).ToUnixTimeMilliseconds()).UtcDateTime;
            var today = history
                .Where(t => t.IsComplete && string.Equals(t.AccountID ?? t.Portfolio?.AccountID, r.Account, StringComparison.OrdinalIgnoreCase))
                .Select(t => new { t, at = CloseUtc(t) })
                .Where(x => x.at >= dayStart)
                .OrderBy(x => x.at)
                .ToList();
            decimal run = 0, peak = 0;
            var streak = 0;
            foreach (var x in today)
            {
                var net = x.t.PnL - Math.Abs(x.t.Commission ?? 0m);
                run += net;
                if (run > peak) peak = run;
                streak = net < -Math.Abs(r.ConsecMin) ? streak + 1 : 0;
            }
            v.Realised = run;
            v.Peak = peak;
            v.Trades = today.Count;
            v.Streak = streak;
            v.Positions = positions.Where(p => string.Equals(p.AccountID ?? p.Portfolio?.AccountID, r.Account, StringComparison.OrdinalIgnoreCase) && p.Volume != 0).ToList();
            decimal open = 0;
            foreach (var p in v.Positions)
            {
                try { open += p.OpenPnL ?? 0m; }
                catch { }
            }
            v.Unrealised = open;
            v.Orders = orders.Where(o => string.Equals(o.AccountID ?? o.Portfolio?.AccountID, r.Account, StringComparison.OrdinalIgnoreCase) && o.State == OrderStates.Active).ToList();
            v.Portfolio = v.Positions.Select(p => p.Portfolio).FirstOrDefault(p => p != null)
                ?? portfolios.FirstOrDefault(p => string.Equals(p.AccountID, r.Account, StringComparison.OrdinalIgnoreCase));
            return v;
        }

        private static async Task Enforce(JournalSync owner, CancellationToken token)
        {
            var rules = _rules;
            var core = _core;
            var history = Snapshot<HistoryMyTrade>(() => owner.RiskStatistics?.HistoryMyTrades);
            var positions = core != null ? Snapshot<Position>(() => core.Positions) : new List<Position>();
            var orders = core != null ? Snapshot<Order>(() => core.Orders) : new List<Order>();
            var portfolios = core != null ? Snapshot<Portfolio>(() => core.Portfolios) : new List<Portfolio>();

            // accounts no longer enforced are released
            foreach (var k in Blocked.Keys.ToList())
                if (!rules.Any(r => string.Equals(r.Account, k, StringComparison.OrdinalIgnoreCase)))
                    Blocked.TryRemove(k, out _);

            foreach (var r in rules)
            {
                token.ThrowIfCancellationRequested();
                AccountState st;
                lock (Gate)
                {
                    if (!States.TryGetValue(r.Account, out var found))
                    {
                        found = new AccountState();
                        States[r.Account] = found;
                    }
                    st = found;
                }
                var v = View(r, history, positions, orders, portfolios);

                if (st.LockedDay != 0 && st.LockedDay != _dayStartUtc)
                {
                    st.LockedDay = 0; // a new day
                    st.LockReason = "";
                    st.LockIsTarget = false;
                }
                if (st.LockedDay != 0 && st.LockIsTarget && !(r.FlattenTarget && r.Target > 0))
                {
                    st.LockedDay = 0; // the target's flatten switch was turned off
                    st.LockReason = "";
                    st.LockIsTarget = false;
                }
                var lossHit = r.DailyLoss > 0 && v.Realised + v.Unrealised <= -r.DailyLoss;
                var trailHit = r.Trail > 0 && v.Peak - v.Realised >= r.Trail;
                var targetHit = r.FlattenTarget && r.Target > 0 && v.Realised + (r.TargetOpen ? v.Unrealised : 0m) >= r.Target;
                if (targetHit && !lossHit && !trailHit && st.LockedDay == 0)
                {
                    st.LockedDay = _dayStartUtc;
                    st.LockIsTarget = true;
                    st.LockReason = $"profit target of {r.Target:0.##} reached — done for the day";
                }
                if ((lossHit || trailHit) && (st.LockedDay == 0 || st.LockIsTarget))
                {
                    st.LockedDay = _dayStartUtc;
                    st.LockIsTarget = false;
                    st.LockReason = lossHit
                        ? $"daily loss limit of {r.DailyLoss:0.##} reached"
                        : $"trailing drawdown of {r.Trail:0.##} reached (day's high {v.Peak:0.##}, now {v.Realised:0.##})";
                }
                string reason = r.ManualLock ? "blocked by you for the rest of the day"
                    : st.LockedDay != 0 ? st.LockReason
                    : r.MaxTrades > 0 && v.Trades >= r.MaxTrades ? $"{v.Trades} of {r.MaxTrades} trades taken today"
                    : r.MaxConsec > 0 && v.Streak >= r.MaxConsec ? $"{v.Streak} losing trades in a row"
                    : !r.InWindow ? "outside your trading window"
                    : "";
                Blocked[r.Account] = reason.Length > 0;

                // what to do about positions and orders
                var actError = "";
                var dueAction = DateTime.UtcNow - st.LastAction > TimeSpan.FromSeconds(5);
                var windowEnded = st.WasInWindow == true && !r.InWindow;
                st.WasInWindow = r.InWindow;
                if (core != null && v.Portfolio != null && dueAction)
                {
                    try
                    {
                        var flattenLocked = (r.ManualLock && r.ManualFlatten) || (st.LockedDay != 0 && (st.LockIsTarget ? r.FlattenTarget : r.FlattenLoss));
                        if (flattenLocked && (v.Positions.Count > 0 || v.Orders.Count > 0))
                        {
                            st.LastAction = DateTime.UtcNow;
                            await Flatten(core, v);
                        }
                        else if (windowEnded && r.Flatten && v.Positions.Count > 0)
                        {
                            st.LastAction = DateTime.UtcNow;
                            await Flatten(core, v);
                        }
                        else if (reason.Length > 0 && v.Positions.Count == 0 && v.Orders.Count > 0)
                        {
                            st.LastAction = DateTime.UtcNow; // resting entry orders while blocked
                            foreach (var o in v.Orders)
                                await core.CancelOrderAsync(o);
                        }
                        else if (r.MaxContracts > 0)
                        {
                            foreach (var p in v.Positions.Where(p => Math.Abs(p.Volume) > r.MaxContracts))
                            {
                                st.LastAction = DateTime.UtcNow;
                                var excess = Math.Abs(p.Volume) - r.MaxContracts;
                                await core.RegisterOrderAsync(new Order
                                {
                                    Portfolio = p.Portfolio ?? v.Portfolio,
                                    Security = p.Security,
                                    Direction = p.Volume > 0 ? OrderDirections.Sell : OrderDirections.Buy,
                                    Type = OrderTypes.Market,
                                    QuantityToFill = excess,
                                    Comment = "RoninFlow: over the contract limit",
                                });
                            }
                        }
                    }
                    catch (Exception e)
                    {
                        actError = "couldn't act: " + (e.InnerException ?? e).Message;
                    }
                }

                if (_setAtas && r.SetAtas)
                    await SyncNative(r, v, st);

                st.Report = new
                {
                    account = r.Account,
                    tier = r.Tier,
                    realised = Math.Round(v.Realised, 2),
                    unrealised = Math.Round(v.Unrealised, 2),
                    peak = Math.Round(v.Peak, 2),
                    floor = Math.Round(r.Trail > 0 ? v.Peak - r.Trail : -r.DailyLoss, 2),
                    target = r.Target,
                    targetHit = st.LockedDay != 0 && st.LockIsTarget,
                    trades = v.Trades,
                    streak = v.Streak,
                    positions = v.Positions.Count,
                    orders = v.Orders.Count,
                    blocked = reason.Length > 0,
                    reason,
                    seen = v.Portfolio != null,
                    native = st.Native,
                    error = actError,
                };
            }
        }

        private static async Task Flatten(IDataFeedConnector core, AccountView v)
        {
            if (v.Portfolio == null)
                return;
            if (core.IsSupportedGoFlat)
            {
                await core.GoFlatAsync(v.Portfolio);
                return;
            }
            foreach (var o in v.Orders)
            {
                try { await core.CancelOrderAsync(o); }
                catch { }
            }
            await core.ClosePositionsAsync(v.Portfolio);
        }

        // ---------- ATAS Risk Management ----------

        private static object? GetProp(object o, string name)
        {
            try { return o.GetType().GetProperty(name)?.GetValue(o); }
            catch { return null; }
        }

        private static bool SetProp(object o, string name, object value)
        {
            var p = o.GetType().GetProperty(name);
            if (p == null || !p.CanWrite)
                return false;
            var cur = p.GetValue(o);
            if (Equals(cur, value))
                return false;
            p.SetValue(o, value);
            return true;
        }

        private static async Task<object?> Await(object? task)
        {
            if (task is not Task t)
                return null;
            await t.ConfigureAwait(false);
            return t.GetType().GetProperty("Result")?.GetValue(t);
        }

        private static async Task SyncNative(AccountRules r, AccountView v, AccountState st)
        {
            var rms = _rms;
            if (rms == null || _rmsType == null)
            {
                st.Native = new { ok = false, error = _rmsError.Length > 0 ? _rmsError : "ATAS Risk Management isn't available" };
                return;
            }
            // the loss limit, lowered once the trailing drawdown is tighter (ATAS measures from the day's start)
            var limit = r.DailyLoss;
            if (r.Trail > 0 && v.Peak > 0)
            {
                var room = r.Trail - v.Peak;
                if (room < limit)
                    limit = Math.Max(1m, room);
            }
            limit = Math.Round(limit, 2);
            var key = $"{limit}|{r.MaxTrades}|{r.MaxConsec}|{r.ConsecMin}";
            if (key == st.NativeKey && DateTime.UtcNow - st.NativeCheckedAt < TimeSpan.FromSeconds(30))
                return;
            st.NativeCheckedAt = DateTime.UtcNow;
            try
            {
                var get = _rmsType.GetMethod("GetAccountSettingsAsync");
                var save = _rmsType.GetMethod("SaveAccountSettingsAsync");
                if (get == null || save == null)
                {
                    st.Native = new { ok = false, error = "this ATAS version's Risk Management can't be set from an add-on" };
                    return;
                }
                var settings = await Await(get.Invoke(rms, new object[] { r.Account }));
                if (settings == null)
                {
                    st.Native = new { ok = false, error = "ATAS Risk Management has no entry for this account yet" };
                    return;
                }
                var changed = false;
                if (r.DailyLoss > 0)
                {
                    changed |= SetProp(settings, "LossLimitEnabled", true);
                    changed |= SetProp(settings, "LossLimit", limit);
                }
                if (r.MaxTrades > 0)
                {
                    changed |= SetProp(settings, "MaxTradesEnabled", true);
                    changed |= SetProp(settings, "MaxTradesPerDay", r.MaxTrades);
                }
                if (r.MaxConsec > 0)
                {
                    changed |= SetProp(settings, "ConsecutiveLossesEnabled", true);
                    changed |= SetProp(settings, "ConsecutiveLossesLimit", r.MaxConsec);
                    changed |= SetProp(settings, "LossThreshold", Math.Abs(r.ConsecMin));
                }
                string error = "";
                if (changed)
                {
                    try
                    {
                        await Await(save.Invoke(rms, new object[] { r.Account, settings }));
                    }
                    catch (Exception e)
                    {
                        var inner = e is TargetInvocationException tie && tie.InnerException != null ? tie.InnerException : e;
                        error = "ATAS didn't accept the change (" + inner.Message + ") — its Settings change mode may lock them while the account is blocked";
                    }
                }
                st.NativeKey = error.Length == 0 ? key : "";
                st.Native = new
                {
                    ok = error.Length == 0,
                    error,
                    lossLimit = GetProp(settings, "LossLimitEnabled") is true ? GetProp(settings, "LossLimit") : null,
                    maxTrades = GetProp(settings, "MaxTradesEnabled") is true ? GetProp(settings, "MaxTradesPerDay") : null,
                    maxConsec = GetProp(settings, "ConsecutiveLossesEnabled") is true ? GetProp(settings, "ConsecutiveLossesLimit") : null,
                    responseMode = GetProp(settings, "ResponseMode")?.ToString(),
                    changeMode = GetProp(settings, "SettingsChangeMode")?.ToString(),
                    updated = changed && error.Length == 0,
                };
            }
            catch (Exception e)
            {
                st.Native = new { ok = false, error = "couldn't read ATAS Risk Management: " + (e.InnerException ?? e).Message };
            }
        }

        // ---------- report to RoninFlow ----------

        private static async Task Report(JournalSync owner, CancellationToken token)
        {
            List<object?> accounts;
            lock (Gate)
                accounts = _rules.Select(r => States.TryGetValue(r.Account, out var s) ? s.Report : null).Where(x => x != null).ToList();
            await owner.PostRiskStatus(new
            {
                version = JournalSync.AddonVersion,
                enforcing = true,
                setAtas = _setAtas,
                guard = GuardOn,
                guardError = _guardError,
                core = _core != null,
                coreError = _coreError,
                rms = _rms != null,
                rmsError = _rmsError,
                rulesError = _rulesError,
                accounts,
            }, token);
        }
    }
}
