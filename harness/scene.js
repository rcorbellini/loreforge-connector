// C1 · A CENA COMO ÍNDICE — nome citável → onde está.
//
// Porta de `v1/regras.py::indice_cena` e `rotulos`. Nenhum modelo: é o que permite ao
// C4 dizer "aqui / longe / desconhecido" e ao C7 desempatar homônimos por DONO.
//
// Duas correções que o B3/B6 exigiram e que ficam escritas aqui:
//   · o que QUEM ESTÁ AQUI carrega também está ao alcance (persuadir, furtar, cobrar);
//   · o LUGAR ONDE ELE ESTÁ não é "longe" — o `known_elsewhere` do mundo o inclui.

"use strict";

const { norm } = require("./text");

const BOX = "C1";

function _chaves(nome) {
  const n = norm(nome);
  const out = [n];
  const b = norm(String(nome).split(",")[0]);
  if (b && b !== n) out.push(b);
  return out.filter(Boolean);
}

function _locais(ctx) {
  const x = ctx || {};
  const s = x.scene || {};
  const self = x.self || {};
  const eu = self.id;
  const out = [];   // [nome, id]
  for (const p of s.characters || []) {
    if (p.id === eu) continue;
    out.push([p.name, p.id]);
    for (const i of p.carrying || []) if (i && typeof i === "object") out.push([i.name || "?", i.id]);
  }
  for (const i of s.items || []) out.push([i.name || "?", i.id]);
  for (const o of s.objects || []) {
    out.push([o.name || "?", o.id]);
    for (const i of o.contains || o.contents || o.items || []) {
      if (i && typeof i === "object") out.push([i.name || "?", i.id]);
    }
  }
  for (const i of self.inventory || []) out.push([i.name || "?", i.id]);
  for (const e of s.exits || []) out.push([e.name, e.id]);
  return out;
}

// nome citável → [{onde:"aqui"|"longe", nome, id}]
function sceneIndex(ctx) {
  const idx = new Map();
  const add = (k, v) => { if (!idx.has(k)) idx.set(k, []); idx.get(k).push(v); };
  const locais = _locais(ctx);
  for (const [nome, id] of locais) {
    for (const k of _chaves(nome || "")) add(k, { onde: "aqui", nome, id });
  }
  const lugar = (ctx && ctx.scene && ctx.scene.place) || {};
  const idsLocais = new Set(locais.map(([, id]) => id));
  // O lugar onde ele está NÃO é indexado (como no protótipo que mediu o B3/B6): citá-lo
  // ("na Praça, coma a maçã") não é alvo de ato nenhum, e como 1º citado faria o C7
  // subir por "objeto do verbo sem lugar". Ele só sai do `known_elsewhere` — não está longe.
  if (lugar.id) idsLocais.add(lugar.id);
  for (const k of ((ctx && ctx.self && ctx.self.known_elsewhere) || [])) {
    if (!k || idsLocais.has(k.id)) continue;
    for (const ch of _chaves(k.name || k.id)) add(ch, { onde: "longe", nome: k.name, id: k.id });
  }
  return idx;
}

// id → rótulo com DONO ou LUGAR, para o decisor distinguir homônimos (B6).
function labels(ctx) {
  const x = ctx || {};
  const sc = x.scene || {};
  const self = x.self || {};
  const out = {};
  for (const i of sc.items || []) out[i.id] = `${i.name} (no chão)`;
  for (const o of sc.objects || []) {
    out[o.id] = `${o.name} (objeto do lugar)`;
    for (const i of o.contains || o.contents || o.items || []) {
      if (i && typeof i === "object") out[i.id] = `${i.name} (em ${o.name})`;
    }
  }
  for (const p of sc.characters || []) {
    if (p.id === self.id) continue;
    out[p.id] = p.name;
    for (const i of p.carrying || []) {
      if (i && typeof i === "object") out[i.id] = `${i.name} (com ${String(p.name).split(",")[0]})`;
    }
  }
  // o rótulo do PRÓPRIO inventário vence (B6)
  for (const i of self.inventory || []) out[i.id] = `${i.name} (na sua mão/inventário)`;
  for (const e of sc.exits || []) out[e.id] = `${e.name} (saída daqui)`;
  if (sc.place && sc.place.id) out[sc.place.id] = `${sc.place.name} (onde você está)`;
  for (const k of self.known_elsewhere || []) {
    if (k && k.id && !out[k.id]) out[k.id] = `${k.name} (conhecido, em outro lugar)`;
  }
  return out;
}

// id → nome curto, para os rótulos neutros da tela (nunca o id).
function nameOf(ctx, id) {
  const l = labels(ctx)[id];
  return l ? l.replace(/\s*\(.*\)$/, "") : null;
}

module.exports = { BOX, sceneIndex, labels, nameOf };
