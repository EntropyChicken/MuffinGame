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

let timeSpeedMultiplier = 10;



// FIREWORKS I MADE FROM LIKE... IDK. COVID DAYS. 7TH GRADE? LOLLLLLL
let ganime = 0;
let sanime = 222;
let f = []; // Firework rockets array
let p = []; // Exploded particles array

class FireworkRocket {
  constructor(nfx, nfyv, nft) {
    this.x = nfx;
    this.y = height; // Dynamically uses full canvas height instead of a static 640
    this.yv = nfyv;
    this.type = nft;
  }
  
  draw() {
    noStroke();
    fill(random(123, 255));
    ellipse(this.x, this.y, 3 - this.yv / 2, 4 - this.yv / 2);
  }
  
  move() {
    this.y += this.yv;
    this.yv *= 0.98;
  }
  
  nature(id) {
    if (this.yv > -0.7) {
      if (this.type === 1) {
        let nextColors;
        if (ganime < 120) {
          nextColors = [random(0, 255), 255, random(0, 255)];
        } else if (ganime > 240) {
          nextColors = [255, random(50, 200), random(50, 200)];
        } else {
          nextColors = [random(0, 255), random(0, 255), 255];
        }
        for (let i = 0; i < 25; i++) {
          let nangle = random(0, 360);
          p.push(new FireworkParticle(this.x, this.y, random(-1, 2) * cos(nangle), random(-1, 2) * sin(nangle) - 3, nextColors));
        }
      } 
      else if (this.type === 2) {
        let nextcolorsmag = 255 * floor(random(0, 2));
        for (let i = 225; i < 316; i += 5) {
          p.push(new FireworkParticle(this.x, this.y, 1.5 * cos(i), 5 * sin(i) - 2, [255 - nextcolorsmag, nextcolorsmag, nextcolorsmag]));
        }
      } 
      else if (this.type === 3) {
        for (let i = 0; i < 361; i += 15) {
          let nextcolors;
          if (i % 2 === 0) { nextcolors = [255, 0, 0]; } 
          else if (i % 4 === 1) { nextcolors = [255, 150, 0]; } 
          else { nextcolors = [255, 230, 0]; }
          p.push(new FireworkParticle(this.x, this.y, 2.5 * cos(i), 2 * sin(i) - 4, nextcolors));
          p.push(new FireworkParticle(this.x, this.y, 1.5 * cos(i), 1.2 * sin(i) - 4, nextcolors));
          p.push(new FireworkParticle(this.x, this.y, 0.8 * cos(i), 0.5 * sin(i) - 4, nextcolors));
        }
      }
      f.splice(id, 1);
    }
  }
}
class FireworkParticle {
  constructor(npx, npy, npxv, npyv, npcolor) {
    this.x = npx;
    this.y = npy;
    this.xv = npxv;
    this.yv = npyv;
    this.color = [npcolor[0], npcolor[1], npcolor[2]];
  }
  
  draw() {
    noStroke();
    fill(this.color[0], this.color[1], this.color[2], 280 - this.yv * 32);
    ellipse(this.x, this.y, 10 - this.yv, 12 - this.yv);
  }
  
  move() {
    this.x += this.xv;
    this.y += this.yv;
    this.yv += 0.1;
    this.xv *= 0.99;
  }
  
  nature(id) {
    if (this.yv > 6) {
      p.splice(id, 1);
    }
  }
}





function setup() {
  createCanvas(windowWidth, windowHeight);
  angleMode(DEGREES); // Crucial for your cos() and sin() calculations to parse properly
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

  // Reset particles
  f = [];
  p = [];

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
    amount: finalAmount
  });
}

// ---- Rendering ----------------------------------------------------------------

function draw() {
  checkWinCondition();

  drawBackground();
  drawTimerAndRunner();
  drawPlayerList();
  if (gameStatus === "finished") {
    drawPayout();
  }
  drawDedicationLog();
  drawConnectionStatus();
}

// --- RENDERING HOOKS FOR BACKGROUNDS & TRAIL GENERATION ---
function drawBackground() {
  if (gameStatus === "finished") {
    // Semi-transparent overlay allows fireworks to leave motion trails
    fill(0, 40);
    rect(0, 0, width, height);
    runFireworkEngine();
  } 
  else if (currentRunner === null) {
    background(50);
  } 
  else {
    background(0);
  }
}

function runFireworkEngine() {
  // Incremental timing cycles
  if (ganime < 360) { ganime++; } else { ganime = 1; }
  if (sanime < 360) { sanime += 0.2; } else { sanime = 0.2; }
  
  if (sanime < 320) {
    if (sanime < 50) {
      if (ganime % 7 === 2) {
        f.push(new FireworkRocket(random(50, width - 50), -10, 2));
      }
    } 
    else if (ganime % 16 === 7) {
      f.push(new FireworkRocket(random(100, width - 100), random(-6, -15), 1));
    }
  } 
  else if (round(sanime) === 330) {
    // Giant type 3 clusters
    f.push(new FireworkRocket(100 + ((width - 200) / 10) * (ganime % 5), 3 * abs(ganime % 5 - 2) - 10, 3));
    f.push(new FireworkRocket(width-(100 + ((width - 200) / 10) * (ganime % 5)), 3 * abs(ganime % 5 - 2) - 10, 3));
  }

  // Loop backward through active arrays to safely splice out expired values
  for (let i = f.length - 1; i >= 0; i--) {
    f[i].move();
    f[i].draw();
    f[i].nature(i);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    p[i].move();
    p[i].draw();
    p[i].nature(i);
  }
}

function checkWinCondition() {
  if (gameStatus === "running") {
    if (keyIsDown(RIGHT_ARROW)) {
      let normalFrameMs = 1000 / frameRate();
      let warpedMs = normalFrameMs * (timeSpeedMultiplier - 1); // fast
      timerEndTime -= warpedMs;
    }
    if (keyIsDown(LEFT_ARROW)) {
      let normalFrameMs = 1000 / frameRate();
      let warpedMs = -2*normalFrameMs; // reverse
      timerEndTime -= warpedMs;
    }

    if (Date.now() >= timerEndTime) {
      gameStatus = "finished";
      winner = currentRunner;
    }
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
    fill(255, 182, 0);
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
  return n + 1;
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

  fill(255, 182, 0);
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

  fill(200);
  for (const d of itemsToRender) {
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
  let timeColor = color((max(progress * 250 - 10, 0) + 360) % 360, 72, 100);
  colorMode(RGB, 255);
  return timeColor;
}