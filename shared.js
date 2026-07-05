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

let maxMuffins = Quantity.fromString("6");
let runDurationSeconds = 60;
let maxPresses = 5;


const SESSION_HEARTBEAT_INTERVAL_MS = 5000;
const SESSION_STALE_TIMEOUT_MS = 18000; // no longer used for auto-takeover, kept for reference
const SESSION_CLAIM_TIMEOUT_MS = 6000;


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

	// Same-browser, same-tab-group duplicate guard (instant, no network)
	PING_EXISTING: "PING_EXISTING",
	I_AM_ALREADY_HERE: "I_AM_ALREADY_HERE",

	// Cross-device session ownership, arbitrated by the Game Master
	SESSION_CLAIM: "SESSION_CLAIM",
	SESSION_CLAIM_RESULT: "SESSION_CLAIM_RESULT",
	SESSION_HEARTBEAT: "SESSION_HEARTBEAT",
	SESSION_RELEASE: "SESSION_RELEASE",
	SESSION_REVOKED: "SESSION_REVOKED",

	PLAYER_REMOVED: "PLAYER_REMOVED"
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

function encodeQuantityPayload(value) {
	if (value instanceof Quantity) return value.toString();
	if (Array.isArray(value)) return value.map(encodeQuantityPayload);
	if (value && typeof value === "object") {
		const out = {};
		for (const [key, nestedValue] of Object.entries(value)) {
			out[key] = encodeQuantityPayload(nestedValue);
		}
		return out;
	}
	return value;
}

function decodeQuantityPayload(value) {
	if (typeof value === "string") {
		return Quantity.sanitizeInput(value) ? Quantity.fromString(value) : value;
	}
	if (Array.isArray(value)) return value.map(decodeQuantityPayload);
	if (value && typeof value === "object") {
		const out = {};
		for (const [key, nestedValue] of Object.entries(value)) {
			out[key] = decodeQuantityPayload(nestedValue);
		}
		return out;
	}
	return value;
}

function asQuantity(value) {
	if (value instanceof Quantity) return value;
	return Quantity.fromJSON(value);
}

function formatMuffins(amount) {
	const quantity = asQuantity(amount);
	if (quantity.isZero()) return "0";
	return quantity.toDisplayString();
}


// ==========================================================
// PERSISTENT DEVICE SESSION ID
//
// Stored in localStorage (NOT sessionStorage) so the same
// browser keeps the same identity across a plain reload AND
// across fully closing/reopening the tab or app. This is what
// lets a player leave and come back without ever looking like
// a duplicate to the Game Master.
// ==========================================================

const DEVICE_SESSION_STORAGE_KEY = "muffinGameDeviceSessionId";
let _cachedDeviceSessionId = null;

function getOrCreateDeviceSessionId() {
	if (_cachedDeviceSessionId) return _cachedDeviceSessionId;

	try {
		let id = localStorage.getItem(DEVICE_SESSION_STORAGE_KEY);
		if (!id) {
			id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
			localStorage.setItem(DEVICE_SESSION_STORAGE_KEY, id);
		}
		_cachedDeviceSessionId = id;
	} catch (err) {
		// localStorage unavailable (e.g. some private-browsing modes).
		// Fall back to an id that's at least stable for the life of this page.
		_cachedDeviceSessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	}

	return _cachedDeviceSessionId;
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