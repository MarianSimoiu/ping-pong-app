# How ratings are computed

This document is the source of truth for **how every rating number is produced**.
The formulas here are implemented in
[`supabase/functions/_shared/glicko2.ts`](../supabase/functions/_shared/glicko2.ts),
and the worked numbers below are asserted by
[`glicko2.test.ts`](../supabase/functions/_shared/glicko2.test.ts) — so the code
and this doc can't drift apart. All rating math runs **server-side** in the
`submit-match` Edge Function; clients never compute or write ratings.

Each player has **two numbers**:

1. A **skill rating** (Glicko-2) — updated after every match. *This document.*
2. **Season points** (WTA-style tournament points) — added in Phase 5; see the
   "Season points" section at the end for the intended design.

---

## 1. Skill rating: Glicko-2

Glicko-2 is an improved Elo. Besides the familiar **rating** (starts at **1500**),
each player carries:

- **RD** (rating deviation, starts at **350**) — how *uncertain* we are about the
  rating. Low RD = well-established; high RD = unproven. Shown in the app as `± RD`.
- **Volatility σ** (starts at **0.06**) — how erratic the player's results are.

Constants used (from `GLICKO2` in the code): scale `173.7178`, `τ = 0.5`,
provisional threshold `10` matches.

### The update, step by step

For a player (rating `r`, deviation `RD`, volatility `σ`) who plays an opponent
(`rⱼ`, `RDⱼ`) with outcome `s` (win = 1, loss = 0):

1. **To the Glicko-2 scale:** `μ = (r − 1500) / 173.7178`, `φ = RD / 173.7178`.
2. **Opponent weighting:** `g(φⱼ) = 1 / √(1 + 3φⱼ²/π²)` — a less certain opponent
   (higher RDⱼ) counts for less.
3. **Expected score:** `E = 1 / (1 + e^(−g(φⱼ)·(μ − μⱼ)))` — the model's predicted
   win probability. **This is the fairness core:** if you're much stronger, `E` is
   near 1, so a win adds almost nothing and a loss costs a lot.
4. **Variance & delta:** `v = [g(φⱼ)² · E · (1−E)]⁻¹`, `Δ = v · g(φⱼ) · (s − E)`.
5. **New volatility σ′:** solved iteratively (Illinois algorithm) under `τ`.
6. **New deviation:** `φ′ = 1 / √(1/(φ² + σ′²) + 1/v)` — playing always *reduces*
   RD (we learn something); inactivity later *increases* it (see §2.4).
7. **New rating:** `μ′ = μ + φ′² · g(φⱼ) · (s − E)`.
8. **Back to display scale:** `r′ = 173.7178·μ′ + 1500`, `RD′ = 173.7178·φ′`.

### Worked example A — the canonical check

Player `1500 / 200 / 0.06` plays three in one period: **beats** `1400/30`,
**loses to** `1550/100`, **loses to** `1700/300`. Result:

> **rating 1464.06 · RD 151.52 · σ 0.05999**

This is Glickman's own published example; `glicko2.test.ts` asserts it.

### Worked example B — why weak opponents can't be farmed

An **established** strong player `1800 / RD 60` versus a weak `1200 / RD 60`:

| Outcome | New rating | Change |
|---|---|---|
| Beats the weak player (expected) | 1800.68 | **+0.68** |
| Loses to the weak player (upset) | 1779.79 | **−20.21** |

Beating someone you're supposed to beat is worth almost nothing; an upset loss is
worth ~30× more. Playing 10 easy games nets you a rounding error — and risks real
losses. This falls straight out of step 3, no special-casing needed.

### Worked example C — a fresh, even match

Two brand-new players `1500 / 350 / 0.06`. Winner → **1662.31**, loser →
**1337.69**, both RD → **290.32**. New players move fast (high RD) and converge
toward their true level within their first several games.

---

## 2. Anti-farming guards

Four guards keep the ladder fair. Guard 1 is inherent to Glicko-2 (above); the
other three are explicit and listed here with exact rules.

### 2.1 Opponent-strength weighting (inherent)
Covered by step 3. Beating weak players ≈ 0 points; losing to them is costly.
Worked example B is the proof.

### 2.2 Provisional players
While `matches_played < 10` a player is **provisional**. Their RD is high, so
Glicko-2 already moves them quickly toward their real level; the app also labels
them provisional and (Phase 3) can hide them from the public leaderboard until
they've settled. Rule: `isProvisional(n) = n < 10`.

### 2.3 Diminishing repeat-opponent returns
The direct fix for "I'll just play the same weak friend 10 times today." Let
`k` = how many times these two have **already** played **today** (last 24 h)
before the current game. The current game's **rating change is multiplied** by:

| Current game of the day (vs same opponent) | `k` | Factor |
|---|---|---|
| 1st | 0 | **1.0** |
| 2nd | 1 | **1.0** |
| 3rd | 2 | **0.5** |
| 4th | 3 | **0.25** |
| 5th and beyond | ≥4 | **0.0** |

Only the **rating move** is damped; **RD and σ still update normally** (a played
game is still information). Implemented as
`applyRepeatFactor(before, after, repeatFactor(k))`. So the 5th+ game against the
same person on the same day cannot change either player's rating at all.

### 2.4 Inactivity / RD decay
Sit out and the system becomes *less sure* you're still that good. For `p` rating
periods of inactivity, `RD` grows: `φ ← √(φ² + σ²·p)`, capped at 350 (you're never
more uncertain than a newcomer). Rule: `applyInactivity(player, p)`. Example: a
settled `1600 / RD 80` player after a long idle stretch → RD grows back toward the
default while the rating itself is unchanged.

---

## 3. Where each guard lives

| Guard | Function | Applied in |
|---|---|---|
| Opponent weighting | `updateRating` (step 3) | every match |
| Provisional | `isProvisional` | badge now; leaderboard gate (Phase 3) |
| Repeat-opponent | `repeatFactor` + `applyRepeatFactor` | `submit-match` before persisting |
| Inactivity/RD | `applyInactivity` | `submit-match` before the update |

Every match writes an append-only pair of rows to **`rating_events`** recording
`rating_before/after`, `rd_before/after`, `volatility_before/after`, `delta`,
`repeat_factor`, and `provisional` — so any number in the app can be traced back
to its inputs.

---

## 4. Season points (WTA-style) — Phase 5 design

A **separate** number from skill rating, answering "what have you achieved lately?"
Planned rules (implemented in Phase 5, in `_shared/points.ts`):

- Points are awarded only for **tournament** placements, weighted by the
  tournament's **tier** (bigger events pay more — like a Grand Slam vs a 250).
- A player's ranking = the sum of their **best N** results within a **rolling
  52-week window**; older results **expire**. You cannot farm it with casual games,
  and standing decays if you stop competing.

This section will gain its own worked examples when Phase 5 lands.
