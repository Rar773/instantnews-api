process.env.NO_START = "1";
const m = await import("./index.tsx");
const it = (title: string) => ({ title, content: "", pubDate: Date.now(), id: title } as any);
const cases: [string, boolean][] = [
  ["BMO expects Bank of Canada to hike in December.", true],
  ["CIBC expects the Bank of Canada to hike in December.", true],
  ["Nomura: We see the BOC to hike in December, previous forecast was January.", true],
  ["BoC's Gov. Macklem press conference ends.", true],
  ["Goldman expects Fed to cut in December.", false],
  ["BoC December rate hike chances rise to 80% from 65% after Macklem remarks, swap market data", false],
  ["Bank of Canada rate decision: raises rates to 2.50%", false],
  ["BoC's Gov. Macklem: We expect a solid Q3.", false],
  ["Powell press conference ends", false],
  ["Nvidia expects record revenue $NVDA", false],
  ["IRGC Navy: A fourth oil tanker exploded after striking a sea mine", false],
  ["Peru’s Economy Ministry Revises 2026 Growth Outlook Downward to 3.1% From 3.4%", true],
  ["Peru Narrows 2026 Fiscal Deficit Forecast by 0.6 Percentage Points to 1.2% of GDP", true],
  ["China’s Benchmark Coking Coal Contract Rallies Over 3%", true],
  ["Most Active China Coke Futures Jump 4.1% to 2,043 Yuan Per Metric Ton, Highest Since Octob", true],
  ["Shenzhou-24 Crew Successfully Boards Tiangong Space Station, Chinese Media Says", true],
  ["Bank of China’s Proposed Luxembourg Branch MTN Notes Receive ‘A(EXP)’ Rating From Fitch", true],
  ["Fitch Ratings Highlights Strong Economic Conditions as a Key Support for Vietnam's Major B", true],
  ["Fitch downgrades United States credit rating to AA", false],
  ["Fitch downgrades France to A+", false],
  ["Coca-Cola (Coke) beats earnings estimates $KO", false],
  ["Oil Futures Decline, With Brent and U.S. Crude Both Down Over $1", false],
  ["China Iron Ore Futures Plunge as Beijing Announces Steel Output Curbs", false],
  ["Taiwanese Equities Extend Losses, Falling Over 8%", false],
  ["U.S. Stock Futures Decline, With Nasdaq Down 1.1% and S&P 500 Off 0.6%", false],
  ["Peru imposes sanctions on Venezuela", false],
];
let bad = 0;
for (const [t, want] of cases) {
  const c = m.classify(it(t));
  const skipped = c.skip || !!m.noiseReason(t, c.highAlert, Date.now() + Math.random() * 1e9);
  if (skipped !== want) { bad++; console.log("FAIL", want ? "should skip" : "should pass", "|", t); }
}
console.log(bad ? `${bad} failures` : "all filter cases OK"); if (bad) process.exit(1);
