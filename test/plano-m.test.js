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
    avaliacao_de_viabilidade: "Dá para fazer.",
    passos_do_plano: [
      { tipo: "ato", acao: "Comer a Costela de Coelho", com: ["Costela de Coelho"], espera: "fome saciada" },
      { tipo: "fala", acao: "Dizer que já volta", com: [], espera: "" },
      { tipo: "gesto", acao: "Olhar a porta", com: "", espera: "" },
    ],
    depois: ["voltar à Taverna do Gancho"],
    pronto_quando: "fome saciada",
  },
  resposta: "Já volto.",
};

test("contrato M2: o JSON puro vira postura, passos, o que fica para depois, o fato e a fala", () => {
  const p = parsePlan(JSON.stringify(PLANO));
  assert.strictEqual(p.stance, "Dá para fazer.");
  assert.strictEqual(p.reply, "Já volto.");
  assert.deepStrictEqual(p.later, ["voltar à Taverna do Gancho"]);
  assert.strictEqual(p.doneWhen, "fome saciada");
  assert.deepStrictEqual(p.defects, []);
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

test("pedida (spec 076): o pedido literal com o verbo conjugado e curto CONTA como pedido; a agência extra não", () => {
  const { wasAsked } = require("../harness/evidence");
  assert.strictEqual(wasAsked("dá uma moeda de cobre — Tibério", "dê uma moeda de cobre ao Tibério"), true);
  assert.strictEqual(wasAsked("Ir para o quarto de hóspedes — Escada dos Hóspedes", "vá para o quarto descansar"), true);
  assert.strictEqual(wasAsked("Pegar a Corda Velha", "pegue a corda"), true);
  assert.strictEqual(wasAsked("Atravessar a porta baixa — Portão Lateral", "conte uma piada para a Bruna"), false);
  assert.strictEqual(wasAsked("sobe pela Ladeira do Sal — Ladeira do Sal", "vai matar essa fome"), false);
  assert.strictEqual(wasAsked("Pegar a Corda Velha", null), false);
});

// --- spec 077: o M2 (o que fica para depois, o fato que fecha) e o andamento ------------- //

test("contrato M2: `depois` e `pronto_quando` ausentes ou fora do formato NÃO são inventados — o defeito vai ao registro", () => {
  const sem = parsePlan(JSON.stringify({ chain_of_thought: { passos_do_plano: [] }, resposta: "" }));
  assert.deepStrictEqual(sem.later, []);
  assert.strictEqual(sem.doneWhen, "nenhum");
  assert.deepStrictEqual(sem.defects, ["depois", "pronto_quando"]);
  const torto = parsePlan(JSON.stringify({ chain_of_thought: { passos_do_plano: [],
    depois: ["chegar ao cais", { tipo: "ato", acao: "voltar" }, "", 7, "comprar o peixe"],
    pronto_quando: "estar conversando com o Obadiah" } }));
  assert.deepStrictEqual(torto.later, ["chegar ao cais", "comprar o peixe"], "item que não é texto entrou");
  assert.strictEqual(torto.doneWhen, "nenhum", "fato fora das formas virou fato");
  assert.deepStrictEqual(torto.defects, ["pronto_quando"]);
  const texto = parsePlan(JSON.stringify({ chain_of_thought: { passos_do_plano: [], depois: "chegar ao cais",
    pronto_quando: "Nenhum." } }));
  assert.deepStrictEqual(texto.later, [], "um texto solto virou lista");
  assert.deepStrictEqual(texto.defects, ["depois"]);
  assert.strictEqual(texto.doneWhen, "nenhum");
});

test("o ANDAMENTO (contrato andamento.md): o que já fez e o que faltava; o jogador falando de novo leva o pedido anterior e NÃO o que faltava", () => {
  const { andamentoText } = require("../harness/objectives");
  const vezN = andamentoText({ feito: ["Subir a Ladeira do Sal → deu certo: ele chegou à Praça do Mercado"],
                               faltava: ["chegar à Taverna do Gancho", "pedir uma bebida"] });
  assert.strictEqual(vezN, "O QUE ELE JÁ FEZ POR ESTE PEDIDO:\n- Subir a Ladeira do Sal → deu certo: ele chegou à Praça do Mercado\n"
    + "O QUE FALTAVA:\n- chegar à Taverna do Gancho\n- pedir uma bebida");
  const deNovo = andamentoText({ antes: ["consiga peixe fresco no cais"], feito: ["Sair pela Rua do Mercador → deu certo"],
                                 faltava: ["chegar ao cais"] });
  assert.match(deNovo, /^ANTES, O JOGADOR TINHA PEDIDO: consiga peixe fresco no cais\n\nO QUE ELE JÁ FEZ POR ESTE PEDIDO:/);
  assert.doesNotMatch(deNovo, /O QUE FALTAVA/, "o resto do plano velho foi junto com o sussurro novo (medido: puxa o pedido velho)");
  assert.strictEqual(andamentoText(null), "");
});

test("o `user` da vez N leva o andamento entre a instrução e a cena; sem andamento, é o da 076", async () => {
  const { userOf } = require("../harness/objectives");
  const mente = { _contextoPayload: async () => ({}), _cenaEmProsa: () => "A CENA" };
  assert.strictEqual(await userOf(mente, {}, "vá à taverna"), "O que ele faz?\n\nINSTRUÇÃO: vá à taverna\n\nA CENA");
  const u = await userOf(mente, {}, "vá à taverna", { faltava: ["pedir uma bebida"] });
  assert.strictEqual(u, "O que ele faz?\n\nINSTRUÇÃO: vá à taverna\n\nO QUE FALTAVA:\n- pedir uma bebida\n\nA CENA");
});

test("o racional mostra o que fica para depois, em prosa", () => {
  const p = parsePlan(JSON.stringify({ chain_of_thought: { avaliacao_de_viabilidade: "Vou.",
    passos_do_plano: [{ tipo: "ato", acao: "Subir a Ladeira do Sal", com: [], espera: "" }],
    depois: ["chegar à Taverna do Gancho", "pedir uma bebida"], pronto_quando: "sede saciada" }, resposta: "Sede." }));
  assert.strictEqual(rationaleText(p), "Vou.\n— Subir a Ladeira do Sal\nDepois: chegar à Taverna do Gancho; pedir uma bebida.\n\"Sede.\"");
});

test("o racional junta os nomes do `com` à ação quando ela veio sem eles (o qwen: '— Seguir'), e não repete quando já estão", () => {
  const p = parsePlan(JSON.stringify({ chain_of_thought: { avaliacao_de_viabilidade: "",
    passos_do_plano: [{ tipo: "ato", acao: "Seguir", com: ["Ladeira do Sal"], espera: "" },
                      { tipo: "fala", acao: "Perguntar a Elga, a Taverneira, se há peixe", com: ["Elga, a Taverneira"], espera: "" }],
    depois: [], pronto_quando: "nenhum" }, resposta: "" }));
  assert.strictEqual(rationaleText(p), "— Seguir — Ladeira do Sal\n— Perguntar a Elga, a Taverneira, se há peixe");
});

test("o item do `depois` que só NEGA é a lista vazia dita em palavras (o qwen: 'Nenhum passo adicional necessário')", () => {
  const p = parsePlan(JSON.stringify({ chain_of_thought: { passos_do_plano: [],
    depois: ["Nenhum passo adicional necessário", "nada mais", "voltar à taverna"], pronto_quando: "nenhum" } }));
  assert.deepStrictEqual(p.later, ["voltar à taverna"]);
  const vazio = parsePlan(JSON.stringify({ chain_of_thought: { passos_do_plano: [],
    depois: ["Nenhum passo adicional necessário"], pronto_quando: "nenhum" } }));
  assert.deepStrictEqual(vazio.later, []);
});
