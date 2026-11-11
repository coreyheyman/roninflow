//+------------------------------------------------------------------+
//| Trade Journal Sync — MetaTrader 4 Expert Advisor                  |
//|                                                                  |
//| Writes every closed order on this account to MetaTrader's shared |
//| folder (Common\Files\TradeJournal); the journal on this PC picks |
//| it up within ~10 seconds. Read-only — it never trades.           |
//|                                                                  |
//| Install: copy to MQL4\Experts (npm run addon:mt does it), compile |
//| in MetaEditor (F7), then drag "TradeJournalSync" onto any chart. |
//+------------------------------------------------------------------+
#property copyright "Trade Journal"
#property version   "1.00"
#property description "Sends your closed trades to Trade Journal (read-only, never trades)."
#property strict

input int BackfillDays = 30;   // Days of history to send when it starts

string g_trades;
string g_status;
string g_login;
int    g_sent[];
int    g_lastHistoryCount = -1;

string Esc(string s)
  {
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   return s;
  }
string Num(double v) { return DoubleToString(v, 8); }
// server time → UTC ISO (the broker's current offset from GMT, rounded to 15 minutes)
string IsoUtc(datetime serverTime)
  {
   int off = (int)(TimeGMT() - TimeCurrent());
   off = (int)MathRound(off / 900.0) * 900;
   datetime t = serverTime + off;
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ", TimeYear(t), TimeMonth(t), TimeDay(t), TimeHour(t), TimeMinute(t), TimeSeconds(t));
  }
bool Sent(int ticket)
  {
   for(int i = 0; i < ArraySize(g_sent); i++) if(g_sent[i] == ticket) return true;
   return false;
  }

int OnInit()
  {
   g_login  = IntegerToString(AccountNumber());
   g_trades = "TradeJournal\\mt4-" + g_login + ".jsonl";
   g_status = "TradeJournal\\mt4-" + g_login + ".status.json";
   FolderCreate("TradeJournal", FILE_COMMON);
   ArrayResize(g_sent, 0);
   int n = Scan(TimeCurrent() - BackfillDays * 86400);
   WriteStatus();
   PrintFormat("[Trade Journal] started for account %s — %d closed trade(s) sent from the last %d days", g_login, n, BackfillDays);
   EventSetTimer(5);
   return(INIT_SUCCEEDED);
  }
void OnDeinit(const int reason) { EventKillTimer(); }
void OnTimer()
  {
   if(OrdersHistoryTotal() != g_lastHistoryCount) Scan(TimeCurrent() - 7 * 86400);
   WriteStatus();
  }
void OnTick() {}

int Scan(datetime from)
  {
   int written = 0;
   int total = OrdersHistoryTotal();
   g_lastHistoryCount = total;
   for(int i = 0; i < total; i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;   // balance / credit / pending orders
      if(OrderCloseTime() == 0 || OrderCloseTime() < from) continue;
      int ticket = OrderTicket();
      if(Sent(ticket)) continue;
      double pnl  = OrderProfit() + OrderSwap() + OrderCommission();
      string line = StringFormat("{\"id\":\"mt4-%s-%d\",\"platform\":\"MetaTrader 4\",\"version\":\"1.0.0\",\"account\":\"%s\",\"symbol\":\"%s\",\"direction\":\"%s\",\"qty\":%s,\"entryTime\":\"%s\",\"exitTime\":\"%s\",\"entryPrice\":%s,\"exitPrice\":%s,\"pnl\":%s,\"fees\":%s}",
                                 g_login, ticket, g_login, Esc(OrderSymbol()), type == OP_BUY ? "Long" : "Short", Num(OrderLots()),
                                 IsoUtc(OrderOpenTime()), IsoUtc(OrderCloseTime()), Num(OrderOpenPrice()), Num(OrderClosePrice()), Num(pnl), Num(-OrderCommission()));
      int h = FileOpen(g_trades, FILE_READ | FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON | FILE_SHARE_READ);
      if(h == INVALID_HANDLE) { PrintFormat("[Trade Journal] can't open %s (error %d)", g_trades, GetLastError()); return written; }
      FileSeek(h, 0, SEEK_END);
      FileWriteString(h, line + "\n");
      FileClose(h);
      int s = ArraySize(g_sent); ArrayResize(g_sent, s + 1); g_sent[s] = ticket;
      written++;
     }
   return written;
  }

void WriteStatus()
  {
   int h = FileOpen(g_status, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON | FILE_SHARE_READ);
   if(h == INVALID_HANDLE) return;
   FileWriteString(h, StringFormat("{\"platform\":\"MetaTrader 4\",\"version\":\"1.0.0\",\"account\":\"%s\",\"server\":\"%s\",\"balance\":%s,\"equity\":%s,\"currency\":\"%s\"}",
                                   g_login, Esc(AccountServer()), Num(AccountBalance()), Num(AccountEquity()), AccountCurrency()));
   FileClose(h);
  }
//+------------------------------------------------------------------+
