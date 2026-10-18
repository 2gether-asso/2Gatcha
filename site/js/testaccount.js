// Compte test admin (2026-10-18, api/src/native/testaccount.js) : un admin
// bascule sur le compte test (id 9 "Le Grand 2GETHER") sans Discord, s'y
// donne niveaux et ressources, choisit sa difficulte, et revient a son compte.
// La session admin est gardee de cote (localStorage) pendant la partie test ;
// les outils l'utilisent pour parler a l'API en tant qu'admin.

(function () {
  const KEY = "2gatcha_test_backup";
  const esc = escHtml;
  const SESSION_KEYS = ["userId", "pseudo", "discordId", "discordUsername", "discordAvatar", "token"];
  const backup = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { return null; } };
  const active = () => { const b = backup(); return !!(b && String(Session.userId) === String(b.testId)); };

  // Appel admin : session admin courante, ou celle gardee de cote pendant la partie test.
  async function call(action, extra = {}) {
    const b = backup();
    if (!b || !active()) return API.post("adminTestAccount", { discordId: Session.discordId, action, ...extra });
    const res = await fetch(API.url("adminTestAccount"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + b.token },
      body: JSON.stringify({ discordId: b.discordId, action, ...extra })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) { const err = new Error(data.error || "http_" + res.status); err.code = data.error; err.data = data; throw err; }
    return data;
  }

  async function enter() {
    const r = await call("login");
    const keep = Object.fromEntries(SESSION_KEYS.map((k) => [k, Session[k] || ""]));
    try { localStorage.setItem(KEY, JSON.stringify({ ...keep, testId: r.userId })); } catch (e) { Toast.error("Stockage du navigateur indisponible."); return; }
    Session.set({ userId: r.userId, pseudo: r.pseudo, discordId: "", discordUsername: "", discordAvatar: "", token: r.token });
    location.href = "index.html";
  }

  function leave() {
    const b = backup();
    if (!b) return;
    Session.set(b);
    try { localStorage.removeItem(KEY); } catch (e) { /* stockage indisponible */ }
    location.href = "admin.html";
  }

  const ERR = { test_account_missing: "Le compte test n'existe pas (réglage « Compte test admin : id du joueur »).", forbidden: "Réservé aux admins.", unknown_resource: "Ressource inconnue." };

  // Panneau d'outils (admin > Compte test, ou fenetre depuis le bandeau).
  async function renderPanel(box) {
    box.innerHTML = '<div class="skeleton-line">Chargement…</div>';
    let st;
    try { st = await call("status"); } catch (e) { box.innerHTML = `<p class="empty-state">${esc(ERR[e.code] || friendlyError(e))}</p>`; return; }
    const draw = () => {
      box.innerHTML = `
        <div class="ta-head">
          <div><strong>&#129514; ${esc(st.pseudo)}</strong> <small class="muted">#${st.userId} · niv. ${st.level} · ${st.cards} exemplaire${st.cards > 1 ? "s" : ""}</small></div>
          ${active() ? `<button type="button" class="btn-secondary" data-ta="leave">&#8617; Revenir à mon compte</button>` : `<button type="button" class="btn" data-ta="enter">&#127918; Jouer avec le compte test</button>`}
        </div>
        <p class="ta-help muted">Connexion sans Discord. Ce compte n'apparaît pas dans les classements, le fil d'actu ni les objectifs communs, ne compte pas dans les statistiques de l'économie, et ne peut ni échanger, ni donner, ni toucher au coffre de guilde, au chantier, au boss, aux équipes, à la loterie ou aux codes événement.</p>
        <div class="ta-grid">
          <fieldset class="ta-box"><legend>Difficulté du compte</legend>
            <select data-ta-mode>
              <option value="">Celle du serveur (${esc(st.modes.find((m) => m.key === st.globalMode)?.label || st.globalMode)})</option>
              ${st.modes.map((m) => `<option value="${m.key}" ${st.mode === m.key ? "selected" : ""}>${m.icon} ${esc(m.label)}</option>`).join("")}
            </select>
            <small class="muted">Seulement pour ce compte : les autres joueurs gardent la difficulté du serveur.</small>
          </fieldset>
          <fieldset class="ta-box"><legend>Niveaux</legend>
            <label>Compte <input type="number" min="1" max="200" data-ta-level="account" value="${st.level}" /></label>
            ${Object.entries(st.skills).map(([k, s]) => `<label>${esc(s.label)} <input type="number" min="1" max="${s.max}" data-ta-level="${k}" value="${s.level}" /></label>`).join("")}
          </fieldset>
          <fieldset class="ta-box ta-res"><legend>Ressources</legend>
            ${st.resources.map((r) => `<label>${esc(r.label)} <input type="number" min="0" data-ta-res="${r.key}" value="${r.value}" /></label>`).join("")}
          </fieldset>
        </div>
        <div class="ta-actions">
          <button type="button" class="btn" data-ta="save">Appliquer</button>
          <button type="button" class="btn-secondary" data-ta="cards">&#127183; Une carte de chaque</button>
          <button type="button" class="btn-ghost ta-danger" data-ta="reset">&#9851;&#65039; Repartir en nouveau joueur</button>
        </div>`;
    };
    draw();
    box.onclick = async (e) => {
      const b = e.target.closest("[data-ta]");
      if (!b || b.disabled) return;
      const act = b.dataset.ta;
      b.disabled = true;
      try {
        if (act === "enter") return await enter();
        if (act === "leave") return leave();
        if (act === "save") {
          const levels = {}; const resources = {};
          box.querySelectorAll("[data-ta-level]").forEach((i) => { levels[i.dataset.taLevel] = Number(i.value); });
          box.querySelectorAll("[data-ta-res]").forEach((i) => { resources[i.dataset.taRes] = Number(i.value); });
          st = await call("set", { levels, resources, mode: box.querySelector("[data-ta-mode]").value });
          Toast.success("Compte test mis à jour.");
        } else if (act === "cards") {
          st = await call("cards");
          Toast.success(`${st.given} carte${st.given > 1 ? "s" : ""} ajoutée${st.given > 1 ? "s" : ""}.`);
        } else if (act === "reset") {
          if (!(await Confirm.show("Supprimer toutes les cartes et toute la progression du compte test pour repartir comme un nouveau joueur ? (sa difficulté choisie est gardée)", { title: "Nouveau joueur", confirmText: "Repartir de zéro", dangerous: true }))) return;
          st = await call("reset");
          Toast.success("Compte test remis à zéro.");
        }
        draw();
        if (active()) { if (typeof loadHeaderBoosterBadge === "function") loadHeaderBoosterBadge(); API.invalidate && API.invalidate(); }
      } catch (err) {
        Toast.error(ERR[err.code] || friendlyError(err));
      } finally { b.disabled = false; }
    };
  }

  // Bandeau pendant la partie test.
  function banner() {
    if (!active() || document.getElementById("ta-banner")) return;
    const el = document.createElement("div");
    el.id = "ta-banner";
    el.className = "ta-banner";
    el.innerHTML = `<span>&#129514; Compte test</span><button type="button" data-ta-open>Outils</button><button type="button" data-ta-back>Revenir à mon compte</button>`;
    document.body.appendChild(el);
    el.querySelector("[data-ta-back]").addEventListener("click", leave);
    el.querySelector("[data-ta-open]").addEventListener("click", () => {
      const ov = document.createElement("div");
      ov.className = "ta-modal";
      ov.innerHTML = `<div class="ta-modal-box" role="dialog" aria-label="Outils du compte test"><button type="button" class="ta-close" aria-label="Fermer">&times;</button><div class="ta-modal-body"></div></div>`;
      document.body.appendChild(ov);
      const close = () => { ov.remove(); location.reload(); };
      ov.querySelector(".ta-close").addEventListener("click", close);
      ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
      renderPanel(ov.querySelector(".ta-modal-body"));
    });
  }

  window.TestAccount = { active, enter, leave, renderPanel };
  // Admin > Compte test.
  const zone = document.getElementById("test-account-zone");
  if (zone) { if (typeof AdminNav !== "undefined" && AdminNav.onFirstShow) AdminNav.onFirstShow("test", () => renderPanel(zone)); else renderPanel(zone); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", banner); else banner();
})();
