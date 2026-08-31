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
const Mente = require("../mente");

const CENA = { self: { id: "fulano", name: "Fulano" }, memories: [],
               characters_present: [], items_present: [], routes: [] };

function mundoFalso(tools) {
  return {
    listarCapacidades: async () => tools,
    chamarCapacidade: async () => ({ texto: "", narrativa: {}, recusado: false }),
  };
}

// Captura o corpo de CADA chamada ao Ollama, sem fingir uma resposta fixa —
// devolve sempre "narrate" pronto pra fechar o turno em UMA rodada.
function espiaFetch() {
  const original = globalThis.fetch;
  const corpos = [];
  globalThis.fetch = async (_url, opts) => {
    const corpo = JSON.parse((opts && opts.body) || "{}");
    corpos.push(corpo);
    return {
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        message: {
          content: "",
          tool_calls: [{ function: { name: "narrate",
                         arguments: { narrative_hint: "encerra o turno" } } }],
        },
        prompt_eval_count: 10, eval_count: 5,
      }),
    };
  };
  return { corpos, restaurar: () => { globalThis.fetch = original; } };
}

test("interpret() com tools nativas NÃO duplica as capacidades em prosa no user", async () => {
  const cfg = configuracao.carregar(true);
  cfg.runtime = "local";
  configuracao.gravar(cfg);

  Mente.usarMundo(mundoFalso([
    { name: "take", description: "Pega um item.", inputSchema: { type: "object" } },
    { name: "narrate", description: "Encerra o turno.", inputSchema: { type: "object" } },
  ]));
  Mente.usarExtensoes({ toolsLocais: () => [], ehLocal: () => false,
                        hook: async (_p, dado) => dado });

  const espiao = espiaFetch();
  try {
    await Mente.interpret("pegue a corda", CENA);
  } finally {
    espiao.restaurar();
  }

  assert.strictEqual(espiao.corpos.length, 1, "esperava uma única rodada");
  const corpo = espiao.corpos[0];
  assert.ok(Array.isArray(corpo.tools) && corpo.tools.length > 0,
    "a chamada não levou `tools` — o teste não está exercitando o caminho certo");

  const userMsg = corpo.messages.find((m) => m.role === "user");
  assert.ok(userMsg, "não achei a mensagem 'user' no corpo da requisição");
  assert.ok(!userMsg.content.includes('"capacidades"'),
    "o user ainda descreve as capacidades em prosa — duplicação viva de novo: " +
    userMsg.content.slice(0, 300));
});

// --------------------------------------------------------------------------- //
// O CONTRATO DO MUNDO É O SCHEMA — trava de regressão (2026-08-20).
//
// `cook.ingredientes` é declarado `array` no `inputSchema` que o `tools/list`
// entrega. O llama3.1:8b às vezes manda a lista como texto com vírgulas, e o
// conector repassava verbatim: o mundo tratava a string INTEIRA como um id só e
// respondia "'moeda-a, moeda-b' não está ao alcance" — apontando para ALCANCE
// quando o defeito era FORMATO. A Mente leu isso como "os ingredientes é que
// estão errados" e enumerou 20 combinações em 49 tentativas.
//
// A correção é DESTE lado: o contrato está certo, o cliente é que precisa
// mandar certo — e ele tem o schema em mãos desde o `tools/list`.
// --------------------------------------------------------------------------- //

function espiaProposta(argsDaTool) {
  const original = globalThis.fetch;
  let rodada = 0;
  globalThis.fetch = async (_url, opts) => {
    const corpo = JSON.parse((opts && opts.body) || "{}");
    rodada++;
    const chamada = rodada === 1
      ? { function: { name: "cook", arguments: argsDaTool } }
      : { function: { name: "narrate", arguments: { narrative_hint: "fim" } } };
    return {
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ message: { content: "", tool_calls: [chamada] },
                           prompt_eval_count: 10, eval_count: 5 }),
    };
  };
  return { restaurar: () => { globalThis.fetch = original; }, corpo: null };
}

const TOOLS_COOK = [
  { name: "cook", description: "Cozinha.",
    inputSchema: { type: "object",
      properties: { ingredientes: { type: "array", items: { type: "string" } },
                    fonte_calor: { type: "string" } },
      required: ["ingredientes", "fonte_calor"] } },
  { name: "narrate", description: "Encerra.", inputSchema: { type: "object" } },
];

async function propostaDe(args) {
  const cfg = configuracao.carregar(true);
  cfg.runtime = "local";
  configuracao.gravar(cfg);
  Mente.usarMundo(mundoFalso(TOOLS_COOK));
  Mente.usarExtensoes({ toolsLocais: () => [], ehLocal: () => false,
                        hook: async (_p, dado) => dado });
  const espiao = espiaProposta(args);
  try {
    const sessao = await Mente.interpret("cozinhe algo", CENA);
    return sessao && sessao.propostas && sessao.propostas[0];
  } finally {
    espiao.restaurar();
  }
}

test("param `array`: string com vírgulas vira LISTA antes de subir ao mundo", async () => {
  const p = await propostaDe({ ingredientes: "moeda-a, moeda-b, moeda-c",
                               fonte_calor: "fogao",
                               prosa: { acao: "cozinha", fala: "" } });
  assert.ok(p, "não veio proposta nenhuma");
  assert.deepStrictEqual(p.alvos.ingredientes, ["moeda-a", "moeda-b", "moeda-c"],
    "a string com vírgulas subiu sem virar lista: " + JSON.stringify(p.alvos));
  assert.strictEqual(p.alvos.fonte_calor, "fogao",
    "param `string` NÃO pode ser tocado — só os declarados `array`");
});

test("param `array`: id único vira lista de um; lista já certa não é mexida", async () => {
  const um = await propostaDe({ ingredientes: "coelho-do-cais", fonte_calor: "fogao",
                                prosa: { acao: "cozinha", fala: "" } });
  assert.deepStrictEqual(um.alvos.ingredientes, ["coelho-do-cais"]);

  const ja = await propostaDe({ ingredientes: ["carne-a", "carne-b"],
                                fonte_calor: "fogao",
                                prosa: { acao: "cozinha", fala: "" } });
  assert.deepStrictEqual(ja.alvos.ingredientes, ["carne-a", "carne-b"]);
});

// ===========================================================================
// SPEC 060 — a PARADA FALSA.
//
// Com o turno passando a continuar no sucesso, "sem tool call" virou o sinal de
// que A Mente terminou. Só que às vezes ela NÃO terminou: o modelo escreveu a
// chamada como TEXTO no `content` em vez de emitir tool call, e isso chega
// exatamente igual. Confundir os dois faria a próxima medição de campo mentir —
// o mesmo estrago que o item 52.5 registrou.
// ===========================================================================

test("060: chamada emitida como TEXTO é reconhecida como parada FALSA", () => {
  const { _paradaFalsa } = require("../mente");
  assert.strictEqual(typeof _paradaFalsa, "function",
    "a função precisa estar exposta — teste que não testa nada é pior que teste ausente");
  const tools = [{ name: "ask_directions" }, { name: "take" }];
  assert.strictEqual(
    _paradaFalsa('{"name": "ask_directions", "parameters": {"quem": "odila"}}', tools),
    "ask_directions", "JSON puro com nome conhecido");
  assert.strictEqual(
    _paradaFalsa('Ele decide perguntar. {"name":"take","parameters":{}}', tools),
    "take", "JSON embutido em prosa");
  assert.strictEqual(
    _paradaFalsa("Torvin fica onde está, pensando.", tools), null,
    "prosa de verdade NÃO é parada falsa");
  assert.strictEqual(
    _paradaFalsa('{"name": "comprar", "parameters": {}}', tools), null,
    "nome DESCONHECIDO não é parada falsa — é capacidade inventada, que o " +
    "`_peneira` já trata; confundir as duas troca um defeito por outro");
  assert.strictEqual(_paradaFalsa("", tools), null);
  assert.strictEqual(_paradaFalsa(null, tools), null);
});


// ===========================================================================
// SPEC 060 / US2 — o id NÃO chega à Mente.
//
// Este é o teste que prova a etapa inteira. Se um id vazar para o payload, a
// feature não existe: ela volta a copiar id em vez de apontar por nome, e a
// família de recusa "alvo fantasma" volta junto.
// ===========================================================================

test("060/US2: nenhum id de cena aparece no payload que vai ao modelo", async () => {
  const m = require("../mente");
  const CONTEXTO = {
    self: { id: "torvin-ferreiro", name: "Torvin", body: "Um ferreiro.",
            inventory: [{ id: "bolsa-de-couro", name: "Bolsa de Couro" }] },
    location: { id: "praca-do-mercado", name: "Praça do Mercado", narrative: "Uma praça." },
    characters_present: [
      { id: "obadiah-mascate", name: "Obadiah, o Mascate", action: "vende",
        carrying: [{ id: "cravos-de-ferro", name: "Cravos de Ferro" }] },
      { id: "torvin-ferreiro", name: "Torvin", state: "self" }],
    items_present: [{ id: "frasco-de-oleo", name: "Frasco de Óleo" }],
    objects_present: [{ id: "poco-da-praca", name: "Poço", contains: [] }],
    routes: [{ id: "rua-do-portao", name: "Rua do Portão", destination_name: "Porto Negro" }],
    memories: [],
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

test("060/US2: o enum de LISTA DE CENA sai das tools; o CALCULADO fica", () => {
  const m = require("../mente");
  if (typeof m._semIdDeCena !== "function") {
    assert.fail("_semIdDeCena precisa estar exposta para este teste valer");
  }
  const take = m._semIdDeCena({ name: "take", inputSchema: { type: "object",
    properties: { item: { type: "string", enum: ["frasco-de-oleo", "cantil"] } } } });
  assert.ok(!take.inputSchema.properties.item.enum,
    "lista de cena SAI: a Mente já vê isso em prosa, e o enum é a segunda cópia");
  assert.ok(take.inputSchema.properties.item.description,
    "e no lugar fica a dica de COMO chamar");

  const heal = m._semIdDeCena({ name: "heal", inputSchema: { type: "object",
    properties: { alvo: { type: "string", enum: ["fenn-dedos-leves"] } } } });
  assert.deepStrictEqual(heal.inputSchema.properties.alvo.enum, ["fenn-dedos-leves"],
    "subconjunto CALCULADO fica: quem está caído é a ÚNICA fonte, e o contexto " +
    "não diz isso de um jeito que ela use — tirar perderia conhecimento, não peso");

  const arr = m._semIdDeCena({ name: "cook", inputSchema: { type: "object",
    properties: { ingredientes: { type: "array", items: { type: "string",
      enum: ["carne", "sal"] } } } } });
  assert.ok(!arr.inputSchema.properties.ingredientes.items.enum,
    "enum dentro de array também sai");
});


// ===========================================================================
// SPEC 060 / US3 — a cena em PROSA.
//
// Medida contra quatro alternativas: a prosa foi a mais barata E a mais certeira
// (20/20 contra 19/20 do JSON). E o resultado NÃO é "menos estrutura é melhor" —
// as linhas `chave: valor` são quase tão baratas e foram as PIORES (15/20).
// ===========================================================================

test("060/US3: a prosa leva TODOS os nomes da cena e NENHUM id", async () => {
  const m = require("../mente");
  const CTX = {
    self: { id: "torvin-ferreiro", name: "Torvin", body: "Um ferreiro calado.",
            necessidade: { fome: "com fome" },
            inventory: [{ id: "bolsa-de-couro", name: "Bolsa de Couro" }] },
    location: { id: "praca-do-mercado", name: "Praça do Mercado",
                narrative: "Barracas e gente." },
    characters_present: [
      { id: "obadiah-mascate", name: "Obadiah, o Mascate", action: "vende",
        carrying: [{ id: "cravos-de-ferro", name: "Cravos de Ferro" }] },
      { id: "torvin-ferreiro", name: "Torvin", state: "self" }],
    items_present: [{ id: "frasco-de-oleo", name: "Frasco de Óleo" }],
    objects_present: [{ id: "poco-da-praca", name: "Poço", contains: [] }],
    routes: [{ id: "rua-do-portao", name: "Rua do Portão",
               destination_name: "Porto Negro" }],
    memories: [{ content: "Prometi cravos a Obadiah.", timestamp_start: 1 }],
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
    self: { name: "T", inventory: [] }, location: { name: "Praça" },
    characters_present: [], items_present: [], objects_present: [], routes: [],
    memories: [{ content: "Prometi cravos a Obadiah.", timestamp_start: 1 }],
  }, { comCapacidades: false }));
  assert.ok(/Ele lembra:.*Prometi cravos/.test(prosa), prosa);
});

test("060/US3: cena vazia não quebra e não mente", async () => {
  const m = require("../mente");
  const prosa = m._cenaEmProsa(await m._contextoPayload({
    self: { name: "T", inventory: [] }, location: { name: "Ermo" },
    characters_present: [], items_present: [], objects_present: [], routes: [],
    memories: [],
  }, { comCapacidades: false }));
  assert.ok(prosa.includes("Não há mais ninguém aqui"));
  assert.ok(prosa.includes("Ele não carrega nada"));
  assert.ok(!prosa.includes("undefined"), prosa);
});
