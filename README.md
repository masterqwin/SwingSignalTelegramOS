# SwingSignalTelegramOS

Local V1 crypto swing/range signal and paper-tracking system for Team SBP.

This project scans public Gate.io Spot market data, finds rule-based pullback buy-limit setups, sends Thai Telegram alerts, tracks every signal lifecycle, and records objective performance stats. It does **not** auto-trade, does **not** require exchange private API keys, and does **not** provide financial guarantees.

## Setup

```powershell
cd D:\SBP\projects\SwingSignalTelegramOS
npm install
Copy-Item .env.local.example .env.local
npm run db:init
npm run db:seed
```

Edit `.env.local`:

```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
USDTHB_RATE=36.50
SCAN_INTERVAL_MINUTES=5
SIGNAL_EXPIRY_DAYS=3
STARTING_CAPITAL_THB=200000
DEFAULT_STAKE_THB=20000
MAX_ACTIVE_SIGNALS=5
```

## Run Dashboard

```powershell
npm run dev
```

Open `http://localhost:3000`.

## Run Scanner

In another terminal:

```powershell
npm run scanner
```

The scanner loops every `SCAN_INTERVAL_MINUTES`, fetches Gate.io public tickers/candles, updates SQLite, sends Thai Telegram lifecycle messages, and never places orders.

## Telegram Setup

1. Create a Telegram bot with BotFather.
2. Put the bot token in `TELEGRAM_BOT_TOKEN`.
3. Send a message to the bot or add it to a group.
4. Put your chat id or group id in `TELEGRAM_CHAT_ID`.
5. Start the dashboard and use Settings > test Telegram.

## Architecture

- `src/app` - Next.js App Router dashboard pages and API routes.
- `src/components` - Thai dashboard UI components.
- `src/lib/db.ts` - SQLite connection and schema helpers.
- `src/lib/gateio.ts` - Gate.io public market data client.
- `src/lib/signal-engine.ts` - rule-based pullback setup scoring and lifecycle checks.
- `src/lib/telegram.ts` - Thai Telegram message formatting and sender.
- `src/lib/stats.ts` - objective paper-tracking performance stats.
- `scripts/db-init.ts` - creates SQLite tables.
- `scripts/db-seed.ts` - seeds config and Gate.io allowlist universe.
- `scripts/scanner.ts` - background worker.
- `data/coin-allowlist.json` - configurable V1 credible coin universe.

## GitHub

```powershell
git init
git add .
git commit -m "Initial SwingSignalTelegramOS V1"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

## Safety Notes

- Signal and paper-tracking software only.
- No auto-trading.
- No exchange private API key usage.
- Every setup expires after `SIGNAL_EXPIRY_DAYS` and is not reused.
- Telegram alerts are informational and must be reviewed by a human.
