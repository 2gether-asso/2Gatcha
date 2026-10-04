// Moteur d'execution des workflows 2Gatcha (format JSON n8n), sans n8n.
//
// Les 47 workflows du dossier n8n/workflows n'utilisent que 6 types de
// noeuds : webhook, code, if, grist, httpRequest et respondToWebhook. Ce
// moteur les rejoue avec la meme semantique que n8n ("executionOrder: v1") :
//   - execution en profondeur, branche par branche, les branches etant
//     ordonnees par position sur le canevas (haut -> bas, puis gauche ->
//     droite) ;
//   - un noeud qui ne produit aucun item arrete sa branche, sauf
//     alwaysOutputData (un item vide {} est alors emis) ;
//   - les noeuds Grist / httpRequest / if s'executent une fois PAR item ;
//   - le noeud Respond envoie la reponse HTTP, l'execution continue ensuite.
// Les acces Grist sont rediriges vers le Store (SQLite + memoire).

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// --------------------------------------------------------------- expressions
// Repere les blocs {{ ... }} en tenant compte des accolades imbriquees et des
// chaines de caracteres (ex. "{{ { a: { b: 1 } } }}").
function findTemplateBlocks(s) {
  const blocks = [];
  let i = 0;
  while (i < s.length) {
    const start = s.indexOf('{{', i);
    if (start < 0) break;
    let j = start + 2, depth = 0, quote = null;
    for (; j < s.length; j++) {
      const ch = s[j];
      if (quote) {
        if (ch === '\\') { j++; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        if (depth === 0 && s[j + 1] === '}') break;
        depth--;
      }
    }
    if (j >= s.length) break;
    blocks.push({ start, end: j + 2, code: s.slice(start + 2, j).trim() });
    i = j + 2;
  }
  return blocks;
}

const exprCache = new Map();
function compileExpr(code) {
  let fn = exprCache.get(code);
  if (!fn) {
    fn = new Function('$json', '$', '$input', '$items', `return (${code});`);
    exprCache.set(code, fn);
  }
  return fn;
}

// Evalue un parametre n8n : les chaines commencant par "=" sont des
// expressions ; un unique bloc {{ }} renvoie la valeur brute (objet, nombre,
// booleen), sinon le resultat est concatene en texte.
function evaluate(value, ctx) {
  if (typeof value === 'string') {
    if (!value.startsWith('=')) return value;
    const s = value.slice(1);
    const blocks = findTemplateBlocks(s);
    if (!blocks.length) return s;
    const run = (b) => compileExpr(b.code)(ctx.$json, ctx.$, ctx.$input, ctx.$items);
    if (blocks.length === 1 && s.slice(0, blocks[0].start).trim() === '' && s.slice(blocks[0].end).trim() === '') {
      return run(blocks[0]);
    }
    let out = '', last = 0;
    for (const b of blocks) {
      out += s.slice(last, b.start);
      const v = run(b);
      out += v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      last = b.end;
    }
    return out + s.slice(last);
  }
  if (Array.isArray(value)) return value.map((v) => evaluate(v, ctx));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = evaluate(v, ctx);
    return out;
  }
  return value;
}

// ----------------------------------------------------------- donnees de run
// Les sorties d'un noeud sont copiees a chaque lecture par un autre noeud
// (comme n8n) : un workflow peut modifier les lignes lues sans effet de bord.
// Les sorties des lectures Grist restent en JSON texte et ne sont
// reconstruites qu'a la demande.
class NodeOutput {
  constructor(outputs, jsonText) {
    this.outputs = outputs; // tableau de sorties, chaque sortie = tableau d'items
    this.jsonText = jsonText || null; // getAll Grist : '[{...},{...}]'
  }
  items(index = 0) {
    if (this.jsonText != null && index === 0) {
      const rows = JSON.parse(this.jsonText);
      return rows.length ? rows.map((json) => ({ json })) : [{ json: {} }];
    }
    let out = this.outputs[index];
    if ((!out || !out.length) && index === 0) out = this.outputs.find((o) => o && o.length) || [];
    return structuredClone(out || []);
  }
}

function itemsAccessor(items) {
  return {
    first: () => items[0],
    last: () => items[items.length - 1],
    all: () => items,
    get item() { return items[0]; },
    isExecuted: true
  };
}

// --------------------------------------------------------------- execution
export class WorkflowRunner {
  // onError(err, { workflow, node }) : erreur d'execution (suivi GlitchTip).
  constructor({ store, overrides = {}, log = console, fetchImpl = fetch, onError = null }) {
    this.store = store;
    this.overrides = overrides;
    this.log = log;
    this.onError = onError;
    this.fetch = fetchImpl;
  }

  // Lance un workflow pour une requete HTTP. Renvoie une promesse resolue des
  // que le noeud Respond s'execute (ou a la fin du workflow) ; `done` est
  // resolue quand tout le workflow est termine.
  run(workflow, request, hooks = {}) {
    const exec = new Execution(this, workflow, request, hooks);
    return exec.start();
  }
}

class Execution {
  constructor(runner, workflow, request, hooks) {
    this.runner = runner;
    this.store = runner.store;
    this.wf = workflow;
    this.request = request;
    this.hooks = hooks;
    this.nodes = new Map(workflow.nodes.map((n) => [n.name, n]));
    this.runData = new Map();
    this.response = null;
  }

  start() {
    let resolveResponse;
    const responded = new Promise((r) => { resolveResponse = r; });
    this.resolveResponse = (resp) => {
      if (this.response) return;
      this.response = resp;
      resolveResponse(resp);
    };
    const webhook = this.wf.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
    const done = (async () => {
      try {
        await this.execNode(webhook.name, [{ json: this.request }]);
        if (!this.response) this.resolveResponse({ status: 500, json: { message: 'Workflow did not respond' } });
      } catch (err) {
        this.runner.log.error(`[${this.wf.name}] ${err.nodeName ? `noeud "${err.nodeName}" : ` : ''}${err.stack || err.message}`);
        if (this.runner.onError) this.runner.onError(err, { workflow: this.wf.name, node: err.nodeName });
        if (!this.response) this.resolveResponse({ status: 500, json: { message: 'Error in workflow', error: err.message } });
      }
    })();
    return { responded, done };
  }

  // $('Nom du noeud') : copie privee par noeud en cours d'execution.
  makeDollar(cache) {
    return (name) => {
      if (cache.has(name)) return cache.get(name);
      const out = this.runData.get(name);
      if (!out) throw new Error(`Referenced node is unexecuted: "${name}"`);
      const acc = itemsAccessor(out.items(0));
      cache.set(name, acc);
      return acc;
    };
  }

  context(items, item, cache) {
    const $ = this.makeDollar(cache);
    const input = itemsAccessor(items);
    return {
      $,
      $json: item ? item.json : (items[0] ? items[0].json : {}),
      $input: { ...input, get item() { return item || items[0]; } },
      $items: (name) => (name ? $(name).all() : items)
    };
  }

  async execNode(name, items) {
    const node = this.nodes.get(name);
    if (!node) throw new Error(`Unknown node "${name}"`);
    let result;
    try {
      result = await this.runNode(node, items);
    } catch (err) {
      err.nodeName = err.nodeName || name;
      throw err;
    }
    let { outputs, jsonText } = result;
    if (node.alwaysOutputData && outputs.every((o) => !o || !o.length)) {
      outputs = [[{ json: {} }]];
      jsonText = null;
    }
    this.runData.set(name, new NodeOutput(outputs, jsonText));

    const conns = (this.wf.connections[name] && this.wf.connections[name].main) || [];
    const next = [];
    outputs.forEach((out, index) => {
      if (!out || !out.length) return;
      for (const c of conns[index] || []) next.push({ target: c.node, index, items: out });
    });
    // Ordre des branches : position sur le canevas (haut -> bas, gauche -> droite).
    next.sort((a, b) => {
      const pa = this.nodes.get(a.target).position || [0, 0], pb = this.nodes.get(b.target).position || [0, 0];
      return pa[1] - pb[1] || pa[0] - pb[0];
    });
    for (const n of next) {
      const items = jsonText != null && n.index === 0 ? this.runData.get(name).items(0) : structuredClone(n.items);
      await this.execNode(n.target, items);
    }
  }

  async runNode(node, items) {
    switch (node.type) {
      case 'n8n-nodes-base.webhook': return { outputs: [items] };
      case 'n8n-nodes-base.code': return this.runCode(node, items);
      case 'n8n-nodes-base.if': return this.runIf(node, items);
      case 'n8n-nodes-base.grist': return this.runGrist(node, items);
      case 'n8n-nodes-base.httpRequest': return this.runHttp(node, items);
      case 'n8n-nodes-base.respondToWebhook': return this.runRespond(node, items);
      default: throw new Error(`Unsupported node type ${node.type}`);
    }
  }

  // --- Code (mode "runOnceForAllItems", le seul utilise) -----------------
  async runCode(node, items) {
    if (node.parameters.mode && node.parameters.mode !== 'runOnceForAllItems') {
      throw new Error(`Unsupported code mode ${node.parameters.mode}`);
    }
    const cache = new Map();
    const ctx = this.context(items, null, cache);
    const helpers = {
      prepareBinaryData: async (buffer, fileName, mimeType) => ({ data: Buffer.from(buffer), fileName, mimeType })
    };
    const fn = new AsyncFunction('$', '$input', '$json', 'items', 'Buffer', node.parameters.jsCode);
    let out = await fn.call({ helpers }, ctx.$, ctx.$input, ctx.$json, items, Buffer);
    if (out == null) out = [];
    if (!Array.isArray(out)) out = [out];
    out = out.map((it) => (it && typeof it === 'object' && 'json' in it ? it : { json: it }));
    // Secrets / reglages propres a l'hebergement (cle Discord, webhook...) :
    // injectes dans la sortie des noeuds "Set Config" (voir config.js).
    if (node.name === 'Set Config') {
      const ov = this.runner.overrides;
      for (const it of out) for (const k of Object.keys(ov)) if (k in it.json && ov[k] !== '') it.json[k] = ov[k];
    }
    return { outputs: [out] };
  }

  // --- If (v2) -------------------------------------------------------------
  runIf(node, items) {
    const conds = node.parameters.conditions || {};
    const caseSensitive = conds.options ? conds.options.caseSensitive !== false : true;
    const isOr = conds.combinator === 'or';
    const yes = [], no = [];
    const cache = new Map();
    for (const item of items) {
      const ctx = this.context(items, item, cache);
      const results = (conds.conditions || []).map((c) => {
        const left = evaluate(c.leftValue, ctx);
        const right = evaluate(c.rightValue, ctx);
        const op = `${c.operator.type}.${c.operator.operation}`;
        switch (op) {
          case 'boolean.true': return left === true || left === 'true';
          case 'boolean.false': return left === false || left === 'false';
          case 'string.equals':
          case 'string.notEquals': {
            let l = left == null ? '' : String(left), r = right == null ? '' : String(right);
            if (!caseSensitive) { l = l.toLowerCase(); r = r.toLowerCase(); }
            return op === 'string.equals' ? l === r : l !== r;
          }
          default: throw new Error(`Unsupported if operator ${op}`);
        }
      });
      const pass = isOr ? results.some(Boolean) : results.every(Boolean);
      (pass ? yes : no).push(item);
    }
    return { outputs: [yes, no] };
  }

  // --- Grist -> Store -------------------------------------------------------
  runGrist(node, items) {
    const p = node.parameters;
    const op = p.operation || 'getAll';
    const out = [];
    const cache = new Map();
    let jsonText = null;
    for (const item of items) {
      const ctx = this.context(items, item, cache);
      const table = evaluate(p.tableId, ctx);
      if (op === 'getAll') {
        // Un getAll par item, comme n8n (les workflows s'assurent d'un seul
        // item en entree grace aux noeuds "Sync").
        if (items.length === 1) { jsonText = this.store.getAllJson(table); break; }
        for (const row of this.store.getAll(table)) out.push({ json: row });
        continue;
      }
      const fields = {};
      for (const prop of (p.fieldsToSend && p.fieldsToSend.properties) || []) {
        fields[evaluate(prop.fieldId, ctx)] = evaluate(prop.fieldValue, ctx);
      }
      if (op === 'create') out.push({ json: this.store.create(table, fields) });
      else if (op === 'update') out.push({ json: this.store.update(table, evaluate(p.rowId, ctx), fields) });
      else if (op === 'delete') {
        String(evaluate(p.rowId, ctx)).split(',').map((s) => s.trim()).filter(Boolean).forEach((id) => this.store.delete(table, id));
        out.push({ json: { success: true } });
      } else throw new Error(`Unsupported grist operation ${op}`);
    }
    if (jsonText != null) {
      return { outputs: [JSON.parse(jsonText).map((json) => ({ json }))], jsonText };
    }
    return { outputs: [out] };
  }

  // --- HTTP (Discord) -------------------------------------------------------
  async runHttp(node, items) {
    const p = node.parameters;
    const out = [];
    const cache = new Map();
    for (const item of items) {
      const ctx = this.context(items, item, cache);
      const url = evaluate(p.url, ctx);
      const method = (p.method || 'GET').toUpperCase();
      const headers = {};
      if (p.sendHeaders) for (const h of (p.headerParameters && p.headerParameters.parameters) || []) headers[h.name] = evaluate(h.value, ctx);
      let body;
      if (p.sendBody) {
        const params = (p.bodyParameters && p.bodyParameters.parameters) || [];
        const ct = p.contentType || 'json';
        if (p.specifyBody === 'json') {
          const raw = evaluate(p.jsonBody, ctx);
          body = typeof raw === 'string' ? raw : JSON.stringify(raw);
          headers['Content-Type'] = 'application/json';
        } else if (ct === 'form-urlencoded') {
          body = new URLSearchParams(params.map((q) => [q.name, String(evaluate(q.value, ctx) ?? '')])).toString();
          headers['Content-Type'] = 'application/x-www-form-urlencoded';
        } else if (ct === 'multipart-form-data') {
          body = new FormData();
          for (const q of params) {
            if (q.parameterType === 'formBinaryData') {
              const bin = item.binary && item.binary[q.inputDataFieldName];
              if (bin) body.append(q.name, new Blob([bin.data], { type: bin.mimeType }), bin.fileName || 'file');
            } else body.append(q.name, String(evaluate(q.value, ctx) ?? ''));
          }
        } else {
          body = JSON.stringify(Object.fromEntries(params.map((q) => [q.name, evaluate(q.value, ctx)])));
          headers['Content-Type'] = 'application/json';
        }
      }
      // Pendant un appel externe, les autres requetes peuvent avancer.
      const doFetch = () => this.runner.fetch(url, { method, headers, body, signal: AbortSignal.timeout(15000) });
      const res = await (this.hooks.unlocked ? this.hooks.unlocked(doFetch) : doFetch());
      const wantsFile = p.options && p.options.response && p.options.response.response && p.options.response.response.responseFormat === 'file';
      if (wantsFile) {
        const data = Buffer.from(await res.arrayBuffer());
        if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
        out.push({ json: {}, binary: { data: { data, mimeType: res.headers.get('content-type') || 'application/octet-stream' } } });
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}: ${text.slice(0, 200)}`);
      let parsed;
      try { parsed = text ? JSON.parse(text) : {}; } catch (e) { parsed = { data: text }; }
      if (Array.isArray(parsed)) parsed.forEach((json) => out.push({ json }));
      else out.push({ json: parsed });
    }
    return { outputs: [out] };
  }

  // --- Respond to Webhook ---------------------------------------------------
  runRespond(node, items) {
    const p = node.parameters;
    const opts = p.options || {};
    const headers = {};
    for (const h of (opts.responseHeaders && opts.responseHeaders.entries) || []) headers[h.name] = h.value;
    const status = opts.responseCode || 200;
    const first = items[0] || { json: {} };
    if (p.respondWith === 'binary') {
      const bin = first.binary && (first.binary.data || Object.values(first.binary)[0]);
      this.resolveResponse({ status, headers: { 'Content-Type': (bin && bin.mimeType) || 'application/octet-stream', ...headers }, raw: bin ? bin.data : Buffer.alloc(0) });
    } else {
      const ctx = this.context(items, first, new Map());
      let body = p.responseBody !== undefined ? evaluate(p.responseBody, ctx) : first.json;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { /* texte brut */ } }
      this.resolveResponse({ status, headers, json: body });
    }
    return { outputs: [items] };
  }
}

export const _internals = { findTemplateBlocks, evaluate };
