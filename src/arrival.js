// The envelope window only does one thing: a click opens Today's Peta. Whether it is shown at all is decided in Rust
// (arrival.rs), from today's slot.
const { invoke } = window.__TAURI__.core;
document.getElementById("envelope").addEventListener("click", () => invoke("arrival_open"));
