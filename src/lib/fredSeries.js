// The macro data series the Macro pages show (FRED and the New York Fed), how each one is labelled, scaled and
// formatted, how pages group them, and the hook that loads them. Pure data + maths, shared by every series page.

const DAY = 86400000;
// unit: pct (x.xx%) · usdB ($1,234B) · usd ($12.34) · k (1,234K) · num (plain, dp) — scale multiplies FRED's raw value
// chg: how the change reads — bps (basis points), pp (percentage points shown as %), or the series' own unit
// tf: yoy (percent change on a year earlier) · diff (change on the previous print, e.g. payrolls)
// demo: [latest value, frequency d/w/m/q, typical move per observation, drift per observation] for the public demo
export const SERIES = {
  // ---- rates ----
  DGS1: { label: '1-Year Treasury', unit: 'pct', chg: 'bps', demo: [4.59, 'd', 0.03] },
  DGS2: { label: '2-Year Treasury', unit: 'pct', chg: 'bps', demo: [4.63, 'd', 0.04] },
  DGS5: { label: '5-Year Treasury', unit: 'pct', chg: 'bps', demo: [4.69, 'd', 0.045] },
  DGS10: { label: '10-Year Treasury', unit: 'pct', chg: 'bps', demo: [4.91, 'd', 0.045] },
  DGS20: { label: '20-Year Treasury', unit: 'pct', chg: 'bps', demo: [5.33, 'd', 0.04] },
  DGS30: { label: '30-Year Treasury', unit: 'pct', chg: 'bps', demo: [5.30, 'd', 0.04] },
  DGS3MO: { label: '3-Month Treasury Bill', unit: 'pct', chg: 'bps', demo: [4.36, 'd', 0.015] },
  T10Y2Y: { label: '10Y − 2Y Spread', unit: 'pct', chg: 'bps', demo: [0.28, 'd', 0.02], note: 'Negative = inverted curve, historically a recession warning.' },
  T10Y3M: { label: '10Y − 3M Spread', unit: 'pct', chg: 'bps', demo: [0.55, 'd', 0.025] },
  DFII5: { label: '5-Year TIPS (real yield)', unit: 'pct', chg: 'bps', demo: [2.58, 'd', 0.035] },
  DFII10: { label: '10-Year TIPS (real yield)', unit: 'pct', chg: 'bps', demo: [2.79, 'd', 0.035] },
  DFII30: { label: '30-Year TIPS (real yield)', unit: 'pct', chg: 'bps', demo: [3.19, 'd', 0.03] },
  T5YIE: { label: '5Y Breakeven Inflation', unit: 'pct', chg: 'bps', demo: [2.11, 'd', 0.02] },
  T10YIE: { label: '10Y Breakeven Inflation', unit: 'pct', chg: 'bps', demo: [2.12, 'd', 0.015] },
  T5YIFR: { label: '5Y/5Y Forward Inflation', unit: 'pct', chg: 'bps', demo: [2.13, 'd', 0.015] },
  MORTGAGE30US: { label: '30-Year Mortgage Rate', unit: 'pct', chg: 'bps', demo: [6.84, 'w', 0.06] },
  // ---- policy & liquidity ----
  WALCL: { label: 'Fed Total Assets', unit: 'usdB', scale: 0.001, demo: [6741, 'w', 12, -9] },
  WRESBAL: { label: 'Bank Reserve Balances', unit: 'usdB', demo: [3105, 'w', 45] },
  RRPONTSYD: { label: 'Overnight Reverse Repo', unit: 'usdB', demo: [2, 'd', 3, -0.6] },
  WTREGEN: { label: 'Treasury General Account', unit: 'usdB', scale: 0.001, demo: [917, 'w', 35] },
  BOGMBASE: { label: 'Monetary Base (M0)', unit: 'usdB', scale: 0.001, demo: [5460, 'm', 40] },
  M1SL: { label: 'M1 Money Supply', unit: 'usdB', demo: [20167, 'm', 60, 40] },
  M2SL: { label: 'M2 Money Supply', unit: 'usdB', demo: [23533, 'm', 60, 70] },
  M2V: { label: 'Velocity of M2', unit: 'num', dp: 2, demo: [1.42, 'q', 0.01] },
  SOFR: { label: 'SOFR', unit: 'pct', chg: 'bps', demo: [3.94, 'd', 0.01] },
  DFF: { label: 'Effective Fed Funds Rate', unit: 'pct', chg: 'bps', demo: [3.88, 'd', 0.005] },
  DFEDTARU: { label: 'Fed Funds Target (upper)', unit: 'pct', chg: 'bps', demo: [4.0, 'd', 0] },
  NETLIQ: { label: 'Net Liquidity', unit: 'usdB', derive: ['WALCL', 'RRPONTSYD', 'WTREGEN'], fn: (a, b, c) => a - b - c, note: 'Fed assets minus the reverse repo and the Treasury’s account — the cash actually left in the system.' },
  // ---- credit & markets ----
  BAMLH0A0HYM2: { label: 'US High Yield Spread (OAS)', unit: 'pct', chg: 'pp', demo: [3.72, 'd', 0.05] },
  BAMLC0A0CM: { label: 'US Investment Grade Spread (OAS)', unit: 'pct', chg: 'pp', demo: [0.98, 'd', 0.012] },
  BAMLH0A3HYC: { label: 'CCC & Lower Spread (OAS)', unit: 'pct', chg: 'pp', demo: [9.4, 'd', 0.12] },
  TOTLL: { label: 'Bank Loans & Leases', unit: 'usdB', demo: [14264, 'w', 18, 12] },
  DPSACBW027SBOG: { label: 'Bank Deposits', unit: 'usdB', demo: [19825, 'w', 35, 8] },
  CCLACBW027SBOG: { label: 'Consumer Credit (banks)', unit: 'usdB', demo: [1100, 'w', 3, 0.6] },
  DRBLACBS: { label: 'Business Loan Delinquency', unit: 'pct', chg: 'pp', demo: [1.27, 'q', 0.05] },
  DRSFRMACBS: { label: 'Mortgage Delinquency', unit: 'pct', chg: 'pp', demo: [1.86, 'q', 0.05] },
  DRCCLACBS: { label: 'Credit Card Delinquency', unit: 'pct', chg: 'pp', demo: [2.85, 'q', 0.06] },
  STLFSI4: { label: 'St. Louis Fed Financial Stress', unit: 'num', dp: 2, demo: [-0.07, 'w', 0.12] },
  NFCI: { label: 'Chicago Fed Financial Conditions', unit: 'num', dp: 2, demo: [-0.44, 'w', 0.02] },
  ANFCI: { label: 'Adjusted Financial Conditions', unit: 'num', dp: 2, demo: [-0.44, 'w', 0.02] },
  SP500: { label: 'S&P 500', unit: 'num', dp: 0, demo: [7201, 'd', 55, 2.2] },
  NASDAQCOM: { label: 'Nasdaq Composite', unit: 'num', dp: 0, demo: [23734, 'd', 260, 9] },
  NASDAQ100: { label: 'Nasdaq 100', unit: 'num', dp: 0, demo: [25410, 'd', 290, 10] },
  DJIA: { label: 'Dow Jones Industrial Average', unit: 'num', dp: 0, demo: [46210, 'd', 330, 12] },
  VIXCLS: { label: 'VIX', unit: 'num', dp: 2, demo: [26.36, 'd', 1.1] },
  DCOILWTICO: { label: 'WTI Crude', unit: 'usd', demo: [82.24, 'd', 1.4] },
  DCOILBRENTEU: { label: 'Brent Crude', unit: 'usd', demo: [91.8, 'd', 1.5] },
  DHHNGSP: { label: 'Henry Hub Natural Gas', unit: 'usd', demo: [3.42, 'd', 0.12] },
  PCOPPUSDM: { label: 'Copper ($/lb)', unit: 'usd', scale: 1 / 2204.62, demo: [5.48, 'm', 0.15] },
  DTWEXBGS: { label: 'US Dollar Index — Broad', unit: 'num', dp: 1, demo: [123.6, 'd', 0.35] },
  DTWEXEMEGS: { label: 'US Dollar Index — EM', unit: 'num', dp: 1, demo: [132.4, 'd', 0.3] },
  DTWEXAFEGS: { label: 'US Dollar Index — Advanced', unit: 'num', dp: 1, demo: [114.1, 'd', 0.35] },
  // ---- FX (FRED's noon rates) ----
  DEXUSEU: { label: 'EUR/USD', unit: 'num', dp: 4, demo: [1.0842, 'd', 0.004] },
  DEXUSUK: { label: 'GBP/USD', unit: 'num', dp: 4, demo: [1.2611, 'd', 0.005] },
  DEXJPUS: { label: 'USD/JPY', unit: 'num', dp: 2, demo: [152.4, 'd', 0.7] },
  DEXSZUS: { label: 'USD/CHF', unit: 'num', dp: 4, demo: [0.8912, 'd', 0.004] },
  DEXCAUS: { label: 'USD/CAD', unit: 'num', dp: 4, demo: [1.3921, 'd', 0.004] },
  DEXUSAL: { label: 'AUD/USD', unit: 'num', dp: 4, demo: [0.6512, 'd', 0.004] },
  DEXUSNZ: { label: 'NZD/USD', unit: 'num', dp: 4, demo: [0.5904, 'd', 0.004] },
  DEXCHUS: { label: 'USD/CNY', unit: 'num', dp: 4, demo: [7.1822, 'd', 0.012] },
  DEXMXUS: { label: 'USD/MXN', unit: 'num', dp: 3, demo: [18.92, 'd', 0.12] },
  // ---- economy & labour ----
  UNRATE: { label: 'Unemployment Rate (U-3)', unit: 'pct', dp: 1, chg: 'pp', demo: [4.1, 'm', 0.1] },
  U6RATE: { label: 'Underemployment (U-6)', unit: 'pct', dp: 1, chg: 'pp', demo: [7.9, 'm', 0.15] },
  PAYEMS: { label: 'Nonfarm Payrolls', unit: 'k', tf: 'diff', sign: true, demo: [159800, 'm', 70, 150], note: 'Jobs added last month.' },
  ICSA: { label: 'Initial Jobless Claims', unit: 'k', scale: 0.001, demo: [189, 'w', 7] },
  CCSA: { label: 'Continuing Claims', unit: 'k', scale: 0.001, demo: [1870, 'w', 22] },
  UNEMPLOY: { label: 'Unemployed Persons', unit: 'k', demo: [7068, 'm', 90] },
  CES0500000003: { label: 'Avg Hourly Earnings', unit: 'usd', demo: [38.0, 'm', 0.05, 0.12] },
  JTSJOL: { label: 'Job Openings (JOLTS)', unit: 'k', demo: [7523, 'm', 220] },
  JTSQUR: { label: 'Quit Rate (JOLTS)', unit: 'pct', dp: 1, chg: 'pp', demo: [2.1, 'm', 0.08] },
  JTSLDR: { label: 'Layoffs Rate (JOLTS)', unit: 'pct', dp: 1, chg: 'pp', demo: [1.0, 'm', 0.05] },
  GDPC1: { label: 'Real GDP', unit: 'usdB', demo: [24665, 'q', 60, 150] },
  A191RL1Q225SBEA: { label: 'Real GDP Growth (annualised)', unit: 'pct', dp: 1, chg: 'pp', demo: [2.1, 'q', 1.1] },
  INDPRO: { label: 'Industrial Production', unit: 'num', dp: 1, demo: [102.2, 'm', 0.4] },
  DGORDER: { label: 'Durable Goods Orders', unit: 'usdB', scale: 0.001, demo: [347, 'm', 6] },
  RSAFS: { label: 'Retail Sales', unit: 'usdB', scale: 0.001, demo: [748, 'm', 3, 1.8] },
  CSUSHPISA: { label: 'Case-Shiller Home Prices', unit: 'num', dp: 1, demo: [334.8, 'm', 0.6, 0.6] },
  HOUST: { label: 'Housing Starts', unit: 'k', demo: [1309, 'm', 70] },
  PERMIT: { label: 'Building Permits', unit: 'k', demo: [1297, 'm', 50] },
  UMCSENT: { label: 'Consumer Sentiment (UMich)', unit: 'num', dp: 1, demo: [48.0, 'm', 2.2] },
  PSAVERT: { label: 'Personal Savings Rate', unit: 'pct', dp: 1, chg: 'pp', demo: [4.1, 'm', 0.3] },
  RECPROUSM156N: { label: 'Recession Probability', unit: 'pct', dp: 1, chg: 'pp', demo: [0.4, 'm', 0.4] },
  CFNAI: { label: 'Chicago Fed National Activity', unit: 'num', dp: 2, demo: [-0.06, 'm', 0.18], note: 'Above zero = the economy growing faster than trend.' },
  // ---- inflation ----
  CPIAUCSL: { label: 'CPI (YoY)', unit: 'pct', dp: 1, chg: 'pp', tf: 'yoy', demo: [324.1, 'm', 0.25, 0.85] },
  CPILFESL: { label: 'Core CPI (YoY)', unit: 'pct', dp: 1, chg: 'pp', tf: 'yoy', demo: [330.5, 'm', 0.2, 0.82] },
  PCEPI: { label: 'PCE Prices (YoY)', unit: 'pct', dp: 1, chg: 'pp', tf: 'yoy', demo: [127.1, 'm', 0.08, 0.27] },
  PCEPILFE: { label: 'Core PCE (YoY)', unit: 'pct', dp: 1, chg: 'pp', tf: 'yoy', demo: [126.4, 'm', 0.07, 0.29], note: 'The Fed’s preferred inflation gauge; its target is 2%.' },
  PPIFIS: { label: 'PPI Final Demand (YoY)', unit: 'pct', dp: 1, chg: 'pp', tf: 'yoy', demo: [151.2, 'm', 0.35, 0.3] },
  PPIACO: { label: 'PPI All Commodities (YoY)', unit: 'pct', dp: 1, chg: 'pp', tf: 'yoy', demo: [262.4, 'm', 1.6, 2.3] },
  CORESTICKM159SFRBATL: { label: 'Sticky-Price CPI (YoY)', unit: 'pct', dp: 1, chg: 'pp', demo: [3.6, 'm', 0.08] },
  CUSR0000SAH1: { label: 'Shelter CPI (YoY)', unit: 'pct', dp: 1, chg: 'pp', tf: 'yoy', demo: [418.2, 'm', 0.3, 1.25] },
  IR: { label: 'Import Prices (YoY)', unit: 'pct', dp: 1, chg: 'pp', tf: 'yoy', demo: [142.1, 'm', 0.5, 0.15] },
  MICH: { label: 'Inflation Expectations 1Y (UMich)', unit: 'pct', dp: 1, chg: 'pp', demo: [4.4, 'm', 0.25] },
  EXPINF1YR: { label: 'Expected Inflation 1Y (Cleveland Fed)', unit: 'pct', chg: 'pp', demo: [2.61, 'm', 0.08] },
  EXPINF10YR: { label: 'Expected Inflation 10Y (Cleveland Fed)', unit: 'pct', chg: 'pp', demo: [2.38, 'm', 0.04] },
  // ---- international (OECD long rates via FRED, monthly) ----
  IRLTLT01DEM156N: { label: 'Germany 10Y Bund', unit: 'pct', chg: 'bps', demo: [3.42, 'm', 0.08] },
  IRLTLT01JPM156N: { label: 'Japan 10Y JGB', unit: 'pct', chg: 'bps', demo: [2.75, 'm', 0.07] },
  IRLTLT01GBM156N: { label: 'UK 10Y Gilt', unit: 'pct', chg: 'bps', demo: [5.34, 'm', 0.09] },
  IRLTLT01EZM156N: { label: 'Euro Area 10Y', unit: 'pct', chg: 'bps', demo: [3.22, 'm', 0.08] },
  IRLTLT01FRM156N: { label: 'France 10Y OAT', unit: 'pct', chg: 'bps', demo: [3.91, 'm', 0.08] },
  IRLTLT01ITM156N: { label: 'Italy 10Y BTP', unit: 'pct', chg: 'bps', demo: [4.38, 'm', 0.1] },
  IRLTLT01CAM156N: { label: 'Canada 10Y', unit: 'pct', chg: 'bps', demo: [3.71, 'm', 0.09] },
  IRLTLT01AUM156N: { label: 'Australia 10Y', unit: 'pct', chg: 'bps', demo: [4.86, 'm', 0.1] },
  IRLTLT01NZM156N: { label: 'New Zealand 10Y', unit: 'pct', chg: 'bps', demo: [4.71, 'm', 0.1] },
  IRLTLT01CHM156N: { label: 'Switzerland 10Y', unit: 'pct', chg: 'bps', demo: [0.62, 'm', 0.06] },
  // ---- G10 screener cells ----
  LRHUTTTTCAM156S: { label: 'Canada unemployment', unit: 'pct', dp: 1, chg: 'pp', demo: [6.7, 'm', 0.1] },
  LRHUTTTTDEM156S: { label: 'Germany unemployment', unit: 'pct', dp: 1, chg: 'pp', demo: [4.1, 'm', 0.05] },
  LRHUTTTTGBM156S: { label: 'UK unemployment', unit: 'pct', dp: 1, chg: 'pp', demo: [4.7, 'm', 0.1] },
  LRHUTTTTJPM156S: { label: 'Japan unemployment', unit: 'pct', dp: 1, chg: 'pp', demo: [2.4, 'm', 0.05] },
  LRHUTTTTAUM156S: { label: 'Australia unemployment', unit: 'pct', dp: 1, chg: 'pp', demo: [4.7, 'm', 0.1] },
  LRHUTTTTNZQ156S: { label: 'New Zealand unemployment', unit: 'pct', dp: 1, chg: 'pp', demo: [5.7, 'q', 0.15] },
  LRHUTTTTCHQ156S: { label: 'Switzerland unemployment', unit: 'pct', dp: 1, chg: 'pp', demo: [4.6, 'q', 0.1] },
  CPALTT01CAM659N: { label: 'Canada CPI (YoY)', unit: 'pct', dp: 1, chg: 'pp', demo: [2.4, 'm', 0.2] },
  CP0000EZ19M086NEST: { label: 'Euro area HICP (YoY)', unit: 'pct', dp: 1, chg: 'pp', tf: 'yoy', demo: [128.9, 'm', 0.2, 0.2] },
  CPALTT01DEM659N: { label: 'Germany CPI (YoY)', unit: 'pct', dp: 1, chg: 'pp', demo: [2.0, 'm', 0.2] },
  CPALTT01GBM659N: { label: 'UK CPI (YoY)', unit: 'pct', dp: 1, chg: 'pp', demo: [3.6, 'm', 0.2] },
  CPALTT01JPM659N: { label: 'Japan CPI (YoY)', unit: 'pct', dp: 1, chg: 'pp', demo: [2.9, 'm', 0.2] },
  CPALTT01AUQ659N: { label: 'Australia CPI (YoY)', unit: 'pct', dp: 1, chg: 'pp', demo: [2.8, 'q', 0.25] },
  CPALTT01NZQ659N: { label: 'New Zealand CPI (YoY)', unit: 'pct', dp: 1, chg: 'pp', demo: [2.5, 'q', 0.25] },
  CPALTT01CHM659N: { label: 'Switzerland CPI (YoY)', unit: 'pct', dp: 1, chg: 'pp', demo: [0.3, 'm', 0.15] },
  IRSTCI01CAM156N: { label: 'Canada policy rate', unit: 'pct', chg: 'pp', demo: [2.27, 'm', 0.03] },
  ECBDFR: { label: 'ECB deposit rate', unit: 'pct', chg: 'pp', demo: [2.0, 'd', 0] },
  IUDSOIA: { label: 'UK SONIA', unit: 'pct', chg: 'pp', demo: [3.97, 'd', 0.004] },
  IRSTCI01GBM156N: { label: 'UK policy rate', unit: 'pct', chg: 'pp', demo: [4.0, 'm', 0.02] },
  IRSTCI01JPM156N: { label: 'Japan policy rate', unit: 'pct', chg: 'pp', demo: [1.23, 'm', 0.04] },
  IRSTCI01AUM156N: { label: 'Australia policy rate', unit: 'pct', chg: 'pp', demo: [4.6, 'm', 0.05] },
  IRSTCI01NZM156N: { label: 'New Zealand policy rate', unit: 'pct', chg: 'pp', demo: [3.25, 'm', 0.05] },
  IRSTCI01CHM156N: { label: 'Switzerland policy rate', unit: 'pct', chg: 'pp', demo: [-0.04, 'm', 0.02] },
  // ---- New York Fed primary dealer positions ($B) ----
  'PDPOSGST-TOT': { src: 'pd', cat: 'Treasuries', label: 'Treasury Total Net', unit: 'usdB', demo: [456, 'w', 9] },
  'PDPOSGS-B': { src: 'pd', cat: 'Treasuries', label: 'Treasury Bills', unit: 'usdB', demo: [97, 'w', 4] },
  'PDPOSGSC-L2': { src: 'pd', cat: 'Treasuries', label: 'Coupons ≤ 2Y', unit: 'usdB', demo: [72, 'w', 4] },
  'PDPOSGSC-G2L3': { src: 'pd', cat: 'Treasuries', label: 'Coupons 2Y–3Y', unit: 'usdB', demo: [41, 'w', 3] },
  'PDPOSGSC-G3L6': { src: 'pd', cat: 'Treasuries', label: 'Coupons 3Y–6Y', unit: 'usdB', demo: [88, 'w', 4] },
  'PDPOSGSC-G6L7': { src: 'pd', cat: 'Treasuries', label: 'Coupons 6Y–7Y', unit: 'usdB', demo: [19, 'w', 2] },
  'PDPOSGSC-G7L11': { src: 'pd', cat: 'Treasuries', label: 'Coupons 7Y–11Y', unit: 'usdB', demo: [37, 'w', 3] },
  'PDPOSGSC-G11L21': { src: 'pd', cat: 'Treasuries', label: 'Coupons 11Y–21Y', unit: 'usdB', demo: [24, 'w', 2] },
  'PDPOSGSC-G21': { src: 'pd', cat: 'Treasuries', label: 'Coupons > 21Y', unit: 'usdB', demo: [29, 'w', 2] },
  'PDPOSGS-BFRN': { src: 'pd', cat: 'Treasuries', label: 'Floating Rate Notes', unit: 'usdB', demo: [6, 'w', 1] },
  'PDPOSTIPS-G6L11': { src: 'pd', cat: 'TIPS', label: 'TIPS 6Y–11Y', unit: 'usdB', demo: [3, 'w', 0.5] },
  'PDPOSMBS-TOT': { src: 'pd', cat: 'Agency MBS', label: 'Agency MBS Total', unit: 'usdB', demo: [108, 'w', 4] },
  'PDPOSFGS-C': { src: 'pd', cat: 'Agency', label: 'Agency Coupons (ex-MBS)', unit: 'usdB', demo: [9, 'w', 1] },
  'PDPOSCS-TOT': { src: 'pd', cat: 'Corporate', label: 'Corporate Total', unit: 'usdB', demo: [19, 'w', 2] },
  'PDPOSCSCP': { src: 'pd', cat: 'Corporate', label: 'Commercial Paper', unit: 'usdB', demo: [6, 'w', 1] },
  'PDPOSABS-TOT': { src: 'pd', cat: 'ABS', label: 'Asset-Backed Total', unit: 'usdB', demo: [8, 'w', 0.8] },
  'PDPOSSMGO-TOT': { src: 'pd', cat: 'Munis', label: 'State & Municipal Total', unit: 'usdB', demo: [11, 'w', 0.8] },
};

/** The pages built from these series: groups of cards. */
export const SERIES_PAGES = {
  rates: {
    title: 'Fixed Income & Rates', src: 'FRED', refresh: 'Daily',
    desc: 'Treasury yields along the curve, the curve’s slope, real yields and the inflation the bond market is pricing.',
    groups: [
      { title: 'Treasury yields', ids: ['DGS3MO', 'DGS1', 'DGS2', 'DGS5', 'DGS10', 'DGS20', 'DGS30'] },
      { title: 'Curve', ids: ['T10Y2Y', 'T10Y3M', 'MORTGAGE30US'] },
      { title: 'Real yields (TIPS)', ids: ['DFII5', 'DFII10', 'DFII30'] },
      { title: 'Inflation priced in', ids: ['T5YIE', 'T10YIE', 'T5YIFR'] },
    ],
    curve: true,
  },
  monetary: {
    title: 'Monetary Policy', src: 'FRED', refresh: 'Mixed',
    desc: 'The Fed’s balance sheet, the plumbing that moves liquidity in and out of markets, the money supply and policy rates.',
    groups: [
      { title: 'Policy rates', ids: ['DFEDTARU', 'DFF', 'SOFR'] },
      { title: 'Balance sheet & liquidity', ids: ['NETLIQ', 'WALCL', 'WRESBAL', 'RRPONTSYD', 'WTREGEN'] },
      { title: 'Money supply', ids: ['BOGMBASE', 'M1SL', 'M2SL', 'M2V'] },
    ],
  },
  dealers: {
    title: 'Primary Dealer Statistics', src: 'NY Fed', refresh: 'Weekly · Thu', pd: true,
    desc: 'Net positions of the primary dealers — the banks that make markets in Treasuries — across Treasuries, TIPS, agency MBS, corporates, ABS and munis. Released Thursdays at 4:15 PM ET, about a week behind.',
    groups: [
      { title: 'Treasuries', ids: ['PDPOSGST-TOT', 'PDPOSGS-B', 'PDPOSGSC-L2', 'PDPOSGSC-G2L3', 'PDPOSGSC-G3L6', 'PDPOSGSC-G6L7', 'PDPOSGSC-G7L11', 'PDPOSGSC-G11L21', 'PDPOSGSC-G21', 'PDPOSGS-BFRN'] },
      { title: 'TIPS, agencies & MBS', ids: ['PDPOSTIPS-G6L11', 'PDPOSFGS-C', 'PDPOSMBS-TOT'] },
      { title: 'Credit', ids: ['PDPOSCS-TOT', 'PDPOSCSCP', 'PDPOSABS-TOT', 'PDPOSSMGO-TOT'] },
    ],
  },
  credit: {
    title: 'Credit & Markets', src: 'FRED', refresh: 'Mixed',
    desc: 'Credit spreads, stress and financial-conditions gauges, bank lending and delinquencies, and the markets that react first.',
    groups: [
      { title: 'Credit spreads', ids: ['BAMLH0A0HYM2', 'BAMLC0A0CM', 'BAMLH0A3HYC'] },
      { title: 'Stress & conditions', ids: ['STLFSI4', 'NFCI', 'ANFCI', 'VIXCLS'] },
      { title: 'Banks', ids: ['TOTLL', 'DPSACBW027SBOG', 'CCLACBW027SBOG'] },
      { title: 'Delinquencies', ids: ['DRBLACBS', 'DRSFRMACBS', 'DRCCLACBS'] },
      { title: 'Markets', ids: ['SP500', 'NASDAQCOM', 'DJIA', 'DCOILWTICO', 'DCOILBRENTEU', 'DHHNGSP', 'PCOPPUSDM', 'DTWEXBGS', 'DTWEXEMEGS'] },
    ],
  },
  economy: {
    title: 'Economy & Labor', src: 'FRED', refresh: 'Monthly',
    desc: 'Jobs, growth, the consumer and housing — the data the Fed and the market trade on.',
    groups: [
      { title: 'Labor market', ids: ['UNRATE', 'U6RATE', 'PAYEMS', 'ICSA', 'CCSA', 'UNEMPLOY', 'CES0500000003', 'JTSJOL', 'JTSQUR', 'JTSLDR'] },
      { title: 'Growth & activity', ids: ['A191RL1Q225SBEA', 'GDPC1', 'CFNAI', 'INDPRO', 'DGORDER', 'RECPROUSM156N'] },
      { title: 'Consumer', ids: ['RSAFS', 'UMCSENT', 'PSAVERT'] },
      { title: 'Housing', ids: ['CSUSHPISA', 'HOUST', 'PERMIT'] },
    ],
  },
  inflation: {
    title: 'Inflation', src: 'FRED', refresh: 'Monthly',
    desc: 'Consumer and producer prices, the sticky parts, and what households and markets expect next. Year-on-year unless noted.',
    groups: [
      { title: 'Consumer prices', ids: ['CPIAUCSL', 'CPILFESL', 'PCEPI', 'PCEPILFE', 'CORESTICKM159SFRBATL', 'CUSR0000SAH1'] },
      { title: 'Pipeline', ids: ['PPIFIS', 'PPIACO', 'IR'] },
      { title: 'Expectations', ids: ['MICH', 'EXPINF1YR', 'EXPINF10YR', 'T5YIE', 'T5YIFR'] },
    ],
    target: 2,
  },
  international: {
    title: 'International', src: 'FRED', refresh: 'Mixed',
    desc: 'Foreign 10-year government yields (OECD via FRED, monthly) and the dollar against the majors (daily).',
    groups: [
      { title: '10-year government yields', ids: ['DGS10', 'IRLTLT01DEM156N', 'IRLTLT01FRM156N', 'IRLTLT01ITM156N', 'IRLTLT01EZM156N', 'IRLTLT01GBM156N', 'IRLTLT01JPM156N', 'IRLTLT01CAM156N', 'IRLTLT01AUM156N'] },
      { title: 'Currencies', ids: ['DEXUSEU', 'DEXUSUK', 'DEXJPUS', 'DEXSZUS', 'DEXCAUS', 'DEXUSAL', 'DEXUSNZ', 'DEXCHUS', 'DEXMXUS', 'DTWEXAFEGS'] },
    ],
  },
};

/** Groups for picking a series in the Comparator and Watch List. */
export const PICK_GROUPS = [
  { title: 'Rates', ids: ['DGS2', 'DGS10', 'DGS30', 'T10Y2Y', 'DFII10', 'T10YIE', 'DFF', 'MORTGAGE30US'] },
  { title: 'Equities', ids: ['SP500', 'NASDAQCOM', 'NASDAQ100', 'DJIA'] },
  { title: 'Credit & volatility', ids: ['BAMLH0A0HYM2', 'BAMLC0A0CM', 'VIXCLS', 'STLFSI4', 'NFCI'] },
  { title: 'FX & dollar', ids: ['DTWEXBGS', 'DEXUSEU', 'DEXUSUK', 'DEXJPUS', 'DEXCAUS', 'DEXUSAL'] },
  { title: 'Liquidity', ids: ['NETLIQ', 'WALCL', 'M2SL', 'RRPONTSYD', 'WTREGEN', 'WRESBAL'] },
  { title: 'Inflation', ids: ['CPIAUCSL', 'CPILFESL', 'PCEPILFE', 'PPIFIS', 'MICH'] },
  { title: 'Economy', ids: ['UNRATE', 'PAYEMS', 'ICSA', 'CFNAI', 'INDPRO', 'RSAFS', 'UMCSENT'] },
  { title: 'Commodities', ids: ['DCOILWTICO', 'DCOILBRENTEU', 'DHHNGSP', 'PCOPPUSDM'] },
];

export const RANGES = [
  { value: '3M', label: '3M', days: 92 }, { value: '6M', label: '6M', days: 183 }, { value: '1Y', label: '1Y', days: 366 },
  { value: '2Y', label: '2Y', days: 731 }, { value: '5Y', label: '5Y', days: 1827 }, { value: '10Y', label: '10Y', days: 3653 }, { value: 'MAX', label: 'MAX', days: 0 },
];
export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
export const rangeFrom = (r, now = Date.now()) => { const d = RANGES.find((x) => x.value === r)?.days; return d ? isoDay(now - d * DAY) : null; };

export const seriesDef = (id) => SERIES[id] || (id.startsWith('cot:') ? { label: id.slice(4), unit: 'num', dp: 0 } : { label: id, unit: 'num', dp: 2 });

// ---------- maths ----------
/** value on or before a date (obs sorted ascending) */
export function valueAt(obs, date) {
  let lo = 0, hi = obs.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (obs[m][0] <= date) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans < 0 ? null : obs[ans][1];
}
const shiftDay = (date, days) => isoDay(Date.parse(`${date}T00:00:00Z`) + days * DAY);

/** apply a series' scale and transform to raw [[date, value]] */
export function transform(def, raw) {
  if (!raw?.length) return [];
  const s = def.scale || 1;
  let obs = s === 1 ? raw : raw.map(([d, v]) => [d, v * s]);
  if (def.tf === 'yoy') {
    obs = obs.map(([d, v]) => { const p = valueAt(obs, shiftDay(d, -365)); return p ? [d, (v / p - 1) * 100] : null; }).filter((r) => r && Date.parse(r[0]) - Date.parse(obs[0][0]) >= 360 * DAY);
  } else if (def.tf === 'diff') {
    obs = obs.slice(1).map(([d, v], i) => [d, v - obs[i][1]]);
  }
  return obs;
}

/** combine several series with fn on each date of the first (others as of that date) */
export function derive(fn, lists) {
  const [first, ...rest] = lists;
  if (!first?.length || rest.some((l) => !l?.length)) return [];
  return first.map(([d, v]) => { const o = rest.map((l) => valueAt(l, d)); return o.some((x) => x == null) ? null : [d, fn(v, ...o)]; }).filter(Boolean);
}

/** median days between observations → 'd' | 'w' | 'm' | 'q' */
export function freqOf(obs) {
  if (!obs || obs.length < 3) return 'd';
  const tail = obs.slice(-8);
  const gaps = tail.slice(1).map((r, i) => (Date.parse(r[0]) - Date.parse(tail[i][0])) / DAY).sort((a, b) => a - b);
  const g = gaps[Math.floor(gaps.length / 2)];
  return g <= 3 ? 'd' : g <= 9 ? 'w' : g <= 40 ? 'm' : 'q';
}
export const FREQ_LABEL = { d: 'Daily', w: 'Weekly', m: 'Monthly', q: 'Quarterly' };

/** latest value, the change over the natural window (1 month for daily/weekly series, the previous print otherwise) */
export function stats(obs) {
  if (!obs?.length) return null;
  const [date, v] = obs[obs.length - 1];
  const f = freqOf(obs);
  let prev, window;
  if (f === 'd' || f === 'w') { prev = valueAt(obs, shiftDay(date, f === 'w' ? -28 : -30)); window = f === 'w' ? '4W' : '1M'; } else { prev = obs.length > 1 ? obs[obs.length - 2][1] : null; window = 'prev'; }
  const yearAgo = shiftDay(date, -365);
  const yr = obs.filter((r) => r[0] >= yearAgo).map((r) => r[1]);
  const lo = Math.min(...yr), hi = Math.max(...yr);
  return { date, v, prev, chg: prev == null ? null : v - prev, window, freq: f, lo, hi, pos: hi > lo ? (v - lo) / (hi - lo) : 0.5 };
}

// ---------- formatting ----------
const nf = (n, dp) => n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export function fmtValue(def, v, { sign = false } = {}) {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const out = fmtAbs(def, a);
  const zero = !/[1-9]/.test(out);
  const sg = zero ? '' : (sign || def.sign) && v > 0 ? '+' : v < 0 ? '−' : '';
  return sg + out;
}
function fmtAbs(def, a) {
  const sg = '';
  switch (def.unit) {
    case 'pct': return `${sg}${nf(a, def.dp ?? 2)}%`;
    case 'usdB': return `${sg}$${nf(a, a < 10 ? 1 : 0)}B`;
    case 'usd': return `${sg}$${nf(a, def.dp ?? 2)}`;
    case 'k': return `${sg}${nf(a, 0)}K`;
    default: return `${sg}${nf(a, def.dp ?? 2)}`;
  }
}
export function fmtChange(def, d) {
  if (d == null || !Number.isFinite(d)) return '—';
  if (def.chg === 'bps') { const b = Math.round(d * 100); return `${b > 0 ? '+' : b < 0 ? '−' : '+'}${Math.abs(b)} bps`; }
  if (def.chg === 'pp') { const dp = def.dp ?? 2, r = Math.round(d * 10 ** dp) / 10 ** dp; return `${r < 0 ? '−' : '+'}${nf(Math.abs(r), dp)}%`; }
  return fmtValue({ ...def, sign: true }, d, { sign: true }).replace(/^(?=[\d$])/, '+');
}
/** axis tick: short form */
export function fmtTick(def, v) {
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v);
  if (def.unit === 'pct') return `${v.toFixed(a < 10 ? 2 : 1)}%`;
  if (def.unit === 'usdB') return a >= 1000 ? `$${(v / 1000).toFixed(1)}T` : `$${v.toFixed(0)}B`;
  if (def.unit === 'k') return a >= 1000 ? `${(v / 1000).toFixed(1)}M` : `${v.toFixed(0)}K`;
  if (def.unit === 'usd') return `$${v.toFixed(a < 10 ? 2 : a < 100 ? 1 : 0)}`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(a < 10 ? (def.dp ?? 2) : a < 100 ? 1 : 0);
}

// ---------- loading ----------
/** all raw ids a list of (possibly derived) ids needs */
export function rawIds(ids) {
  const out = new Set();
  for (const id of ids) { const d = SERIES[id]; if (d?.derive) d.derive.forEach((x) => out.add(x)); else out.add(id); }
  return [...out];
}

// ---------- correlation ----------
/** align series on their common dates → returns per series (log returns, or plain differences for series that can be ≤ 0) */
export function alignedReturns(lists) {
  const maps = lists.map((obs) => new Map((obs || []).map(([d, v]) => [d, v])));
  const dates = [...(maps[0]?.keys() || [])].filter((d) => maps.every((m) => m.has(d))).sort();
  const rets = maps.map((m) => {
    const pos = dates.every((d) => m.get(d) > 0);
    return dates.slice(1).map((d, i) => (pos ? Math.log(m.get(d) / m.get(dates[i])) : m.get(d) - m.get(dates[i])));
  });
  return { dates: dates.slice(1), rets };
}
export function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  let ma = 0, mb = 0;
  for (let k = 0; k < n; k++) { ma += a[k]; mb += b[k]; }
  ma /= n; mb /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < n; k++) { const x = a[k] - ma, y = b[k] - mb; sxy += x * y; sxx += x * x; syy += y * y; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}
/** Pearson correlation of daily returns over the last `n` common days */
export function correlationMatrix(lists, n) {
  const { dates, rets } = alignedReturns(lists);
  const tail = rets.map((r) => r.slice(-n));
  const m = tail.map((ri, i) => tail.map((rj, j) => (i === j ? 1 : pearson(ri, rj))));
  return { m, n: tail[0]?.length || 0, end: dates[dates.length - 1] || null };
}
/** rolling correlation of two series' returns: [[date, r], …] */
export function rollingCorrelation(a, b, n) {
  const { dates, rets: [ra, rb] } = alignedReturns([a, b]);
  const out = [];
  for (let k = n; k <= dates.length; k++) out.push([dates[k - 1], pearson(ra.slice(k - n, k), rb.slice(k - n, k))]);
  return out;
}

// which way is "better" for colouring changes (others stay neutral)
const GOOD_UP = new Set(['SP500', 'NASDAQCOM', 'NASDAQ100', 'DJIA', 'PAYEMS', 'JTSJOL', 'GDPC1', 'A191RL1Q225SBEA', 'INDPRO', 'DGORDER', 'RSAFS', 'HOUST', 'PERMIT', 'UMCSENT', 'CFNAI', 'NETLIQ', 'WRESBAL', 'TOTLL', 'PCOPPUSDM']);
const GOOD_DOWN = new Set(['BAMLH0A0HYM2', 'BAMLC0A0CM', 'BAMLH0A3HYC', 'VIXCLS', 'STLFSI4', 'NFCI', 'ANFCI', 'UNRATE', 'U6RATE', 'ICSA', 'CCSA', 'UNEMPLOY', 'JTSLDR', 'DRBLACBS', 'DRSFRMACBS', 'DRCCLACBS', 'RECPROUSM156N', 'CPIAUCSL', 'CPILFESL', 'PCEPI', 'PCEPILFE', 'PPIFIS', 'PPIACO', 'CORESTICKM159SFRBATL', 'CUSR0000SAH1', 'MICH', 'EXPINF1YR']);
/** 'pos' | 'neg' | '' for a change in a series */
export const toneOf = (id, d) => (!d || !Number.isFinite(d) || (SERIES[id]?.chg === 'pp' && Math.abs(d) < 0.5 * 10 ** -(SERIES[id].dp ?? 2)) ? '' : GOOD_UP.has(id) ? (d > 0 ? 'pos' : 'neg') : GOOD_DOWN.has(id) ? (d < 0 ? 'pos' : 'neg') : '');
