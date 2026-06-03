# TCA Sample Data

Ready-to-import test files for the TCA tool. Each file is based on real formats seen in production but uses synthetic, anonymised data.

---

## FIX Execution Report files

All three files use **pipe-delimited FIX 4.4** format (`|` separator).
Import on the **Single Order TCA** page.

### `sample-allianz.txt`
| Property | Value |
|---|---|
| Security | NQU6 — E-mini Nasdaq-100 Sep 2026 |
| Side | BUY 100 contracts |
| Fills | 50 fills × 2 contracts each |
| Price | ~21,100 drifting slowly upward |
| Duration | ~75 min (14:30–15:45 UTC) |
| Format | `ExecType=F` (`150=F`), `MultiLegReportingType=1` (`442=1`) on every fill |
| Why it tests | Single-leg order with `442=1` fills — exercises the smart filter that keeps these when no `442=3` is present |

### `sample-abenmfs.txt`
| Property | Value |
|---|---|
| Security | FEIU6 — MSCI Emerging Markets futures Sep 2026 |
| Side | SELL 200 contracts |
| Fills | 50 fills × 4 contracts each |
| Price | ~1,785 drifting slowly downward |
| Duration | ~75 min (14:00–15:15 UTC) |
| Format | `ExecType=F`, `442=1` on every fill |
| Why it tests | Same single-leg `442=1` pattern as Allianz; different symbol, side, and OMS target |

### `sample-lcc.txt`
| Property | Value |
|---|---|
| Security | NQUM6 / NQUZ6 — Nasdaq calendar spread (buy front, sell back) |
| Side | BUY 50 contracts (spread-level) |
| Fills | 20 spread fills with 2–3 contracts each |
| Spread price | ~52 index points |
| Duration | ~50 min (14:30–15:20 UTC) |
| Format | Each fill generates **3 messages**: `442=3` (spread-level) + `442=1` (leg 1, front) + `442=2` (leg 2, back) |
| Why it tests | Multi-leg spread: the smart filter keeps only `442=3` messages and discards the individual legs |

---

## CSV multi-order file

### `sample-multi-order.csv`

Import on the **Multi-Order TCA** page (Configure Import wizard will map columns).

**140 orders** across:

| Symbol | Description | Price level |
|---|---|---|
| ESM6 | E-mini S&P 500 Sep 2026 | ~5,400 |
| NQU6 | E-mini Nasdaq-100 Sep 2026 | ~21,100 |
| CLZ6 | Crude Oil Dec 2026 | ~72.50 |
| GCZ6 | Gold Dec 2026 | ~3,200 |
| 6EU6 | EUR/USD Sep 2026 | ~1.0950 |
| FEIZ6 | MSCI EM futures Dec 2026 | ~1,775 |

**Dates**: 2026-06-02, 2026-06-03, 2026-06-04  
**Sides**: mix of BUY and SELL  
**Algos**: TWAP, VWAP, POV, Sniper, Pegger  
**Accounts**: FUND001, FUND002, FUND003

**Columns** (all auto-detected by the column mapper):

| Column | Maps to |
|---|---|
| `order_id` | Order ID |
| `symbol` | Symbol |
| `side` | Side |
| `order_qty` | Order Quantity |
| `avg_fill_price` | Avg Fill Price |
| `arrival_price` | Arrival Price |
| `order_time` | Order Time |
| `first_fill_time` | First Fill Time |
| `last_fill_time` | Last Fill Time |
| `algo` | Algo / Strategy |
| `account_id` | Account ID |
| `vwap` | Source VWAP |
| `twap` | Source TWAP |

**In the Configure Import wizard:**
- Step 1: Map symbols to Bloomberg tickers + set price multipliers as needed
- Step 2: Algo mapping (file values TWAP/VWAP/etc. will auto-match standard names)
- Step 3: Adjust timestamps if needed
