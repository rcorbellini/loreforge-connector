// O PLANO M (spec 076): o parser do contrato, o texto do resolvedor e o racional.
//
// O parser é a fronteira entre a Mente e o mundo: o que ele deixa passar como ATO pode virar
// chamada. Por isso ele é estrito no contrato (sem `passos_do_plano` não há plano) e tolerante
// só no FORMATO (cerca de código, texto em volta), e passo sem tipo válido vira "defeito",
// nunca ato.

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { parsePlan, actText, PlanContractError } = require("../harness/objectives");
const { rationaleText } = require("../harness/labels");

const PLANO = {
  chain_of_thought: {
    condicao_fisica: "Com fome.",
    avaliacao_de_viabilidade: "Dá para fazer.",
    passos_do_plano: [
      { tipo: "ato", acao: "Comer a Costela de Coelho", com: ["Costela de Coelho"], espera: "fome saciada" },
      { tipo: "fala", acao: "Dizer que já volta", com: [], espera: "" },
      { tipo: "gesto", acao: "Olhar a porta", com: "", espera: "" },
    ],
  },
  resposta: "Já volto.",
};

test("contrato M: o JSON puro vira postura, passos e fala", () => {
  const p = parsePlan(JSON.stringify(PLANO));
  assert.strictEqual(p.stance, "Dá para fazer.");
  assert.strictEqual(p.body, "Com fome.");
  assert.strictEqual(p.reply, "Já volto.");
  assert.deepStrictEqual(p.steps.map((s) => s.type), ["ato", "fala", "gesto"]);
  assert.deepStrictEqual(p.steps[0], { type: "ato", action: "Comer a Costela de Coelho",
                                       with: ["Costela de Coelho"], expects: "fome saciada" });
});

test("contrato M: cerca de código e texto em volta são FORMATO, não outro contrato", () => {
  const cercado = "Aqui está:\n```json\n" + JSON.stringify(PLANO) + "\n```\nPronto.";
  assert.strictEqual(parsePlan(cercado).steps.length, 3);
  const emVolta = "Plano: " + JSON.stringify(PLANO) + " fim, com } solto";
  assert.strictEqual(parsePlan(emVolta).steps.length, 3);
});

test("contrato M: os passos podem vir no topo (modelo que achata o JSON)", () => {
  const achatado = { passos_do_plano: PLANO.chain_of_thought.passos_do_plano, resposta: "x" };
  assert.strictEqual(parsePlan(JSON.stringify(achatado)).steps.length, 3);
});

test("contrato M: sem JSON, ou sem passos_do_plano, é FALHA — nunca a lista antiga", () => {
  assert.throws(() => parsePlan("- Pegar a Corda Velha"), PlanContractError);
  assert.throws(() => parsePlan(JSON.stringify({ resposta: "oi" })), PlanContractError);
  assert.throws(() => parsePlan(""), PlanContractError);
});

test("contrato M: lista vazia é plano válido (ninguém age)", () => {
  const p = parsePlan(JSON.stringify({ chain_of_thought: { passos_do_plano: [] }, resposta: "Não." }));
  assert.deepStrictEqual(p.steps, []);
  assert.strictEqual(p.reply, "Não.");
});

test("contrato M: passo sem tipo válido, sem ação, ou que não é objeto vira DEFEITO, nunca ato", () => {
  const p = parsePlan(JSON.stringify({ chain_of_thought: { passos_do_plano: [
    { acao: "Pegar a corda" },
    { tipo: "acao", acao: "Pegar a corda" },
    { tipo: "ato", acao: "" },
    "Pegar a corda",
    { tipo: "ATO", acao: "Pegar a corda" },
  ] } }));
  assert.deepStrictEqual(p.steps.map((s) => s.type), ["defeito", "defeito", "defeito", "defeito", "ato"]);
});

test("o texto do resolvedor é a ação e os nomes do `com` — o nome com vírgula fica inteiro", () => {
  const p = parsePlan(JSON.stringify({ chain_of_thought: { passos_do_plano: [
    { tipo: "ato", acao: "Pedir comida", com: "Elga, a Taverneira", espera: "" },
    { tipo: "ato", acao: "Beber", com: ["Jarra de Água Fresca", "Elga, a Taverneira"], espera: "" },
    { tipo: "ato", acao: "Dormir", com: [], espera: "" },
  ] } }));
  assert.deepStrictEqual(p.steps.map(actText), [
    "Pedir comida — Elga, a Taverneira",
    "Beber — Jarra de Água Fresca, Elga, a Taverneira",
    "Dormir",
  ]);
});

test("o racional: postura, uma linha por passo e a fala; defeito e partes vazias ficam fora", () => {
  const p = parsePlan(JSON.stringify({ chain_of_thought: { avaliacao_de_viabilidade: "Vou.",
    passos_do_plano: [{ tipo: "ato", acao: "Ir pela Rua do Mercador", com: [], espera: "" },
                      { acao: "sem tipo" }] }, resposta: "" }));
  assert.strictEqual(rationaleText(p), "Vou.\n— Ir pela Rua do Mercador");
});
