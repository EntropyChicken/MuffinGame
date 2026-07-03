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
let pressesRemainingLocal = -Infinity;//MAX_PRESSES;

let channel;
let channelReady = false;

let pressesText, statusText;
let amountInput, nameInput;
let measureSpan; // hidden element used to measure typed text width

function setup() {
  noCanvas(); // this page is just a simple form, no drawing needed

  const params = new URLSearchParams(window.location.search);
  playerName = params.get("player") || "Unknown";

  createElement("h1", playerName);

  pressesText = createP(pressesLabel());
  pressesText.style("font-family", "monospace");

  const pressButton = createButton("Become the Runner");
  pressButton.mousePressed(handlePress);
  pressButton.class("press-btn");


  createElement("hr");

  // createP("Fill in your dedication:");

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

// Grows an input's width to fit what's typed (or its placeholder, if
// empty), using the hidden measureSpan for an accurate measurement.
// CSS's max-width on .auto-grow-input is what actually keeps it from
// overflowing small screens, regardless of how wide this sets it to.
function autoGrowInput(inputElem) {
  const el = inputElem.elt;
  const content = el.value.length > 0 ? el.value : el.getAttribute("placeholder") || "";
  measureSpan.html(content.replace(/\s/g, "&nbsp;") || "&nbsp;");
  const width = measureSpan.elt.offsetWidth + 24; // padding/caret buffer
  el.style.width = width + "px";
}

function connectToSupabase() {
  channel = supabaseClient.channel(CHANNEL_NAME);
  
  channel.on("broadcast", { event: "GAME_RESET" }, () => {
    console.log("Game Master reset the game! Reloading page...");
    window.location.reload(); 
  });

  // GM's reply to our join request
  channel.on("broadcast", { event: EVENTS.STATE_SYNC }, (msg) => {
    if (msg.payload.player === playerName) {
      pressesRemainingLocal = msg.payload.pressesRemaining;
      pressesText.html(pressesLabel());
    }
  });

  // Fires whenever presence info changes for anyone in the channel
  channel.on("presence", { event: "sync" }, () => {
    checkForDuplicateName();
  });

  channel.on("broadcast", { event: EVENTS.JOIN }, (msg) => {
    handleJoinMessage(msg.payload);
  });

  channel.subscribe(async (status) => {
    channelReady = status === "SUBSCRIBED";
    if (status === "SUBSCRIBED") {
      // Ask the GM what our real state is
      channel.send({
        type: "broadcast",
        event: EVENTS.JOIN,
        payload: { player: playerName }
      });
      // Announce our presence under our player name
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
    statusText.html(`Warning: it looks like ${playerName} is connected multiple times `);
  }
}
function handleJoinMessage(payload) {
  const player = payload && payload.player;
  if (!PLAYERS.includes(player)) {
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

  const amount = amountInput.value().trim();
  const name = nameInput.value().trim();

  if (!amount || !name) {
    statusText.html("Fill in both an amount and a name first.");
    return;
  }

  // Reassemble into the same sentence format the Game Master expects,
  // e.g. "I officially dedicate 5.3 muffins to Charlie"
  const text = `I officially dedicate ${amount} muffins to ${name}`;

  channel.send({
    type: "broadcast",
    event: EVENTS.DEDICATE,
    payload: { player: playerName, text: text }
  });

  statusText.html(`Sent: "${text}"`);
  // amountInput.value(""); // probably don't want to reset, tbh
  // nameInput.value("");
  autoGrowInput(amountInput);
  autoGrowInput(nameInput);
}

// press enter to submit dedication request
function handleInputKey(event) {
  if (event.key === "Enter") {
    event.preventDefault(); // Prevents accidental page reloads or form flashes
    handleDedicate();
  }
}