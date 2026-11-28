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
  ["LME aluminum alloy inventory unchanged at 1,500 tons", true],
  ["LME Nickel Stocks Hold Steady at 275,604 Tons", true],
  ["LME COPPER STOCKS DROP 1,075 TONS TO 336,750 TONS", true],
  ["LME ZINC INVENTORY UP 25 TONS TO 143,450 TONS", true],
  ["LME copper prices hit record high above $12,000", false],
  ["LME suspends nickel trading after price surge", false],
  ["NVIDIA SHARES SLIP 4.3% PREMARKET AFTER 5.9% DROP IN LAST SESSION", false],
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
  ["Ofcom Seeks Views on Faster Takedowns of Intimate Image Abuse Online", true],
  ["Ofcom fines X £18 million over online safety failures", false],
  ["Ofcom opens investigation into TikTok", false],
  ["Amazon: used cars from dealers to be offered at launch of Amazon Autos", false],
  ["WH Sr. Adviser Hassett's interview on Fox Business ends.", true],
  ["Russia's inflation rate for the week of November 17 to 23 reached 0.3%, with prices rising 6.1% since the start of the year", true],
  ["Russian central bank cuts key rate to 15% as inflation slows", false],
  ["Russian oil output falls 2% in October", false],
  ["Russia launches massive drone attack on Kyiv", false],
  ["Powell's interview with CBS ends", false],
  ["Hassett: interview with Fox to be aired tonight", false],
  // Russian domestic business news is noise; war, sanctions, energy, CBR, Putin and US angles still pass
  ["🇷🇺 Levan Nazarov, founder of the fintech group \"Balance-Platform,\" has consolidated a single stake", true],
  ["Russia-Kazakhstan trade nears $30 billion, 96% in national currencies", true],
  ["🇷🇺 MGKL Climbs 12% Amid New Defaults", false], // matches HIGH_ALERT_RE -> never filtered, only not an ALERT
  ["Russia warns NATO over Baltic exercises", false],
  ["Russia expels two diplomats", false],
  ["Russian Diesel Exports Hit Highest Level Since June", false],
  ["Lukoil International is set to be fully acquired by the Boeli consortium", false],
  ["🇷🇺 Putin says Russia is ready to meet Trump", false],
  ["Russia and US agree on new round of peace talks", false],
  ["Russian central bank holds key rate at 16%", false],
  ["🇷🇺 Sberbank hit by new EU sanctions", false],
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
// Fed lines are never speaker-capped; other lines from the same speaker still are
const t2 = Date.now() + 7e10;
const hs = ["WH Sr. Adviser Hassett: Oil heading back to pre-war levels.", "WH Sr. Adviser Hassett: The fundamentals are very strong.", "WH Sr. Adviser Hassett: We expect Warsh, and the Fed will be data-driven.", "WH Sr. Adviser Hassett: We're in a Goldilocks economy."].map((t, i) => m.noiseReason(t, false, t2 + i));
if (hs[2] || !hs[3]) { bad++; console.log("FAIL Fed line speaker cap", hs); }
// Kim Jong Un nuclear-status rhetoric is no HIGH ALERT (and gets speaker-capped); actual nuclear use/launch/tests/threats still are
for (const [t, want] of [["North Korea's Kim Jong Un: North Korea's status as a nuclear weapons state is absolutely irreversible", false], ["North Korea's Kim Jong Un: Nuclear weapons sector should focus on deploying tactical nuclear weapons", false], ["Russia threatens to use nuclear weapons against NATO", true], ["North Korea launches nuclear weapon test", true], ["North Korea conducts nuclear test", true], ["Russia fires tactical nuclear weapon at Ukraine", true], ["Iran warns of nuclear strike", true]] as const)
  if (m.classify(it(t)).highAlert !== want) { bad++; console.log("FAIL nuclear highAlert", want, "|", t); }
const t3 = Date.now() + 8e10;
const kim = ["North Korea's Kim Jong Un: Hostile forces' efforts will intensify", "North Korea's Kim Jong Un: Nuclear material production capacity is being expanded", "North Korea's Kim Jong Un: North Korea's status as a nuclear weapons state is absolutely irreversible"].map((t, i) => m.noiseReason(t, m.classify(it(t)).highAlert, t3 + i));
if (!kim[2] || kim[0] || kim[1]) { bad++; console.log("FAIL Kim speaker cap", kim); }
// a channel's 🚨 only makes a HIGH ALERT for market-moving headlines
for (const [t, want] of [["Russia's inflation rate for the week of November 17 to 23 reached 0.3%", false], ["Peru's central bank keeps outlook unchanged", false], ["Nasdaq 100 enters bear market", true], ["Iran says tanker hit a mine in Hormuz", true], ["Nvidia shares fall 8%", true], ["US 10-year yield jumps 15 bp", true], ["ECB raises rates by 25bp", true]] as const)
  if (m.alertWorthy(t) !== want) { bad++; console.log("FAIL alertWorthy", want, "|", t); }
for (const [t, want] of [["🇷🇺 MGKL Climbs 12% Amid New Defaults", false], ["Headline: US Natural Gas Supplies Fall 24 BCF, Worse Than Expected", false], ["Russia declares war on Moldova", true], ["Russian missile strike hits Kyiv", true], ["US crude inventories fall 5M barrels, oil jumps", true], ["Coreweave Banks Prepare $4.5 Billion Loan Sale as Default Fears Surge $CRWV", true], ["Argentina defaults on bonds", true]] as const)
  if (m.alertWorthy(t) !== want) { bad++; console.log("FAIL alertWorthy", want, "|", t); }
if (m.classify(it("🇷🇺 MGKL Climbs 12% Amid New Defaults")).highAlert || !m.classify(it("Argentina defaults on bonds")).highAlert) { bad++; console.log("FAIL classify Russia-local alert"); }
// a leaders' meeting is not a HIGH ALERT on a channel's 🚨; Fed/OPEC meetings, strikes during talks, deals still are
for (const [t, want] of [["Trump, Rutte Meet on Ukraine War, Iran Conflict", false], ["Trump to meet Xi next week", false], ["Fed holds emergency meeting", true], ["OPEC+ meeting: members agree to cut output", true], ["Iran fires missiles at US base as Trump meets Netanyahu", true], ["Trump, Xi agree trade deal at meeting", true], ["Nvidia CEO meets Trump on chip curbs $NVDA", true]] as const)
  if (m.alertWorthy(t) !== want) { bad++; console.log("FAIL alertWorthy meeting", want, "|", t); }
// Aeroflot domestic news is Russia local; Aeroflot + sanctions/drones still passes. "Headline:" label removed.
if (m.noiseReason("Headline: Aeroflot to start selling subsidized 2027 airfare tickets December 1", false) !== "Russia local") { bad++; console.log("FAIL Aeroflot local"); }
if (m.noiseReason("US sanctions Aeroflot over Ukraine", false) || m.noiseReason("Drones force Aeroflot to halt Moscow flights", false)) { bad++; console.log("FAIL Aeroflot keep"); }
if (m.cleanChannelText("Headline: Aeroflot to start selling tickets").text !== "Aeroflot to start selling tickets" || m.cleanChannelText("Headline inflation rises 3%").text !== "Headline inflation rises 3%") { bad++; console.log("FAIL Headline label"); }
// a rewrite that shrinks to a stub ("Russia") is rejected; a normal shorter rewrite is kept
if (!m.rewriteTooShort("🇷🇺 Russia has extended its gasoline export ban until the end of the year", "", "Russia", "")) { bad++; console.log("FAIL stub rewrite"); }
if (!m.rewriteTooShort("Russia extends gasoline export ban", "The ban now runs until December 31 to keep domestic fuel prices stable after refinery outages.", "Russia extends", "")) { bad++; console.log("FAIL short rewrite"); }
if (m.rewriteTooShort("Trump Finds New Way to Impose Import Duties", "The USTR announced plans to introduce tariffs against 14 trading partners.", "Trump finds new route to import duties", "USTR plans tariffs on 14 trading partners.")) { bad++; console.log("FAIL normal rewrite rejected"); }
// same story worded with plural/singular differences is a duplicate; separate S&P follow-ups and outlet-only words still behave
{
  const T = Date.now() + 3e11;
  if (m.isDuplicateStory("S&P puts Nvidia 'AA' ratings on creditwatch negative", "feed", T)) { bad++; console.log("FAIL dup first"); }
  if (!m.isDuplicateStory("$NVDA: S&P Puts Nvidia's AA Rating on Watch for Possible Downgrade", "tg:WalterBloomberg", T + 150_000)) { bad++; console.log("FAIL dup plural"); }
  if (m.isDuplicateStory("S&P intend to meet with Nvidia’s board & management. $NVDA", "feed", T + 300_000)) { bad++; console.log("FAIL dup follow-up"); }
  if (m.isDuplicateStory("Fed's Waller says rate cuts remain on the table - Reuters", "feed", T + 1e9)) { bad++; console.log("FAIL dup reuters first"); }
  if (!m.isDuplicateStory("FED'S WALLER SAYS RATE CUTS REMAIN ON THE TABLE", "tg:FirstSquawk", T + 1e9 + 60_000)) { bad++; console.log("FAIL dup outlet word"); }
}
// channel handle tags are removed from reposted text
for (const [raw, want] of [["MERZ SAYS RUSSIA WANTS MORE THAN UKRAINE (@FirstSquaw)", "MERZ SAYS RUSSIA WANTS MORE THAN UKRAINE"], ["NVDA UP 3%\n(@FirstSquaw)", "NVDA UP 3%"], ["CONTACT fed@x.com FOR DETAILS", "CONTACT fed@x.com FOR DETAILS"]] as const)
  if (m.cleanChannelText(raw).text !== want) { bad++; console.log("FAIL handle strip |", raw); }
// outlet/source tags are removed, normal sentences stay intact
for (const [raw, want] of [
  ["South Korea seeks to expand stock stabilization fund - Chosun", "South Korea seeks to expand stock stabilization fund"],
  ["ECB policymakers see mrr decision in December or possibly early 2027 - Source", "ECB policymakers see mrr decision in December or possibly early 2027"],
  ["ECB debated raising the minimum reserve requirement - Sources familiar with the matter", "ECB debated raising the minimum reserve requirement"],
  ["Apple in talks to buy startup, Bloomberg reports", "Apple in talks to buy startup"],
  ["US weighs new chip curbs, according to Reuters", "US weighs new chip curbs"],
  ["Fed's Powell says officials are united on policy", "Fed's Powell says officials are united on policy"],
  ["Trump says Fox News treated him unfairly", "Trump says Fox News treated him unfairly"],
  ["Iran's self-appointed envoy meets Saudi officials", "Iran's self-appointed envoy meets Saudi officials"],
  ["Contact ir@reuters.com for details", "Contact ir@reuters.com for details"],
  ["US Officials tell Congress that there is no evidence that Huang's affair was a spy - WSJ. $NVDA", "US Officials tell Congress that there is no evidence that Huang's affair was a spy $NVDA"],
  ["USTR Greer on NVIDIA: The company is structurally important -CNBC Interview. $NVDA", "USTR Greer on NVIDIA: The company is structurally important $NVDA"],
  ["Iran claims an LNG carrier hit a mine in Hormuz - Mehr.", "Iran claims an LNG carrier hit a mine in Hormuz"],
  ["NVIDIA shares fall 8% $NVDA", "NVIDIA shares fall 8% $NVDA"],
  ["Apple and Microsoft rally $AAPL $MSFT", "Apple and Microsoft rally $AAPL $MSFT"],
  ["Mehr says Iran will retaliate", "Mehr says Iran will retaliate"],
  ["Several loud booms were heard in Riyadh - Witness.", "Several loud booms were heard in Riyadh"],
  ["Explosions heard near the port, witnesses say", "Explosions heard near the port"],
  ["Kushner: Israel needs to move away from a war mentality - Israel's Channel 12", "Kushner: Israel needs to move away from a war mentality"],
  ["Netanyahu to fly to Washington next week - Kan News", "Netanyahu to fly to Washington next week"],
  ["Witness says Iran fired missiles at the base", "Witness says Iran fired missiles at the base"],
  ["Israel's Channel 12 gets new owner", "Israel's Channel 12 gets new owner"],
  ["Nvidia pauses chip deliveries to South-east Asia: FT", "Nvidia pauses chip deliveries to South-east Asia"],
  ["Apple weighs China exit: Bloomberg News", "Apple weighs China exit"],
  ["Trump: Fox News treated me unfairly", "Trump: Fox News treated me unfairly"],
  ["Powell: Rates are in a good place", "Powell: Rates are in a good place"],
] as const) if (m.stripAttribution(raw) !== want) { bad++; console.log("FAIL source strip |", raw, "->", m.stripAttribution(raw)); }
// foreign leader barrage: max SPEAKER_CAP non-war lines per hour, war/trade lines always pass
const t1 = Date.now() + 9e10;
const lead = [0, 1, 2].map((i) => m.noiseReason(`MERZ SAYS EUROPE IS OUR WIDER CULTURAL HOME PART ${i}`, false, t1 + i));
if (!lead[2] || lead[0] || lead[1]) { bad++; console.log("FAIL leader cap", lead); }
if (m.noiseReason("MERZ SAYS RUSSIA IS ESCALATING AGAIN", false, t1 + 5)) { bad++; console.log("FAIL leader war line capped"); }
// 26 Nov: Gref (Sberbank) is not Germany; Putin Q&A logistics skipped, his statements pass; BTC positioning is no HIGH ALERT; "Headline:" label from rewrite
if (m.noiseReason("🇷🇺🇰🇿 German Gref frequently visits Astana to meet with President Tokayev and discuss investment", false) !== "Russia local") { bad++; console.log("FAIL Gref local"); }
if (m.noiseReason("German Chancellor Merz warns Russia on Baltic drones", false, Date.now() + 8e10)) { bad++; console.log("FAIL German stays"); }
if (m.noiseReason("Kremlin Schedules Putin Live Q&A and Press Conference for December 10", false) !== "Putin Q&A logistics" || m.noiseReason("Questions for Putin to be accepted via VK, Odnoklassniki and Max chatbot", false) !== "Putin Q&A logistics") { bad++; console.log("FAIL Putin Q&A"); }
for (const t of ["Putin at press conference: Russia ready for ceasefire talks with Ukraine", "Putin says Russia will respond to US tariffs", "Putin: Russia to cut oil output"]) if (m.noiseReason(t, false, Date.now() + 7e10)) { bad++; console.log("FAIL Putin statement skipped |", t); }
if (m.alertWorthy("Large cluster of BTC short positions sits between $61,000 and $65,000")) { bad++; console.log("FAIL BTC positioning alert"); }
for (const t of ["Bitcoin plunges 8% to $58,000", "$1 billion of BTC shorts liquidated as bitcoin jumps above $65,000", "US stocks plunge as Fed hikes"]) if (!m.alertWorthy(t)) { bad++; console.log("FAIL alert lost |", t); }
if (m.stripLabel("Headline: Kremlin Schedules Putin Live Q&A") !== "Kremlin Schedules Putin Live Q&A" || m.stripLabel("**Headline:** Nvidia halts shipments") !== "Nvidia halts shipments" || m.stripLabel("Headline inflation rises 3%") !== "Headline inflation rises 3%") { bad++; console.log("FAIL stripLabel"); }
// 26 Nov (12:35): one foreign central bank max 3 lines/h (BoE report 8 lines, ECB accounts 8 lines); rate decisions, hikes, Nvidia, Fed still pass
{
  const T = Date.now() + 2e11;
  const boe = ["BoE: Households and firms resilient, banking system strong", "BoE to focus on pillar 2a charges for domestic lending", "BoE warns AI financing is \"increasingly complex, circular, opaque\"", "BoE maintains countercyclical buffer at 2%", "BoE Gov. Bailey: AI companies are right to be cautious about releasing the latest models", "BoE Gov. Bailey: AI markets are very concentrated; what has gone on at Nvidia is a matter of concern", "BoE Breeden: Need to push hard on boosting resilience of gilt repo market", "Bank of England rate decision: holds rates at 3.75%", "BoE's Greene: A rate hike may be needed", "BoE's Greene: Fed policy matters for UK"].map((x, i) => m.noiseReason(x, false, T + i));
  const want = [null, null, null, "central bank cap (boe)", "central bank cap (boe)", null, "central bank cap (boe)", null, null, null];
  if (JSON.stringify(boe) !== JSON.stringify(want)) { bad++; console.log("FAIL CB institution cap", boe); }
  const ecb = ["ECB: The direction of travel was clear", "ECB Accounts: Uncertainty remained high", "ECB officials agreed in October that the price outlook had worsened", "ECB officials questioned how long AI can support global growth", "ECB: A hike at the current meeting would simply frontload the necessary tightening"].map((x, i) => m.noiseReason(x, false, T + 100 + i));
  if (ecb[0] || ecb[1] || ecb[2] || !ecb[3] || ecb[4]) { bad++; console.log("FAIL ECB institution cap", ecb); }
  if (m.noiseReason("ECB officials saw no clear signs of second-round effects", false, T + 100 + 61 * 60_000)) { bad++; console.log("FAIL CB cap window"); }
  if (m.noiseReason("Lagarde: remark about Europe", false, T + 300) || m.noiseReason("Japan Senior Finance Ministry Official: We will assess bond issuance size", false, T + 301)) { bad++; console.log("FAIL CB cap too wide"); }
}
// "since the war began" is a time reference, not a HIGH ALERT; real war/oil news still alerts
if (m.alertWorthy("Qatar's LNG Exports Hit Highest Level Since US-Iran War Began")) { bad++; console.log("FAIL since-war alert"); }
for (const t of ["Oil hits highest since the Iran war began", "US strikes Iran as war widens", "Qatar halts LNG exports after Iran attack", "OPEC+ Weighs Holding Oil Output Steady Until January"]) if (!m.alertWorthy(t)) { bad++; console.log("FAIL alert lost |", t); }
// State Duma domestic bills are Russia local; Duma on Ukraine/US/sanctions still passes
if (m.noiseReason("State Duma Backs Bill to Speed Up Pre-Bankruptcy Rehabilitation", false) !== "Russia local") { bad++; console.log("FAIL Duma local"); }
for (const t of ["State Duma ratifies treaty on Ukraine ceasefire", "Duma approves retaliation against US sanctions"]) if (m.noiseReason(t, false, Date.now() + 6e10)) { bad++; console.log("FAIL Duma keep |", t); }
// 26 Nov (17:40): Truth Social / "- Official." / "- EU Diplomats." / leading "Al-Hadath reported that" are sources; normal text stays
{
  const sa: [string, string][] = [
    ["Trump: There's a strong chance Russia pulls back military aggression - Truth Social.", "Trump: There's a strong chance Russia pulls back military aggression"],
    ["The UK and EU haven't agreed on a penalty fee to leave the new deal - Official.", "The UK and EU haven't agreed on a penalty fee to leave the new deal"],
    ["EU leaders set to confirm backing for Spain's De Cos as next ECB president - EU Diplomats.", "EU leaders set to confirm backing for Spain's De Cos as next ECB president"],
    ["Al-Hadath reported that the US is working to arrange a meeting between Trump and Netanyahu", "The US is working to arrange a meeting between Trump and Netanyahu"],
    ["Trump posts on Truth Social: tariffs on EU start Monday", "Trump posts on Truth Social: tariffs on EU start Monday"],
    ["Fed officials say that rates will stay on hold", "Fed officials say that rates will stay on hold"],
    ["Iran expels EU diplomats after strikes", "Iran expels EU diplomats after strikes"],
    ["Senior US official to visit Kyiv next week", "Senior US official to visit Kyiv next week"],
    ["Contact news@instantnews.io for corrections", "Contact news@instantnews.io for corrections"],
  ];
  for (const [i, o] of sa) if (m.stripAttribution(i) !== o) { bad++; console.log("FAIL strip |", i, "->", m.stripAttribution(i)); }
}
// ECB accounts commentary is no HIGH ALERT; real rate decisions still are
if (m.classify(it("ECB officials: Transmission of rate hikes is working smoothly")).highAlert) { bad++; console.log("FAIL ECB accounts alert"); }
for (const t of ["ECB rate decision: raises rates to 2.50%", "BoE officials: emergency rate hike of 50bp", "Fed delivers surprise rate hike"]) if (!m.classify(it(t)).highAlert) { bad++; console.log("FAIL rate alert lost |", t); }
// Russian AI conference lines skipped; Putin on war/US/oil/chips still passes
for (const t of ["Putin Calls for Update to Russia's National AI Strategy", "Putin Warns AI Could Become a Dangerous Threat to Humanity", "🚀 Russia aims for the widespread implementation of artificial intelligence (AI) across all sectors"]) if (!/^Russia (AI|local)$/.test(m.noiseReason(t, false) || "")) { bad++; console.log("FAIL Russia AI |", t); }
for (const t of ["Putin: AI drones will be used in Ukraine war", "Putin says US AI chip curbs will backfire", "Russia bans Nvidia AI chips", "OpenAI to open office in Europe"]) if (m.noiseReason(t, false, Date.now() + 5e10)) { bad++; console.log("FAIL Russia AI too wide |", t); }
// 26 Nov (21:40): "budget cuts" from a foreign leader is budget talk; EU digital tax (hits US tech) and real cuts/war still pass
{
  const T = Date.now() + 7e10;
  if (m.noiseReason("France’s President Macron: EU budget cuts would be a strategic mistake.", false, T) !== "foreign budget talk") { bad++; console.log("FAIL budget cuts"); }
  if (m.noiseReason("France’s President Macron: France wants the EU digital tax to take effect in 2028", false, T + 1e9)) { bad++; console.log("FAIL digital tax cut"); }
  if (m.noiseReason("Starmer: budget cuts tariffs on US imports", false, T + 2e9)) { bad++; console.log("FAIL budget tariffs cut"); }
  if (m.noiseReason("Meloni: Italy will cut taxes", false, T + 3e9)) { bad++; console.log("FAIL leader cut lost"); }
  if (m.noiseReason("📈 AFK Sistema reported a 5.1% increase in revenue for the third quarter, reaching 373.3 billion rubles", false, T) !== "Russia local") { bad++; console.log("FAIL AFK Sistema"); }
  if (m.noiseReason("AFK Sistema hit by new US sanctions", false, T + 4e9)) { bad++; console.log("FAIL AFK Sistema sanctions"); }
}
// 27 Nov (01:40): Tokyo CPI is Japanese data; Saudi all-clear notices are noise. Tokyo geopolitics, the threat warning and US CPI still pass
for (const t of ["Tokyo Core CPI YoY Actual 2.9% (Forecast 2.9%, Previous 2.6%)", "Tokyo CPI Overall Actual 2.8% (Forecast 3.1%, Previous 2.8%)", "Saudi civil defence: danger has passed in Abha city"]) if (!m.classify(it(t)).skip) { bad++; console.log("FAIL not skipped |", t); }
for (const t of ["Saudi Arabia issues warning of potential threat in Abha city", "Tokyo says China fired missiles near Japanese waters", "US CPI YoY Actual 2.9% (Forecast 2.9%, Previous 2.6%)", "BoJ rate decision: Tokyo raises rates to 1%"]) if (m.classify(it(t)).skip) { bad++; console.log("FAIL wrongly skipped |", t); }
// 27 Nov (05:40): EU seven-year budget haggling is noise; EU budget lines on Ukraine/defence/US, EU tariffs still pass.
// Fallback headlines lose ", according to …" but "according to plan" without a comma stays
{
  const T = Date.now() + 8e10;
  if (m.noiseReason("🇪🇺 European leaders have failed to reach an agreement on the seven-year budget. There will be another summit", false, T) !== "EU long-term budget") { bad++; console.log("FAIL EU MFF budget"); }
  for (const t of ["EU long-term budget to fund Ukraine aid of €50 billion", "EU leaders agree seven-year budget with bigger defence spending", "EU imposes tariffs on US goods", "EU budget deficit rules loosened", "ECB raises rates; EU budget talks continue"]) if (m.noiseReason(t, false, T + 1e9)) { bad++; console.log("FAIL EU budget too wide |", t); }
  if (m.dropTitleSource("🌾 Russia has emerged as a major exporter of grain, causing significant harm to France, according to Le Figaro") !== "🌾 Russia has emerged as a major exporter of grain, causing significant harm to France") { bad++; console.log("FAIL title source |", m.dropTitleSource("🌾 Russia has emerged as a major exporter of grain, causing significant harm to France, according to Le Figaro")); }
  if (m.dropTitleSource("According to the Kremlin, talks with the US will resume") !== "Talks with the US will resume") { bad++; console.log("FAIL title source lead"); }
  for (const t of ["Iran talks going according to plan, says Araghchi", "Contact press@example.com for details"]) if (m.dropTitleSource(t) !== t) { bad++; console.log("FAIL title source too wide |", t); }
}
// 27 Nov (09:35): Russian company default (MGKL) still posts but is not a HIGH ALERT nor "economic" (so it gets rewritten, source dropped); sovereign defaults, rubles noise,
// BTC positioning commentary, emoji-led "According to X," in fallback headlines
{
  const T = Date.now() + 9e10;
  const mg = "📈🇷🇺 MGKL rises by 2%. According to Vedomosti, MGKL has encountered its fifth actual default on bonds";
  if (m.alertWorthy(mg) || m.classify(it(mg)).highAlert || m.classify(it(mg)).kind !== "news") { bad++; console.log("FAIL MGKL alert/kind"); }
  if (m.noiseReason(mg, false, T)) { bad++; console.log("FAIL MGKL should still post (no alert)"); }
  if (m.noiseReason("Diasoft Posts First-Half 2026 Net Profit of 374M Rubles, Up 311%", false, T) !== "Russia local") { bad++; console.log("FAIL rubles local"); }
  for (const t of ["Russia defaults on its foreign debt for the first time since 1918", "Russian ruble plunges 5% against the dollar", "Russia's oil revenue falls to 500 billion rubles as sanctions bite", "Evergrande defaults on dollar bonds"]) if (m.noiseReason(t, false, T + 1e9)) { bad++; console.log("FAIL too wide |", t); }
  if (!m.alertWorthy("Russia defaults on its foreign debt")) { bad++; console.log("FAIL sovereign default alert"); }
  if (m.classify(it("US Initial Jobless Claims Actual 220K (Forecast 225K, Previous 230K)")).kind !== "economic") { bad++; console.log("FAIL economic kind"); }
  for (const t of ["Large cluster of BTC short positions sits between $61,000 and $65,000", "Bitcoin Short Positions Cluster Between $61,000 and $65,000"]) if (m.noiseReason(t, false, T) !== "positioning commentary") { bad++; console.log("FAIL positioning |", t); }
  for (const t of ["$1B of BTC shorts liquidated as Bitcoin jumps 8%", "Bitcoin falls below $60,000", "Hedge funds build record short positions in Treasuries futures"]) if (m.noiseReason(t, false, T + 2e9)) { bad++; console.log("FAIL positioning too wide |", t); }
  const e = m.dropTitleSource("🛢 According to Energy Aspects, oil stockpiling will play a crucial role in supporting prices");
  if (e !== "🛢 Oil stockpiling will play a crucial role in supporting prices") { bad++; console.log("FAIL emoji source |", e); }
  if (m.dropInlineSource("📈 According to CNBC's sources, an unusually large order") !== "📈 An unusually large order") { bad++; console.log("FAIL emoji inline source"); }
  for (const t of ["🛢 Oil rises, going according to plan", "📧 Contact press@example.com for details"]) if (m.dropTitleSource(t) !== t) { bad++; console.log("FAIL emoji source too wide |", t); }
}
// 27 Nov (13:35): foreign CB rate talk and on-chain ratios are no HIGH ALERT; decisions, emergency moves and Fed lines still are; Cryptorank ranking reports skipped
{
  const T = Date.now() + 1e11;
  for (const t of ["IMF says RBA should prepare for more rate hikes", "⚠️🇪🇺 Dolenc from the European Central Bank (ECB) stated that two interest rate hikes have not been enough to tame inflation", "ECB's Dolenc: Two hikes to date aren't enough to tame inflation", "BTC 7-Day Profit/Loss Ratio Drops to 0.825"])
    if (m.alertWorthy(t) || m.classify(it(t)).highAlert) { bad++; console.log("FAIL should not alert |", t); }
  for (const t of ["BoJ raises rates to 1%, first hike in a year", "ECB rate decision: hikes by 25 bps", "RBA emergency rate cut", "Fed's Waller: rate cut in December is likely", "Bank of Japan intervention: yen jumps 3%", "Bitcoin plunges 10% below $60,000", "Iran fires missiles at US base"])
    if (!m.alertWorthy(t)) { bad++; console.log("FAIL should alert |", t); }
  if (!m.classify(it("Fed's Waller: rate cut in December is likely")).highAlert) { bad++; console.log("FAIL Fed rate cut highAlert"); }
  for (const t of ["IMF says RBA should prepare for more rate hikes", "ECB's Dolenc: Two hikes to date aren't enough to tame inflation"]) if (m.classify(it(t)).skip || m.noiseReason(t, false, T)) { bad++; console.log("FAIL CB talk should still post |", t); }
  for (const t of ["✨ Cryptorank has released a report highlighting the leading networks by trading volume of", "✨ Cryptorank has released a report detailing the largest tokens by growth and decline over"]) if (m.noiseReason(t, false, T) !== "crypto ranking report") { bad++; console.log("FAIL cryptorank |", t); }
  for (const t of ["Cryptorank: exchange hack drains $200 million", "Bitcoin ETF inflows top $1 billion"]) if (m.noiseReason(t, false, T + 1e9)) { bad++; console.log("FAIL cryptorank too wide |", t); }
}
// 27 Nov (17:40): Russian company results in rubles and Putin's ceremonial appearances skipped; sanctions/oil/US lines and his statements still pass
{
  const T = Date.now() + 2e11;
  for (const t of ["Transneft Nine-Month IFRS Profit Falls to 46.2 Billion Rubles", "Gazprom Neft Reports 495 Billion Ruble Profit for Nine Months", "Gazprom posted a third-quarter net profit of 247 billion rubles under IFRS."])
    if (m.noiseReason(t, false, T) !== "Russian company results") { bad++; console.log("FAIL RU results |", m.noiseReason(t, false, T), "|", t); }
  for (const t of ["President Putin Arrives in Severodvinsk", "Putin attends flag-raising ceremony for new nuclear submarine \"Perm\"", "Putin will hold a meeting on the development of the Navy's multi-purpose nuclear submarine fleet"])
    if (m.noiseReason(t, false, T) !== "Putin ceremony") { bad++; console.log("FAIL Putin ceremony |", m.noiseReason(t, false, T), "|", t); }
  for (const t of ["Gazprom profit plunges to 247 billion rubles as EU gas exports collapse", "Rosneft revenue falls 30% to 2 trillion rubles on US sanctions and lower oil prices", "Lukoil net loss of 100 billion rubles after Ukrainian drone strikes on refineries",
    "Putin arrives in Beijing for talks with Xi", "Putin arrives in Alaska for summit with Trump", "Putin attends meeting on Ukraine ceasefire proposal", "Putin: Russia will respond to any NATO attack", "Gazprom halts gas flows to Europe"])
    if (m.noiseReason(t, false, T + 3e9)) { bad++; console.log("FAIL too wide |", t); }
}
// 28 Nov (01:40): S&P (rating agency) is one dedup word — "S&P cuts France outlook" went out 4x; S&P 500 moves and other ratings still post
{
  const T = Date.now() + 3e11;
  if (m.isDuplicateStory("S&P: France Outlook changed from Stable to Negative.", "feed", T)) { bad++; console.log("FAIL sandp first"); }
  for (const [t, src, min] of [["S&P Cuts France's Outlook to Negative", "tg:marketsAlpha", 1], ["S&P revises France outlook to negative, affirms A+/A-1 ratings", "feed", 4], ["S&P: France outlook cut to negative on budget consolidation risks; 'A+/A-1' ratings confirmed", "feed", 5]] as const)
    if (!m.isDuplicateStory(t, src, T + min * 60_000)) { bad++; console.log("FAIL sandp dup |", t); }
  for (const [t, src, min] of [["S&P cuts Italy outlook to negative", "feed", 7], ["S&P 500 closes up 1.2%, Nasdaq up 2%", "tg:WalterBloomberg", 8], ["S&P 500 futures fall 0.5%", "feed", 9], ["S&P cuts Belgium outlook to negative", "tg:FirstSquawk", 10], ["France Fin. Min. Lescure: S&P says it is urgent to secure the budget.", "feed", 11], ["Moody's cuts France outlook to negative", "tg:FirstSquawk", 100]] as const)
    if (m.isDuplicateStory(t, src, T + min * 60_000)) { bad++; console.log("FAIL sandp too wide |", t); }
}
// 28 Nov (09:40): Trump personal/campaign politics (2× marketsAlpha in 3 min) — Trump on Fed successor, tariffs, war still post
{
  const T = Date.now() + 4e11;
  for (const t of ["Donald Trump plans to maintain suspense around his successor for as long as possible.", "Former President Donald Trump is urging his supporters to have faith in him as he campaigns across the country"])
    if (m.noiseReason(t, false, T) !== "Trump politics") { bad++; console.log("FAIL Trump politics |", m.noiseReason(t, false, T), "|", t); }
  for (const t of ["Trump to name Powell successor at the Fed next week", "Trump tells supporters tariffs on China will rise to 60%", "Trump campaign pledges tax cuts on tips", "Trump says Iran war victory within reach", "Trump: stocks will hit record highs", "Trump successor pick for Treasury to be announced"])
    if (m.noiseReason(t, false, T + 5e9)) { bad++; console.log("FAIL Trump too wide |", m.noiseReason(t, false, T + 5e9), "|", t); }
}
console.log(bad ? `${bad} failures` : "all filter cases OK"); if (bad) process.exit(1);
