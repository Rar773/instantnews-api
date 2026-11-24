# InstantNews bot v2

FinancialJuice RSS + Telegram kanály + Fed → Telegram @FastestNewsFeed, X @InstantNews73 a web instantnews24.net.
Jeden program (Bun), jedna databáza (PostgreSQL). Žiadne n8n.

## Čo robí
- **Správy** z FinancialJuice (kontrola každé 4 s) → Telegram hneď, na X len dôležité (HIGH ALERT, dáta, earnings, MOO/MOC, CFTC…)
- **Ekonomické dáta / earnings / aukcie** → Claude naformátuje (Actual / Forecast / Previous, BEAT/MISS)
- **MOO / MOC imbalance** → čísla počíta kód, Claude píše komentár, s bannerom
- **CFTC** (piatok) → analýza od Claude
- **Fed** priamo z federalreserve.gov (okolo FOMC každú sekundu)
- **⏰ Odpočet** 5 min pred dôležitými US dátami
- **📅 Kalendár** o 13:30 (Po–Pi), **📰 Digest** o 22:00 (pripnutý na Telegrame), **📈 NQ výhľad** v nedeľu o 19:00
- **Telegram kanály** (TG_SOURCES) → okamžite, s fotkou/videom, dole „Source: …“
- **Duplicity** (rovnaký príbeh z viacerých zdrojov) sa nepošlú dvakrát
- **Web API** (`/api/news`, `/api/imbalances`, `/api/digest`, `/api/cftc`) pre instantnews24.net
- **Strážca**: problémy ti píše do súkromného Telegramu a pripomína sa každých 30 min, kým sa nevyriešia
- **Záloha** každú nedeľu o 18:00 ako súbor do súkromného Telegramu

## Premenné (Railway → service → Variables)
| Premenná | Čo to je |
|---|---|
| `DATABASE_URL` | z Railway Postgres (`${{Postgres.DATABASE_URL}}`) |
| `ADMIN_TOKEN` | tvoje tajné heslo pre admin (vymysli si dlhé) |
| `TG_TOKEN` | token bota z @BotFather |
| `TG_CHAT` | `@FastestNewsFeed` |
| `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` | z developer.x.com (Read and Write) |
| `ANTHROPIC_API_KEY` | z console.anthropic.com |
| `TG_API_ID`, `TG_API_HASH` | z my.telegram.org (len ak chceš preberať Telegram kanály) |
| `TG_SOURCES` | kanály oddelené čiarkou, napr. `kanal1,kanal2` |
| voliteľné | `X_MODE` (important/all/off), `X_DAILY_CAP` (40), `POLL_MS` (4000), `DRY_RUN=1` (len skúška) |

## Prvé spustenie
1. Napíš botovi v Telegrame súkromne: `/admin TVOJ_ADMIN_TOKEN` → budú ti chodiť upozornenia a zálohy.
2. Ak používaš Telegram kanály: otvor `https://<adresa-bota>/tg/login?token=TVOJ_ADMIN_TOKEN` a prihlás sa.
3. Príkazy v súkromnom chate: `/status`, `/pause`, `/resume`, `/digest`, `/weekly`, `/backup`.

## Obnova, keď sa niečo stratí
1. Railway → New Project → Deploy from GitHub → tento repozitár → pridaj PostgreSQL.
2. Nastav premenné z tabuľky vyššie.
3. Na webe (repo Rar773.github.io) nastav adresu API na novú Railway adresu.
