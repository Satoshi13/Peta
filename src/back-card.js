// The back of a sticker (spec §30): ORIGINAL / Received, who made it, when, which material.
// Shared by the desktop layer ("turn over") and the Sticker Book. All text comes from Rust (`sticker_back`);
// this only lays it out. Every value goes in with textContent (names are user input).

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/** `back` is a `StickerBack` (see docs/ui-handoff.md). Returns the card element. */
export function renderBackCard(back) {
  const card = el("div", "back-card");
  card.dataset.kind = back.kind;
  card.dataset.art = "back-paper"; // art hook: paper texture (back/paper-cream.jpg, back/paper-kraft.jpg)
  const face = el("div", "face");
  card.append(face);

  const received = back.kind === "received";
  if (!received) {
    const stamp = el("div", "stamp", "ORIGINAL");
    stamp.dataset.art = "stamp-frame"; // art hook: rubber-stamp frame
    face.append(stamp);
  }

  const rows = el("div", "rows");
  const row = (label, ...values) => {
    const r = el("div", "row");
    r.append(el("span", "label", label));
    for (const v of values) if (v) r.append(el("span", "value", v));
    rows.append(r);
  };
  row("Created by", back.createdBy, back.createdOn);
  if (received) row("Received from", back.receivedFrom, back.receivedOn);
  if (back.material) row("Material", back.material.name);
  face.append(rows);

  const number = back.originalNumber
    ? `No. ${back.originalNumber}`
    : back.editionNumber
      ? `Edition #${back.editionNumber}`
      : "";
  if (number) face.append(el("div", "number", number));

  const mark = el("div", "peta-mark", "Peta");
  mark.dataset.art = "peta-mark"; // art hook: brush wordmark
  face.append(mark);
  face.append(el("small", "code", back.idCode));
  return card;
}

/** Shown if the back could not be loaded. */
export function renderBackFallback() {
  const card = el("div", "back-card");
  card.dataset.kind = "original";
  const face = el("div", "face");
  face.append(el("div", "peta-mark", "Peta"));
  card.append(face);
  return card;
}
