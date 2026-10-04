// Presentation only. Observe the existing DOM; never invoke Tauri or change app state.
const root = document.documentElement;
root.dataset.pack = new URLSearchParams(location.search).get("pack") === "box" ? "box" : "pouch";
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const envelope = document.getElementById("stage-envelope");
const material = document.getElementById("stage-material");
const reveal = document.querySelector('[data-art="material-reveal"]');
const open = document.getElementById("open-material");
let started = null;
let finishTimer = null;

// Which card / swatch to draw. The app puts the material's id in `data-material-id`; the display name
// is only a fallback. Materials without art of their own yet fall back to matte.
const KNOWN = new Set(["matte", "kraft", "holographic"]);
function materialKind(id, name = "") {
  if (KNOWN.has(id)) return id;
  const n = name.toLowerCase();
  return n.includes("holograph") ? "holographic" : n.includes("kraft") ? "kraft" : "matte";
}

function setText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function synchronize() {
  if (reveal) {
    const name = document.getElementById("material-name")?.textContent || "";
    const rarity = document.getElementById("material-rarity")?.dataset.rarity || "";
    reveal.dataset.artMaterial = materialKind(document.getElementById("material-card")?.dataset.materialId, name);
    reveal.dataset.artRarity = rarity;
    setText(reveal.querySelector(".art-material-name"), name);
    setText(reveal.querySelector(".art-material-rarity"), rarity);
  }
  document.querySelectorAll(".chip, .mcard, #material-list li").forEach((chip) => {
    chip.dataset.artMaterial = materialKind(chip.dataset.materialId, chip.textContent);
  });
  if (started === null || finishTimer !== null) return;
  const error = document.getElementById("error");
  if (error && !error.hidden && error.textContent) {
    started = null;
    document.body.classList.remove("art-opening");
    return;
  }
  // Existing render() hides the envelope only after daily_open_material succeeds.
  if (envelope?.hidden && material && !material.hidden) {
    const wait = reduced.matches ? 0 : Math.max(0, 800 - (performance.now() - started));
    finishTimer = setTimeout(() => {
      started = null;
      finishTimer = null;
      document.body.classList.remove("art-opening");
      if (!reduced.matches) {
        reveal.classList.add("is-revealing");
        setTimeout(() => reveal.classList.remove("is-revealing"), 650);
      }
    }, wait);
  }
}

open?.addEventListener("click", () => {
  if (started !== null || envelope?.hidden) return;
  started = performance.now();
  document.body.classList.add("art-opening");
});
// Make the envelope object use the already-wired Open button.
document.querySelector('[data-art="envelope"]')?.addEventListener("click", () => open?.click());
new MutationObserver(synchronize).observe(document.body, {
  subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "data-rarity"],
});
synchronize();
