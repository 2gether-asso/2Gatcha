// Mises a jour en direct (2026-11-02) : un flux SSE par onglet ouvert
// (GET /webhook/live?token=). Le serveur previent un joueur quand son compte
// change a cause de quelqu'un d'autre (echange, don, cadeau, recompense
// partagee) et tout le monde quand le fil du serveur bouge. Le site relit alors
// son en-tete, au lieu de tout relire toutes les minutes.

const clients = new Map(); // userId -> Set(res)
const MAX_PER_USER = 4;
const THROTTLE_MS = 2000;
const pendingUsers = new Map(); // userId -> timer
let feedTimer = null;

function send(res, event, data = {}) {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) { /* client parti */ }
}

export function open(req, res, userId, headers = {}) {
  const set = clients.get(userId) || new Set();
  if (set.size >= MAX_PER_USER) [...set][0].end();
  res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  // Premier message tout de suite : le site ne se croit connecte qu'a sa reception
  // (un proxy qui retiendrait le flux laisse le site en relecture toutes les minutes).
  res.write('retry: 15000\n\nevent: hello\ndata: {}\n\n');
  set.add(res);
  clients.set(userId, set);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* ferme plus bas */ } }, 25000);
  req.on('close', () => {
    clearInterval(ping);
    set.delete(res);
    if (!set.size) clients.delete(userId);
  });
}

// Le compte d'un joueur a change (regroupe sur 2 s).
export function notify(userId) {
  const id = Number(userId);
  if (!id || !clients.has(id) || pendingUsers.has(id)) return;
  pendingUsers.set(id, setTimeout(() => {
    pendingUsers.delete(id);
    for (const res of clients.get(id) || []) send(res, 'refresh');
  }, THROTTLE_MS));
}

// Le fil du serveur a bouge (regroupe sur 5 s).
export function feedChanged() {
  if (feedTimer || !clients.size) return;
  feedTimer = setTimeout(() => {
    feedTimer = null;
    for (const set of clients.values()) for (const res of set) send(res, 'feed');
  }, 5000);
}

export const stats = () => ({ players: clients.size, streams: [...clients.values()].reduce((s, x) => s + x.size, 0) });
