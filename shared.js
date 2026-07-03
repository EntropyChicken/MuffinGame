/* =========================================================
   MUFFIN GAME — shared.js
   Loaded by index.html, index.html, and gm.html.
   Holds: Supabase setup, game constants, and the dedication
   text parser (both pages need to agree on this format).
   ========================================================= */

// ---- 1) SUPABASE CONFIG ---------------------------------------------------
// Fill these in with your own project's values:
// Supabase Dashboard -> Project Settings -> API
const SUPABASE_URL = "https://hwwthixvanursqmxebfq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_zK-_D68FVdDzmMVUsPppBg_rJa7s0Mj";

// One shared client, used by whichever page loads this file.
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Every player page and the GM page join this same channel name.
const CHANNEL_NAME = "muffin-game-channel";

// ---- 2) GAME CONSTANTS -----------------------------------------------------
const MAX_PRESSES = 5;
const RUN_DURATION_SECONDS = 60;
const MAX_MUFFINS = 6;

const gameMasterPasswordHash = "49d180ecf56132819571bf39d9b7b342522a2ac6d23c1418d3338251bfe469c8";


// The players in this game. Edit this list for your session
// (names here must exactly match, ignoring case, what you hand
// out as ?player=NAME links, and what people type in dedications).
const PLAYERS = ["Alice", "Bob", "Charlie"];

// ---- 3) MESSAGE TYPES -------------------------------------------------------
const EVENTS = {
  PRESS: "press",
  DEDICATE: "dedicate",
  JOIN: "join",              // NEW: player -> GM, "what's my real state?"
  STATE_SYNC: "state_sync"   // NEW: GM -> that player, the answer
};

// ---- 4) DEDICATION TEXT FORMAT ----------------------------------------------
// Required phrasing (case-insensitive), e.g.:
//   "I officially dedicate 5.3 muffins to Charlie"
//   "I officially dedicate 1 muffin to Bob"
const DEDICATION_REGEX = /^i officially dedicate\s+([0-9]*\.?[0-9]+)\s+muffins?\s+to\s+(.+?)\s*$/i;

// Parses free text typed by a player.
// Returns { amount, recipientRaw } on success, or null if the
// text doesn't match the required format at all.
function parseDedicationText(text) {
  if (!text) return null;
  const match = text.trim().match(DEDICATION_REGEX);
  if (!match) return null;
  const amount = parseFloat(match[1]);
  if (isNaN(amount)) return null;
  const recipientRaw = match[2].trim();
  if (!recipientRaw) return null;
  return { amount, recipientRaw };
}

// ---- 5) FORMATTING HELPERS ---------------------------------------------------
// Always show exactly one decimal place, e.g. 20 -> "20.0", 5.34 -> "5.3"
function formatOneDecimal(n) {
  return Number(n).toFixed(1);
}

function formatMuffins(n) {
  if(n<1e-10){
    return n;
  }
  return parseFloat(n.toFixed(12)).toString();
}

async function sha256HashHex(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}