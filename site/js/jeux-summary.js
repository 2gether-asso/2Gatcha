// Jeux (2026-10-11) : recapitulatif en haut de page, pour voir d'un coup
// d'oeil ce qui attend (energie, chien, jardin, expedition, peche,
// devinette) sans passer d'onglet en onglet. Un clic ouvre le bon onglet.

(function () {
  if (typeof Session === "undefined" || !Session.isLoggedIn()) return;
  const settled = (p) => p.then((v) => v, () => null);

  async function render() {
    const el = document.getElementById("games-summary");
    if (!el) return;
    const uid = Session.userId;
    const [dig, garden, fish, expe, guess, dogGift] = await Promise.all([
      settled(API.getDigStatus(uid)), settled(API.garden(uid)), settled(API.fishing(uid, "status")),
      settled(API.expedition(uid, "status")), settled(API.guessCard(uid, "status")), settled(API.dogGift(uid))
    ]);
    const chips = [];
    const chip = (tab, icon, text, hot) => chips.push(`<button type="button" class="gs-chip ${hot ? "hot" : ""}" data-gs-tab="${tab}"><span aria-hidden="true">${icon}</span> ${text}</button>`);
    if (dig) {
      chip("dig", "&#9935;&#65039;", `Énergie ${dig.energy}/${dig.maxEnergy}`, dig.energy >= dig.maxEnergy);
      const left = dig.dogSecondsLeft || 0;
      if (left > 0) chip("dig", "&#128021;", `Milo : encore ${Math.ceil(left / 3600)} h`, false);
      else if (dig.bones > 0 && dig.bonesLeftToday !== 0) chip("dig", "&#129460;", `${dig.bones} os à donner`, true);
    }
    if (dogGift && dogGift.available) chips.push(`<button type="button" class="gs-chip hot" data-gs-dog="1"><span aria-hidden="true">&#128021;</span> Trouvaille de Milo</button>`);
    if (garden) {
      const empty = garden.plots.filter((p) => !p.planted).length;
      if (garden.readyCount) chip("garden", "&#127803;", `${garden.readyCount} parcelle${garden.readyCount > 1 ? "s" : ""} à récolter`, true);
      else if (empty) chip("garden", "&#127793;", `${empty} parcelle${empty > 1 ? "s" : ""} vide${empty > 1 ? "s" : ""}`, false);
    }
    if (fish) chip("fish", "&#127907;", fish.castsLeft == null ? `${fish.worms} vers` : `${fish.castsLeft} lancer${fish.castsLeft > 1 ? "s" : ""} · ${fish.worms} vers`, fish.castsLeft > 0 && fish.worms >= fish.cost);
    if (expe) {
      const ex = expe.expedition || {};
      if (ex.active && ex.ready) chip("expedition", "&#129517;", "Expédition rentrée", true);
      else if (ex.active) chip("expedition", "&#129517;", "Expédition en cours", false);
      else chip("expedition", "&#129517;", "Explorateur disponible", true);
    }
    if (guess && !guess.played) chip("guess", "&#10067;", "Devinette du jour", true);
    el.innerHTML = chips.join("");
    el.hidden = !chips.length;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const el = document.getElementById("games-summary");
    if (!el) return;
    el.addEventListener("click", (e) => {
      const dog = e.target.closest("[data-gs-dog]");
      if (dog) {
        dog.disabled = true;
        API.dogGift(Session.userId, "claim").then((r) => { Toast.success(`&#128021; Milo t'a rapporté ${r.gift.label} !`); if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge(); render(); })
          .catch(() => { dog.disabled = false; Toast.error("Milo n'a rien trouvé pour l'instant."); });
        return;
      }
      const b = e.target.closest("[data-gs-tab]");
      if (b && typeof setActiveTab === "function") setActiveTab(b.dataset.gsTab);
    });
    render();
    // A jour apres chaque action (les reponses invalident le cache de l'API).
    window.addEventListener("api:claimed", () => setTimeout(render, 500));
    setInterval(render, 60000);
  });
})();
