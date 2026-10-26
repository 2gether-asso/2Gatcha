// Editeur de reglages JSON en tableaux (admin, 2026-10-18) : tables de butin,
// destinations, etapes, echanges... sans ecrire de JSON.
//  - liste d'objets      -> tableau (une ligne par element, une colonne par champ),
//                           lignes ajoutees / supprimees / deplacees, colonne ajoutee ;
//  - objet de valeurs    -> tableau cle / valeur ;
//  - liste de valeurs    -> une case par valeur ;
//  - champ imbrique      -> objet de valeurs simples : petit tableau cle / valeur
//                           dans la case ; sinon JSON compact sur une ligne.
// Bouton « JSON brut » pour tout le reste. JsonTable.mount(el, value, def) -> { get() }.

(function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const isPrim = (v) => v === null || ["string", "number", "boolean"].includes(typeof v);
  const flatObj = (v) => isObj(v) && Object.values(v).every((x) => typeof x === "number" || typeof x === "string" || typeof x === "boolean");

  // Type d'une colonne : celui de la premiere valeur renseignee.
  function colType(rows, key, sample) {
    for (const r of [...rows, sample || {}]) {
      const v = r && r[key];
      if (v === undefined || v === null || v === "") continue;
      if (typeof v === "number") return "number";
      if (typeof v === "boolean") return "bool";
      if (typeof v === "string") return "text";
      if (flatObj(v)) return "kv";
      return "json";
    }
    return "text";
  }

  function primInput(v, type, attrs = "") {
    if (type === "bool") return `<input type="checkbox" ${attrs} ${v ? "checked" : ""} />`;
    if (type === "number") return `<input type="number" step="any" ${attrs} value="${v ?? ""}" />`;
    return `<input type="text" ${attrs} value="${esc(v ?? "")}" />`;
  }
  const primRead = (input, type) => {
    if (type === "bool") return input.checked;
    const raw = input.value.trim();
    if (raw === "") return undefined;
    if (type === "number") { const n = Number(raw.replace(",", ".")); if (!Number.isFinite(n)) throw new Error(`« ${raw} » n'est pas un nombre`); return n; }
    return raw;
  };

  // Petit tableau cle / valeur (objet de valeurs simples), dans une case ou seul.
  function kvHtml(obj, cls = "jt-kv") {
    const entries = Object.entries(obj || {});
    return `<div class="${cls}">${entries.map(([k, v]) => kvRow(k, v)).join("")}<button type="button" class="jt-mini" data-jt="kv-add" title="Ajouter un champ">+</button></div>`;
  }
  const kvRow = (k, v) => {
    const t = typeof v === "number" ? "number" : typeof v === "boolean" ? "bool" : "text";
    return `<div class="jt-kv-row" data-t="${t}"><input type="text" class="jt-kv-k" value="${esc(k)}" placeholder="clé" />${primInput(v, t, 'class="jt-kv-v"')}<button type="button" class="jt-mini" data-jt="kv-del" title="Retirer">&times;</button></div>`;
  };
  function kvRead(box) {
    const out = {};
    box.querySelectorAll(":scope > .jt-kv-row").forEach((row) => {
      const k = row.querySelector(".jt-kv-k").value.trim();
      if (!k) return;
      let t = row.dataset.t;
      const input = row.querySelector(".jt-kv-v");
      // Nouvelle ligne : nombre si ca en a l'air.
      if (t === "text" && /^-?\d+([.,]\d+)?$/.test(input.value.trim())) t = "number";
      const v = primRead(input, t);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }

  function mount(el, value, def) {
    let mode = "table";
    let current = value;
    const kind = Array.isArray(value) ? (value.length ? (value.every(isObj) ? "rows" : value.every(isPrim) ? "list" : "raw") : (Array.isArray(def) && def.length && def.every(isObj) ? "rows" : "list"))
      : isObj(value) ? (Object.values(value).every(isPrim) ? "kv" : "raw") : "raw";
    const sample = Array.isArray(def) && isObj(def[0]) ? def[0] : null;
    let cols = [];

    function drawRows(rows) {
      const seen = new Set();
      cols = [];
      [...rows, ...(sample ? [sample] : [])].forEach((r) => Object.keys(r || {}).forEach((k) => { if (!seen.has(k)) { seen.add(k); cols.push({ key: k, type: colType(rows, k, sample) }); } }));
      return `
        <div class="table-scroll"><table class="admin-table jt-table">
          <thead><tr>${cols.map((c) => `<th>${esc(c.key)}</th>`).join("")}<th aria-label="Actions"></th></tr></thead>
          <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td data-col="${esc(c.key)}" data-t="${c.type}"${r && c.key in r ? ' data-had="1"' : ""}>${cell(r[c.key], c.type)}</td>`).join("")}
            <td class="jt-row-actions"><button type="button" class="jt-mini" data-jt="up" title="Monter">&uarr;</button><button type="button" class="jt-mini" data-jt="down" title="Descendre">&darr;</button><button type="button" class="jt-mini" data-jt="del" title="Supprimer la ligne">&times;</button></td></tr>`).join("")}</tbody>
        </table></div>
        <div class="jt-foot"><button type="button" class="btn-ghost" data-jt="add">+ Ligne</button><input type="text" class="jt-newcol" placeholder="nouvelle colonne" /><button type="button" class="btn-ghost" data-jt="addcol">+ Colonne</button><button type="button" class="btn-ghost jt-raw-btn" data-jt="raw">JSON brut</button></div>`;
    }
    const cell = (v, t) => (t === "kv" ? kvHtml(v || {}) : t === "json" ? `<input type="text" class="jt-json" value="${esc(v === undefined ? "" : JSON.stringify(v))}" />` : primInput(v, t, 'class="jt-cell"'));

    function readRows() {
      return [...el.querySelectorAll(".jt-table tbody tr")].map((tr, i) => {
        const o = {};
        tr.querySelectorAll("td[data-col]").forEach((td) => {
          const t = td.dataset.t, key = td.dataset.col;
          try {
            let v;
            if (t === "kv") v = kvRead(td.querySelector(".jt-kv"));
            else if (t === "json") { const raw = td.querySelector(".jt-json").value.trim(); v = raw === "" ? undefined : JSON.parse(raw); }
            else v = primRead(td.querySelector(".jt-cell"), t);
            // Colonne absente de cette ligne au depart (2026-10-26) : un objet
            // vide ou une case decochee restent absents, au lieu de remplir
            // chaque ligne de {} / false (le reglage paraissait toujours modifie).
            if (!td.dataset.had && ((t === "kv" && v && !Object.keys(v).length) || (t === "bool" && v === false))) v = undefined;
            if (v !== undefined) o[key] = v;
          } catch (e) { throw new Error(`Ligne ${i + 1}, colonne « ${key} » : ${e.message}`); }
        });
        return o;
      });
    }

    function draw() {
      if (mode === "raw" || kind === "raw") {
        el.innerHTML = `<textarea class="jt-raw" spellcheck="false">${esc(JSON.stringify(current, null, 2))}</textarea>${kind === "raw" ? "" : '<div class="jt-foot"><button type="button" class="btn-ghost" data-jt="table">Revenir au tableau</button></div>'}`;
        return;
      }
      if (kind === "rows") el.innerHTML = drawRows(current);
      else if (kind === "kv") el.innerHTML = `${kvHtml(current, "jt-kv jt-kv-main")}<div class="jt-foot"><button type="button" class="btn-ghost jt-raw-btn" data-jt="raw">JSON brut</button></div>`;
      else el.innerHTML = `<div class="jt-list">${current.map((v) => `<span class="jt-list-item">${primInput(v, typeof v === "number" ? "number" : typeof v === "boolean" ? "bool" : "text", 'class="jt-cell"')}<button type="button" class="jt-mini" data-jt="ldel" title="Retirer">&times;</button></span>`).join("")}<button type="button" class="jt-mini" data-jt="ladd" title="Ajouter">+</button></div><div class="jt-foot"><button type="button" class="btn-ghost jt-raw-btn" data-jt="raw">JSON brut</button></div>`;
    }

    function get() {
      if (mode === "raw" || kind === "raw") {
        try { return JSON.parse(el.querySelector(".jt-raw").value); } catch (e) { throw new Error("JSON invalide"); }
      }
      if (kind === "rows") return readRows();
      if (kind === "kv") return kvRead(el.querySelector(".jt-kv-main"));
      const numeric = current.every((v) => typeof v === "number");
      return [...el.querySelectorAll(".jt-list .jt-cell")].map((i) => primRead(i, numeric ? "number" : i.type === "checkbox" ? "bool" : "text")).filter((v) => v !== undefined);
    }

    el.classList.add("jt");
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-jt]");
      if (!b || !el.contains(b)) return;
      const act = b.dataset.jt;
      try {
        if (act === "raw") { current = get(); mode = "raw"; return draw(); }
        if (act === "table") { current = get(); mode = "table"; return draw(); }
        if (act === "kv-add") { b.insertAdjacentHTML("beforebegin", kvRow("", "")); b.previousElementSibling.querySelector(".jt-kv-k").focus(); return; }
        if (act === "kv-del") { b.closest(".jt-kv-row").remove(); return; }
        if (act === "ladd") { b.insertAdjacentHTML("beforebegin", `<span class="jt-list-item">${primInput("", current.every((v) => typeof v === "number") ? "number" : "text", 'class="jt-cell"')}<button type="button" class="jt-mini" data-jt="ldel" title="Retirer">&times;</button></span>`); return; }
        if (act === "ldel") { b.closest(".jt-list-item").remove(); return; }
        const tr = b.closest("tr");
        if (act === "del") { tr.remove(); return; }
        if (act === "up" && tr.previousElementSibling) { tr.parentElement.insertBefore(tr, tr.previousElementSibling); return; }
        if (act === "down" && tr.nextElementSibling) { tr.parentElement.insertBefore(tr.nextElementSibling, tr); return; }
        if (act === "add") {
          current = readRows();
          const last = current[current.length - 1] || sample || {};
          // Nouvelle ligne : memes champs, valeurs vides (les sous-tableaux gardent leurs cles).
          current.push(Object.fromEntries(Object.entries(last).map(([k, v]) => [k, flatObj(v) ? Object.fromEntries(Object.keys(v).map((x) => [x, typeof v[x] === "number" ? 0 : ""])) : typeof v === "number" ? 0 : typeof v === "boolean" ? false : Array.isArray(v) ? [] : ""])));
          return draw();
        }
        if (act === "addcol") {
          const name = el.querySelector(".jt-newcol").value.trim();
          if (!name) return;
          current = readRows().map((r) => (name in r ? r : { ...r, [name]: "" }));
          if (!current.length) current = [{ [name]: "" }];
          return draw();
        }
      } catch (err) { if (typeof Toast !== "undefined") Toast.error(err.message); }
    });
    draw();
    return { get };
  }

  window.JsonTable = { mount };
})();
