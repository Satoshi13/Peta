/* Shared English copy. Cryptographic proof and a referee check are separate facts. */
globalThis.PetaRefereeUI = Object.freeze({
  label(checked) {
    return checked === 'checked' ? 'Checked by Peta' : checked === 'pending' ? 'Waiting to check' : 'Not checked';
  },
  message(code, developer = false) {
    const copy = {
      offline: 'Connect to the internet to do this. Nothing was changed.',
      already_claimed: 'Someone already received this gift.',
      pending_cancel: "Peta is still taking back an earlier send. Try again when you're online.",
      clock_skew: "Check your Mac's date and time, then try again.",
      gift_received_during_save: 'The gift was received before saving finished. This sticker is no longer on this device.',
      pack_opened_during_save: 'Someone opened this pack before saving finished. Peta recorded the remote transfer; the local pack was not saved.',
      busy_pack: 'This pack is busy. Please try again.',
    };
    const message = copy[code] || 'Peta could not check this. Please try again.';
    return developer ? `${message} [${code}]` : message;
  },
});
