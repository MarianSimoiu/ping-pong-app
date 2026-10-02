# How leaderboard points work

A quick, plain-language explanation of the two numbers behind the
Leaderboard's two tabs. For the exact formulas and every anti-farming rule,
see [`docs/RATING.md`](RATING.md) — the numbers here match it exactly.

## Skill rating (the "Skill rating" tab)

Updated after **every match**, casual or tournament. Everyone starts at
**1500**. The core idea: **winning only pays off in proportion to how
surprising it is.**

- Beat someone you were expected to beat → you gain almost nothing.
- Lose to someone you were expected to beat → you lose a lot.

This is what makes it un-farmable — playing easy opponents over and over
can't inflate your rating.

**Example** — an established 1800-rated player vs. an established 1200-rated
player:

| Outcome | New rating | Change |
|---|---|---|
| The 1800 player wins (expected) | 1800.68 | **+0.68** |
| The 1800 player loses (upset) | 1779.79 | **−20.21** |

An upset loss costs about **30× more** than an expected win gains. That one
rule is the whole system — no special-casing needed.

## Season points (the "Season points" tab)

A separate number, earned **only by placing in tournaments** — casual
matches never count. Each tournament has a **tier** (bigger events are worth
more), and only your **best 8 results from the last 52 weeks** count toward
your total (older results roll off).

**Example** — a 4-player, tier-1 tournament played to seed:

| Finish | Points |
|---|---|
| Champion | **100** |
| Runner-up | **60** |
| Lost in the first round (semifinal) | **36** each |

A tier-2 event pays double (champion = 200, runner-up = 120, …). Since points
only come from tournament results, this answers "what have you achieved
lately?" — while skill rating answers "how good are you right now?"
