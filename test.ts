process.env.NO_START = "1";
const m = await import("./index.tsx");

const xml = `<rss><channel>
<item><title>FinancialJuice: MOC Imbalance</title><description>S&amp;P 500: -291 mln&lt;br /&gt;Nasdaq 100: +33 mln&lt;br /&gt;Dow 30: +442 mln&lt;br /&gt;Mag 7: +1313 mln</description><pubDate>Fri, 06 Nov 2026 20:50:30 GMT</pubDate><guid isPermaLink="false">1</guid></item>
<item><title>FinancialJuice: CFTC Positions in the Week of November 3rd 2026</title><description>&lt;div&gt;&lt;ul&gt;&lt;li&gt;Equity fund speculators trim S&amp;amp;P 500 CME net short position by 27,501 contracts to 345,246&lt;/li&gt;&lt;li&gt;Bitcoin net long position is 2,230 contracts&lt;/li&gt;&lt;/ul&gt;&lt;/div&gt;</description><pubDate>Fri, 06 Nov 2026 20:41:49 GMT</pubDate><guid>2</guid></item>
<item><title>FinancialJuice: USD CFTC Positions Week of November 3rd - FJElite</title><description/><pubDate>Fri, 06 Nov 2026 21:10:40 GMT</pubDate><guid>3</guid></item>
<item><title>FinancialJuice: US Consumer Credit Actual 27.839B (Forecast 13.8B, Previous 8.28B)</title><description/><pubDate>Fri, 06 Nov 2026 20:00:16 GMT</pubDate><guid>4</guid></item>
<item><title>FinancialJuice: German Factory Orders Actual 1.1% (Forecast 0.5%, Previous -0.8%)</title><description/><pubDate>Fri, 06 Nov 2026 20:00:16 GMT</pubDate><guid>5</guid></item>
<item><title>FinancialJuice: China, U.S. agree to continue talks to maintain stable, positive trade ties - Xinhua</title><description/><pubDate>Fri, 06 Nov 2026 20:00:16 GMT</pubDate><guid>6</guid></item>
<item><title>FinancialJuice: Monday FX Options Expiries</title><description>x</description><pubDate>Fri, 06 Nov 2026 20:00:16 GMT</pubDate><guid>7</guid></item>
<item><title>FinancialJuice: Trump ends remarks to reporters</title><description/><pubDate>Fri, 06 Nov 2026 20:00:16 GMT</pubDate><guid>8</guid></item>
<item><title>FinancialJuice: Earthquake magnitude 6.55 hits southern Italy: GFZ</title><description/><pubDate>Fri, 06 Nov 2026 20:00:16 GMT</pubDate><guid>9</guid></item>
<item><title>FinancialJuice: $AVGO Broadcom Q2 Earnings</title><description>Adjusted EPS $2.44, est. $2.39&lt;br /&gt;Adjusted revenue $22.19B, est. $22.13B</description><pubDate>Fri, 06 Nov 2026 20:00:16 GMT</pubDate><guid>10</guid></item>
<item><title>FinancialJuice: ECB rate decision: holds rates at 2.00%</title><description/><pubDate>Fri, 06 Nov 2026 20:00:16 GMT</pubDate><guid>11</guid></item>
<item><title>FinancialJuice: US 10-Year Note Auction High Yield Actual 4.123% (Previous 4.05%)</title><description/><pubDate>Fri, 06 Nov 2026 20:00:16 GMT</pubDate><guid>12</guid></item>
</channel></rss>`;
for (const it of m.parseFeed(xml)) console.log(JSON.stringify(m.classify(it)), "|", it.title, "|", JSON.stringify(it.content).slice(0, 120));
