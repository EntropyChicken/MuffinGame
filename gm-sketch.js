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

  // 1. ADD THIS LISTENER SO THE GM ACTUALLY HEARS THE PLAYER JOIN
  channel.on("broadcast", { event: EVENTS.JOIN }, (msg) => {
    handleJoinMessage(msg.payload);
  });

  channel.on("broadcast", { event: EVENTS.PRESS }, (msg) => {
    handlePressMessage(msg.payload);
  });

  channel.on("broadcast", { event: EVENTS.DEDICATE }, (msg) => {
    handleDedicateMessage(msg.payload);
  });

  channel.subscribe((status) => {
    channelStatusText = status;
    
    // Auto-reset hook from earlier
    if (status === "SUBSCRIBED") {
      channel.send({
        type: "broadcast",
        event: "GAME_RESET",
        payload: {}
      });
    }
  });
}

// ---- Message handlers -------------------------------------------------------

function handleJoinMessage(payload) {
  const player = payload && payload.player;
  
  const playerExists = PLAYERS.some(
    (p) => p.toLowerCase() === (player || "").toLowerCase()
  );

  if (!playerExists) {
    console.log(`Unrecognized player "${player}" tried to join.`);
    return;
  }

  channel.send({
    type: "broadcast",
    event: EVENTS.STATE_SYNC,
    payload: {
      player: player,
      pressesRemaining: pressesRemaining[player]
    }
  });
}
function handlePressMessage(payload) {
  const rawPlayer = payload && payload.player;

  if (gameStatus === "finished") {
    console.log(`${rawPlayer} pressed their button, but the game is already finished.`);
    return;
  }

  const player = PLAYERS.find(
    (p) => p.toLowerCase() === (rawPlayer || "").toLowerCase()
  );

  if (!player) {
    console.log(`Received a press from unrecognized player "${rawPlayer}".`);
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
  const amount = payload && payload.amount;
  const recipientRaw = payload && payload.recipient;

  if (gameStatus === "finished") {
    console.log(`${player} sent a dedication after the game had finished.`);
    return;
  }
  if (!PLAYERS.includes(player)) {
    console.log(`Received a dedication from unrecognized player "${player}".`);
    return;
  }
  if (!recipientRaw || isNaN(amount)) {
    console.log(`Received bad dedication data from ${player}.`);
    return;
  }
  const recipient = PLAYERS.find(
    (p) => p.toLowerCase() === recipientRaw.toLowerCase()
  );
  if (!recipient) {
    console.log(`${player} tried to dedicate to an unrecognized player "${recipientRaw}".`);
    return;
  }

  

  // math for capping at 6
  let currentTotalToOthers = 0;
  for (const target of PLAYERS) {
    if (target !== recipient) {
      currentTotalToOthers += (dedicationMax[player][target] || 0);
    }
  }

  const allowedMaxForThisRecipient = 6.0 - currentTotalToOthers;
  if (allowedMaxForThisRecipient <= 0) {
    console.log(`${player} has already hit their global 6-muffin limit.`);
    return;
  }
  let finalAmount = amount;
  if (finalAmount > allowedMaxForThisRecipient) {
    finalAmount = allowedMaxForThisRecipient;
    console.log(`${player}'s dedication to ${recipient} was capped at ${finalAmount} to respect the 6-muffin max.`);
  }
  const previousMax = dedicationMax[player][recipient];
  if (finalAmount <= previousMax) {
    console.log(`${player} tried to dedicate ${finalAmount} (capped) to ${recipient}, which doesn't exceed previous max of ${previousMax}.`);
    return;
  }

  



  dedicationMax[player][recipient] = finalAmount;
  dedicationLog = dedicationLog.filter(d => !(d.from === player && d.to === recipient));
  dedicationLog.push({
    time: Date.now(),
    from: player,
    to: recipient,
    amount: finalAmount // logs the capped version!
  });
}

// ---- Rendering ----------------------------------------------------------------

function draw() {
  checkWinCondition();

  drawBackgroud();
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
  
  textSize(115);
  if (gameStatus === "finished" || currentRunner === null) {
    fill(255);
  } else {
    fill(getTimeColor());
  }
  text(formatOneDecimal(getRemainingSeconds()), width / 2, 30);
  
  fill(255);
  textSize(34);
  if (gameStatus === "finished") {
    fill(242, 182, 50);
    text(`WINNER: ${winner}`, width / 2, 150);
  } else if (currentRunner) {
    fill(getTimeColor());
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

function drawBackgroud() {
  if (gameStatus === "finished") {
    background(30);
  } 
  else if (currentRunner === null) {
    // Checks if currentRunner is strictly null
    background(50);
  } 
  else {
    background(0);
  }
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
    fill(isRunner ? getTimeColor() : color(200));
    text(
      `${p}  —  ${pressesRemaining[p]} press${pressesRemaining[p] === 1 ? "" : "es"} left`,
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
  
  const x = width / 2;
  let y = playerListStartY(); 

  fill(200);
  text("DEDICATIONS", x, y);
  y += 35;

  if (dedicationLog.length === 0) {
    fill(120);
    text("(none yet)", x, y);
    return;
  }

  const availableHeight = height - 40 - y;
  const maxLinesPossible = floor(availableHeight / 35);

  let itemsToRender = dedicationLog;
  let showEllipsis = false;

  if (dedicationLog.length > maxLinesPossible) {
    showEllipsis = true;
    const allowedDedicationsCount = maxLinesPossible - 1;
    itemsToRender = dedicationLog.slice(dedicationLog.length - allowedDedicationsCount);
  }

  if (showEllipsis) {
    fill(120);
    text("...", x, y);
    y += 35;
  }

  // Draw the remaining dedications row by row without timestamps
  fill(200);
  for (const d of itemsToRender) {
    // UPDATED: No timestamp generation, cleaner layout output
    text(`${d.from} to ${d.to}: ${formatMuffins(d.amount)}`, x, y);
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

function getTimeColor() {
  let totalTime = RUN_DURATION_SECONDS * 1000;
  let timeLeft = max(0, timerEndTime - Date.now());
  let progress = timeLeft / totalTime;
  colorMode(HSB, 360, 100, 100);
  let timeColor = color((max(progress * 250-10,0)+360)%360,72,100);
  colorMode(RGB, 255);
  return timeColor;
}