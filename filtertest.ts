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
];
let bad = 0;
for (const [t, want] of cases) {
  const c = m.classify(it(t));
  const skipped = c.skip || !!m.noiseReason(t, c.highAlert, Date.now() + Math.random() * 1e9);
  if (skipped !== want) { bad++; console.log("FAIL", want ? "should skip" : "should pass", "|", t); }
}
console.log(bad ? `${bad} failures` : "all filter cases OK"); if (bad) process.exit(1);
