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

const gameMasterPasswordHash = "fc63a788b7769bc10b6c3621375e5fb883bb7e0dd2d4949d65a990d912d6fd81";
let isAuthenticated = false;

let addPlayerInput;
let requestedNamesQueue = []; // Holds strings of incoming requests
let requestElements = [];     // Holds the DOM buttons we render

// Session ledger: sole authority on who currently "owns" a player name.
// Keyed by lowercased player name -> { playerName, sessionId, claimedAt, lastSeen }
// claimedAt/lastSeen are always stamped with the GM's own Date.now(), never a
// client-supplied timestamp.
let sessionLedger = {};

let gameStatus;       // "running" | "finished"
let pressesRemaining; // { playerName: number }
let currentRunner;    // playerName | null
let timerEndTime;     // ms epoch timestamp | null
let winner;           // playerName | null

let dedicationMax;    // dedicationMax[from][to] = highest muffin amount as Quantity
let dedicationLog;    // [{ time, from, to, amount }] with Quantity amounts

let channel;
let channelStatusText = "connecting...";

let timeSpeedMultiplier = 20;
let buttonPressFlash = 0;
let playerWealth = {};
let leaderboardHeld = false;
let payoutAppliedThisRound = false;

let nextRoundButton;

let doTimeCrunchRedness = false;
let waitingRoomImg;
let spinnyWaitingRoom = false, buffer, bufferSize; // very laggy
let defaultTextBoxOpacity = 190;
let textBoxOpacity = defaultTextBoxOpacity;

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
    if (this.yv > -1.2) {
      if (this.type === 1) {
        let nextColors;
        if (ganime < 120) {
          nextColors = [random(0, 255), 255, random(0, 255)];
        } else if (ganime > 240) {
          nextColors = [255, random(50, 200), random(50, 200)];
        } else {
          nextColors = [random(0, 255), random(0, 255), 255];
        }
        for (let i = 0; i < 30; i++) {
          let nangle = random(0, 360);
          let myNextColors = [nextColors[0]+random(-50,50),nextColors[1]+random(-50,50),nextColors[2]+random(-50,50)];
          p.push(new FireworkParticle(this.x, this.y, random(0, 3) * cos(nangle), random(0, 3) * sin(nangle) - 3, myNextColors));
        }
      } 
      else if (this.type === 2) {
        let nextcolorsmag = 255 * floor(random(0, 2));
        for (let i = 225; i < 316; i += 5) {
          p.push(new FireworkParticle(this.x, this.y, random(1.4,1.6) * cos(i), random(4.5,4.8) * sin(i) - 2, [255 - nextcolorsmag, nextcolorsmag, nextcolorsmag]));
          p.push(new FireworkParticle(this.x, this.y, -random(1.4,1.6) * cos(i), -random(4.5,4.8) * sin(i) - 2, [nextcolorsmag, 255 - nextcolorsmag, 255 - nextcolorsmag]));
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
    if (this.yv > random(4,14)) {
      p.splice(id, 1);
    }
  }
}

let qrImg;
let cnv; 

function preload() {
  qrImg = loadImage('assets/join_qrcode.png');
}

async function setup() {
  createCanvas(windowWidth, windowHeight);
  angleMode(DEGREES);
  connectToSupabase();
  bufferSize = max(width, height) * 1.6;
  buffer = createGraphics(bufferSize, bufferSize);
  buffer.background(0);

  isAuthenticated = await checkGMPasswordHashed();
  if (!isAuthenticated) {
    return;
  }

  nextRoundButton = createButton("New Round");
  nextRoundButton.style("position", "fixed");
  nextRoundButton.style("bottom", "20px");
  nextRoundButton.style("right", "20px");   // leaves room for the Add player input
  nextRoundButton.style("padding", "8px 12px");
  nextRoundButton.style("font-family", "monospace");
  nextRoundButton.style("font-size", "16px");
  nextRoundButton.style("background", "#333");
  nextRoundButton.style("color", "#fff");
  nextRoundButton.style("border", "1px solid #555");
  nextRoundButton.style("border-radius", "4px");
  nextRoundButton.style("cursor", "pointer");
  nextRoundButton.style("z-index", "10000");
  nextRoundButton.mousePressed(startNextRound);

  addPlayerInput = createInput("");
  addPlayerInput.attribute("placeholder", "Remove player");
  addPlayerInput.style("position", "fixed");
  addPlayerInput.style("bottom", "20px");
  addPlayerInput.style("right", "144px");
  addPlayerInput.style("padding", "8px 12px");
  addPlayerInput.style("font-family", "monospace");
  addPlayerInput.style("font-size", "16px");
  addPlayerInput.style("width", "140px");
  addPlayerInput.style("background", "#333");
  addPlayerInput.style("color", "#fff");
  addPlayerInput.style("border", "1px solid #555");
  addPlayerInput.style("border-radius", "4px");
  addPlayerInput.style("z-index", "10000");

  addPlayerInput.elt.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      registerNewPlayer();
    }
  });
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

async function checkGMPasswordHashed() {
  return new Promise((resolve) => {
    let overlay = createDiv();
    
    overlay.style('position', 'fixed');
    overlay.style('top', '50%'); overlay.style('left', '50%');
    overlay.style('transform', 'translate(-50%, -50%)');
    overlay.style('width', 'auto'); overlay.style('height', 'auto');
    overlay.style('padding', '30px 40px');
    overlay.style('background', '#121212');
    overlay.style('border-radius', '12px');
    overlay.style('box-shadow', '0 0 40px rgba(0,0,0,0.8)');

    overlay.style('display', 'flex'); overlay.style('flex-direction', 'column');
    overlay.style('justify-content', 'center'); overlay.style('align-items', 'center');
    overlay.style('gap', '15px'); 
    overlay.style('z-index', '99999');
    overlay.style('font-family', 'monospace');

    let qrLabel = createP("PLAYER JOIN CODE:").parent(overlay);
    qrLabel.style('color', '#ffffff'); qrLabel.style('font-size', '24px'); qrLabel.style('margin', '0');
    qrLabel.style("font-size","24px");

    let qrCodeImg = createImg('assets/join_qrcode.png', 'Player QR Code').parent(overlay);
    qrCodeImg.style('width', '300px');
    qrCodeImg.style('height', '300px');
    qrCodeImg.style('margin-bottom', '20px');

    let settingsLabel = createP("SETTINGS:").parent(overlay);
    settingsLabel.style('color', '#ffffff'); settingsLabel.style('font-size', '18px'); settingsLabel.style('margin', '0');
    settingsLabel.style("font-size","24px");

    let settingsRow = createDiv().parent(overlay);
    settingsRow.style('display', 'flex'); settingsRow.style('gap', '10px');

    let muffinInput = createInput(maxMuffins.toDisplayString()).parent(settingsRow);
    muffinInput.attribute("placeholder", "Max Muffins");
    muffinInput.style('padding', '8px'); muffinInput.style('font-size', '16px'); muffinInput.style('width', '120px');
    muffinInput.style('text-align', 'center'); muffinInput.style('background', '#222'); muffinInput.style('color', '#fff'); muffinInput.style('border', '1px solid #555'); muffinInput.style('border-radius', '4px');

    let timerInput = createInput("60").parent(settingsRow);
    timerInput.attribute("placeholder", "Timer Seconds");
    timerInput.style('padding', '8px'); timerInput.style('font-size', '16px'); timerInput.style('width', '120px');
    timerInput.style('text-align', 'center'); timerInput.style('background', '#222'); timerInput.style('color', '#fff'); timerInput.style('border', '1px solid #555'); timerInput.style('border-radius', '4px');

    let pressesInput = createInput("5").parent(settingsRow);
    pressesInput.attribute("placeholder", "Max Presses");
    pressesInput.style('padding', '8px'); pressesInput.style('font-size', '16px'); pressesInput.style('width', '120px');
    pressesInput.style('text-align', 'center'); pressesInput.style('background', '#222'); pressesInput.style('color', '#fff'); pressesInput.style('border', '1px solid #555'); pressesInput.style('border-radius', '4px');

    let passLabel = createP("PASSWORD:").parent(overlay);
    passLabel.style('color', '#ffffff'); passLabel.style('font-size', '24px'); passLabel.style('margin', '15px 0 0 0');
    passLabel.style("font-size","24px");

    let passInput = createInput("").parent(overlay);
    passInput.attribute("type", "password");
    passInput.style('padding', '10px 15px'); 
    passInput.style('font-size', '18px'); 
    passInput.style('text-align', 'center');
    passInput.style('font-family', 'monospace');
    passInput.style('background', '#222');
    passInput.style('color', '#fff');
    passInput.style('border', '1px solid #555');
    passInput.style('border-radius', '4px');
    passInput.elt.focus();

    const submitPass = async () => {
      const entered = passInput.value().trim();
      
      if (await sha256HashHex(entered) === gameMasterPasswordHash) {
        const rawMaxMuffins = muffinInput.value().trim();
        maxMuffins = Quantity.fromString(rawMaxMuffins || maxMuffins.toDisplayString());
        runDurationSeconds = parseFloat(timerInput.value()) || 60;
        maxPresses = parseInt(pressesInput.value()) || 5;
        
        channel.send({
          type: "broadcast",
          event: EVENTS.SETTINGS_SYNC,
          payload: { maxMuffins: encodeQuantityPayload(maxMuffins), runDurationSeconds, maxPresses }
        });
        
        resetGameState();
        overlay.remove(); 
        resolve(true);
      } else {
        alert("Access Denied.");
        window.location.href = "index.html";
        resolve(false);
      }
    };

    passInput.elt.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitPass();
      }
    });
  });
}

function resetGameState() {
  gameStatus = "running";
  currentRunner = null;
  timerEndTime = Date.now() + runDurationSeconds * 1000;
  winner = null;
  payoutAppliedThisRound = false;

  pressesRemaining = {};
  dedicationMax = {};
  dedicationLog = [];

  f = [];
  p = [];
  for (const p of players) {
    const key = p.toLowerCase();
    if (!(key in playerWealth)) {
      playerWealth[key] = Quantity.zero();
    }
    pressesRemaining[p] = maxPresses;
    dedicationMax[p] = {};
    for (const q of players) {
      dedicationMax[p][q] = Quantity.zero();
    }
  }
}

function resolveSessionClaim(rawPlayerName, sessionId) {
  if (!rawPlayerName || !sessionId) return { accepted: false };

  const key = rawPlayerName.toLowerCase();
  const now = Date.now();
  const existing = sessionLedger[key];

  // Accept if it's a brand new claim, or if the SAME device is reclaiming it
  if (!existing || existing.sessionId === sessionId) {
    sessionLedger[key] = {
      playerName: rawPlayerName,
      sessionId,
      claimedAt: existing ? existing.claimedAt : now,
      lastSeen: now
    };
    return { accepted: true };
  }

  // FIX: Never allow a different device to take over an existing session.
  // This prevents the original player from being accidentally booted.
  return { accepted: false };
}

// A heartbeat only updates lastSeen if the sender still matches the
// ledger's current owner. If it doesn't (because the slot was taken
// over while this device was out of contact), the sender is told to
// stand down so it can show the duplicate-session screen instead of
// silently pressing dead buttons.
function handleSessionHeartbeat(rawPlayerName, sessionId) {
  if (!rawPlayerName || !sessionId) return { stillOwner: false };

  const key = rawPlayerName.toLowerCase();
  const existing = sessionLedger[key];

  if (existing && existing.sessionId === sessionId) {
    existing.lastSeen = Date.now();
    return { stillOwner: true };
  }

  return { stillOwner: false };
}

// Best-effort courtesy release on a clean tab close. Only clears the
// ledger if the releasing device is still the current owner, so a
// slower "goodbye" from an already-superseded session can't stomp on
// whoever has already taken the name over.
function releaseSession(rawPlayerName, sessionId) {
  if (!rawPlayerName || !sessionId) return;

  const key = rawPlayerName.toLowerCase();
  const existing = sessionLedger[key];
  if (existing && existing.sessionId === sessionId) {
    delete sessionLedger[key];
  }
}

function connectToSupabase() {
  channel = supabaseClient.channel(channelName);

  channel.on("broadcast", { event: EVENTS.SESSION_CLAIM }, (msg) => {
    const payload = msg.payload || {};
    const rawPlayerName = payload.player;
    const sessionId = payload.sessionId;
    
    // FIX: Don't silently return if sessionId is missing. 
    // We must send a rejection back so the player doesn't hang forever.
    if (!rawPlayerName) return; 

    const result = resolveSessionClaim(rawPlayerName, sessionId);

    if (result.accepted && result.tookOverFrom) {
      channel.send({
        type: "broadcast",
        event: EVENTS.SESSION_REVOKED,
        payload: { player: rawPlayerName, sessionId: result.tookOverFrom }
      });
    }

    channel.send({
      type: "broadcast",
      event: EVENTS.SESSION_CLAIM_RESULT,
      payload: { player: rawPlayerName, sessionId, accepted: result.accepted }
    });
  });

  channel.on("broadcast", { event: EVENTS.SESSION_HEARTBEAT }, (msg) => {
    const payload = msg.payload || {};
    const rawPlayerName = payload.player;
    const sessionId = payload.sessionId;
    if (!rawPlayerName || !sessionId) return;

    const result = handleSessionHeartbeat(rawPlayerName, sessionId);
    if (!result.stillOwner) {
      channel.send({
        type: "broadcast",
        event: EVENTS.SESSION_REVOKED,
        payload: { player: rawPlayerName, sessionId }
      });
    }
  });

  channel.on("broadcast", { event: EVENTS.SESSION_RELEASE }, (msg) => {
    const payload = msg.payload || {};
    if (payload.player && payload.sessionId) {
      releaseSession(payload.player, payload.sessionId);
    }
  });

  channel.on("broadcast", { event: EVENTS.PRESS }, (msg) => {
    handlePressMessage(msg.payload);
  });
  channel.on("broadcast", { event: EVENTS.DEDICATE }, (msg) => {
    handleDedicateMessage(msg.payload);
  });
  channel.on("broadcast", { event: EVENTS.REQUEST_NAME }, (msg) => {
    handleNameRequest(msg.payload);
  });

  channel.on("broadcast", { event: EVENTS.REQUEST_ROSTER }, () => {
    channel.send({
      type: "broadcast",
      event: EVENTS.ROSTER_SYNC,
      payload: { 
        currentPlayers: players,
        pressesRemaining: pressesRemaining,
        requestedNamesQueue: requestedNamesQueue
      }
    });
    channel.send({
      type: "broadcast",
      event: EVENTS.SETTINGS_SYNC,
      payload: { maxPresses, maxMuffins: encodeQuantityPayload(maxMuffins), runDurationSeconds }
    });
    channel.send({
      type: "broadcast",
      event: EVENTS.DEDICATIONS_SYNC,
      payload: { dedicationMax: encodeQuantityPayload(dedicationMax) }
    });
  });

  channel.subscribe((status) => {
    channelStatusText = status;
    
    if (status === "SUBSCRIBED") {
      setTimeout(() => {
        channel.send({
          type: "broadcast",
          event: EVENTS.GAME_RESET,
          payload: {}
        });
      }, 500);
    }
  });
}

function removePlayerFromGame(playerName) {
  if (!playerName || gameStatus === "finished") return false;

  const targetLower = playerName.toLowerCase();
  const matchingPlayers = players.filter((p) => p.toLowerCase() === targetLower);
  if (!matchingPlayers.length) return false;

  const removedNames = matchingPlayers.map((p) => p);

  players = players.filter((p) => p.toLowerCase() !== targetLower);

  for (const removedName of removedNames) {
    delete pressesRemaining[removedName];
    delete playerWealth[removedName.toLowerCase()];
    delete dedicationMax[removedName];
    delete sessionLedger[removedName.toLowerCase()];
  }

  for (const remainingPlayer of players) {
    for (const removedName of removedNames) {
      delete dedicationMax[remainingPlayer][removedName];
    }
  }

  dedicationLog = dedicationLog.filter(
    (entry) => !((entry.from && entry.from.toLowerCase() === targetLower) || (entry.to && entry.to.toLowerCase() === targetLower))
  );

  if (currentRunner && currentRunner.toLowerCase() === targetLower) {
    currentRunner = null;
  }
  if (winner && winner.toLowerCase() === targetLower) {
    winner = null;
  }

  if (channel) {
    channel.send({
      type: "broadcast",
      event: EVENTS.ROSTER_SYNC,
      payload: {
        currentPlayers: players,
        pressesRemaining: pressesRemaining,
        requestedNamesQueue: requestedNamesQueue
      }
    });

    channel.send({
      type: "broadcast",
      event: EVENTS.DEDICATIONS_SYNC,
      payload: { dedicationMax: encodeQuantityPayload(dedicationMax) }
    });

    channel.send({
      type: "broadcast",
      event: EVENTS.PLAYER_REMOVED,
      payload: { player: playerName }
    });
  }

  return true;
}

function registerNewPlayer() {
  const newName = addPlayerInput.value().trim();
  if (!newName) return;

  const caseInsensitiveExisting = players.filter((p) => p.toLowerCase() === newName.toLowerCase());
  if (caseInsensitiveExisting.length && gameStatus !== "finished") {
    const removed = removePlayerFromGame(newName);
    if (removed) {
      console.log(`Removed player: ${newName}`);
    }
    addPlayerInput.value("");
    return;
  }

  const exists = players.some((p) => p.toLowerCase() === newName.toLowerCase());
  if (exists) {
    console.log(`Player "${newName}" is already in the game.`);
    addPlayerInput.value("");
    return;
  }

  players.push(newName);
  if (!(newName.toLowerCase() in playerWealth)) {
    playerWealth[newName.toLowerCase()] = Quantity.zero();
  }
  pressesRemaining[newName] = maxPresses;
  dedicationMax[newName] = {};

  for (const existingPlayer of players) {
    dedicationMax[existingPlayer][newName] = Quantity.zero();
    dedicationMax[newName][existingPlayer] = Quantity.zero();
  }

  console.log(`Successfully added new player: ${newName}`);

  if (channel) {
    channel.send({
      type: "broadcast",
      event: EVENTS.APPROVE,
      payload: { approvedName: newName }
    });

    channel.send({
      type: "broadcast",
      event: EVENTS.ROSTER_SYNC,
      payload: { 
        currentPlayers: players, 
        pressesRemaining: pressesRemaining,
        requestedNamesQueue: requestedNamesQueue
      }
    });

    channel.send({
      type: "broadcast",
      event: EVENTS.DEDICATIONS_SYNC,
      payload: { dedicationMax: encodeQuantityPayload(dedicationMax) }
    });
  }
  
  addPlayerInput.value("");
}

function handlePressMessage(payload) {
  const rawPlayer = payload && payload.player;

  if (gameStatus === "finished") {
    console.log(`${rawPlayer} pressed their button, but the game is already finished.`);
    return;
  }

  const player = players.find(
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

  buttonPressFlash += 1;

  // make black
  waitingRoomImg = createImage(width, height);
  waitingRoomImg.loadPixels();
  for (let i = 0; i < waitingRoomImg.pixels.length; i += 4) {
    waitingRoomImg.pixels[i] = 0;     // R
    waitingRoomImg.pixels[i+1] = 0;   // G
    waitingRoomImg.pixels[i+2] = 0;   // B
    waitingRoomImg.pixels[i+3] = 255; // A
  }
  waitingRoomImg.updatePixels();

  pressesRemaining[player]--;
  currentRunner = player;
  gameStatus = "running";
  timerEndTime = Date.now() + runDurationSeconds * 1000;
}

function handleDedicateMessage(payload) {
  const player = payload && payload.player;
  const amountRaw = payload && payload.amount;
  const amount = asQuantity(amountRaw);
  const recipientRaw = payload && payload.recipient;

  if (gameStatus === "finished") {
    console.log(`${player} sent a dedication after the game had finished.`);
    return;
  }
  if (!players.includes(player)) {
    console.log(`Received a dedication from unrecognized player "${player}".`);
    return;
  }
  if (!recipientRaw || !amountRaw || !Quantity.sanitizeInput(amountRaw)) {
    console.log(`Received bad dedication data from ${player}.`);
    return;
  }
  const recipient = players.find(
    (p) => p.toLowerCase() === recipientRaw.toLowerCase()
  );
  if (!recipient) {
    console.log(`${player} tried to dedicate to an unrecognized player "${recipientRaw}".`);
    return;
  }

  let currentTotalToOthers = Quantity.zero();
  for (const target of players) {
    if (target !== recipient) {
      currentTotalToOthers = currentTotalToOthers.add(dedicationMax[player][target] || Quantity.zero());
    }
  }

  if (amount.add(currentTotalToOthers).isGreaterThan(maxMuffins)) {
    channel.send({
       type: "broadcast",
       event: EVENTS.DEDICATE_ERROR,
       payload: { player: player, message: `ERROR: Giving ${amount.toDisplayString()} more would exceed your limit of ${maxMuffins.toDisplayString()} total muffins.` }
    });
    console.log(`${player} hit their ${maxMuffins.toDisplayString()}-muffin max cap and was rejected.`);
    return;
  }

  const previousMax = dedicationMax[player][recipient];
  if (amount.isLessThanOrEqualTo(previousMax)) {
    console.log(`${player} tried to dedicate ${amount.toDisplayString()} to ${recipient}, which doesn't exceed previous max of ${previousMax.toDisplayString()}.`);
    return;
  }

  dedicationMax[player][recipient] = amount;
  dedicationLog = dedicationLog.filter(d => !(d.from === player && d.to === recipient));
  dedicationLog.push({
    time: Date.now(),
    from: player,
    to: recipient,
    amount: amount
  });

  channel.send({
    type: "broadcast",
    event: EVENTS.DEDICATIONS_SYNC,
    payload: { dedicationMax: encodeQuantityPayload(dedicationMax) }
  });
}

function handleNameRequest(payload) {
  const name = payload && payload.requestedName ? payload.requestedName.trim() : null;
  if (!name) return;

  const nameLower = name.toLowerCase();
  const existing = players.some(p => p.toLowerCase() === nameLower);
  const isPending = requestedNamesQueue.some(p => p.toLowerCase() === nameLower);

  // If it's already officially in or waiting, ignore any secondary adversarial network requests
  if (existing || isPending) {
    return;
  }

  // Safe new unique request
  requestedNamesQueue.push(name);

  const maxVisibleRequests = 1000;
  if (requestedNamesQueue.length > maxVisibleRequests) {
    requestedNamesQueue.shift();
  }

  // Broadcast the updated queue to all players
  channel.send({
    type: "broadcast",
    event: EVENTS.ROSTER_SYNC,
    payload: { currentPlayers: players, pressesRemaining: pressesRemaining, requestedNamesQueue: requestedNamesQueue }
  });

  renderRequestConsole();
}

function draw() {
  if (!isAuthenticated) {
    drawWaitingRoom(1,0,1,1);
    background(70,80);
    return; 
  }

  checkWinCondition();
  drawBackground();
  drawTimerAndRunner();
  drawPlayerList();
  if (gameStatus === "finished") {
    drawPayout();
  }
  drawDedicationLog();
  drawConnectionStatus();
  
  if (leaderboardHeld) {
    drawLeaderboard();
  }
}
function drawWaitingRoom(scaleFactor=1.0008, angleChange=0.025, iterations=2, fadeFreq=0.1, col) {
  push();
  for(let iter = 0; iter<iterations; iter++){ 
    push();
    translate(width / 2, height / 2);
    scale(scaleFactor);
    if(spinnyWaitingRoom){
      rotate(angleChange);
    }
    imageMode(CENTER);
    if (waitingRoomImg !== undefined){
      image(waitingRoomImg, 0, 0);
    }
    pop();

    noFill();
    strokeWeight(10);
    let high = constrain(random(-20, 400),0,255);
    if (col === undefined) {
      if (random(0, 2) < 1) {
        stroke(high, high * 0.7, 0, random(50, 170));
      } else {
        stroke(high * 0.4, high * 0.4, high, random(50, 210));
      }
    }
    else{
      stroke(red(col),green(col),blue(col),random(50, 210));
    }
    
    let rad = pow(random(0, 1.1), 6) * 40 + 15;
    if (random(0, 10) < 1) {
      rad *= random(1, 3);
    }
    let x = random(-rad, width + rad);
    let y = random(-rad, height + rad);
    ellipse(x, y, rad * 2, rad * 2);
    
    if(random(0,1)<fadeFreq){
      background(0,5);
    }
    waitingRoomImg = get();
  }
  pop();
}

function drawBackground() {
  if (gameStatus === "finished") {
    textBoxOpacity = defaultTextBoxOpacity;
    fill(0, 30);
    rect(0, 0, width, height);
    runFireworkEngine();
  } 
  else if (currentRunner === null) {
    textBoxOpacity = 0;
    let bright = 40;
    if(getRemainingSeconds()<20){
      bright = max(0,map(getRemainingSeconds(),5,20,0,40));
    }
    background(bright + (255-bright) * buttonPressFlash);
  } 
  else {
    textBoxOpacity = defaultTextBoxOpacity;
    let redness = 0;
    if(doTimeCrunchRedness && getRemainingSeconds()<18){
      redness = max(0,1.5*max(8,18-getRemainingSeconds())*(1+sin(millis()*PI/4)));
    }
    let baseColor = color(redness,0,0);
    let backgroundColor = getTimeColor();
    backgroundColor.setAlpha(buttonPressFlash);
    
    if(getRemainingSeconds()>10){
      drawWaitingRoom(1.0015,0.06,1,0.1,getTimeColor());
      background(0,max(170,map(sqrt(map(getRemainingSeconds(),10,runDurationSeconds,0,1)),0,1,255,100)));
    }
    else{
      background(0);
    }
    
    background(backgroundColor);
  }
  
  buttonPressFlash *= 0.9;
}

function runFireworkEngine() {
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
    f.push(new FireworkRocket(100 + ((width - 200) / 10) * (ganime % 5), 3 * abs(ganime % 5 - 2) - 10, 3));
    f.push(new FireworkRocket(width-(100 + ((width - 200) / 10) * (ganime % 5)), 3 * abs(ganime % 5 - 2) - 10, 3));
  }

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
      let warpedMs = normalFrameMs * (timeSpeedMultiplier - 1);
      timerEndTime -= warpedMs;
    }
    if (keyIsDown(LEFT_ARROW)) {
      let normalFrameMs = 1000 / frameRate();
      let warpedMs = -normalFrameMs * (timeSpeedMultiplier + 1);
      timerEndTime -= warpedMs;
    }

    if (Date.now() >= timerEndTime) {
      gameStatus = "finished";
      winner = currentRunner || null;
      if (!payoutAppliedThisRound) {
        payoutAppliedThisRound = true;
        applyRoundPayout();
      }
    }
  }
}
function applyRoundPayout() {

	if (winner) {

		let totalDedicated = Quantity.zero();

		for (const p of players) {

			if (p === winner) continue;

			const amt = dedicationMax[winner][p] || Quantity.zero();

			totalDedicated = totalDedicated.add(amt);

			playerWealth[p.toLowerCase()] = (playerWealth[p.toLowerCase()] || Quantity.zero()).add(amt);
		}

		playerWealth[winner.toLowerCase()] = (playerWealth[winner.toLowerCase()] || Quantity.zero()).add(maxMuffins.subtract(totalDedicated));
	}
	else {
    // everyone tied for first place gets annihilated (back to zero wealth over all games)
		let richestWealth = Quantity.zero();
		for (const p of players) {
			const wealth = asQuantity(playerWealth[p.toLowerCase()] || Quantity.zero());
			if (wealth.isGreaterThan(richestWealth)) {
				richestWealth = wealth;
			}
		}

		for (const p of players) {
			const wealth = asQuantity(playerWealth[p.toLowerCase()] || Quantity.zero());
			if (wealth.isEqualTo(richestWealth)) {
				playerWealth[p.toLowerCase()] = Quantity.zero();
			}
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
  return runDurationSeconds;
}

function textBox(...args) {
  const str = args[0];
  const x = args[1];
  const y = args[2];

  push();
  const currentFill = drawingContext.fillStyle;
  const textW = textWidth(str);
  const textH = textAscent() + textDescent();
  const hAlign = drawingContext.textAlign || "left";
  const vAlign = drawingContext.textBaseline || "alphabetic";

  let boxX = x;
  let boxY = y;
  const padX = 20;
  const padY = 12;
  const radius = 8;

  if (hAlign === "center") {
    boxX = x - textW / 2 - padX;
  } else if (hAlign === "right") {
    boxX = x - textW - padX;
  } else {
    boxX = x - padX;
  }

  if (vAlign === "top") {
    boxY = y - padY;
  } else if (vAlign === "middle") {
    boxY = y - textH / 2 - padY;
  } else if (vAlign === "bottom") {
    boxY = y - textH - padY;
  } else {
    boxY = y - textAscent() - padY;
  }

  noStroke();
  rectMode(CORNER);
  fill(0, textBoxOpacity);
  rect(boxX, boxY, textW + padX * 2, textH + padY*1.7, radius);
  fill(currentFill);
  text(...args);
  pop();
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
  textBox(formatTimer(getRemainingSeconds()), width / 2, 30);
  
  fill(255);
  textSize(60);
  if (gameStatus === "finished") {
    fill(255, 182, 0);
    textBox(winner ? `WINNER: ${winner}` : "The wealthiest players lose all their wealth💀", width / 2, 142);
  } else if (currentRunner) {
    fill(getTimeColor());
    textBox(`Runner: ${currentRunner}`, width / 2, 142);
  } else {
    fill(150);
    textBox("Runner: nobody yet", width / 2, 142);
  }
}

function playerListStartY() {
  return 220;
}

function playerListEndY() {
  return playerListStartY() + 22 + players.length * 35 + 35;
}

function drawPlayerList() {
  textFont("monospace");
  textAlign(LEFT, TOP);
  textSize(28);

  const x = 30;
  let y = playerListStartY();

  fill(200);
  textBox("PLAYERS:", x, y);
  y += 35;
  
  if (players.length === 0) {
    fill(120);
    textBox("(none yet)", x, y);
    return;
  }

  let maxNameWidth = 0;
  for (const p of players) {
    let w = textWidth(p);
    if (w > maxNameWidth) {
      maxNameWidth = w;
    }
  }

  const statusGap = 20; 
  
  for (const p of players) {
    const isRunner = p === currentRunner && gameStatus !== "finished";
    fill(isRunner ? getTimeColor() : color(200));
    
    textBox(p, x, y);
    
    const statusX = x + maxNameWidth + statusGap;
    const statusTextString = "("+pressesRemaining[p]+" left)";
    textBox(statusTextString, statusX, y);
    
    y += 35;
  }
}

function countPayoutLines() {
  let n = 0;
  if (!winner) return 0;
  for (const p of players) {
    if (p === winner) continue;
    if (dedicationMax[winner] && dedicationMax[winner][p] && dedicationMax[winner][p].isGreaterThan(Quantity.zero())) n++;
  }
  return n + 1;
}

function payoutEndY() {
  if (gameStatus !== "finished") return playerListEndY();
  return playerListEndY() + 22 + countPayoutLines() * 35 + 35;
}

function drawPayout() {
  if (!winner) return;
  
  textFont("monospace");
  textAlign(LEFT, TOP);
  textSize(28);

  const x = 30;
  let y = playerListEndY();

  fill(255, 182, 0);
  textBox("PAYOUT:", x, y);
  y += 35;

  let totalDedicated = Quantity.zero();
  for (const p of players) {
    if (p === winner) continue;
    const amt = dedicationMax[winner][p] || Quantity.zero();
    if (amt.isGreaterThan(Quantity.zero())) {
      textBox(`${p} gets ${formatMuffins(amt)} muffins!`, x, y);
      y += 35;
      totalDedicated = totalDedicated.add(amt);
    }
  }
  const winnerKeeps = maxMuffins.subtract(totalDedicated);
  textBox(`${winner} gets ${formatMuffins(winnerKeeps)} muffins!`, x, y); // muffins! 🏆
}

function drawDedicationLog() {
  textFont("monospace");
  textAlign(LEFT, TOP);
  textSize(28);
  
  const x = width / 2;
  let y = playerListStartY(); 

  fill(200);
  textBox("DEDICATIONS:", x, y);
  y += 35;

  if (dedicationLog.length === 0) {
    fill(120);
    textBox("(none yet)", x, y);
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
    textBox("...", x, y);
    y += 35;
  }

  fill(200);
  for (const d of itemsToRender) {
    textBox(`${d.from} to ${d.to}: ${formatMuffins(d.amount)}`, x, y);
    y += 35;
  }
}

function drawConnectionStatus() {
  textFont("monospace");
  textAlign(RIGHT, BOTTOM);
  textSize(10);
  fill(90);
  textBox(`realtime: ${channelStatusText}`, width - 5, height - 5);
}

function getTimeColor() {
  let totalTime = runDurationSeconds * 1000;
  let timeLeft = max(0, timerEndTime - Date.now());
  let progress = timeLeft / totalTime;
  colorMode(HSB, 360, 100, 100);
  let timeColor = color((max(progress * 300 - 65, 0) + 360) % 360, 72, 100);
  colorMode(RGB, 255);
  return timeColor;
}

function renderRequestConsole() {
  for (let el of requestElements) {
    el.remove();
  }
  requestElements = [];

  let currentX = 20;
  const currentY = height - 70;

  if (requestedNamesQueue.length > 0) {
    let title = createSpan("Pending Approval:");
    title.position(currentX, currentY - 25);
    title.style("font-family", "monospace");
    title.style("color", "#ffb600");
    title.style("font-size", "14px");
    requestElements.push(title);
  }

  for (let i = 0; i < requestedNamesQueue.length; i++) {
    const candidateName = requestedNamesQueue[i];

    let btn = createButton(`＋ ${candidateName}`);
    btn.position(currentX, currentY);
    btn.style("padding", "6px 10px");
    btn.style("font-family", "monospace");
    btn.style("background", "#2a4d2a");
    btn.style("color", "#fff");
    btn.style("border", "1px solid #44aa44");
    btn.style("border-radius", "4px");
    btn.style("cursor", "pointer");

    btn.mousePressed((event) => {
      if (event.button === 0) {
        addPlayerInput.value(candidateName);
        registerNewPlayer();

        requestedNamesQueue.splice(i, 1);
        renderRequestConsole();
      }
    });

    btn.elt.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      
      if (channel) {
        channel.send({
          type: "broadcast",
          event: EVENTS.DENY,
          payload: { deniedName: candidateName }
        });
      }
      requestedNamesQueue.splice(i, 1);
      channel.send({
        type: "broadcast",
        event: EVENTS.ROSTER_SYNC,
        payload: { currentPlayers: players, pressesRemaining: pressesRemaining, requestedNamesQueue: requestedNamesQueue }
      });
      renderRequestConsole();
    });

    requestElements.push(btn);
    currentX += btn.elt.offsetWidth + 12; 
  }
}

function startNextRound() {
	resetGameState();
	channel.send({
		type:"broadcast",
		event:EVENTS.GAME_RESET,
		payload:{}
	});
}

  function drawLeaderboard(){
    push();
  fill(0, 190);
  rect(0, 0, width, height);
  fill(255);
  textAlign(CENTER, TOP);
  textSize(40);
  textBox("LEADERBOARD", width / 2, 30);

  const standings = Object.entries(playerWealth).sort((a, b) => {
    const left = asQuantity(a[1]);
    const right = asQuantity(b[1]);
    if (left.isGreaterThan(right)) return -1;
    if (left.isLessThan(right)) return 1;
    return 0;
  });
  
  // Set the text size BEFORE measuring textWidth, otherwise the measurements will be wrong!
  textAlign(LEFT, TOP);
  textSize(28);

  // --- PASS 1: Calculate ranks and track max text widths ---
  let leaderboardRows = [];
  let displayRank = 1;
  let lastWealth = null;
  
  let maxRankWidth = 0;
  let maxNameWidth = 0;

  for (let i = 0; i < standings.length; i++) {
    const [name, wealth] = standings[i];
    
    const wealthValue = asQuantity(wealth);
    if (i > 0 && lastWealth !== null && wealthValue.isLessThan(lastWealth)) {
      displayRank = i + 1;
    }
    
    let rankStr = `#${displayRank}.`;
    let wealthStr = formatMuffins(wealth);
    
    // Track the widest text element for each column
    maxRankWidth = max(maxRankWidth, textWidth(rankStr));
    maxNameWidth = max(maxNameWidth, textWidth(name));
    
    // Store processed data for the drawing pass
    leaderboardRows.push({ rankStr, name, wealthStr });
    lastWealth = wealthValue;
  }

  // --- PASS 2: Calculate dynamic column X positions and draw ---
  let padding = 40; // The comfortable gap between columns
  
  let rankX = 80;                           // Column 1 starts here
  let nameX = rankX + maxRankWidth + padding; // Column 2 shifts past Column 1 + padding
  let wealthX = nameX + maxNameWidth + padding; // Column 3 shifts past Column 2 + padding

  let y = 100;
  for (const row of leaderboardRows) {
    textBox(row.rankStr, rankX, y);
    textBox(row.name, nameX, y);
    textBox(row.wealthStr, wealthX, y);
    y += 36;
  }
  
  pop();
}

function keyPressed(){
	if(key==="l"||key==="L")
		leaderboardHeld=true;
}

function keyReleased(){
	if(key==="l"||key==="L")
		leaderboardHeld=false;
}