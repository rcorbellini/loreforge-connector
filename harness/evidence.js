// A CLASSIFICAÇÃO DA AÇÃO para o registro (FR-017, research R10).
//
//   persistente · aceita pelo mundo e com desfecho que mudou algo (`aconteceu`/`viradas`)
//   consultiva  · consulta do mundo (`readOnlyHint`) ou tool local de extensão
//   pedida      · o verbo do objetivo aparece no sussurro (regra de radical — a mesma da
//                 pista do verbo). "Não pedida" é a agência extra do C3 (~1 por caso no
//                 B2): executa, e fica marcada para o mantenedor medir.

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
  const v = primeiroVerbo(objetivo);
  if (v.length < 3) return false;
  const r = v.slice(0, 3);
  return norm(sussurro).split(" ").some((w) => w.length >= 3 && !STOP.has(w) && w.slice(0, 3) === r);
}

module.exports = { isConsultive, isPersistent, wasAsked };
