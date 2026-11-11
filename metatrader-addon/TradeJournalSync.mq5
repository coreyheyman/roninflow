//+------------------------------------------------------------------+
//| Trade Journal Sync — MetaTrader 5 Expert Advisor                  |
//|                                                                  |
//| Writes every closed position on this account to MetaTrader's     |
//| shared folder (Common\Files\TradeJournal), where the journal on  |
//| this PC picks it up within ~10 seconds. No web request settings  |
//| are needed (MetaTrader can't call the journal's local address).  |
//|                                                                  |
//| Install: copy to MQL5\Experts (npm run addon:mt does it), compile |
//| in MetaEditor (F7), then drag "TradeJournalSync" onto any chart. |
//| It only reads history — it never places or changes orders.       |
//+------------------------------------------------------------------+
#property copyright "Trade Journal"
#property version   "1.00"
#property description "Sends your closed trades to Trade Journal (read-only, never trades)."

input int BackfillDays = 30;   // Days of history to send when it starts

string g_trades;   // TradeJournal\mt5-<login>.jsonl
string g_status;   // TradeJournal\mt5-<login>.status.json
string g_login;
long   g_sent[];   // position ids already written this session
datetime g_lastCheck = 0;

//--- JSON helpers
string Esc(string s)
  {
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   return s;
  }
string Num(double v) { return DoubleToString(v, 8); }
// server time → UTC ISO (uses the broker's current offset from GMT, rounded to 15 minutes)
string IsoUtc(datetime serverTime)
  {
   long off = (long)(TimeGMT() - TimeTradeServer());
   off = (long)MathRound(off / 900.0) * 900;
   MqlDateTime d;
   TimeToStruct((datetime)(serverTime + off), d);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ", d.year, d.mon, d.day, d.hour, d.min, d.sec);
  }
bool Sent(long id)
  {
   for(int i = 0; i < ArraySize(g_sent); i++) if(g_sent[i] == id) return true;
   return false;
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   g_login  = IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   g_trades = "TradeJournal\\mt5-" + g_login + ".jsonl";
   g_status = "TradeJournal\\mt5-" + g_login + ".status.json";
   FolderCreate("TradeJournal", FILE_COMMON);
   ArrayResize(g_sent, 0);
   int n = Scan(TimeCurrent() - (datetime)BackfillDays * 86400);
   WriteStatus();
   PrintFormat("[Trade Journal] started for account %s — %d closed trade(s) sent from the last %d days", g_login, n, BackfillDays);
   EventSetTimer(5);
   return(INIT_SUCCEEDED);
  }
void OnDeinit(const int reason) { EventKillTimer(); }
void OnTimer()
  {
   // look back a day each time; positions already written are skipped (and the journal ignores repeats)
   Scan(TimeCurrent() - 86400);
   WriteStatus();
  }
void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
  {
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD) { Scan(TimeCurrent() - 86400); }
  }

//+------------------------------------------------------------------+
//| Find positions with a closing deal since `from`, write the ones  |
//| that are now flat.                                               |
//+------------------------------------------------------------------+
int Scan(datetime from)
  {
   if(!HistorySelect(from, TimeCurrent() + 86400)) return 0;
   long ids[];
   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
     {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0) continue;
      long entry = HistoryDealGetInteger(deal, DEAL_ENTRY);
      long type  = HistoryDealGetInteger(deal, DEAL_TYPE);
      if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY && entry != DEAL_ENTRY_INOUT) continue;
      long pos = HistoryDealGetInteger(deal, DEAL_POSITION_ID);
      if(pos == 0 || Sent(pos)) continue;
      bool have = false;
      for(int k = 0; k < ArraySize(ids); k++) if(ids[k] == pos) { have = true; break; }
      if(!have) { int s = ArraySize(ids); ArrayResize(ids, s + 1); ids[s] = pos; }
     }
   int written = 0;
   for(int k = 0; k < ArraySize(ids); k++) if(WritePosition(ids[k])) written++;
   return written;
  }

bool WritePosition(long pos)
  {
   if(!HistorySelectByPosition(pos)) return false;
   int n = HistoryDealsTotal();
   double net = 0, inVol = 0, inNot = 0, outVol = 0, outNot = 0, pnl = 0, fees = 0;
   int dir = 0;
   datetime first = 0, last = 0;
   string symbol = "";
   for(int i = 0; i < n; i++)
     {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0) continue;
      long type = HistoryDealGetInteger(deal, DEAL_TYPE);
      if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;
      double vol   = HistoryDealGetDouble(deal, DEAL_VOLUME);
      double price = HistoryDealGetDouble(deal, DEAL_PRICE);
      datetime t   = (datetime)HistoryDealGetInteger(deal, DEAL_TIME);
      int side = (type == DEAL_TYPE_BUY) ? 1 : -1;
      if(dir == 0) { dir = side; first = t; symbol = HistoryDealGetString(deal, DEAL_SYMBOL); }
      if(side == dir) { inVol += vol; inNot += vol * price; } else { outVol += vol; outNot += vol * price; }
      net += side * vol;
      last = t;
      double comm = HistoryDealGetDouble(deal, DEAL_COMMISSION) + HistoryDealGetDouble(deal, DEAL_FEE);
      pnl  += HistoryDealGetDouble(deal, DEAL_PROFIT) + HistoryDealGetDouble(deal, DEAL_SWAP) + comm;
      fees -= comm;
     }
   if(dir == 0 || inVol <= 0 || outVol <= 0) return false;
   if(MathAbs(net) > 1e-8) return false; // still open (partly closed) — written once it's flat
   string line = StringFormat("{\"id\":\"mt5-%s-%s\",\"platform\":\"MetaTrader 5\",\"version\":\"1.0.0\",\"account\":\"%s\",\"symbol\":\"%s\",\"direction\":\"%s\",\"qty\":%s,\"entryTime\":\"%s\",\"exitTime\":\"%s\",\"entryPrice\":%s,\"exitPrice\":%s,\"pnl\":%s,\"fees\":%s}",
                              g_login, IntegerToString(pos), g_login, Esc(symbol), dir > 0 ? "Long" : "Short", Num(inVol), IsoUtc(first), IsoUtc(last),
                              Num(inNot / inVol), Num(outNot / outVol), Num(pnl), Num(fees));
   int h = FileOpen(g_trades, FILE_READ | FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON | FILE_SHARE_READ);
   if(h == INVALID_HANDLE) { PrintFormat("[Trade Journal] can't open %s (error %d)", g_trades, GetLastError()); return false; }
   FileSeek(h, 0, SEEK_END);
   FileWriteString(h, line + "\n");
   FileClose(h);
   int s = ArraySize(g_sent); ArrayResize(g_sent, s + 1); g_sent[s] = pos;
   return true;
  }

void WriteStatus()
  {
   int h = FileOpen(g_status, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON | FILE_SHARE_READ);
   if(h == INVALID_HANDLE) return;
   FileWriteString(h, StringFormat("{\"platform\":\"MetaTrader 5\",\"version\":\"1.0.0\",\"account\":\"%s\",\"server\":\"%s\",\"balance\":%s,\"equity\":%s,\"currency\":\"%s\"}",
                                   g_login, Esc(AccountInfoString(ACCOUNT_SERVER)), Num(AccountInfoDouble(ACCOUNT_BALANCE)), Num(AccountInfoDouble(ACCOUNT_EQUITY)), AccountInfoString(ACCOUNT_CURRENCY)));
   FileClose(h);
  }
//+------------------------------------------------------------------+
