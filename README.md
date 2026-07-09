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
MAX_DCA_ENTRIES=3
RECOVERY_DROP_PCT=5
RECOVERY_SCORE_THRESHOLD=88
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

## Telegram จะแสดงทั้ง THB และ USDT เพื่อใช้งานกับ Gate.io

ข้อความ Telegram ของ SETUP และ ENTRY HIT ถูกจัดเป็นใบคำสั่งเทรดสำหรับใช้งานบน Gate.io โดยตรง:

- ราคาเข้าและเป้าขายใช้ USDT เป็นหลัก พร้อมราคาเงินบาทประกอบ
- ทุนแนะนำแสดงทั้งบาทและ USDT
- แสดงจำนวนเหรียญโดยประมาณจากทุน USDT หารราคาเข้าเฉลี่ย
- กำไรคาดหวังแสดงทั้งเปอร์เซ็นต์ บาท และ USDT
- ระบบยังเป็น signal + paper tracking เท่านั้น ไม่มี auto-trading และไม่ใช้ exchange private API key

## วิธีใช้งานจริง

ระบบนี้เป็น Telegram-first: หัวใจหลักคือ `npm run scanner` ที่อ่าน Gate.io public live data, สร้าง signal, ส่ง Telegram, และ paper-track lifecycle ลง SQLite. Dashboard มีไว้ดูสถิติและประวัติจาก SQLite เท่านั้น

### 1. ใส่ Telegram token/chat id

```powershell
cd D:\SBP\projects\SwingSignalTelegramOS
Copy-Item .env.local.example .env.local
```

แก้ `.env.local`:

```env
TELEGRAM_BOT_TOKEN=ใส่ token จาก BotFather
TELEGRAM_CHAT_ID=ใส่ chat id หรือ group id
USDTHB_RATE=36.50
SIGNAL_EXPIRY_DAYS=3
SCAN_INTERVAL_MINUTES=5
MAX_ACTIVE_SIGNALS=5
DEFAULT_STAKE_THB=20000
STARTING_CAPITAL_THB=200000
```

V1 ไม่ใช้ exchange API key และไม่มีการส่ง order ไป Gate.io

### 2. ทดสอบ Telegram

```powershell
npm run dev
```

เปิด `http://localhost:3000/settings` แล้วกด `Test Telegram`

- ถ้ายังไม่ได้ใส่ token/chat id ระบบจะแสดง error ว่าต้องใส่ใน `.env.local`
- ถ้าใส่ถูกต้อง Telegram bot จะส่งข้อความทดสอบเข้า chat ที่กำหนด

### 3. รัน dashboard

```powershell
npm run dev
```

Dashboard pages อ่านข้อมูลจริงจาก SQLite:

- Overview
- Active Signals
- Signal History
- Performance
- Coin Ranking
- Settings

### 4. รัน scanner

ทดสอบหนึ่งรอบ:

```powershell
npm run scanner:once
```

รันต่อเนื่อง:

```powershell
npm run scanner
```

Scanner จะ log ภาพรวมประมาณนี้:

```text
[scanner] universe=100 pairs
[scanner] scanned=98 skipped=2 duplicate_skipped=1 capacity_skipped=0 signals_created=1 active_signals=3
```

ถ้า pair ไม่มีบน Gate.io Spot จะ skip พร้อมเหตุผล `reason=not_available_on_gateio_spot`

### 5. วิธีดู log

ดู log จาก terminal ที่รัน `npm run scanner` โดยตรง:

- `universe` = จำนวนคู่เหรียญที่เปิดใช้งานใน `coin_universe`
- `scanned` = จำนวนคู่ที่พบใน Gate.io public tickers และถูกสแกน
- `skipped` = คู่ที่ไม่เข้าเงื่อนไขหรือไม่มีบน Gate.io
- `duplicate_skipped` = pair ที่มี active signal อยู่แล้ว
- `signals_created` = signal ใหม่ที่ถูกสร้างและส่ง Telegram
- `active_signals` = จำนวน SETUP/ENTRY/TARGET1/HOLD ที่ยัง active

### 6. เข้าใจ lifecycle message

- `SETUP SIGNAL` = ระบบพบ pullback buy-limit setup คะแนน >= 85 และส่งแผนตั้ง Buy Limit
- `ENTRY HIT` = ราคาปัจจุบันลงถึงโซน `entry_low-entry_high` ภายใน 3 วัน ให้ผู้ใช้ตรวจเองว่า Buy Limit fill หรือยัง พร้อมแผนขาย
- `CANCEL SIGNAL` = ครบ 3 วันแล้วยังไม่มี ENTRY HIT ให้ยกเลิก Buy Limit ใน Gate.io และรอสัญญาณใหม่
- `TARGET 1 HIT` = หลัง ENTRY HIT ราคาแตะ target1 ระบบบันทึกผลจำลองไม้แรก
- `TARGET 2 HIT` = ราคาแตะ target2 ระบบบันทึกผลจำลองไม้สอง
- `SIGNAL CLOSED` = signal จำลองปิดครบ lifecycle แล้ว
- `RECOVERY SIGNAL` = V1 ยังไม่ส่ง recovery signal อัตโนมัติ มีเฉพาะ placeholder/log เพื่อกันการส่งมั่ว

ทุก signal ถูก paper-track ใน SQLite ไม่ว่าผู้ใช้จะเทรดจริงหรือไม่ และระบบไม่ตรวจ order จริงของผู้ใช้

## รันฟรีด้วย GitHub Actions ทุก 5 นาที

V1 สามารถรัน `scanner:once` บน GitHub Actions แบบ Telegram-first ได้โดยใช้ workflow:

```text
.github/workflows/scanner.yml
```

Workflow นี้ทำงานสองแบบ:

- schedule ทุก 5 นาทีด้วย cron `*/5 * * * *`
- `workflow_dispatch` สำหรับกด `Run workflow` เองจากหน้า GitHub

### GitHub Secrets ที่ต้องใส่

ไปที่ GitHub repo > Settings > Secrets and variables > Actions > New repository secret แล้วเพิ่ม:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
USDTHB_RATE
```

ค่าอื่น ๆ ถูกตั้งใน workflow แล้ว:

```text
SIGNAL_EXPIRY_DAYS=3
SCAN_INTERVAL_MINUTES=5
MAX_ACTIVE_SIGNALS=5
DEFAULT_STAKE_THB=20000
STARTING_CAPITAL_THB=200000
DATABASE_PATH=./data/swing_signal.sqlite
```

ห้าม commit `.env.local` ขึ้น GitHub เพราะ workflow ใช้ GitHub Secrets แทน

### SQLite state บน GitHub Actions

GitHub Actions runner เป็นเครื่องชั่วคราว ถ้าไม่เก็บ state กลับ repo ระบบจะลืม signal เดิมทุกรอบ และอาจส่ง duplicate signal ได้

วิธีที่ V1 ใช้:

- scanner อ่าน/เขียน state ที่ `data/swing_signal.sqlite`
- `.gitignore` ยังกัน `.env.local` และ SQLite อื่น ๆ แต่ยอม track เฉพาะ `data/swing_signal.sqlite`
- หลัง `npm run scanner:once` workflow จะ `git add data/swing_signal.sqlite`
- ถ้า DB เปลี่ยน workflow จะ commit และ push กลับ repo

ผลคือ active signals, signal events, snapshots, และ performance stats ไม่หายระหว่าง schedule รอบถัดไป และ duplicate signal ข้ามรอบจะถูกกันด้วยข้อมูลใน SQLite

### เปิดใช้งาน Actions

1. Push project นี้ขึ้น GitHub
2. เปิดหน้า repo ใน GitHub
3. ไปที่ Actions
4. ถ้า GitHub ถาม ให้กด enable workflows
5. ตรวจว่า workflow ชื่อ `SwingSignal Scanner` แสดงขึ้นมา

### กด Run workflow ทดสอบ

1. ไปที่ GitHub repo > Actions
2. เลือก `SwingSignal Scanner`
3. กด `Run workflow`
4. เปิด job log แล้วดูบรรทัดประมาณนี้:

```text
[scanner] universe=90 pairs
[scanner] scanned=85 skipped=... duplicate_skipped=... signals_created=... active_signals=...
```

ถ้าไม่มี signal ใหม่ workflow ต้องจบแบบผ่าน ไม่ fail. ถ้า Telegram ส่งไม่ได้ scanner จะ log `telegram_failed ... error=...` ชัดเจน

## Debug Mode สำหรับทดสอบ Telegram

Debug Mode มีไว้ทดสอบรูปแบบข้อความ Telegram เท่านั้น ไม่ใช่สัญญาณเงินจริง และไม่ใช่คำแนะนำให้ซื้อขายจริง

### เปิด Debug Mode ในเครื่อง

แก้ `.env.local`:

```env
DEBUG_SIGNAL=true
```

จากนั้นรัน:

```powershell
npm run scanner:once
```

เมื่อ `DEBUG_SIGNAL=true` scanner จะ:

- สแกน Gate.io public live data จริง
- คัด candidate ทั้งหมดแล้วเรียงคะแนนสูงสุด
- เลือก top candidate 1 ตัวต่อรอบ แม้คะแนนยังไม่ถึง threshold 85
- สร้าง signal/event ที่มี `[DEBUG]` ชัดเจน
- บันทึก `is_debug=1` ใน SQLite
- ไม่นับรวมในสถิติจริง เช่น win rate, ranking, score buckets

### ปิด Debug Mode ก่อนใช้งานจริง

แก้ `.env.local` กลับเป็น:

```env
DEBUG_SIGNAL=false
```

เมื่อ `DEBUG_SIGNAL=false` scanner จะใช้กฎจริงเหมือนเดิม:

- ส่งเฉพาะ score >= 85
- กัน duplicate active signal ต่อ pair
- ไม่มี `[DEBUG]`
- นับเป็น signal จริงใน paper tracking

### ใช้ Debug Mode บน GitHub Actions

ค่า default ใน workflow คือ `false` เพื่อไม่ให้ schedule จริงส่ง debug เอง

ถ้าต้องการทดสอบด้วย GitHub Actions:

1. ไปที่ repo > Settings > Secrets and variables > Actions
2. เพิ่ม Repository variable หรือ secret ชื่อ `DEBUG_SIGNAL`
3. ตั้งค่าเป็น `true`
4. ไปที่ Actions > `SwingSignal Scanner`
5. กด `Run workflow`
6. หลังทดสอบเสร็จ ให้ตั้ง `DEBUG_SIGNAL=false` หรือ ลบ variable/secret นี้ออก

ห้ามเปิด `DEBUG_SIGNAL=true` ค้างไว้ถ้าจะใช้งาน schedule จริง

## เริ่มใช้งานจริง

- ระบบจะสแกนทุก 5 นาทีผ่าน GitHub Actions workflow `SwingSignal Scanner`
- ถ้าเจอสัญญาณจริงตามเงื่อนไข score >= 85 ระบบจะส่ง Telegram ให้ทันที
- Dashboard เปิดเฉพาะเวลาจะดูสถิติ ประวัติ signal และสถานะระบบ
- ไม่มี auto-trading
- ไม่มี exchange private API key
- ตอนใช้งานจริงต้องให้ `DEBUG_SIGNAL=false`

ก่อนเปิด schedule จริง ให้ตั้ง GitHub Secrets:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
USDTHB_RATE
```

จากนั้นไปที่ Actions > `SwingSignal Scanner` > `Run workflow` เพื่อตรวจ log ว่า `debug_signal=false`

## Recovery / DCA Rule Lock

- `MAX_ACTIVE_SIGNALS=5` จำกัด active setup หลักสูงสุด 5 เหรียญ และต้องไม่ซ้ำ pair
- SETUP ใหม่ของ pair เดิมจะถูก skip ถ้ายังมี active setup/entry อยู่
- Recovery อนุญาตเฉพาะ parent signal ที่เป็น `ENTRY_HIT` แล้วเท่านั้น
- Recovery ไม่เพิ่ม setup slot ใหม่ แต่เพิ่ม exposure และ `dca_level` ของ parent
- Recovery จะส่งเมื่อราคาลงถึงโซนช้อนตาม `RECOVERY_DROP_PCT`, volume ยังผ่าน, structure ไม่เสีย, และ score >= `RECOVERY_SCORE_THRESHOLD`
- จำนวนไม้รวมถูกจำกัดด้วย `MAX_DCA_ENTRIES=3`
- ถ้ายังเป็นแค่ SETUP และยังไม่ ENTRY_HIT ระบบจะไม่ส่ง Recovery
- Performance ไม่ถือ Recovery เป็น signal ใหม่แยกจาก parent

## Confidence Score คืออะไร

`confidence_pct` เป็นคะแนนความมั่นใจแยกจาก `score` ของ setup. `score` วัดความสวยของสัญญาณตามกฎหลัก ส่วน confidence วัดความครบของหลักฐานประกอบ เช่น volume ratio, ระยะใกล้แนวรับ, reward/risk, volatility range, trend 24h, คุณภาพย้อนหลังของเหรียญ และ Market Guard.

Telegram และ Dashboard จะแสดงเช่น `ความมั่นใจ: 72%`. Debug signals ยังมี `is_debug=1` และไม่ถูกนับในสถิติจริง.

## Dynamic Position Size คืออะไร

ค่า default ยังเป็น `DEFAULT_STAKE_THB=20000` แต่ระบบจะแนะนำทุนตามคุณภาพสัญญาณ:

- score 85-89: 10,000 บาท
- score 90-94: 20,000 บาท
- score 95+: 25,000 บาท
- confidence ต่ำกว่า 65%: ลดทุนลง 25%

ระบบยังคุม exposure รวมด้วย `MAX_ACTIVE_SIGNALS`, `DEFAULT_STAKE_THB`, และ `STARTING_CAPITAL_THB`. Telegram จะแสดงทั้ง THB และ USDT พร้อมเหตุผลทุน เช่น `ทุนแนะนำ: 20,000 บาท ≈ 548 USDT`.

## Portfolio Heat คืออะไร

Portfolio Heat คือ `active exposure / starting capital * 100`. Dashboard Overview แสดง:

- Portfolio Heat
- Active Exposure
- Reserve Remaining
- Recovery Exposure
- Slot Used

Telegram SETUP จะแสดงสถานะพอร์ต เช่น ใช้ทุนอยู่กี่เปอร์เซ็นต์, เหลือสำรองกี่บาท, และ slot `2/5`.

## Market Guard คืออะไร

Market Guard ใช้ Gate.io public data ของ `BTC_USDT` และ `ETH_USDT` เพื่อดูภาพรวมตลาดก่อนสร้าง SETUP ใหม่:

- `normal`: ตลาดปกติ
- `caution`: ลด confidence ของสัญญาณใหม่
- `risk_off`: หยุดส่ง SETUP ใหม่ แต่ยัง tracking lifecycle ของ signal เดิมต่อ

scanner จะ log เหตุผลในรูปแบบ `market_guard=normal/caution/risk_off`. ไม่มีการใช้ exchange private API key.

## วิธีอ่าน Coin Ranking

หน้า Coin Ranking แสดง performance แยกตามเหรียญ: total signals, entry hit rate, target1 hit rate, target2 hit rate, cancel rate, average return pct, average time to entry, average time to target, win rate, และ quality grade A/B/C/D.

Grade ใช้ดูคุณภาพย้อนหลังของเหรียญ ไม่ใช่คำสั่งซื้อขาย.

## วิธีอ่าน Performance by Score Band

หน้า Performance แยก score เป็น 3 ช่วง: 85-89, 90-94, และ 95-100. แต่ละช่วงแสดง total signals, entry hit rate, win rate, และ avg return เพื่อดูว่า score band ไหนแม่นที่สุดจาก paper tracking จริง.

## Daily Health Summary

รัน manual ได้ด้วย:

```powershell
npm run health:once
```

ระบบจะส่ง Telegram สรุปรายวัน:

```text
✅ SwingSignal OS Health
สแกนล่าสุด: ...
Active Signals: ...
Portfolio Heat: ...
Reserve: ...
Entry Hit Rate: ...
Win Rate: ...
Market Guard: ...
Telegram: OK
Gate.io: OK
Database: OK
```

GitHub Actions เพิ่ม workflow `SwingSignal Daily Health` ที่รันวันละครั้งช่วงเช้าไทยโดยประมาณ และไม่กระทบ workflow scanner ทุก 5 นาที.

## Architecture

- `src/app` - Next.js App Router dashboard pages and API routes.
- `src/components` - Thai dashboard UI components.
- `src/lib/db.ts` - SQLite connection and schema helpers.
- `src/lib/gateio.ts` - Gate.io public market data client.
- `src/lib/analytics.ts` - confidence, position sizing, portfolio heat, ranking helpers.
- `src/lib/market-guard.ts` - BTC/ETH public market guard.
- `src/lib/signal-engine.ts` - rule-based pullback setup scoring and lifecycle checks.
- `src/lib/telegram.ts` - Thai Telegram message formatting and sender.
- `src/lib/stats.ts` - objective paper-tracking performance stats.
- `scripts/db-init.ts` - creates SQLite tables.
- `scripts/db-seed.ts` - seeds config and Gate.io allowlist universe.
- `scripts/scanner.ts` - background worker.
- `scripts/health.ts` - manual/GitHub Actions daily health summary.
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
