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

module.exports = { BOX, cited, whereIs };
