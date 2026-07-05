/* =========================================================
   MUFFIN GAME — shared.js
   Shared configuration, helpers, parser, and message types.
   Loaded by both the Game Master and Player clients.
   ========================================================= */

// ==========================================================
// SUPABASE CONFIG
// ==========================================================

const supabaseUrl = "https://hwwthixvanursqmxebfq.supabase.co";
const supabaseAnonKey = "sb_publishable_zK-_D68FVdDzmMVUsPppBg_rJa7s0Mj";

const supabaseClient = supabase.createClient(
	supabaseUrl,
	supabaseAnonKey
);

const channelName = "muffin-game-channel";


// ==========================================================
// GLOBAL GAME SETTINGS
// (Game Master overwrites these at startup and syncs them)
// ==========================================================

let maxMuffins = 6;
let runDurationSeconds = 60;
let maxPresses = 5;


// ==========================================================
// SHARED GAME STATE
// ==========================================================

let players = [];


// ==========================================================
// NETWORK EVENT NAMES
// ==========================================================

const EVENTS = {
	PRESS: "press",
	DEDICATE: "dedicate",
	JOIN: "join",

	STATE_SYNC: "state_sync",
	SETTINGS_SYNC: "settings_sync",
	DEDICATIONS_SYNC: "dedications_sync",

  REQUEST_ROSTER: "REQUEST_ROSTER",
	REQUEST_NAME: "request_name",
	APPROVE: "approve",
	DENY: "deny",

	DEDICATE_ERROR: "dedicate_error",

	GAME_RESET: "game_reset",
	ROSTER_SYNC: "ROSTER_SYNC",
	VERIFY_SESSION: "VERIFY_SESSION",
	VERIFY_SESSION_RESULT: "VERIFY_SESSION_RESULT",
	PING_EXISTING: "PING_EXISTING",
	I_AM_ALREADY_HERE: "I_AM_ALREADY_HERE",
	PLAYER_REMOVED: "PLAYER_REMOVED",
	PLAYER_LEFT: "PLAYER_LEFT"
};


// ==========================================================
// DEDICATION PARSER
// ==========================================================

const dedicationRegex =
	/^i officially dedicate\s+([0-9]*\.?[0-9]+)\s+muffins?\s+to\s+(.+?)\s*$/i;

function parseDedicationText(text) {

	if (!text) return null;

	const match = text.trim().match(dedicationRegex);

	if (!match) {
		return null;
	}

	const amount = parseFloat(match[1]);

	if (isNaN(amount)) {
		return null;
	}

	const recipientRaw = match[2].trim();

	if (!recipientRaw.length) {
		return null;
	}

	return {
		amount,
		recipientRaw
	};
}


// ==========================================================
// TIMER FORMATTER
// ==========================================================

function formatTimer(seconds) {

	if (seconds < 20) {
		return Number(seconds).toFixed(1);
	}

	return floor(seconds);
}


// ==========================================================
// MUFFIN FORMATTER
// ==========================================================

function formatMuffins(amount) {

	if (Math.abs(amount) < 1e-10) {
		return "0";
	}

	return parseFloat(amount.toFixed(12)).toString();
}


// ==========================================================
// SHA-256 PASSWORD HASHING
// ==========================================================

async function sha256HashHex(text) {

	const encoder = new TextEncoder();

	const data = encoder.encode(text);

	const hashBuffer =
		await crypto.subtle.digest("SHA-256", data);

	const hashArray =
		Array.from(new Uint8Array(hashBuffer));

	return hashArray
		.map(b => b.toString(16).padStart(2, "0"))
		.join("");
}