---
name: build-week
description: >
  Build, check or adjust Arbor Management's crew board for a week in HousecallPro: the step order,
  what each tool answers, how to weigh the backlog, and how to present a proposed week. Load this
  whenever someone asks to build, propose, fill, fix or re-plan a day or week of crew work, or asks
  what the crews should do.
---

# Build the week (the method)

The rules — roster, crew rules, equipment, targets, sizing, dryness, blocks, tiers, placeholders,
yard — are **config records already in your context** (`config:*`). This file is the *order of
operations* and the judgment calls. The tools do the arithmetic; you decide what to ask for and
how to present it. Never re-derive by hand what a tool computes.

## Golden rules

1. **Propose; do not write.** Phase 4 adds the write tool. Until then every week you build is a proposal.
2. **Build to the crew-day dollar floor on the 8:00–4:00 block, not to the clock.** Under the band → add a job. At or over → the day is built; do not add work to consume leftover hours. The ten-hour fill is documented and NOT active.
3. **Ask, don't assume,** on exactly these: a SEVERE rain event (`get_ground_state` says `ask`), any job over the sizing ask threshold (`size_job` says `ask`), an Ameren line-drop date, and real names on a board the office is treating as tentative. Use `ask_question`; do not guess.
4. Customer phones, emails and street addresses are not in your context on purpose. Do not ask tools for them.

## Step order

1. **Time off first** — `get_time_off(week_start)`. Print the per-day out-roster back and let the office correct it before any crew is built. Getting this wrong invalidates every crew.
2. **Ground** — `get_ground_state()`. Standard event → the tier and `unlocked_tags`. Severe → stop and ask; untagged / Normal Conditions work still proceeds. Check `rain_ahead` too: do not put a "Needs To Be Very Dry" job on Thursday if Wednesday shows an inch.
3. **Backlog** — `get_backlog(week_start, unlocked_tags)`. It has already: removed hard blocks (listed under `blocked` with reasons), netted stump out of the price (`tree_only`), placed each job in its pool, aged it, and split it by its pool's lead-time window (`band` A = past the window, a promise being broken; B = inside it).
4. **Board** — `get_board(week_start)` for what is already placed. Placeholder crews (Crew A/B/C) are fully crewed tentative days, not empty ones. Real names mean that day is firm.
5. **Order the work** (this is judgment, in this order):
   - `preempt` (insurance, storm damage) short-schedule and bump the board — place them, and **name what they displaced** so those customers get a call the same day.
   - `priority` — build the crew-day around it. If it cannot be placed, that is a finding to raise, not a job to defer silently. Priority tags are rare and easy to miss; the tool flags them, trust the flag.
   - Sunday-parked (`source: sunday_parked`) — Justin's ready queue.
   - Band A before all of band B, most overdue first (`overdue_multiple`), and routing no longer outranks it — take the drive.
   - Band B — routing, queue age and quota weighed together. Inside the window days are cheap and miles are not.
   - Report the pool windows with the proposal; if tree and crane have diverged by more than a week or two, say so — that is a sales-quoting problem.
6. **Size** — `size_job` per candidate on `tree_only`, for the crew size you intend. Duration-hint tags win over the formula. Leave the last 60–90 minutes of every crew-day unsold; the buffer is inside the block.
7. **Crews** — `validate_crew(members, tags, out)` for every crew-day, with `out` from step 1. Crane days first each week: one crane, two operators, three CDLs, and Ethan cannot pair with Bob — a crane day consumes one of four leaders. Any violation means that crew is not proposed. Soft warnings are reported, not enforced.
8. **Equipment** — `check_equipment` per day. Only the single-point pools collide; a conflict on the crane means one of the jobs moves, or Erlinger is booked as an action.
9. **Route** — `route_day` per crew-day with the jobs' lat/lng. Time is usually the binding constraint, not distance: check block-hours first, then use drive cost to choose among what fits. A long haul makes nearby work nearly free. Never reject on a ZIP.
10. **Present** (below). Then stop. Writes come later and only on approval.

## Overtime

Manage to the Sun–Sat week, not the day. On the 8-hour build overtime should be uncommon; never decline emergency or storm work to protect 40 hours. Anything past 40 needs a reason and needs Justin; a week that drifts over 40 with no reason is a sizing error — re-check step 6.

## Presenting the proposal

Per day, per crew: members with the leader marked · jobs in order with block, customer, city, price ·
**day dollars vs the crew-day target — the governor** (under = soft, add a job; at/over = built) ·
clocked hours and the crew's running week (visibility only) · equipment claimed · buffer left ·
drive miles and minutes.

Then, separately and first in the reader's eye: ground state · anything bumped and who needs a call ·
soft rules broken · blocked work and why (Ameren especially) · backlog health (count, dollars,
per-pool windows; flag lead time over 15 days or backlog over $200k as a staffing signal) · overtime
exposure with its reason · every question you are asking.

Exceptions first. Numbers from tools, never by eye.
