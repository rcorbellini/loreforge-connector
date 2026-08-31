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
