/* =========================================================
   MUFFIN GAME — player-sketch.js
   Each player loads: player.html?player=YourName

   This page only SENDS messages — it never receives anything
   back, and there is no confirmation from the Game Master.
   The "presses remaining" shown here is a local convenience
   counter for the player's own display only; the Game Master
   Center is the true authority on the actual game state.
   ========================================================= */

let playerName = "Unknown";
let pressesRemainingLocal = MAX_PRESSES;

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
  pressButton.style("font-size", "20px");
  pressButton.style("padding", "12px 24px");

  createElement("hr");

  createP("Fill in your dedication:");

  // Hidden element used purely to measure how wide the typed text is,
  // so the visible input can grow to match it (capped by CSS max-width).
  measureSpan = createSpan("");
  measureSpan.class("measure-span");

  const line = createDiv();
  line.class("dedication-line");

  createSpan("I officially dedicate").parent(line);

  amountInput = createInput("");
  amountInput.class("auto-grow-input");
  amountInput.attribute("placeholder", "0.0");
  amountInput.attribute("inputmode", "decimal");
  amountInput.parent(line);
  amountInput.input(() => autoGrowInput(amountInput));

  createSpan("muffins to").parent(line);

  nameInput = createInput("");
  nameInput.class("auto-grow-input");
  nameInput.attribute("placeholder", "name");
  nameInput.parent(line);
  nameInput.input(() => autoGrowInput(nameInput));

  autoGrowInput(amountInput);
  autoGrowInput(nameInput);

  const dedicateButton = createButton("Send Dedication");
  dedicateButton.mousePressed(handleDedicate);

  statusText = createP("");
  statusText.style("color", "#666");

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
  channel.subscribe((status) => {
    channelReady = status === "SUBSCRIBED";
  });
}

function pressesLabel() {
  return `Presses remaining: ${pressesRemainingLocal} / ${MAX_PRESSES}`;
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
  amountInput.value("");
  nameInput.value("");
  autoGrowInput(amountInput);
  autoGrowInput(nameInput);
}