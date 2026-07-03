/* =========================================================
   MUFFIN GAME — gm-sketch.js
   The Game Master Center. This page is the sole source of
   truth for the entire game: it holds all state in memory,
   listens for player button-presses and dedications over
   Supabase Realtime (Broadcast), and renders the big screen.

   There is no backend table and no "reset" button on purpose:
   closing/reloading this page throws away all state, and
   reopening it always starts a brand new game from scratch
   (everyone back to 5 presses, no runner, no dedications).
   ========================================================= */

let gameStatus;       // "waiting" | "running" | "finished"
let pressesRemaining; // { playerName: number }
let currentRunner;    // playerName | null
let timerEndTime;     // ms epoch timestamp | null
let winner;           // playerName | null

let dedicationMax;    // dedicationMax[from][to] = highest amount so far
let dedicationLog;    // [{ time, from, to, amount }], oldest first

let channel;
let channelStatusText = "connecting...";

function setup() {
  createCanvas(windowWidth, windowHeight);
  resetGameState();
  connectToSupabase();
}

function resetGameState() {
  gameStatus = "waiting";
  currentRunner = null;
  timerEndTime = null;
  winner = null;

  pressesRemaining = {};
  dedicationMax = {};
  dedicationLog = [];

  for (const p of PLAYERS) {
    pressesRemaining[p] = MAX_PRESSES;
    dedicationMax[p] = {};
    for (const q of PLAYERS) {
      dedicationMax[p][q] = 0;
    }
  }
}

function connectToSupabase() {
  channel = supabaseClient.channel(CHANNEL_NAME);

  channel.on("broadcast", { event: EVENTS.PRESS }, (msg) => {
    handlePressMessage(msg.payload);
  });

  channel.on("broadcast", { event: EVENTS.DEDICATE }, (msg) => {
    handleDedicateMessage(msg.payload);
  });

  channel.subscribe((status) => {
    channelStatusText = status;
  });
}

// ---- Message handlers -------------------------------------------------------

function handlePressMessage(payload) {
  const player = payload && payload.player;

  if (gameStatus === "finished") {
    console.log(`${player} pressed their button, but the game is already finished.`);
    return;
  }
  if (!PLAYERS.includes(player)) {
    console.log(`Received a press from unrecognized player "${player}".`);
    return;
  }
  if (pressesRemaining[player] <= 0) {
    console.log(`${player} tried to press their button but has 0 presses remaining.`);
    return;
  }

  pressesRemaining[player]--;
  currentRunner = player;
  gameStatus = "running";
  timerEndTime = Date.now() + RUN_DURATION_SECONDS * 1000;
}

function handleDedicateMessage(payload) {
  const player = payload && payload.player;
  const text = payload && payload.text;

  if (gameStatus === "finished") {
    console.log(`${player} sent a dedication after the game had already finished: "${text}"`);
    return;
  }
  if (!PLAYERS.includes(player)) {
    console.log(`Received a dedication from unrecognized player "${player}": "${text}"`);
    return;
  }

  const parsed = parseDedicationText(text);
  if (!parsed) {
    console.log(`Could not parse dedication text from ${player}: "${text}"`);
    return;
  }

  const { amount, recipientRaw } = parsed;
  const recipient = PLAYERS.find(
    (p) => p.toLowerCase() === recipientRaw.toLowerCase()
  );

  if (!recipient) {
    console.log(`${player} tried to dedicate to an unrecognized player "${recipientRaw}": "${text}"`);
    return;
  }
  if (!(amount > 0) || amount > MAX_MUFFINS) {
    console.log(`${player} sent an out-of-range dedication amount (${amount}): "${text}"`);
    return;
  }
  const previousMax = dedicationMax[player][recipient];
  if (amount <= previousMax) {
    console.log(`${player} tried to dedicate ${amount} to ${recipient}, which does not exceed their previous dedication of ${previousMax}: "${text}"`);
    return;
  }

  dedicationMax[player][recipient] = amount;
  dedicationLog.push({
    time: Date.now(),
    from: player,
    to: recipient,
    amount: amount
  });
}

// ---- Rendering ----------------------------------------------------------------

function draw() {
  checkWinCondition();

  background(18);

  drawTimerAndRunner();
  drawPlayerList();
  if (gameStatus === "finished") {
    drawPayout();
  }
  drawDedicationLog();
  drawConnectionStatus();
}

function checkWinCondition() {
  if (gameStatus === "running" && Date.now() >= timerEndTime) {
    gameStatus = "finished";
    winner = currentRunner;
  }
}

function getRemainingSeconds() {
  if (gameStatus === "running") {
    return max(0, (timerEndTime - Date.now()) / 1000);
  }
  if (gameStatus === "finished") {
    return 0;
  }
  return RUN_DURATION_SECONDS;
}

function drawTimerAndRunner() {
  textFont("monospace");
  textAlign(CENTER, TOP);

  fill(245);
  textSize(96);
  text(formatOneDecimal(getRemainingSeconds()), width / 2, 30);

  textSize(34);
  if (gameStatus === "finished") {
    fill(242, 182, 50);
    text(`WINNER: ${winner}`, width / 2, 150);
  } else if (currentRunner) {
    fill(120, 220, 160);
    text(`Runner: ${currentRunner}`, width / 2, 150);
  } else {
    fill(150);
    text("No runner yet", width / 2, 150);
  }
}

function playerListStartY() {
  return 220;
}

function playerListEndY() {
  return playerListStartY() + 22 + PLAYERS.length * 35 + 35;
}

function drawPlayerList() {
  textFont("monospace");
  textAlign(LEFT, TOP);
  textSize(28);

  const x = 30;
  let y = playerListStartY();

  fill(200);
  text("PLAYERS", x, y);
  y += 35;

  for (const p of PLAYERS) {
    const isRunner = p === currentRunner && gameStatus !== "finished";
    fill(isRunner ? color(120, 220, 160) : color(200));
    text(
      `${p}  —  ${pressesRemaining[p]} press${pressesRemaining[p] === 1 ? "" : "es"} remaining`,
      x,
      y
    );
    y += 35;
  }
}

function countPayoutLines() {
  let n = 0;
  for (const p of PLAYERS) {
    if (p === winner) continue;
    if ((dedicationMax[winner][p] || 0) > 0) n++;
  }
  return n + 1; // +1 for the "<winner> keeps X muffins" line
}

function payoutEndY() {
  if (gameStatus !== "finished") return playerListEndY();
  return playerListEndY() + 22 + countPayoutLines() * 35 + 35;
}

function drawPayout() {
  textFont("monospace");
  textAlign(LEFT, TOP);
  textSize(28);

  const x = 30;
  let y = playerListEndY();

  fill(242, 182, 50);
  text("PAYOUT", x, y);
  y += 35;

  let totalDedicated = 0;
  for (const p of PLAYERS) {
    if (p === winner) continue;
    const amt = dedicationMax[winner][p] || 0;
    if (amt > 0) {
      text(`${p} receives ${formatMuffins(amt)} muffins`, x, y);
      y += 35;
      totalDedicated += amt;
    }
  }
  const winnerKeeps = MAX_MUFFINS - totalDedicated;
  text(`${winner} keeps ${formatMuffins(winnerKeeps)} muffins`, x, y);
}

function drawDedicationLog() {
  textFont("monospace");
  textAlign(LEFT, TOP);
  textSize(28);

  const x = 30;
  let y = payoutEndY();

  fill(200);
  text("DEDICATIONS", x, y);
  y += 35;

  if (dedicationLog.length === 0) {
    fill(120);
    text("(none yet)", x, y);
    return;
  }

  fill(200);
  for (const d of dedicationLog) {
    const timeStr = new Date(d.time).toLocaleTimeString();
    text(`[${timeStr}] ${d.from} dedicated ${formatMuffins(d.amount)} muffins to ${d.to}`, x, y);
    y += 35;
  }
}

function drawConnectionStatus() {
  textFont("monospace");
  textAlign(RIGHT, BOTTOM);
  textSize(11);
  fill(90);
  text(`realtime: ${channelStatusText}`, width - 10, height - 10);
}
