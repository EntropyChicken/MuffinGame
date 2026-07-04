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

let rawPlayerName = "Unknown";

async function setup() {
  noCanvas();
  
  // Show a clean placeholder status right away while waiting for the GM
  let loadingText = createP("Waiting for a Game Master...");
  loadingText.id("gm-waiting-message");
  loadingText.style("font-family", "monospace");
  loadingText.style("color", "#444");

  const params = new URLSearchParams(window.location.search);
  rawPlayerName = params.get("player") || "Unknown";

  connectToSupabase();

  channel.on("broadcast", { event: "ROSTER_SYNC" }, (msg) => {
    if (msg.payload && msg.payload.currentPlayers) {
      // Clear the waiting message once the GM responds
      let msgEl = document.getElementById("gm-waiting-message");
      if (msgEl) msgEl.remove();

      const activePlayers = msg.payload.currentPlayers;
      const found = activePlayers.find(p => p.toLowerCase() === rawPlayerName.toLowerCase());

      if (found) {
        playerName = found;
        initializeActivePlayerPodium();
      } else {
        playerName = "Unknown";
        if (rawPlayerName !== "Unknown") {
          window.history.replaceState(null, '', window.location.pathname);
          rawPlayerName = "Unknown";
        }
        renderRegistrationUI(rawPlayerName);
      }
    }
  });
}

function renderRegistrationUI(attemptedName) {
  if (window.registrationUiRendered) return;
  window.registrationUiRendered = true;

  let existingHeader = document.querySelector('h1');
  if (existingHeader) existingHeader.remove();

  createElement("h1", "Muffin Game");
  const instructionText = createP("Please enter your player name to register:");
  
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

    // ─── FIX: Fast-track bypassing! If the name is already in the game, log them right in ───
    const existingMatch = PLAYERS.find(p => p.toLowerCase() === enteredName.toLowerCase());
    if (existingMatch) {
      const newUrl = `${window.location.origin}${window.location.pathname}?player=${encodeURIComponent(existingMatch)}`;
      window.location.href = newUrl;
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
  channel = supabaseClient.channel(CHANNEL_NAME);
  
  channel.on("broadcast", { event: "GAME_RESET" }, () => {
    window.location.reload(); 
  });

  channel.on("broadcast", { event: EVENTS.STATE_SYNC }, (msg) => {
    if (msg.payload.player === playerName) {
      pressesRemainingLocal = msg.payload.pressesRemaining;
      pressesText.html(pressesLabel());
    }
  });

  channel.on("broadcast", { event: "ROSTER_SYNC" }, (msg) => {
    if (msg.payload && msg.payload.currentPlayers) {
      PLAYERS = msg.payload.currentPlayers; 
      
      // ─── FIX: Instantly catch our presses if we are fully loaded in ───
      if (playerName !== "Unknown" && msg.payload.pressesRemaining) {
        pressesRemainingLocal = msg.payload.pressesRemaining[playerName];
        if (pressesText) pressesText.html(pressesLabel());
      }
    }
  });

  channel.on("presence", { event: "sync" }, () => {
    checkForDuplicateName();
  });

  channel.subscribe(async (status) => {
    channelReady = status === "SUBSCRIBED";
    if (status === "SUBSCRIBED") {
      setTimeout(() => {
        channel.send({
          type: "broadcast",
          event: "REQUEST_ROSTER",
          payload: {}
        });
      }, 500);
      
      if (playerName !== "Unknown") {
        await channel.track({ player: playerName });
      }
    }
  });
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

  const recipientExists = PLAYERS.some(
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

  if (amount < 0 || amount > 6) {
    statusText.html("ERROR: Dedication must be between 0 and 6 muffins.");
    return;
  }

  channel.send({
    type: "broadcast",
    event: EVENTS.DEDICATE,
    payload: { player: playerName, amount: amount, recipient: name }
  });

  statusText.html(`Sent dedication request: ${amount} muffins to ${name}.`);
}

function initializeActivePlayerPodium() {
  // If we are already building the board, back out
  if (window.podiumUiRendered) return;
  window.podiumUiRendered = true;

  // Wipe any registration text boxes out of the DOM structure completely
  document.body.innerHTML = "";

  createElement("h1", playerName);

  pressesText = createP(pressesLabel());
  pressesText.style("font-family", "monospace");

  const pressButton = createButton("Become the Runner");
  pressButton.mousePressed(handlePress);
  pressButton.class("press-btn");

  createElement("hr");

  measureSpan = createSpan("");
  measureSpan.class("measure-span");

  const dedicationLine = createDiv();
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

  const dedicateButton = createButton("Make Dedication");
  dedicateButton.mousePressed(handleDedicate);
  dedicateButton.class("dedicate-btn");

  statusText = createP("");
  statusText.style("color", "#667");  
  
  // Send a join announcement so the GM updates our local client count state counters
  channel.send({
    type: "broadcast",
    event: EVENTS.JOIN,
    payload: { player: playerName }
  });
}

function autoGrowInput(inputElem) {
  const el = inputElem.elt;
  const content = el.value.length > 0 ? el.value : el.getAttribute("placeholder") || "";
  measureSpan.html(content.replace(/\s/g, "&nbsp;") || "&nbsp;");
  const width = measureSpan.elt.offsetWidth + 24; 
  el.style.width = width + "px";
}

function checkForDuplicateName() {
  const state = channel.presenceState();
  let count = 0;
  for (const key in state) {
    for (const entry of state[key]) {
      if (entry.player === playerName) count++;
    }
  }
  if (count > 1) {
    statusText.html(`Warning! It seems like someone else is also connected to ${playerName}. Like, identity theft type beat, ya know?`);
  }
}

function pressesLabel() {
  if (Number.isFinite(pressesRemainingLocal)){
    return `${pressesRemainingLocal} / ${MAX_PRESSES} presses left`;
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