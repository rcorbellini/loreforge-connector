// C3 · O QUE EU QUERO AGORA — a única chamada PAGA antes de o mundo agir.
//
// A Mente recebe a instrução e a cena em PROSA, e NUNCA o schema das tools (invariante 1
// do contrato 01). Ela devolve objetivos, um por linha, cada um nomeando o alvo pelo
// nome da cena (B3: sem nome no texto, o C4 não tem o que resolver). Escolher a tool e
// os ids é trabalho do resolvedor local, de graça.
//
// Prompt: B2/P1 (cobertura ~70%, ~1,4 mil tokens). A cena é a mesma prosa que o jogo já
// montava para o caminho antigo (`_cenaEmProsa(_contextoPayload(ctx, {comCapacidades:false}))`).

"use strict";

const BOX = "C3";

function parseList(texto) {
  return String(texto || "").split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-*•]\s*\S/.test(l) || /^\d+[.)]\s*\S/.test(l))
    .map((l) => l.replace(/^([-*•]|\d+[.)])\s*/, "").trim())
    .filter((l) => l && !/^\(?\s*nada\s*\)?\.?$/i.test(l));
}

async function userOf(mente, ctx, instrucao) {
  const prosa = mente._cenaEmProsa(await mente._contextoPayload(ctx, { comCapacidades: false }));
  return "O que ele faz?\n\nINSTRUÇÃO: " + instrucao + "\n\n" + prosa;
}

// → { objetivos: [texto], cru, user }
async function objectives({ mente, ctx, instrucao, system }) {
  const user = await userOf(mente, ctx, instrucao);
  const cru = await mente.conversar(system, user,
    { rotina: "objetivos", label: "OBJETIVOS (C3)", temperature: 0.4, maxTokens: 200 });
  return { objetivos: parseList(cru).slice(0, 6), cru, user };
}

module.exports = { BOX, objectives, parseList, userOf };
