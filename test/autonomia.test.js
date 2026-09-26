// A BIFURCAÇÃO DO TICK AUTÔNOMO — agora "querer OU andar" (spec 075).
//
// O ramo de CRIAR já morreu em silêncio uma vez (spec 035 → refactor de 06/08: o
// `REFLECT_COMMAND` ficou órfão por uma semana, e um personagem sem intenção
// simplesmente nunca fazia nenhuma). Na spec 075 ele virou a rotina `querer` (C3P):
// sem desejo, o tick pergunta "o que eu quero agora?" e planeja.
//
// O comportamento do tick é testado em `laco.test.js` (TICK sem desejo). Aqui fica a
// garantia de que as rotinas do harness existem e são EDITÁVEIS pelo painel — o
// Jev e a Mente são um ecossistema só, e a mesa tuna os dois do mesmo jeito.

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const Mente = require("../mente").criarMente();

test("as rotinas do harness são EDITÁVEIS no painel — as da Mente e as do Jev", () => {
  const nomes = Mente.ROTINAS.map((r) => r.nome);
  for (const n of ["objetivos", "querer", "planejar", "narrar",
                   "decisor_system", "c6_tool", "c7_param", "c8_passo", "c8d_fim"]) {
    assert.ok(nomes.includes(n), `a rotina '${n}' não aparece para quem tuna`);
    assert.ok(Object.keys(Mente.promptsPadrao()).includes(n), `a rotina '${n}' não tem texto padrão`);
  }
});

test("as rotinas do caminho antigo MORRERAM (FR-005): nada de interpretar, autonomia ou refletir", () => {
  const nomes = Mente.ROTINAS.map((r) => r.nome);
  for (const morta of ["interpretar", "autonomia", "refletir"]) {
    assert.ok(!nomes.includes(morta), `a rotina '${morta}' ainda existe`);
  }
  assert.strictEqual(typeof Mente.interpret, "undefined");
  assert.strictEqual(typeof Mente.deriveWhisper, "undefined");
});
