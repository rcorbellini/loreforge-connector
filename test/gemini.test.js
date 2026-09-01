// O RUNTIME GEMINI — trava de regressão para o quarto provedor.
//
// Os outros runtimes (Anthropic, OpenRouter) só têm cobertura indireta via
// `dialeto.test.js` (o formato) e `roteamento.test.js`/`mente.test.js` (o
// caminho do Ollama, que é o mais exercitado). Este arquivo cobre o que é
// ESPECÍFICO do Gemini e não aparece em nenhum dos dois:
//
//   · a chave vai em CABEÇALHO (`x-goog-api-key`), nunca na URL — uma URL com
//     chave acaba em log de acesso com uma facilidade que um cabeçalho não tem;
//   · a mensagem inicial do laço do turno nasce no formato GENÉRICO
//     ({role, content}, o mesmo que serve Anthropic/OpenRouter) e o runtime
//     do Gemini precisa convertê-la para o formato dele ({role, parts}) —
//     sem essa conversão a primeira chamada de cada turno sai com `contents`
//     no formato errado e a API recusa;
//   · o corpo leva `systemInstruction` e `tools[0].functionDeclarations`, os
//     nomes exatos que a API do Gemini espera (não `system`, não `tools[].function`).

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-"));
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

const TOOLS = [
  { name: "narrate", description: "Encerra o turno.", inputSchema: { type: "object" } },
];

function espiaFetch() {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, opts) => {
    chamadas.push({ url, opts, corpo: JSON.parse((opts && opts.body) || "{}") });
    return {
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        candidates: [{ content: { parts: [
          { functionCall: { name: "narrate", args: { narrative_hint: "fim" } } }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }),
    };
  };
  return { chamadas, restaurar: () => { globalThis.fetch = original; } };
}

async function comGemini(cb) {
  const cfg = configuracao.carregar(true);
  cfg.runtime = "gemini";
  cfg.geminiKey = "AIza-SEGREDO-DE-TESTE";
  configuracao.gravar(cfg);
  Mente.usarMundo(mundoFalso(TOOLS));
  Mente.usarExtensoes({ toolsLocais: () => [], ehLocal: () => false,
                        hook: async (_p, dado) => dado });
  const espiao = espiaFetch();
  try {
    return { sessao: await Mente.interpret("faça algo", CENA), ...espiao };
  } finally {
    espiao.restaurar();
  }
}

test("Gemini: a chave vai no CABEÇALHO, nunca na URL", async () => {
  const { chamadas } = await comGemini();
  assert.strictEqual(chamadas.length, 1);
  const { url, opts } = chamadas[0];
  assert.ok(!url.includes("AIza-SEGREDO-DE-TESTE"),
    "a chave vazou na URL: " + url);
  assert.strictEqual(opts.headers["x-goog-api-key"], "AIza-SEGREDO-DE-TESTE");
  assert.ok(url.includes("generativelanguage.googleapis.com"));
  assert.ok(url.includes(":generateContent"));
});

test("Gemini: a mensagem inicial (genérica) vira `contents` com `parts`", async () => {
  const { chamadas } = await comGemini();
  const { corpo } = chamadas[0];
  assert.ok(Array.isArray(corpo.contents) && corpo.contents.length === 1);
  const [msg] = corpo.contents;
  assert.strictEqual(msg.role, "user");
  assert.strictEqual(typeof msg.parts[0].text, "string");
  assert.ok(msg.content === undefined,
    "o `content` genérico vazou pro corpo — o Gemini só entende `parts`");
});

test("Gemini: o system vai em `systemInstruction`, as tools em `functionDeclarations`", async () => {
  const { chamadas } = await comGemini();
  const { corpo } = chamadas[0];
  assert.strictEqual(typeof corpo.systemInstruction.parts[0].text, "string");
  assert.strictEqual(corpo.tools[0].functionDeclarations[0].name, "narrate");
});

test("Gemini: uma resposta com functionCall vira proposta normalmente", async () => {
  const { sessao } = await comGemini();
  assert.ok(sessao && sessao.propostas && sessao.propostas.length === 1);
  assert.strictEqual(sessao.propostas[0].capacidade, "narrate");
});

test("Gemini: check() falha sem chave, e reporta o modelo com ela", async () => {
  const cfg = configuracao.carregar(true);
  cfg.runtime = "gemini";
  cfg.geminiKey = "";
  configuracao.gravar(cfg);
  const semChave = await Mente.check();
  assert.strictEqual(semChave.ok, false);

  cfg.geminiKey = "AIza-x";
  configuracao.gravar(cfg);
  const comChave = await Mente.check();
  assert.strictEqual(comChave.ok, true);
  assert.match(comChave.reason, /Gemini/);
});
