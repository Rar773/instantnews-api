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
  ["GERMANY'S MERZ ON BUDGET NEGOTIATIONS: NO CALCULATOR CAN WORK OUT ABSOLUTE FAIRNESS", true],
  ["Merz says 2027 budget is far from solving all problems, but course change has begun", true],
  ["GERMANY'S MERZ ON EUROPEAN BUDGET NEGOTIATIONS: IF THE IMPRESSION AROSE THAT I THINK WE SPEND TOO MUCH", true],
  ["GERMAN CHANCELLOR MERZ SAYS RUSSIA IS ESCALATING, EUROPE MUST SHOW RUSSIA ITS LIMITS", false],
  ["Merz says EU will respond to US tariffs on cars", false],
  ["Starmer: UK budget will include cuts to spending", false],
  ["Merz says Germany wants closer ties with the US", false],
  ["Merz says budget talks will continue with us next week", true],
  ["Macron calls snap election after budget defeat, French bonds slide", false],
  ["Xi, Pakistan's President Mark Joint Astronaut Mission With Messages of Congratulations", true],
  ["XI SAYS CHINA-PAKISTAN ASTRONAUT MISSION REFLECTS LONG-STANDING TIES", true],
  ["Xi Pledges Stronger Space Ties With Pakistan and Other Countries", true],
  ["QatarEnergy Partners With JBIC to Strengthen Japan-Qatar Energy Ties Through New MoU", true],
  ["QATARENERGY AND PARTNERS EXPLORE POTENTIAL JOINT PROJECTS ACROSS ENERGY", true],
  ["QatarEnergy declares force majeure on LNG shipments after attack", false],
  ["QatarEnergy halts LNG production at Ras Laffan", false],
  ["SpaceX valuation hits $800 billion in tender offer", false],
  ["Xi: China and the US to open new chapter of trade talks", false],
  ["Amazon: used cars from dealers to be offered at launch of Amazon Autos", false],
];
let bad = 0;
for (const [t, want] of cases) {
  const c = m.classify(it(t));
  const skipped = c.skip || !!m.noiseReason(t, c.highAlert, Date.now() + Math.random() * 1e9);
  if (skipped !== want) { bad++; console.log("FAIL", want ? "should skip" : "should pass", "|", t); }
}
// speaker cap: Mag 7 never capped, other speakers still capped after SPEAKER_CAP quotes/h
const t0 = Date.now() + 5e10;
for (let i = 0; i < 4; i++) if (m.noiseReason(`Amazon: Autos detail ${i}`, false, t0 + i)) { bad++; console.log("FAIL Mag7 speaker capped", i); }
const capped = [0, 1, 2, 3].map((i) => m.noiseReason(`Lagarde: remark ${i}`, false, t0 + i));
if (!capped[3]) { bad++; console.log("FAIL non-Mag7 speaker cap no longer works"); }
// channel handle tags are removed from reposted text
for (const [raw, want] of [["MERZ SAYS RUSSIA WANTS MORE THAN UKRAINE (@FirstSquaw)", "MERZ SAYS RUSSIA WANTS MORE THAN UKRAINE"], ["NVDA UP 3%\n(@FirstSquaw)", "NVDA UP 3%"], ["CONTACT fed@x.com FOR DETAILS", "CONTACT fed@x.com FOR DETAILS"]] as const)
  if (m.cleanChannelText(raw).text !== want) { bad++; console.log("FAIL handle strip |", raw); }
// foreign leader barrage: max SPEAKER_CAP non-war lines per hour, war/trade lines always pass
const t1 = Date.now() + 9e10;
const lead = [0, 1, 2].map((i) => m.noiseReason(`MERZ SAYS EUROPE IS OUR WIDER CULTURAL HOME PART ${i}`, false, t1 + i));
if (!lead[2] || lead[0] || lead[1]) { bad++; console.log("FAIL leader cap", lead); }
if (m.noiseReason("MERZ SAYS RUSSIA IS ESCALATING AGAIN", false, t1 + 5)) { bad++; console.log("FAIL leader war line capped"); }
console.log(bad ? `${bad} failures` : "all filter cases OK"); if (bad) process.exit(1);
