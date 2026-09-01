// Testes do RESOLVEDOR DE ALVO (spec 060, US2).
//
// A regra que estes testes guardam é a mesma dos dois lados da fronteira: resolve
// só quando há UM alvo, e nunca chuta. O que muda é o job — aqui se decide SE
// CHEGA A HAVER CHAMADA; no Motor, salva-se chamada malformada de outro host MCP.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { criarResolvedor, literal, semantica, normalizar } = require("../resolucao");

const CENA = [
  { id: "cantil-de-agua-fresca", nome: "Cantil de Água Fresca" },
  { id: "frasco-de-oleo", nome: "Frasco de Óleo" },
  { id: "corda-de-canhamo", nome: "Corda de Cânhamo" },
  { id: "moeda-cobre-025", nome: "Moeda de Cobre" },
  { id: "moeda-cobre-026", nome: "Moeda de Cobre" },
  { id: "moeda-cobre-027", nome: "Moeda de Cobre" },
  { id: "obadiah-mascate", nome: "Obadiah, o Mascate" },
  { id: "odila-aguadeira", nome: "Odila, a Aguadeira" },
];

test("060/US2: o id exato resolve nele mesmo", () => {
  assert.strictEqual(literal("frasco-de-oleo", CENA).id, "frasco-de-oleo");
});

test("060/US2: o NOME resolve no id — é o caso que a feature inteira compra", () => {
  assert.strictEqual(literal("Frasco de Óleo", CENA).id, "frasco-de-oleo");
  assert.strictEqual(literal("frasco de oleo", CENA).id, "frasco-de-oleo",
    "sem acento resolve igual: a Mente escreve como escreve");
  assert.strictEqual(literal("Odila, a Aguadeira", CENA).id, "odila-aguadeira");
});

test("060/US2: HOMÔNIMOS são abundância, não ambiguidade", () => {
  // Com enum, "guarde uma das suas moedas de prata" deixava a Mente MUDA 5/5.
  // Três moedas de MESMO nome são intercambiáveis: recusar seria repetir o
  // defeito. O critério é a natureza do empate, não a nota.
  const r = literal("Moeda de Cobre", CENA);
  assert.strictEqual(r.via, "abundancia");
  assert.strictEqual(r.entre, 3);
  assert.strictEqual(r.id, "moeda-cobre-025", "escolha determinística: o menor id");
  assert.strictEqual(literal("Moeda de Cobre", CENA).id, r.id, "e estável entre chamadas");
});

test("062/US1: empate entre coisas DIFERENTES resolve — nunca mais 'ambiguo'", () => {
  // Antes da spec 062, isto devolvia {id: null, porque: "ambiguo"} — e o recado
  // que voltava à Mente ("diga qual") era uma pergunta sem resposta possível:
  // ela não vê ids, e os dois candidatos têm nomes DIFERENTES que casaram com a
  // mesma referência curta. Decisão do mantenedor: escolhe um e usa; se não for
  // apto, o Motor valida e informa.
  const doisNomes = [{ id: "faca-a", nome: "Faca de Escamar" },
                     { id: "faca-b", nome: "Faca de Mercador" }];
  const r = literal("faca", doisNomes);
  assert.strictEqual(r.porque, undefined, "não é mais um 'não resolvido'");
  assert.ok(r.id === "faca-a" || r.id === "faca-b");
  assert.strictEqual(r.via, "desempate", "não é abundância: os nomes são diferentes");
  assert.strictEqual(r.entre, 2);
});

test("062/US1: o desempate VARIA — o mesmo id não sai duas vezes seguidas", () => {
  // Isto é o que impede a repetição de morrer calada: se a Mente insiste na
  // mesma referência (o primeiro id foi recusado por outro motivo), a segunda
  // tentativa não pode receber o MESMO id — ele já está em `tentadas` do laço,
  // e a proposta seria filtrada em silêncio, sem nem o orçamento de passos
  // avançar.
  const doisNomes = [{ id: "faca-a", nome: "Faca de Escamar" },
                     { id: "faca-b", nome: "Faca de Mercador" }];
  const primeiro = literal("faca", doisNomes);
  const jaOferecidos = new Set([primeiro.id]);
  const segundo = literal("faca", doisNomes, jaOferecidos);
  assert.notStrictEqual(segundo.id, primeiro.id, "o segundo id é o outro candidato");

  // Esgotados os dois, cai no determinístico de sempre — não trava, não lança.
  jaOferecidos.add(segundo.id);
  const terceiro = literal("faca", doisNomes, jaOferecidos);
  assert.ok(terceiro.id === "faca-a" || terceiro.id === "faca-b");
});

test("062/US1: a abundância (moedas de cobre) também varia com jaOferecidos", () => {
  const vistos = new Set();
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const r = literal("Moeda de Cobre", CENA, vistos);
    ids.push(r.id);
    vistos.add(r.id);
  }
  assert.deepStrictEqual([...ids].sort(),
    ["moeda-cobre-025", "moeda-cobre-026", "moeda-cobre-027"],
    "as 3 tentativas percorrem os 3 ids antes de repetir");
});

test("060/US2: o que NÃO existe na cena não resolve — nunca vira outro alvo", () => {
  // Este é o caso mais grave que a US2 conserta. Com enum, pedir "examine o
  // destilador" fazia o mundo examinar o FOGÃO 5/5: ação errada com cara de
  // sucesso. Aqui não há chamada nenhuma.
  assert.strictEqual(literal("destilador", CENA).id, null);
  assert.strictEqual(literal("a espada élfica", CENA).id, null);
  assert.strictEqual(literal("o cavalo preto", CENA).id, null);
});

test("060/US2: referência vazia ou lista vazia não resolve", () => {
  assert.strictEqual(literal("", CENA).porque, "referencia-vazia");
  assert.strictEqual(literal(null, CENA).porque, "referencia-vazia");
  assert.strictEqual(literal("frasco", []).porque, "sem-candidatos");
});

test("060/US2: a cascata sem embedder resolve o literal e declara a ausência",
async () => {
  const r = criarResolvedor();                       // sem modelo de embedding
  assert.strictEqual((await r.resolver("Frasco de Óleo", CENA)).id, "frasco-de-oleo");
  const falhou = await r.resolver("aquele troço de metal", CENA);
  assert.strictEqual(falhou.id, null);
  assert.strictEqual(falhou.semSemantica, true,
    "sem embedder ele DIZ que resolveu menos — não degrada em silêncio (Princípio VIII)");
});

test("060/US2: a semântica só entra quando a literal não resolveu", async () => {
  let chamadas = 0;
  const embedder = async (textos) => {
    chamadas++;
    // dublê: vetor de um eixo só, "distância" pelo tamanho do texto
    return textos.map((t) => [t.length, 1]);
  };
  const r = criarResolvedor({ embedder });
  await r.resolver("Frasco de Óleo", CENA);
  assert.strictEqual(chamadas, 0, "a literal resolveu: o embedder nem foi acionado");
});

test("060/US2: a MARGEM é o critério, e margem curta NÃO resolve", () => {
  const cands = [{ id: "a", nome: "Alfa" }, { id: "b", nome: "Beta" }];
  // vetores fabricados: o 1o ganha por pouco
  const quase = semantica([1, 0], cands, [[1, 0.02], [1, 0.05]], 0.05);
  assert.strictEqual(quase.id, null);
  assert.strictEqual(quase.porque, "margem-insuficiente");
  // e por muito
  const claro = semantica([1, 0], cands, [[1, 0], [0, 1]], 0.05);
  assert.strictEqual(claro.id, "a");
  assert.strictEqual(claro.via, "semantica");
});

test("060/US2: o embedder que falha não inventa alvo", async () => {
  const r = criarResolvedor({ embedder: async () => { throw new Error("ollama caiu"); } });
  const out = await r.resolver("aquele troço", CENA);
  assert.strictEqual(out.id, null, "erro de infra NUNCA vira resolução");
});

test("060/US2: normalizar é o mesmo contrato dos dois lados da fronteira", () => {
  assert.strictEqual(normalizar("Cantil de Água Fresca"), "cantil de agua fresca");
  assert.strictEqual(normalizar("moeda-cobre-025"), "moeda cobre 025");
  assert.strictEqual(normalizar("  "), "");
});
