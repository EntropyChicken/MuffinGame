# Muffin Game

An original game I came up with in order to write a story about game theory concepts falling apart under real-world behavior.

## Player Registration QR Code
Scan this code to join the game session as a player:

<img src="assets/join_qrcode.png" width="300" alt="Muffin Game Player Registration QR Code" />

## The Rules
* **The Goal:** Be the "runner" for 100 uninterrupted seconds to win.
* **The Buttons:** Each player has 5 presses. Pressing your button makes you the runner and resets the 100-second timer. 
* **The Reward:** The winner gets 6 muffins by default.
* **The Dedications:** At any time, players can officially dedicate fractions of their potential winnings to other players (or themselves). Dedications are binding, processed by the Game Master, and can only be increased, never lowered. The winner keeps whatever remains of the 6 muffins after their specific dedications are paid out.

## Technical Architecture

Built as static frontend pages communicating via Supabase Realtime (Broadcast). No database tables are used; all state lives in the Game Master's browser memory.

* **`gm.html` (Game Master Center):** The single source of truth. Manages the active timer, tracks press counts, calculates payouts, and dynamically renders the latest incoming dedications in a dedicated sidebar column. Reloading this page resets the entire game.
* **`index.html` (Player Hub & Client):** Differentiated by passing the player's name as a query parameter (`index.html?player=Name`). Contains the action buttons and the dedication entry field.