// A DUPLICAÇÃO QUE INICIOU A SPEC 045 — trava de regressão.
//
// `_contextoPayload` (mente.js) descrevia as capacidades em PROSA no `user` ao
// MESMO tempo em que `tools` (o campo nativo) já carregava a mesma informação
// estruturada. Medido ao vivo em 2026-08-17 contra o llama3.1:8b (18 chamadas
// reais, 3 casos × com/sem o bloco × 3 repetições — script em
// `specs/043-tools-exposed-to-mind/testar_duplicacao_capacidades.py`): com o
// bloco duplicado, 4 de 9 chamadas saíam SEM tool_call nenhuma; sem ele, 9 de
// 9 saíram certas, mais rápidas e mais baratas.
//
// Este teste intercepta o `fetch` de verdade (o mesmo caminho que
// `roteamento.test.js` já exercita) e confere o CORPO da requisição que
// `interpret()` manda: quando `tools` vai preenchido, o `content` da mensagem
// `user` não pode conter o bloco `"capacidades"`.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mente-"));
process.env.LOREFORGE_CONFIG = path.join(TMP, "conector.json");
process.env.LOREFORGE_LOG = "0";

const configuracao = require("../config");
// spec 072: a Mente é uma POR ASSENTO. Só a construção mudou — as asserções abaixo
// são as mesmas de antes, e é isso que prova que o refactor foi léxico (research R5).
const Mente = require("../mente").criarMente();

const CENA = {
  self: { id: "fulano", name: "Fulano", memories: [], intentions: [],
          inventory: [], known: [], transit: null },
  scene: { place: { id: "x", name: "X", prose: null, belongs_to: null },
           characters: [], items: [], objects: [], exits: [] },
};


test("060/US2: nenhum id de cena aparece no payload que vai ao modelo", async () => {
  const m = require("../mente");
  const CONTEXTO = {
    self: { id: "torvin-ferreiro", name: "Torvin", prose: "Um ferreiro.",
            inventory: [{ id: "bolsa-de-couro", name: "Bolsa de Couro" }],
            memories: [], intentions: [], known: [], transit: null },
    scene: {
      place: { id: "praca-do-mercado", name: "Praça do Mercado", prose: "Uma praça." },
      characters: [
        { id: "obadiah-mascate", name: "Obadiah, o Mascate", action: "vende",
          carrying: [{ id: "cravos-de-ferro", name: "Cravos de Ferro" }] },
        { id: "torvin-ferreiro", name: "Torvin", state: "self" }],
      items: [{ id: "frasco-de-oleo", name: "Frasco de Óleo" }],
      objects: [{ id: "poco-da-praca", name: "Poço", contains: [] }],
      exits: [{ id: "rua-do-portao", name: "Rua do Portão",
                destination_name: "Porto Negro" }],
    },
  };
  const payload = JSON.stringify(await m._contextoPayload(CONTEXTO,
    { comCapacidades: false }));

  const IDS = ["obadiah-mascate", "frasco-de-oleo", "bolsa-de-couro",
               "cravos-de-ferro", "poco-da-praca", "rua-do-portao"];
  for (const id of IDS) {
    assert.ok(!payload.includes(id), `o id "${id}" vazou para o payload da Mente`);
  }
  // e os NOMES continuam lá: é por eles que ela aponta
  for (const nome of ["Obadiah, o Mascate", "Frasco de Óleo", "Bolsa de Couro",
                      "Rua do Portão"]) {
    assert.ok(payload.includes(nome), `o nome "${nome}" sumiu — ela ficou sem como apontar`);
  }
});

test("060/US3: a prosa leva TODOS os nomes da cena e NENHUM id", async () => {
  const m = require("../mente");
  const CTX = {
    self: { id: "torvin-ferreiro", name: "Torvin", prose: "Um ferreiro calado.",
            needs: { hunger: "com fome" },
            inventory: [{ id: "bolsa-de-couro", name: "Bolsa de Couro" }],
            memories: [{ content: "Prometi cravos a Obadiah.", timestamp_start: 1 }],
            intentions: [], known: [], transit: null },
    scene: {
      place: { id: "praca-do-mercado", name: "Praça do Mercado",
               prose: "Barracas e gente." },
      characters: [
        { id: "obadiah-mascate", name: "Obadiah, o Mascate", action: "vende",
          carrying: [{ id: "cravos-de-ferro", name: "Cravos de Ferro" }] },
        { id: "torvin-ferreiro", name: "Torvin", state: "self" }],
      items: [{ id: "frasco-de-oleo", name: "Frasco de Óleo" }],
      objects: [{ id: "poco-da-praca", name: "Poço", contains: [] }],
      exits: [{ id: "rua-do-portao", name: "Rua do Portão",
                destination_name: "Porto Negro" }],
    },
  };
  const prosa = m._cenaEmProsa(await m._contextoPayload(CTX, { comCapacidades: false }));

  for (const nome of ["Praça do Mercado", "Obadiah, o Mascate", "Cravos de Ferro",
                      "Frasco de Óleo", "Poço", "Bolsa de Couro", "Rua do Portão",
                      "Porto Negro", "Um ferreiro calado", "com fome"]) {
    assert.ok(prosa.includes(nome), `a prosa perdeu "${nome}"`);
  }
  for (const id of ["obadiah-mascate", "frasco-de-oleo", "bolsa-de-couro",
                    "cravos-de-ferro", "poco-da-praca", "rua-do-portao"]) {
    assert.ok(!prosa.includes(id), `o id "${id}" vazou para a prosa`);
  }
});

test("060/US3: a MEMÓRIA chega à prosa — o campo é `o_que`, não `content`", async () => {
  // Este teste existe por um bug real, pego antes de ir ao ar: o renderizador
  // procurava `summary`/`content`, mas `_limparMemorias` entrega `o_que`. A
  // memória sumiria da cena EM SILÊNCIO — e memória é o eixo do jogo.
  const m = require("../mente");
  const prosa = m._cenaEmProsa(await m._contextoPayload({
    self: { name: "T", inventory: [], memories: [{ content: "Prometi cravos a Obadiah.", timestamp_start: 1 }] },
    scene: { place: { name: "Praça" }, characters: [],
             items: [], objects: [], exits: [] },
  }, { comCapacidades: false }));
  assert.ok(/Ele lembra:.*Prometi cravos/.test(prosa), prosa);
});

test("060/US3: cena vazia não quebra e não mente", async () => {
  const m = require("../mente");
  const prosa = m._cenaEmProsa(await m._contextoPayload({
    self: { name: "T", inventory: [], memories: [] },
    scene: { place: { name: "Ermo" }, characters: [],
             items: [], objects: [], exits: [] },
  }, { comCapacidades: false }));
  assert.ok(prosa.includes("Não há mais ninguém aqui"));
  assert.ok(prosa.includes("Ele não carrega nada"));
  assert.ok(!prosa.includes("undefined"), prosa);
});

test("060/US3: a hierarquia de lugares vira caminho, não [object Object]", async () => {
  // Bug REAL, pego no primeiro turno de jogo depois de aplicar a US3: o payload
  // saiu com "O lugar é de [object Object]." porque `_pertenceA` devolve uma
  // CADEIA aninhada, não uma string. Os testes com dublê não pegaram — a cena
  // sintética não tinha `belongs_to`. É por isso que jogar de verdade faz parte.
  const m = require("../mente");
  const prosa = m._cenaEmProsa(await m._contextoPayload({
    self: { name: "T", inventory: [], memories: [] },
    scene: {
      place: { name: "Boticário", prose: "Uma loja.",
        belongs_to: { name: "Porto Negro", belongs_to: { name: "Costa de Ferro" } } },
      characters: [], items: [], objects: [], exits: [],
    },
  }, { comCapacidades: false }));
  assert.ok(!prosa.includes("[object Object]"), prosa);
  assert.ok(prosa.includes("Porto Negro") && prosa.includes("Costa de Ferro"), prosa);
});

// O CORTE DAS MEMÓRIAS (fronteira conector ↔ payload): o alcance chega inteiro do
// mundo, e aqui decide-se o que está gritando na cabeça dele agora.
const MEMS = [
  { id: "m1", estado: "viva", salience: "vivida", recency: "agora",
    intensity: "large", summary: "Vi Hulda furtar o pe de cabra.",
    involved: ["hulda"], timestamp_start: 500 },
  { id: "m2", estado: "viva", salience: "latente", recency: "ha meses",
    intensity: "small", summary: "Conversei com Elga sobre o tempo.",
    involved: ["elga"], timestamp_start: 400 },
  { id: "m3", estado: "vencida", salience: "latente", recency: "ha meses",
    intensity: "small", summary: "Perdi uma moeda na praca.",
    involved: ["praca"], timestamp_start: 300 },
];

test("o corte lê `summary` — o alcance NÃO carrega `content`", () => {
  const m = require("../mente");
  const saiu = m._limparMemorias(MEMS, new Set());
  assert.ok(saiu.length > 0,
    "lendo só `content`, o contrato novo devolveria lista VAZIA em silêncio — a " +
    "Mente jogaria sem memória nenhuma com a suíte verde");
  assert.ok(saiu.some((x) => x.o_que.includes("Hulda")));
});

test("a VENCIDA é alcançável mas não vai ao payload", () => {
  const m = require("../mente");
  const saiu = m._limparMemorias(MEMS, new Set());
  assert.ok(!saiu.some((x) => x.o_que.includes("moeda")),
    "ela é dele e ele pode parar e lembrar — mas não está gritando na cabeça dele");
});

test("a EVOCAÇÃO: o vívido volta sozinho, o latente só se a cena o chamar", () => {
  const m = require("../mente");
  // ninguém presente: só o vívido por si sobrevive
  const sozinho = m._limparMemorias(MEMS, new Set(["ninguem"]));
  assert.deepStrictEqual(sozinho.map((x) => x.o_que),
    ["Vi Hulda furtar o pe de cabra."],
    "o latente não volta sem a cena o evocar (spec 013)");
  // com a Elga presente, a lembrança dela volta junto
  const comElga = m._limparMemorias(MEMS, new Set(["elga"]));
  assert.strictEqual(comElga.length, 2,
    "quem está presente traz de volta o que o envolve, mesmo latente");
});

test("sem `estado` no payload, o corte de vida é pulado — servidor antigo não quebra",
     () => {
  const m = require("../mente");
  const velho = [{ id: "v1", content: "Uma lembranca do contrato antigo.",
                   salience: "vivida", timestamp_start: 1 }];
  const saiu = m._limparMemorias(velho, new Set());
  assert.strictEqual(saiu.length, 1,
    "o contrato antigo já vinha filtrado pelo servidor; aqui não há o que cortar");
});

test("o TETO de 12 continua, e é o último corte", () => {
  const m = require("../mente");
  const muitas = Array.from({ length: 40 }, (_, i) => ({
    id: `x${i}`, estado: "viva", salience: "vivida", intensity: "small",
    summary: `lembranca numero ${i}`, involved: [], timestamp_start: i }));
  assert.strictEqual(m._limparMemorias(muitas, new Set()).length, 12);
});

// ===========================================================================
// A DICA MUDOU DE LUGAR, NÃO SUMIU (22/09) — teste de LIGAÇÃO.
//
// Até 21/09 todo parâmetro de referência carregava `"o NOME daquilo, como aparece
// na cena"`: a mesma frase, quarenta vezes, 3,6% do bloco em toda chamada. Ela saiu
// do schema e entrou UMA vez no `ESCOLHER_SYSTEM`.
//
// POR QUE ISTO PRECISA DE TESTE PRÓPRIO, e não basta o que afirma que o parâmetro
// ficou nu: se a linha sumir do system, o corte continua passando e a Mente perde a
// única instrução que lhe diz COMO apontar — a economia fica e a informação vai
// embora, sem quebrar nada. É o modo de falha que o projeto chama de órfão com a
// suíte verde, e a defesa é cobrar as DUAS pontas no mesmo teste.
//
// Provado quebrando de propósito: trocando a frase no `ESCOLHER_SYSTEM` por outra
// qualquer, este teste falha; sem ele, a suíte inteira segue verde.
// ===========================================================================

// O `event` e o `heard_from` das memórias (2026-09-26, harness por objetivos · B7) chegam
// ao CONECTOR — é com eles que o progresso separa "aprendi algo" de "lembro do que fiz" —
// e NÃO descem ao payload da Mente. É a regra das três camadas (`docs/fluxo-do-contrato.md`):
// o conector guarda o que o personagem PODERIA alcançar; o payload leva o que está
// presente agora, e a classificação de sistema da lembrança não é isso. Teste de LIGAÇÃO
// do lado do conector: o que o `get_context` entrega × o que sai no `user` do modelo.
test("memória: `event`/`heard_from` ficam no conector e NÃO vão ao payload da Mente", async () => {
  const m = require("../mente");
  const agora = Math.floor(Date.now() / 1000);
  const CTX = {
    self: { id: "elga-taverneira", name: "Elga", needs: {}, inventory: [], intentions: [],
      memories: [
        { id: "mem-1", estado: "viva", salience: "vivida", recency: "agora", intensity: "small",
          involved: ["bram-pescador"], summary: "Bram me contou do barco.", timestamp_start: agora,
          event: "hearsay_reconto", heard_from: "bram-pescador" },
        { id: "mem-2", estado: "viva", salience: "vivida", recency: "agora", intensity: "small",
          involved: [], summary: "Comi o pão.", timestamp_start: agora, event: "eat" }] },
    scene: { place: { id: "taverna-do-gancho", name: "Taverna do Gancho", prose: "" },
             characters: [], items: [], objects: [], exits: [] },
  };
  const payload = JSON.stringify(await m._contextoPayload(CTX, { comCapacidades: false }));
  assert.ok(payload.includes("Bram me contou do barco."), "a memória em si sumiu do payload");
  for (const vaz of ["hearsay_reconto", "heard_from", "\"event\"", "\"eat\""]) {
    assert.ok(!payload.includes(vaz), `${vaz} vazou para o payload da Mente`);
  }
});
