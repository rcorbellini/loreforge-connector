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
