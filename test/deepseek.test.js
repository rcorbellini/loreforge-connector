// A API DO DEEPSEEK pelo runtime de formato OpenAI (o mesmo do OpenRouter).
//
// O DeepSeek PENSA POR PADRÃO, inclusive o modelo mais barato (`deepseek-flash`). O
// thinking nativo nunca entra (mantenedor, 03/10): o pensar do harness é o contrato M, e o
// raciocínio escondido do modelo, pago e fora do contrato, tornaria a medição injusta. Sem o
// campo `thinking` no corpo, o `think:false` da mesa não chega à API — o mesmo buraco que o
// Gemini teve, e que só se via na conta.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "deepseek-"));
process.env.LOREFORGE_CONFIG = path.join(TMP, "conector.json");
process.env.LOREFORGE_LOG = "0";

const configuracao = require("../config");
const Mente = require("../mente").criarMente();

function espiaFetch() {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, opts) => {
    chamadas.push({ url, opts, corpo: JSON.parse((opts && opts.body) || "{}") });
    return new Response(JSON.stringify({
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { chamadas, restaurar: () => { globalThis.fetch = original; } };
}

async function chamar({ endpoint = "https://api.deepseek.com", think, json = false } = {}) {
  const cfg = configuracao.carregar(true);
  cfg.runtime = "openrouter";
  cfg.openrouterEndpoint = endpoint;
  cfg.openrouterKey = "sk-SEGREDO-DE-TESTE";
  cfg.openrouterModel = "deepseek-flash";
  if (think !== undefined) cfg.think = think;
  cfg.porRotina = {};
  configuracao.gravar(cfg);
  const espiao = espiaFetch();
  Mente.zerarCusto();
  try {
    await Mente.conversar("sys", "faça algo", { rotina: "objetivos", json });
    return espiao.chamadas;
  } finally {
    espiao.restaurar();
  }
}

test("DeepSeek: com o `think` desligado (o padrão), o corpo DESLIGA o thinking nativo", async () => {
  const chamadas = await chamar({ think: false });
  assert.strictEqual(chamadas.length, 1);
  assert.ok(chamadas[0].url.startsWith("https://api.deepseek.com/chat/completions"));
  assert.deepStrictEqual(chamadas[0].corpo.thinking, { type: "disabled" });
  const semCampo = await chamar();
  assert.deepStrictEqual(semCampo[0].corpo.thinking, { type: "disabled" },
    "sem `think` na mesa o DeepSeek ficava no padrão dele, que é pensar");
});

test("DeepSeek: só a mesa que LIGA o `think` deixa o modelo pensar", async () => {
  const chamadas = await chamar({ think: true });
  assert.deepStrictEqual(chamadas[0].corpo.thinking, { type: "enabled" });
});

test("DeepSeek: o plano que pede JSON vai no modo JSON da API; a conversa solta, não", async () => {
  assert.deepStrictEqual((await chamar({ json: true }))[0].corpo.response_format, { type: "json_object" });
  assert.strictEqual((await chamar())[0].corpo.response_format, undefined);
});

test("OpenRouter: o corpo segue o de antes (o campo de thinking dele não foi medido)", async () => {
  const chamadas = await chamar({ endpoint: "https://openrouter.ai/api/v1", json: true });
  assert.strictEqual(chamadas[0].corpo.thinking, undefined);
  assert.strictEqual(chamadas[0].corpo.response_format, undefined);
  assert.strictEqual(Mente.custoDoTurno().entrada, 10);
});
