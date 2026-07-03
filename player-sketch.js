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

async function setup() {
  noCanvas();
  
  const params = new URLSearchParams(window.location.search);
  const rawPlayerName = params.get("player") || "Unknown";

  playerName = PLAYERS.find(
    (p) => p.toLowerCase() === rawPlayerName.toLowerCase()
  ) || "Unknown";

  // ─── INTERCEPT UNKNOWN PLAYERS ─────────────────────────────────────
  if (playerName === "Unknown") {
    createElement("h1", "Muffin Game");
    createP("Please enter your player name, spelled exactly as it is registered on screen. (Not case-sensitive)");

    // Standard text input for player names
    const loginInput = createInput("");
    loginInput.attribute("placeholder", "Your Name");
    loginInput.elt.focus();

    const joinButton = createButton("Join Game");
    joinButton.class("dedicate-btn");

    const navigateToPlayer = () => {
      const enteredName = loginInput.value().trim();
      if (!enteredName) return;

      // Treat it strictly as a normal player name
      const newUrl = `${window.location.origin}${window.location.pathname}?player=${encodeURIComponent(enteredName)}`;
      window.location.href = newUrl;
    };
    
    joinButton.mousePressed(navigateToPlayer);
    
    loginInput.elt.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        navigateToPlayer();
      }
    });

    return; // Stop execution so unauthorized players don't connect
  }
  // ───────────────────────────────────────────────────────────────────

  // Existing game setup code runs ONLY if player is valid:
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

  connectToSupabase();
}

function autoGrowInput(inputElem) {
  const el = inputElem.elt;
  const content = el.value.length > 0 ? el.value : el.getAttribute("placeholder") || "";
  measureSpan.html(content.replace(/\s/g, "&nbsp;") || "&nbsp;");
  const width = measureSpan.elt.offsetWidth + 24; 
  el.style.width = width + "px";
}

function connectToSupabase() {
  channel = supabaseClient.channel(CHANNEL_NAME);
  
  channel.on("broadcast", { event: "GAME_RESET" }, () => {
    console.log("Game Master reset the game! Reloading page...");
    window.location.reload(); 
  });

  channel.on("broadcast", { event: EVENTS.STATE_SYNC }, (msg) => {
    if (msg.payload.player === playerName) {
      pressesRemainingLocal = msg.payload.pressesRemaining;
      pressesText.html(pressesLabel());
    }
  });

  channel.on("presence", { event: "sync" }, () => {
    checkForDuplicateName();
  });

  channel.subscribe(async (status) => {
    channelReady = status === "SUBSCRIBED";
    if (status === "SUBSCRIBED") {
      channel.send({
        type: "broadcast",
        event: EVENTS.JOIN,
        payload: { player: playerName }
      });
      await channel.track({ player: playerName });
    }
  });
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
    return "awaiting data update..."
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

  const amount = parseFloat(rawAmount);
  if (isNaN(amount)) {
    statusText.html("Error: Amount must be a valid number.");
    return;
  }

  if (amount < 0 || amount > 6) {
    statusText.html("Error: Dedication must be between 0 and 6 muffins.");
    return;
  }

  channel.send({
    type: "broadcast",
    event: EVENTS.DEDICATE,
    payload: { 
      player: playerName, 
      amount: amount, 
      recipient: name 
    }
  });

  statusText.html(`Sent: Dedicated ${amount} muffins to ${name}`);
  autoGrowInput(amountInput);
  autoGrowInput(nameInput);
}

function handleInputKey(event) {
  if (event.key === "Enter") {
    event.preventDefault(); 
    handleDedicate();
  }
}