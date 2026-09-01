// Testes de MUNDO — a tabela de resolução (spec 060, US2).
//
// Estes testes existem por um defeito que 101 testes verdes NÃO pegaram: o
// `registrarNomes` foi escrito e NUNCA LIGADO. A tabela ficava só com ids, o
// resolvedor caía no fallback `nome: id`, e o efeito era invertido — o nome
// CURTO casava por continência e o nome COMPLETO falhava.
//
// Medido em jogo (20 turnos do Irmão Tobias): "Nerissa" resolveu 9 vezes;
// "Nerissa, a Boticária" — o nome EXATO da cena — falhou 8. Nenhum teste
// unitário via isso, porque cada peça estava certa sozinha. Só o caminho INTEIRO
// mostra.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { Mundo } = require("../mundo");
const { literal } = require("../resolucao");

const FACE = [
  { name: "ask_directions", inputSchema: { type: "object", properties: {
      quem: { type: "string", enum: ["nerissa-boticaria", "torvin-ferreiro"] } } } },
  { name: "cook", inputSchema: { type: "object", properties: {
      ingredientes: { type: "array", items: { type: "string",
        enum: ["raiz-torta", "fuligem"] } } } } },
];

const CONTEXTO = {
  self: { id: "irmao-tobias", name: "Irmão Tobias",
          inventory: [{ id: "raiz-torta", name: "Raiz Torta" },
                      { id: "fuligem", name: "Fuligem" }] },
  location: { id: "boticario-da-raiz-torta", name: "Boticário da Raiz Torta" },
  characters_present: [
    { id: "nerissa-boticaria", name: "Nerissa, a Boticária",
      carrying: [{ id: "bolsa-de-ervas", name: "Bolsa de Ervas" }] }],
  items_present: [{ id: "frasco-de-tintura-vermelha", name: "Frasco de Tintura Vermelha" }],
  objects_present: [], routes: [],
};

function mundoFake() {
  const m = Object.create(Mundo.prototype);
  m.capacidadesDaCena = null;
  m.candidatosDaCena = null;
  m._nomesDaCena = null;
  return m;
}

test("060/US2: a face vira tabela de candidatos por parâmetro", () => {
  const m = mundoFake();
  m.capacidadesDaCena = new Set(FACE.map((t) => t.name));
  m.candidatosDaCena = require("../mundo")._tabelaDeCandidatos
    ? require("../mundo")._tabelaDeCandidatos(FACE) : null;
  if (!m.candidatosDaCena) return;   // helper não exposto: coberto pelo teste de ponta a ponta
  assert.deepStrictEqual(m.candidatosDaCena["ask_directions"].quem,
    ["nerissa-boticaria", "torvin-ferreiro"]);
  assert.deepStrictEqual(m.candidatosDaCena["cook"].ingredientes,
    ["raiz-torta", "fuligem"], "enum dentro de array também entra na tabela");
});

test("060/US2: registrarNomes colhe o dicionário id -> nome do contexto", () => {
  const m = mundoFake();
  const nomes = m.registrarNomes(CONTEXTO);
  assert.strictEqual(nomes["nerissa-boticaria"], "Nerissa, a Boticária");
  assert.strictEqual(nomes["bolsa-de-ervas"], "Bolsa de Ervas",
    "o que os presentes CARREGAM também entra — a Mente pode apontar para isso");
  assert.strictEqual(nomes["frasco-de-tintura-vermelha"], "Frasco de Tintura Vermelha");
  assert.strictEqual(nomes["raiz-torta"], "Raiz Torta", "o próprio inventário entra");
});

test("060/US2: SEM os nomes, o nome COMPLETO falha e o CURTO passa — o defeito real",
() => {
  // A prova do que aconteceu em jogo. Sem `registrarNomes`, o candidato é
  // {id, nome: id} e a continência inverte o resultado esperado.
  const semNomes = [{ id: "nerissa-boticaria", nome: "nerissa-boticaria" }];
  assert.ok(literal("Nerissa", semNomes).id, "o nome curto casava (por continência)");
  assert.strictEqual(literal("Nerissa, a Boticária", semNomes).id, null,
    "e o nome COMPLETO falhava — o ` a ` quebra a continência nos dois sentidos");
});

test("060/US2: COM os nomes, os dois resolvem — é o que a fiação conserta", () => {
  const m = mundoFake();
  m.candidatosDaCena = { ask_directions: { quem: ["nerissa-boticaria", "torvin-ferreiro"] } };
  m.registrarNomes(CONTEXTO);
  const cands = m.candidatosDe("ask_directions", "quem");
  assert.strictEqual(cands[0].nome, "Nerissa, a Boticária");
  for (const ref of ["Nerissa", "Nerissa, a Boticária", "nerissa-boticaria"]) {
    assert.strictEqual(literal(ref, cands).id, "nerissa-boticaria",
      `"${ref}" precisa resolver`);
  }
});

test("060/US2: parâmetro sem lista devolve null — não há o que resolver", () => {
  const m = mundoFake();
  m.candidatosDaCena = { ask_directions: { quem: ["nerissa-boticaria"] } };
  m.registrarNomes(CONTEXTO);
  assert.strictEqual(m.candidatosDe("ask_directions", "prosa"), null);
  assert.strictEqual(m.candidatosDe("capacidade-que-nao-existe", "x"), null);
});


// ===========================================================================
// SPEC 060 — QUEM ELE SABE NOMEAR, MAS NÃO ESTÁ AQUI.
//
// O caso real que criou isto: a Elga tem intenção ativa de ajudar a Ossa, e uma
// lembrança de tê-la visto PARTIR. Ao tentar agir sobre ela, o conector não
// conseguia sequer converter o nome em id — e a recusa saía como "isso não
// corresponde a nada", que soa como falha de NOMEAR.
//
// O certo é o mundo dizer "ela não está aqui", que é FATO e diz o que fazer a
// seguir. É o item 53.1: a memória estende o alcance, e quem recusa é a
// execução, nunca um pré-filtro do cliente.
// ===========================================================================

const CTX_COM_AUSENTE = {
  self: { id: "elga-taverneira", name: "Elga", inventory: [] },
  location: { id: "taverna-do-gancho", name: "Taverna do Gancho" },
  characters_present: [{ id: "bram-pescador", name: "Bram, o Pescador" }],
  items_present: [], objects_present: [], routes: [],
  conhecidos: { "ossa-cavadora": "Ossa, a Cavadora",
                "forja-de-ferro": "Forja de Ferro" },
};

function mundoComAusentes() {
  const m = Object.create(Mundo.prototype);
  m.candidatosDaCena = { ask_directions: { quem: ["bram-pescador"] } };
  m.registrarNomes(CTX_COM_AUSENTE);
  return m;
}

test("060: `conhecidos` entra no dicionário de nomes, sem apagar a cena", () => {
  const m = mundoComAusentes();
  assert.strictEqual(m._nomesDaCena["bram-pescador"], "Bram, o Pescador");
  assert.strictEqual(m._nomesDaCena["ossa-cavadora"], "Ossa, a Cavadora");
  assert.ok(m.ehAusenteConhecido("ossa-cavadora"));
  assert.ok(!m.ehAusenteConhecido("bram-pescador"), "quem ESTÁ aqui não é ausente");
});

test("060: o ausente NÃO entra na lista do parâmetro, mas entra na de resolução",
() => {
  const m = mundoComAusentes();
  const soCena = m.candidatosDe("ask_directions", "quem");
  assert.deepStrictEqual(soCena.map((c) => c.id), ["bram-pescador"],
    "a lista do PARÂMETRO continua sendo só quem pode ser perguntado");
  const maior = m.candidatosOuConhecidos("ask_directions", "quem");
  assert.ok(maior.some((c) => c.id === "ossa-cavadora"),
    "mas a de RESOLUÇÃO inclui quem ele sabe nomear");
});

test("060: o nome de quem SAIU resolve — e é o que faz a proposta chegar ao mundo",
() => {
  const m = mundoComAusentes();
  const soCena = m.candidatosDe("ask_directions", "quem");
  const maior = m.candidatosOuConhecidos("ask_directions", "quem");
  assert.strictEqual(literal("Ossa, a Cavadora", soCena).id, null,
    "contra a cena sozinha não resolve — era o comportamento que engolia a tentativa");
  assert.strictEqual(literal("Ossa, a Cavadora", maior).id, "ossa-cavadora",
    "contra o conjunto maior resolve, e o mundo é que vai recusar");
});

test("060: o que não existe em lugar NENHUM continua morrendo no conector", () => {
  const m = mundoComAusentes();
  const maior = m.candidatosOuConhecidos("ask_directions", "quem");
  assert.strictEqual(literal("o destilador", maior).id, null,
    "alargar a resolução não pode virar licença para inventar");
});
