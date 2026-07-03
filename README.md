# Muffin Game

Two static pages that talk to each other over Supabase Realtime (Broadcast):

- `gm.html` — the Game Master Center. The single source of truth for the
  whole game. Renders the countdown timer, current runner, every player's
  remaining presses, and the chronological dedication log.
- `index.html?player=NAME` — one page shared by every player, differentiated
  by the `?player=` query parameter. Has a button to become the runner and a
  text box for dedications.
- `index.html` — a small hub page linking to `gm.html` and to each player's
  link (built from the `PLAYERS` list in `shared.js`), just so you don't have
  to hand-type query params on game day.

## One-time setup

1. Create a free Supabase project at supabase.com.
2. In `shared.js`, fill in:
   ```js
   const SUPABASE_URL = "https://YOUR-PROJECT-ID.supabase.co";
   const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";
   ```
   Both values are on Project Settings -> API in the Supabase dashboard.
   The anon key is meant to be public/client-visible — that's expected here.
3. Edit the `PLAYERS` array in `shared.js` to match your session's player
   names. These names must match, ignoring case:
   - what you put in each player's `?player=NAME` link
   - the name typed in a dedication ("...muffins to NAME")
4. Push this folder to a GitHub repo and enable GitHub Pages for it. You'll
   end up with:
   - `https://yourname.github.io/reponame/gm.html`
   - `https://yourname.github.io/reponame/index.html?player=Alice`

## How it works

- Nothing is stored in a database. All game state (presses remaining,
  current runner, dedications, timer) lives only in the GM page's memory.
- Player pages only ever *send* two kinds of Broadcast messages: a button
  press, or a raw line of typed dedication text. They never receive
  anything back and show no confirmation beyond "message sent."
- The GM page is the only page that validates anything, and it does so the
  moment a message arrives, using its own clock — no timestamps are sent
  over the wire, since ordering is determined by whichever message the GM
  page's browser receives first.
- Because there's no persistence, **closing or reloading the GM page wipes
  the game, and reopening it always starts a fresh game** (everyone back to
  5 presses, no runner, no dedications). There is intentionally no "Reset"
  button — reloading the GM page *is* the reset.
- Invalid actions (pressing with 0 presses left, malformed or out-of-range
  dedication text) are silently ignored from the player's point of view —
  only logged to the GM's browser console (open DevTools on the GM page to
  see them), exactly as specified.

## Dedication text format

Players must type exactly (case-insensitive, "muffin" or "muffins" both work):

```
I officially dedicate 5.3 muffins to Charlie
```

Rules enforced by the GM page:
- amount must be a number greater than 0 and at most 6
- amount must be strictly greater than that same player's previous
  dedication to that same recipient (dedications can only increase)
- self-dedication is allowed ("...muffins to Alice" typed on Alice's page)

## Known limitations (by design, per current scope)

- No password/auth on the GM page — assume one trusted person uses it.
- No reconnection safety net: if a player's tab reloads mid-game, their
  local "presses remaining" display resets to 5/5, but this is only a
  *display* counter — the GM's press count for that player is unaffected
  since the GM is the sole authority.
- Ordering of near-simultaneous presses/dedications is determined by
  network arrival order at the GM's browser, not by a shared clock.
