// C4 · ONDE ESTÁ O ALVO — aqui / longe / desconhecido, por regra.
//
// Porta de `v1/regras.py::citados` e `onde_esta` (regra v2, B3: NOVO 64/65).
//   · o nome citável mais LONGO engole o menor ("Macieira" dentro de "Macieira da Praça");
//   · aceita a 1ª palavra significativa de um nome ("Fenn" por "Fenn, o Dedos-Leves");
//   · o PRIMEIRO citado que está AQUI vence; sem nenhum aqui, o primeiro de longe.

"use strict";

const { norm, STOP } = require("./text");

const BOX = "C4";

// `soSeVazio`: a 1ª palavra significativa ("Fenn") só entra quando NENHUM nome inteiro
// casou — é o `onde_esta` do protótipo. O `citados` a usa sempre (fora da sobreposição).
function _achados(texto, idx, soSeVazio) {
  const t = " " + norm(texto) + " ";
  const achados = [];   // [len, pos, chave, alvos]
  for (const [chave, alvos] of idx) {
    const p = t.indexOf(` ${chave} `);
    if (p >= 0) achados.push([chave.length, p, chave, alvos]);
  }
  if (!(soSeVazio && achados.length)) {
    for (const [chave, alvos] of idx) {
      const palavras = chave.split(" ").filter((w) => !STOP.has(w) && w.length > 3);
      if (!palavras.length) continue;
      const p = t.indexOf(` ${palavras[0]} `);
      if (p >= 0 && (soSeVazio || !achados.some((a) => a[1] <= p && p < a[1] + a[0]))) {
        achados.push([palavras[0].length, p, chave, alvos]);
      }
    }
  }
  // o que está DENTRO de um achado maior não conta
  const vivos = achados.filter((a) => !achados.some((b) => b !== a && b[1] <= a[1]
    && a[1] + a[0] <= b[1] + b[0] && b[0] > a[0]));
  vivos.sort((a, b) => a[1] - b[1]);
  return vivos;
}

// Todos os alvos citados, na ordem do texto, sem repetição.
function cited(texto, idx) {
  const out = [];
  const vistos = new Set();
  for (const [, , , alvos] of _achados(texto, idx)) {
    const aqui = alvos.filter((a) => a.onde === "aqui");
    const a = (aqui.length ? aqui : alvos)[0];
    const chave = a.id || a.nome;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    out.push({ onde: a.onde, nome: a.nome, id: a.id });
  }
  return out;
}

// {onde: aqui|longe|desconhecido, nome, id, ambiguo}
function whereIs(texto, idx) {
  const vivos = _achados(texto, idx, true);
  if (!vivos.length) return { onde: "desconhecido", nome: null, id: null, ambiguo: false };
  const locais = vivos.filter((a) => a[3].some((x) => x.onde === "aqui"));
  const [, , , alvos] = (locais.length ? locais : vivos)[0];
  const aqui = alvos.filter((a) => a.onde === "aqui");
  const pool = aqui.length ? aqui : alvos;
  const ids = new Set(pool.map((a) => a.id));
  return { onde: pool[0].onde, nome: pool[0].nome, id: pool[0].id, ambiguo: ids.size > 1 };
}

// R1 (spec 076) — DESTINO → SAÍDA, depois da escolha da capacidade. O passo de andar nomeia o
// destino ("caminhar para a Taverna do Gancho") e a capacidade escolhida pede uma SAÍDA que o
// passo não citou: as saídas que levam a esse destino entram no lugar dele. Fica FORA do índice
// da cena de propósito: lá, o destino virava alvo de todo passo que cita um lugar, mudava o C4 e
// o filtro da C6 (paridade B3/B5) e punha "andar" entre as candidatas de "rezar pelos mortos do
// porto". Aqui ela só vale quando a C6 já escolheu algo que aceita saída, que é o que a
// V3-resolver mediu (6 deslocamentos legítimos recuperados, nenhum perdido).
function withDestinations(texto, citados, ctx, toolRefs) {
  const exits = ((ctx && ctx.scene && ctx.scene.exits) || []).filter((e) => e && e.id);
  const exitIds = new Set(exits.map((e) => e.id));
  const pedeSaida = Object.values(toolRefs || {}).some((en) => (en || []).some((id) => exitIds.has(id)));
  if (!pedeSaida || citados.some((a) => exitIds.has(a.id))) return citados;
  const idx = new Map();
  for (const e of exits) {
    if (!e.destination_name) continue;
    const chaves = [norm(e.destination_name), norm(String(e.destination_name).split(",")[0])];
    for (const k of new Set(chaves.filter(Boolean))) {
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push({ onde: "aqui", nome: e.name, id: e.id, destino: e.destination_name });
    }
  }
  const saidas = [];
  for (const [, , , alvos] of _achados(texto, idx)) {
    for (const a of alvos) if (!saidas.some((s) => s.id === a.id)) saidas.push(a);
  }
  if (!saidas.length) return citados;
  const destinos = new Set(saidas.map((s) => norm(s.destino)));
  const resto = citados.filter((a) => !destinos.has(norm(a.nome)));
  return saidas.map(({ onde, nome, id }) => ({ onde, nome, id })).concat(resto);
}

module.exports = { BOX, cited, whereIs, withDestinations };
