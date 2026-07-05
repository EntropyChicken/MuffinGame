/* =========================================================
   MUFFIN GAME — player-sketch.js
   Each player loads: index.html?player=YourName

   This page only SENDS messages — it never receives anything
   back, and there is no confirmation from the Game Master.
   The "presses remaining" shown here is a local convenience
   counter for the player's own display only; the Game Master
   Center is the true authority on the actual game state.
   ========================================================= */

let playerName = "Unknown";
let pressesRemainingLocal = -Infinity;

let channel;
let channelReady = false;

let pressesText, statusText;
let amountInput, nameInput;
let measureSpan;

let mainLayout, leftCol, centerCol, rightCol;

let rawPlayerName = "Unknown";
let pendingQueue = [];
let activeDuplicateChannel = null;
let deviceSessionId = null;
let sessionClaimPending = true;
let pendingRosterMessage = null;
let heartbeatIntervalId = null;

async function setup() {
  window.duplicateSessionUiRendered = false;
  noCanvas();
  
  let loadingText = createP("Waiting for a Game Master...");
  loadingText.id("gm-waiting-message");
  loadingText.style("font-family", "monospace");
  loadingText.style("color", "#444");

  const params = new URLSearchParams(window.location.search);
  rawPlayerName = params.get("player") || "Unknown";
  deviceSessionId = getOrCreateDeviceSessionId();

  connectToSupabase();

  // ========================================================
  // 1. BULLETPROOF LOCAL CROSS-TAB DUPLICATE GUARD
  // ========================================================
  const myTabId = Math.random().toString(36).substring(2, 9);
  const tabChannelName = `muffin_session_${rawPlayerName.toLowerCase()}`;
  const localTabChannel = new BroadcastChannel(tabChannelName);
  activeDuplicateChannel = localTabChannel;
  let isDuplicateTab = false;

  localTabChannel.onmessage = (event) => {
    // Ignore our own echoed messages entirely
    if (!event.data || event.data.senderId === myTabId) return;

    // Challenge: An external tab is asking if anyone is here
    if (event.data.type === EVENTS.PING_EXISTING) {
      // Only respond if this specific tab is fully alive and rendering the active game podium
      if (window.podiumUiRendered) {
        localTabChannel.postMessage({ type: EVENTS.I_AM_ALREADY_HERE, senderId: myTabId });
      }
    } 
    // Response: An active tab confirmed it is already running the game
    else if (event.data.type === EVENTS.I_AM_ALREADY_HERE) {
      if (!window.podiumUiRendered && !isDuplicateTab) {
        isDuplicateTab = true;
        window.duplicateSessionUiRendered = true;
        
        showDuplicateSessionScreen(localTabChannel);
      }
    }
  };

  // Broadcast out a check query to see if any real active windows are listening
localTabChannel.postMessage({ type: EVENTS.PING_EXISTING, senderId: myTabId });

  // ========================================================
  // 2. OMNI-ROSTER GAME STATE BROADCAST LISTENER
  // ========================================================
  channel.on("broadcast", { event: EVENTS.ROSTER_SYNC }, (msg) => {
    if (msg.payload && msg.payload.currentPlayers) {
      if (sessionClaimPending) {
        pendingRosterMessage = msg;
        return;
      }
      handleRosterMessage(msg);
    }
  });
}

function handleRosterMessage(msg) {
  if (!msg || !msg.payload || !msg.payload.currentPlayers) return;

  let msgEl = document.getElementById("gm-waiting-message");
  if (msgEl) msgEl.remove();

  const activePlayers = msg.payload.currentPlayers;
  pendingQueue = msg.payload.requestedNamesQueue || [];

  const found = activePlayers.find(p => p.toLowerCase() === rawPlayerName.toLowerCase());

  if (window.duplicateSessionUiRendered) return;

  if (found) {
    playerName = found;

    if (msg.payload.pressesRemaining && msg.payload.pressesRemaining[playerName] !== undefined) {
      pressesRemainingLocal = msg.payload.pressesRemaining[playerName];
      if (pressesText) pressesText.html(pressesLabel());
    }

    if (!window.podiumUiRendered) {
      initializeActivePlayerPodium();
      if (pressesText) pressesText.html(pressesLabel());
    }
  }
  else {
    if (!window.duplicateSessionUiRendered && !window.registrationUiRendered && !window.podiumUiRendered) {
      renderRegistrationUI(rawPlayerName);
    }
  }
}

function showDuplicateSessionScreen(localTabChannel) {
  if (window.duplicateSessionUiRendered) return;
  window.duplicateSessionUiRendered = true;

  if (activeDuplicateChannel && activeDuplicateChannel !== localTabChannel) {
    try { activeDuplicateChannel.close(); } catch (err) {}
  }
  activeDuplicateChannel = localTabChannel;

  document.body.innerHTML = "";
  let errorBox = createDiv();
  errorBox.style("max-width", "500px");
  errorBox.style("margin", "100px auto");
  errorBox.style("text-align", "center");
  errorBox.style("font-family", "monospace");
  errorBox.style("padding", "20px");

  createElement("h1", "Access Denied").parent(errorBox);
  let alertText = createP(`<span style="color:#ff6666; font-weight:bold;">😭duplicate session🥀</span><br>"${rawPlayerName}" is already actively playing in another window or tab.`);
  alertText.parent(errorBox);
  alertText.style("margin-bottom", "30px");
  alertText.style("line-height", "1.6");

  let homeButton = createButton("Return to Sign-Up Screen").parent(errorBox);
  homeButton.class("dedicate-btn");
  homeButton.mousePressed(() => {
    try { localTabChannel.close(); } catch (err) {}
    window.location.href = window.location.origin + window.location.pathname;
  });
}

function renderRegistrationUI(attemptedName) {
  if (window.duplicateSessionUiRendered || window.registrationUiRendered || window.podiumUiRendered) return;
  window.registrationUiRendered = true;

  let existingHeader = document.querySelector('h1');
  if (existingHeader) existingHeader.remove();

  createElement("h1", "Muffin Game");
  const instructionText = createP("Please enter your player name to register (nothing is case sensitive)");
  
  const loginInput = createInput("");
  loginInput.attribute("placeholder", "Your Name");
  loginInput.elt.focus();

  const joinButton = createButton("Request to Join");
  joinButton.class("dedicate-btn");

  let pendingNameApproval = null;

  channel.on("broadcast", { event: EVENTS.APPROVE }, (msg) => {
    if (msg.payload && msg.payload.approvedName) {
      if (pendingNameApproval && msg.payload.approvedName.toLowerCase() === pendingNameApproval.toLowerCase()) {
        const newUrl = `${window.location.origin}${window.location.pathname}?player=${encodeURIComponent(pendingNameApproval)}`;
        window.location.href = newUrl;
      }
    }
  });

  channel.on("broadcast", { event: EVENTS.DENY }, (msg) => {
    if (msg.payload && msg.payload.deniedName) {
      if (pendingNameApproval && msg.payload.deniedName.toLowerCase() === pendingNameApproval.toLowerCase()) {
        instructionText.html(`Request for "<b>${pendingNameApproval}</b>" was denied. Please try a different name.`);
        pendingNameApproval = null;
        
        loginInput.removeAttribute("disabled");
        loginInput.style("display", "inline-block");
        joinButton.style("display", "inline-block");
        
        loginInput.value("");
        loginInput.elt.focus();
      }
    }
  });

  const requestPlayerName = () => {
    const enteredName = loginInput.value().trim();
    if (!enteredName) return;

    if (!channelReady) {
      instructionText.html("Still connecting to network, try again in a second...");
      return;
    }

    const nameLower = enteredName.toLowerCase();

    // Local Guard: Check if the name is already playing officially
    const isAlreadyPlayer = players.some(p => p.toLowerCase() === nameLower);
    if (isAlreadyPlayer) {
      instructionText.html(`<span style="color:#ff6666">"${enteredName}" is already taken by an active player!</span>`);
      return;
    }

    // Local Guard: Check if someone else got in line first
    const isAlreadyPending = pendingQueue.some(p => p.toLowerCase() === nameLower);
    if (isAlreadyPending) {
      instructionText.html(`<span style="color:#ff6666">"${enteredName}" is currently pending GM review. Choose another name!</span>`);
      return;
    }

    pendingNameApproval = enteredName;

    loginInput.style("display", "none");
    joinButton.style("display", "none");

    channel.send({
      type: "broadcast",
      event: EVENTS.REQUEST_NAME,
      payload: { requestedName: enteredName }
    });

    instructionText.html(`Requested "<b>${enteredName}</b>". Waiting for Game Master approval...`);
  };
  
  joinButton.mousePressed(requestPlayerName);
  loginInput.elt.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      requestPlayerName();
    }
  });
}

function connectToSupabase() {
  channel = supabaseClient.channel(channelName);
  channel.on("broadcast", { event: EVENTS.GAME_RESET }, () => {
    window.location.reload();
  });

  channel.on("broadcast", { event: EVENTS.PLAYER_REMOVED }, (msg) => {
    if (msg.payload && msg.payload.player && msg.payload.player.toLowerCase() === playerName.toLowerCase()) {
      window.location.href = window.location.origin + window.location.pathname;
    }
  });
  
  channel.on("broadcast", { event: EVENTS.STATE_SYNC }, (msg) => {
    if (msg.payload.player === playerName) {
      pressesRemainingLocal = msg.payload.pressesRemaining;
      if (pressesText) pressesText.html(pressesLabel());
    }
  });
  channel.on("broadcast", { event: EVENTS.ROSTER_SYNC }, (msg) => {
    if (msg.payload && msg.payload.currentPlayers) {
      players = msg.payload.currentPlayers; 
      pendingQueue = msg.payload.requestedNamesQueue || [];
      if (playerName !== "Unknown" && msg.payload.pressesRemaining) {
        pressesRemainingLocal = msg.payload.pressesRemaining[playerName];
        if (pressesText) pressesText.html(pressesLabel());
      }
    }
  });

  channel.on("broadcast", { event: EVENTS.SESSION_CLAIM_RESULT }, (msg) => {
    if (!msg.payload || !msg.payload.player || window.duplicateSessionUiRendered) return;
    if (msg.payload.player.toLowerCase() !== rawPlayerName.toLowerCase()) return;
    if (msg.payload.sessionId !== deviceSessionId) return;

    sessionClaimPending = false;

    if (!msg.payload.accepted) {
      showDuplicateSessionScreen(activeDuplicateChannel);
      return;
    }

    startSessionHeartbeat();

    if (pendingRosterMessage) {
      const pending = pendingRosterMessage;
      pendingRosterMessage = null;
      handleRosterMessage(pending);
    }
  });

  channel.on("broadcast", { event: EVENTS.SESSION_REVOKED }, (msg) => {
    if (!msg.payload || !msg.payload.player || window.duplicateSessionUiRendered) return;
    if (msg.payload.player.toLowerCase() !== rawPlayerName.toLowerCase()) return;
    if (msg.payload.sessionId !== deviceSessionId) return;

    // Another device took over this name after we went quiet for too long.
    stopSessionHeartbeat();
    showDuplicateSessionScreen(activeDuplicateChannel);
  });

  channel.on("broadcast", { event: EVENTS.SETTINGS_SYNC }, (msg) => {
    if (msg.payload) {
      maxMuffins = msg.payload.maxMuffins;
      maxPresses = msg.payload.maxPresses;
      runDurationSeconds = msg.payload.runDurationSeconds;
      if (pressesText) pressesText.html(pressesLabel());
    }
  });
  channel.on("broadcast", { event: EVENTS.DEDICATE_ERROR }, (msg) => {
    if (msg.payload && msg.payload.player === playerName) {
      if (statusText) statusText.html("<span style='color:#ff6666'>" +msg.payload.message +"</span>");
    }
  });
  channel.on("broadcast", { event: EVENTS.DEDICATIONS_SYNC }, (msg) => {
    if (msg.payload && msg.payload.dedicationMax) {
      renderDedicationsLists(msg.payload.dedicationMax);
    }
  });
  channel.subscribe((status) => {
    channelReady = status === "SUBSCRIBED";
    if (status === "SUBSCRIBED") {
      setTimeout(() => {
        channel.send({
          type: "broadcast",
          event: EVENTS.REQUEST_ROSTER,
          payload: {}
        });

        if (rawPlayerName && rawPlayerName !== "Unknown") {
          channel.send({
            type: "broadcast",
            event: EVENTS.SESSION_CLAIM,
            payload: { player: rawPlayerName, sessionId: deviceSessionId }
          });
        } else {
          // No name in the URL at all - nothing to claim or verify.
          sessionClaimPending = false;
        }
      }, 500);
    }
  });
}

function startSessionHeartbeat() {
  if (heartbeatIntervalId) return;
  heartbeatIntervalId = setInterval(() => {
    if (!channelReady || !rawPlayerName || rawPlayerName === "Unknown") return;
    channel.send({
      type: "broadcast",
      event: EVENTS.SESSION_HEARTBEAT,
      payload: { player: rawPlayerName, sessionId: deviceSessionId }
    });
  }, SESSION_HEARTBEAT_INTERVAL_MS);
}

function stopSessionHeartbeat() {
  if (heartbeatIntervalId) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }
}

function handleDedicate() {
  if (!channelReady) {
    statusText.html("Still connecting, try again in a moment...");
    return;
  }

  const rawAmount = amountInput.value().trim();
  const name = nameInput.value().trim();

  if (!rawAmount || !name) {
    statusText.html("Fill in both an amount and a name first.");
    return;
  }

  const recipientExists = players.some(
    (p) => p.toLowerCase() === name.toLowerCase()
  );

  if (!recipientExists) {
    statusText.html(`ERROR: "${name}" is not a registered player.`);
    return;
  }

  const amount = parseFloat(rawAmount);
  if (isNaN(amount)) {
    statusText.html("ERROR: Amount must be a valid number.");
    return;
  }

  if (amount < 0 || amount > maxMuffins) {
    statusText.html(`ERROR: Dedication must be between 0 and ${maxMuffins} muffins.`);
    return;
  }

  channel.send({
    type: "broadcast",
    event: EVENTS.DEDICATE,
    payload: { player: playerName, amount: amount, recipient: name }
  });

  statusText.html(`Sent dedication of ${formatMuffins(amount)} muffins to ${name}.`);
}

window.addEventListener("beforeunload", () => {
  if (!channel || !rawPlayerName || rawPlayerName === "Unknown" || !deviceSessionId) return;
  try {
    // Best-effort courtesy release on a clean close/reload, so a legitimate
    // reconnect doesn't even have to wait for the heartbeat timeout. Not
    // load-bearing: if this never arrives (mobile browsers often skip it),
    // the same deviceSessionId reclaiming the name still works instantly,
    // and an unclean disconnect still frees up after the stale timeout.
    channel.send({
      type: "broadcast",
      event: EVENTS.SESSION_RELEASE,
      payload: { player: rawPlayerName, sessionId: deviceSessionId }
    });
  } catch (err) {}
});

function initializeActivePlayerPodium() {
  if (window.duplicateSessionUiRendered || window.podiumUiRendered) return;
  window.podiumUiRendered = true;

  document.body.innerHTML = "";

  mainLayout = createDiv();
  mainLayout.style("display","flex");
  mainLayout.style("flex-direction","column");
  mainLayout.style("align-items","center");
  mainLayout.style("max-width","900px");
  mainLayout.style("margin","0 auto");
  mainLayout.style("padding","25px");

  centerCol = createDiv().parent(mainLayout);
  centerCol.style('flex', '2').style('text-align', 'center');

  createElement("h1", playerName).parent(centerCol);

  pressesText = createP(pressesLabel()).parent(centerCol);
  pressesText.style("font-family", "monospace");

  const pressButton = createButton("Become the Runner").parent(centerCol);
  pressButton.mousePressed(handlePress);
  pressButton.class("press-btn");
  
  pressButton.elt.style.setProperty("background", "#5555ff", "important");
  pressButton.elt.style.setProperty("color", "#1a1a1a", "important");

  createElement("hr").parent(centerCol);

  measureSpan = createSpan("").parent(centerCol);
  measureSpan.class("measure-span");

  const dedicationLine = createDiv().parent(centerCol);
  dedicationLine.class("dedication-line");

  createSpan("I officially dedicate").parent(dedicationLine);

  amountInput = createInput("");
  amountInput.class("auto-grow-input");
  amountInput.attribute("placeholder", "0.0");
  amountInput.attribute("inputmode", "decimal");
  amountInput.parent(dedicationLine);
  amountInput.input(() => autoGrowInput(amountInput));

  createSpan("muffins to").parent(dedicationLine);

  nameInput = createInput("");
  nameInput.class("auto-grow-input");
  nameInput.attribute("placeholder", "name");
  nameInput.parent(dedicationLine);
  nameInput.input(() => autoGrowInput(nameInput));

  amountInput.elt.addEventListener("keydown", handleInputKey);
  nameInput.elt.addEventListener("keydown", handleInputKey);

  autoGrowInput(amountInput);
  autoGrowInput(nameInput);

  const dedicateButton = createButton("Make Dedication").parent(centerCol);
  dedicateButton.mousePressed(handleDedicate);
  dedicateButton.class("dedicate-btn");

  statusText = createP("").parent(centerCol);
  statusText.style("color", "#889");  

  const listsContainer = createDiv().parent(mainLayout);
  listsContainer.style("display","grid");
  listsContainer.style("grid-template-columns","1fr 1fr");
  listsContainer.style("gap","60px");
  listsContainer.style("width","100%");
  listsContainer.style("margin-top","35px");
  listsContainer.style("align-items","start");
  leftCol = createDiv().parent(listsContainer);
  leftCol.style("text-align","left");
  leftCol.html(`
  <h3 style="
  font-family:monospace;
  color:#ffb600;
  margin-bottom:12px;">
  Dedications From:
  </h3>

  <div id="from-list"
  style="
  font-family:monospace;
  font-size:20px;
  line-height:1.6;">
  (none)
  </div>
  `);
  rightCol = createDiv().parent(listsContainer);
  rightCol.style("text-align","left");
  rightCol.html(`
  <h3 style="
  font-family:monospace;
  color:#ffb600;
  margin-bottom:12px;">
  Dedications To:
  </h3>

  <div id="to-list"
  style="
  font-family:monospace;
  font-size:20px;
  line-height:1.6;">
  (none)
  </div>
  `);
}

function renderDedicationsLists(dedicationMax) {
  if (!window.podiumUiRendered) return;
  
  let fromHtml = "";
  let toHtml = "";

  for (const p of players) {

    const amt =
      dedicationMax[p]?.[playerName] ?? 0;

    if (amt > 0) {
      fromHtml += `
      <div style="
      display:flex;
      justify-content:space-between;
      margin-bottom:10px;
      font-family:monospace;">
      <span>${p}</span>
      <span>${formatMuffins(amt)}</span>
      </div>`;
    }
  }

  const mine = dedicationMax[playerName] || {};

  for (const p of players) {

    const amt = mine[p] || 0;

    if (amt > 0) {
      toHtml += `
      <div style="
      display:flex;
      justify-content:space-between;
      margin-bottom:10px;
      font-family:monospace;">
      <span>${p}</span>
      <span>${formatMuffins(amt)}</span>
      </div>`;
    }
  }

  document.getElementById("from-list").innerHTML =
    fromHtml || "<span style='color:#777'>(none)</span>";

  document.getElementById("to-list").innerHTML =
    toHtml || "<span style='color:#777'>(none)</span>";
}

function autoGrowInput(inputElem) {
  const el = inputElem.elt;
  const content = el.value.length > 0 ? el.value : el.getAttribute("placeholder") || "";
  measureSpan.html(content.replace(/\s/g, "&nbsp;") || "&nbsp;");
  const width = measureSpan.elt.offsetWidth + 24; 
  el.style.width = width + "px";
}

function pressesLabel() {
  if (Number.isFinite(pressesRemainingLocal)){
    return `${pressesRemainingLocal} / ${maxPresses} presses left`;
  }
  else{
    return "awaiting data update...";
  }
}

function handlePress() {
  if (!channelReady) {
    statusText.html("Still connecting, try again in a moment...");
    return;
  }
  if (pressesRemainingLocal <= 0) {
    statusText.html("You have no presses left.");
    return;
  }

  pressesRemainingLocal--;
  pressesText.html(pressesLabel());

  channel.send({
    type: "broadcast",
    event: EVENTS.PRESS,
    payload: { player: playerName }
  });

  statusText.html("Sent: you pressed your button.");
}

function handleInputKey(event) {
  if (event.key === "Enter") {
    event.preventDefault(); 
    handleDedicate();
  }
}