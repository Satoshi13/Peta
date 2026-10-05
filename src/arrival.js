// The envelope window only does one thing: a click opens Today's Peta. Whether it is shown at all is decided in Rust
// (arrival.rs), from today's slot.
const { invoke } = window.__TAURI__.core;
// ?kind=gift: a sealed gift is waiting (cream envelope with a wax seal); otherwise today's material (kraft envelope)
if (new URLSearchParams(location.search).get("kind") === "gift") {
  const env = document.getElementById("envelope");
  env.setAttribute("aria-label", "A Peta arrived.");
  env.dataset.art = "arrival-gift";
}
document.getElementById("envelope").addEventListener("click", () => invoke("arrival_open"));
