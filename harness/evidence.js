// A CLASSIFICAÇÃO DA AÇÃO para o registro (FR-017, research R10).
//
//   persistente · aceita pelo mundo e com desfecho que mudou algo (`aconteceu`/`viradas`)
//   consultiva  · consulta do mundo (`readOnlyHint`) ou tool local de extensão
//   pedida      · o verbo do objetivo aparece no sussurro (regra de radical — a mesma da
//                 pista do verbo), OU o ato e o sussurro falam da mesma coisa (uma palavra de
//                 conteúdo em comum). "Não pedida" é a agência extra do plano: executa, e fica
//                 marcada para o mantenedor medir. A segunda via é da spec 076: o plano M escreve
//                 o verbo conjugado e curto ("dá uma moeda de cobre — Tibério" para "dê uma moeda
//                 de cobre ao Tibério"), e o radical de 3 letras sozinho marcava o pedido literal
//                 como não pedido.

"use strict";

const { norm, STOP, primeiroVerbo } = require("./text");

function isConsultive(tool, ehLocal) {
  if (!tool) return false;
  if (ehLocal) return true;
  return !!(tool.annotations && tool.annotations.readOnlyHint);
}

function isPersistent(out, consultiva) {
  if (consultiva || !out || !out.ok) return false;
  return !!((out.aconteceu || []).length || (out.viradas || []).length);
}

// Radical de 3 letras: o sussurro vem conjugado ("pegue", "beba") e o objetivo no
// infinitivo ("Pegar", "Beber") — 4 letras não casam "pegu" com "pega". As palavras
// vazias saem ("com" não é o verbo "comer").
function wasAsked(objetivo, sussurro) {
  if (!sussurro) return false;           // tick autônomo: ninguém pediu, é o desejo
  const palavras = norm(sussurro).split(" ").filter((w) => w.length >= 3 && !STOP.has(w));
  const v = primeiroVerbo(objetivo);
  if (v.length >= 3 && palavras.some((w) => w.slice(0, 3) === v.slice(0, 3))) return true;
  // a mesma coisa nos dois: uma palavra de conteúdo (4+ letras) do ato que o sussurro também diz
  const doAto = new Set(norm(objetivo).split(" ").filter((w) => w.length >= 4 && !STOP.has(w)));
  return palavras.some((w) => w.length >= 4 && doAto.has(w));
}

module.exports = { isConsultive, isPersistent, wasAsked };
