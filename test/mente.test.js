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
