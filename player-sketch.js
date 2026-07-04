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

async function setup() {
  noCanvas();
  
  let loadingText = createP("Waiting for a Game Master...");
  loadingText.id("gm-waiting-message");
  loadingText.style("font-family", "monospace");
  loadingText.style("color", "#444");

  const params = new URLSearchParams(window.location.search);
  rawPlayerName = params.get("player") || "Unknown";

  connectToSupabase();

  channel.on("broadcast", { event: "ROSTER_SYNC" }, (msg) => {
    if (msg.payload && msg.payload.currentPlayers) {
      let msgEl = document.getElementById("gm-waiting-message");
      if (msgEl) msgEl.remove();

      const activePlayers = msg.payload.currentPlayers;
      const found = activePlayers.find(p => p.toLowerCase() === rawPlayerName.toLowerCase());


      if (found) {
        playerName = found;
        if (!window.podiumUiRendered) {
          initializeActivePlayerPodium();
          channel.send({
            type: "broadcast",
            event: EVENTS.JOIN,
            payload: { player: playerName }
          });
        }
      }
      else {
        if (
          !window.registrationUiRendered &&
          !window.podiumUiRendered
        ) {
          renderRegistrationUI(rawPlayerName);
        }
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

    const existingMatch = players.find(p => p.toLowerCase() === enteredName.toLowerCase());
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
  channel = supabaseClient.channel(channelName);
  channel.on("broadcast", { event: EVENTS.GAME_RESET }, () => {
    window.location.reload();
  });

  
  channel.on("broadcast", { event: EVENTS.STATE_SYNC }, (msg) => {
    if (msg.payload.player === playerName) {
      pressesRemainingLocal = msg.payload.pressesRemaining;
      if (pressesText) pressesText.html(pressesLabel());
    }
  });
  channel.on("broadcast", { event: "ROSTER_SYNC" }, (msg) => {
    if (msg.payload && msg.payload.currentPlayers) {
      players = msg.payload.currentPlayers; 
      
      if (playerName !== "Unknown" && msg.payload.pressesRemaining) {
        pressesRemainingLocal = msg.payload.pressesRemaining[playerName];
        if (pressesText) pressesText.html(pressesLabel());
      }
    }
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
  channel.on("presence", { event: "sync" }, () => {
    checkForDuplicateName();
  });
  channel.subscribe(async (status) => {
    channelReady = status === "SUBSCRIBED";
    if (status === "SUBSCRIBED") {
      setTimeout(() => {
        channel.send({
          type: "broadcast",
          event: EVENTS.REQUEST_ROSTER,
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

function initializeActivePlayerPodium() {
  if (window.podiumUiRendered) return;
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
  
  channel.send({
    type: "broadcast",
    event: EVENTS.JOIN,
    payload: { player: playerName }
  });
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