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
// spec 072: a Mente é uma POR ASSENTO. Só a construção mudou — as asserções abaixo
// são as mesmas de antes, e é isso que prova que o refactor foi léxico (research R5).
const Mente = require("../mente").criarMente();

const CENA = {
  self: { id: "fulano", name: "Fulano", memories: [], intentions: [],
          inventory: [], known: [], transit: null },
  scene: { place: { id: "x", name: "X", prose: null, belongs_to: null },
           characters: [], items: [], objects: [], exits: [] },
};

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
        candidates: [{ content: { parts: [{ text: "- Pegar a corda" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }),
    };
  };
  return { chamadas, restaurar: () => { globalThis.fetch = original; } };
}

async function comGemini(cb, opts = {}) {
  const cfg = configuracao.carregar(true);
  cfg.runtime = "gemini";
  cfg.geminiKey = "AIza-SEGREDO-DE-TESTE";
  configuracao.gravar(cfg);
  Mente.usarMundo(mundoFalso(TOOLS));
  Mente.usarExtensoes({ toolsLocais: () => [], ehLocal: () => false,
                        hook: async (_p, dado) => dado });
  const espiao = espiaFetch();
  try {
    return { texto: await Mente.conversar("sys", "faça algo", { rotina: "objetivos", ...opts }), ...espiao };
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

test("Gemini: o system vai em `systemInstruction`, e a conversa do harness NÃO leva tools", async () => {
  const { chamadas, texto } = await comGemini();
  const { corpo } = chamadas[0];
  assert.strictEqual(typeof corpo.systemInstruction.parts[0].text, "string");
  assert.ok(!corpo.tools, "a Mente recebeu tools — o schema nunca desce (spec 075)");
  assert.strictEqual(texto, "- Pegar a corda");
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

// A ROTINA TROCA O MODELO SEM APAGAR O SEGREDO (spec 073, T026).
//
// `porRotina` sobrepõe modelo e opções por rotina. A primeira implementação fazia
// isso com `{ ...config(), ...daRotina }` — e o spread APAGA os segredos, porque em
// `config.js` eles são não-enumeráveis DE PROPÓSITO (a trava que os mantém fora de
// todo log e dump). O efeito era mudo e total: toda integração remota passava a
// morrer com "configure sua chave". Esta trava prende o caso pelo lado que dói.
test("Gemini: rotina com modelo próprio NÃO apaga a chave (segredo não-enumerável)", async () => {
  const cfg = configuracao.carregar(true);
  cfg.runtime = "gemini";
  cfg.geminiKey = "AIza-SEGREDO-DE-TESTE";
  cfg.porRotina = { narrar: { model: "outro-modelo", think: false } };
  configuracao.gravar(cfg);

  assert.ok(!Object.keys(cfg).includes("geminiKey"),
    "o segredo virou enumerável — a trava do config.js caiu, e este teste perdeu o sentido");

  Mente.usarMundo(mundoFalso(TOOLS));
  Mente.usarExtensoes({ toolsLocais: () => [], ehLocal: () => false,
                        hook: async (_p, dado) => dado });
  const espiao = espiaFetch();
  try {
    await Mente.conversar("sys", "narre", { rotina: "narrar" });
  } finally {
    espiao.restaurar();
  }
  assert.strictEqual(espiao.chamadas.length, 1,
    "nenhuma chamada saiu: a chave sumiu no caminho da rotina");
  assert.strictEqual(espiao.chamadas[0].opts.headers["x-goog-api-key"],
    "AIza-SEGREDO-DE-TESTE");
});

test("spec 076: o plano pede JSON — `responseMimeType` só quando a rotina pede, nunca na narração", async () => {
  const com = await comGemini(null, { json: true });
  assert.strictEqual(com.chamadas[0].corpo.generationConfig.responseMimeType, "application/json");
  const sem = await comGemini();
  assert.strictEqual(sem.chamadas[0].corpo.generationConfig.responseMimeType, undefined);
});
