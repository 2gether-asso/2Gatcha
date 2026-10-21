// Module charge a la demande par profile.html (bouton [data-compare]).
// Comparateur de collections (2026-10-21) : sur le profil d'un autre joueur,
// ce qu'il a et pas moi, ce que j'ai et pas lui, ce qu'on a en commun, et
// les echanges « gagnant-gagnant » (son doublon qui me manque contre mon
// doublon qui lui manque, raretes proches, sa liste de souhaits d'abord).
// Chaque proposition ouvre le formulaire d'echange pre-rempli
// (trade.html?to=&offer=&request=). Donnees : profil public (deja charge par
// la page) + GET collection du visiteur ; aucun nouvel endpoint.

const Compare = (function () {
  const esc = escHtml;
  const MAX_PAIRS = 6;

  function tile(c, { badge = "", href = "" } = {}) {
    const color = (c.rarity && c.rarity.colorHex) || "#9aa0b4";
    const img = API.imageUrl(c.imageId) || PLACEHOLDER_IMG;
    const inner = `<img src="${img}" alt="" loading="lazy" decoding="async" />${badge}<span class="cmp-name">${esc(c.name)}</span><small style="color:${rarityTextColor(color)}">${esc((c.rarity && c.rarity.name) || "")}</small>`;
    return href
      ? `<a class="cmp-tile" style="--r:${esc(color)}" href="${href}" title="Lui proposer un échange">${inner}</a>`
      : `<span class="cmp-tile" style="--r:${esc(color)}">${inner}</span>`;
  }

  // Paires gagnant-gagnant : ses doublons qui me manquent x mes doublons qui
  // lui manquent, au plus pres en rarete ; ses souhaits passent devant.
  function pairs(hisDupes, myDupes, wish) {
    const out = [];
    const mine = [...myDupes].sort((a, b) => (wish.has(b.cardId) - wish.has(a.cardId)) || ((b.rarity?.sortOrder || 0) - (a.rarity?.sortOrder || 0)));
    const left = [...hisDupes].sort((a, b) => (b.rarity?.sortOrder || 0) - (a.rarity?.sortOrder || 0));
    for (const m of mine) {
      if (!left.length || out.length >= MAX_PAIRS) break;
      let best = 0;
      left.forEach((h, i) => { if (Math.abs((h.rarity?.sortOrder || 0) - (m.rarity?.sortOrder || 0)) < Math.abs((left[best].rarity?.sortOrder || 0) - (m.rarity?.sortOrder || 0))) best = i; });
      out.push({ mine: m, his: left.splice(best, 1)[0], wished: wish.has(m.cardId) });
    }
    return out;
  }

  function bodyHtml(pseudo, d) {
    const total = d.common.length + d.hisOnly.length + d.mineOnly.length || 1;
    const w = (n) => ((n / total) * 100).toFixed(1) + "%";
    const to = encodeURIComponent(pseudo);
    const tradeUrl = (q) => `trade.html?to=${to}&${q}`;
    const pairHtml = d.pairs.length ? `
      <section class="cmp-pairs">
        <h3>&#129309; Échanges gagnant-gagnant</h3>
        <p class="cmp-help">Ton doublon qui lui manque contre son doublon qui te manque, à rareté proche${d.pairs.some((p) => p.wished) ? " (en premier : ce qu'il cherche)" : ""}.</p>
        <ul>${d.pairs.map((p) => `
          <li class="cmp-pair">
            ${tile(p.mine, { badge: p.wished ? '<span class="cmp-badge cmp-wish">&#11088; il la cherche</span>' : "" })}
            <span class="cmp-swap" aria-hidden="true">&#8644;</span>
            ${tile(p.his)}
            <a class="btn cmp-go" href="${tradeUrl(`offer=${p.mine.cardId}&request=${p.his.cardId}`)}">Proposer</a>
          </li>`).join("")}</ul>
      </section>` : "";
    const grid = (list, opts) => (list.length ? `<div class="cmp-grid">${list.map((c) => tile(c, opts(c))).join("")}</div>` : '<p class="cmp-empty">Rien ici.</p>');
    return `
      <div class="cmp-meter" role="img" aria-label="${d.common.length} en commun, ${d.hisOnly.length} seulement chez ${esc(pseudo)}, ${d.mineOnly.length} seulement chez toi">
        <span class="cmp-m-mine" style="width:${w(d.mineOnly.length)}"></span><span class="cmp-m-common" style="width:${w(d.common.length)}"></span><span class="cmp-m-his" style="width:${w(d.hisOnly.length)}"></span>
      </div>
      <div class="cmp-legend">
        <span><i class="cmp-m-mine"></i> Toi seul : <strong>${d.mineOnly.length}</strong></span>
        <span><i class="cmp-m-common"></i> En commun : <strong>${d.common.length}</strong></span>
        <span><i class="cmp-m-his"></i> ${esc(pseudo)} seul : <strong>${d.hisOnly.length}</strong></span>
      </div>
      ${pairHtml}
      <div class="cmp-tabs" role="tablist">
        <button type="button" role="tab" aria-selected="true" data-cmp-tab="his">Il a, pas toi <b>${d.hisOnly.length}</b></button>
        <button type="button" role="tab" aria-selected="false" data-cmp-tab="mine">Toi, pas lui <b>${d.mineOnly.length}</b></button>
        <button type="button" role="tab" aria-selected="false" data-cmp-tab="common">En commun <b>${d.common.length}</b></button>
      </div>
      <div class="cmp-pane" data-cmp-pane="his">
        <p class="cmp-help">Ses doublons (×N) sont les plus faciles à obtenir : touche-les pour lui demander.</p>
        ${grid(d.hisOnly, (c) => (c.count > 1 && !c.isPromo ? { badge: `<span class="cmp-badge">×${c.count}</span>`, href: tradeUrl(`request=${c.cardId}`) } : {}))}
      </div>
      <div class="cmp-pane" data-cmp-pane="mine" hidden>
        <p class="cmp-help">Tes doublons qui lui manquent : touche-les pour les lui proposer.</p>
        ${grid(d.mineOnly, (c) => {
          const wished = d.wish.has(c.cardId);
          const dupe = c.count > 1 && !c.isPromo;
          return { badge: (wished ? '<span class="cmp-badge cmp-wish">&#11088;</span>' : "") + (dupe ? `<span class="cmp-badge">×${c.count}</span>` : ""), href: dupe ? tradeUrl(`offer=${c.cardId}`) : "" };
        })}
      </div>
      <div class="cmp-pane" data-cmp-pane="common" hidden>${grid(d.common, () => ({}))}</div>`;
  }

  async function open(pseudo, profile) {
    if (!Session.isLoggedIn()) { Toast.info("Connecte-toi pour comparer vos collections."); return; }
    const overlay = document.createElement("div");
    overlay.className = "card-modal-overlay contract-overlay cmp-overlay";
    overlay.innerHTML = `<div class="contract-modal cmp-modal" role="dialog" aria-modal="true" aria-labelledby="cmp-title">
      <header class="contract-modal-head"><div><strong id="cmp-title">&#9878;&#65039; Toi et ${esc(pseudo)}</strong><small>Comparaison de vos collections</small></div>
        <button type="button" class="card-modal-close" data-cmp-close aria-label="Fermer">&times;</button></header>
      <div class="cmp-body"><div class="loading-row"><div class="spinner"></div></div></div>
    </div>`;
    document.body.appendChild(overlay);
    if (typeof syncScrollLock === "function") syncScrollLock();
    const close = () => { overlay.remove(); if (typeof syncScrollLock === "function") syncScrollLock(); };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target.closest("[data-cmp-close]")) { close(); return; }
      const tab = e.target.closest("[data-cmp-tab]");
      if (!tab) return;
      overlay.querySelectorAll("[data-cmp-tab]").forEach((b) => b.setAttribute("aria-selected", String(b === tab)));
      overlay.querySelectorAll("[data-cmp-pane]").forEach((p) => { p.hidden = p.dataset.cmpPane !== tab.dataset.cmpTab; });
    });
    overlay.querySelector("[data-cmp-close]").focus();
    const body = overlay.querySelector(".cmp-body");
    try {
      const [his, mineRes] = await Promise.all([profile ? Promise.resolve(profile) : API.getPublicProfile(pseudo), API.getCollection(Session.userId)]);
      const catalog = new Map((mineRes.cards || []).map((c) => [c.cardId, c]));
      const mineCount = new Map((mineRes.owned || []).map((o) => [o.cardId, o.count || (o.copies || []).length || 1]));
      const hisCount = new Map((his.cards || []).map((c) => [c.cardId, c.count || 1]));
      const card = (id, count, fallback) => ({ ...(catalog.get(id) || fallback || {}), cardId: id, count });
      const byRarity = (a, b) => ((b.rarity?.sortOrder || 0) - (a.rarity?.sortOrder || 0)) || String(a.name || "").localeCompare(String(b.name || ""));
      const hisById = new Map((his.cards || []).map((c) => [c.cardId, c]));
      const d = {
        hisOnly: [...hisCount].filter(([id]) => !mineCount.has(id)).map(([id, n]) => card(id, n, hisById.get(id))).sort(byRarity),
        mineOnly: [...mineCount].filter(([id]) => !hisCount.has(id)).map(([id, n]) => card(id, n)).filter((c) => c.name).sort(byRarity),
        common: [...mineCount].filter(([id]) => hisCount.has(id)).map(([id, n]) => card(id, n, hisById.get(id))).sort(byRarity),
        wish: new Set((his.wishlist || []).map((c) => c.cardId))
      };
      d.pairs = pairs(d.hisOnly.filter((c) => c.count > 1 && !c.isPromo), d.mineOnly.filter((c) => c.count > 1 && !c.isPromo), d.wish);
      if (!overlay.isConnected) return;
      body.innerHTML = bodyHtml(pseudo, d);
    } catch (e) {
      body.innerHTML = '<p class="cmp-empty">Comparaison indisponible pour le moment.</p>';
    }
  }

  return { open };
})();
