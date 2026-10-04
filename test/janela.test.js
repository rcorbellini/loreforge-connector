// A JANELA DO OLLAMA (04/10/2026): a Mente e o decisor no MESMO `num_ctx` (8.192), e o
// alarme do corte. Medido: passar da janela não dá erro no Ollama — ele corta o COMEÇO do
// prompt (o system, onde mora o contrato) e responde assim mesmo. Sem o alarme, um plano sem
// contrato seguia como plano. Sem a janela no corpo, a Mente pegava o padrão do servidor
// (32.768: 36% na CPU, o plano em 24 s) e o decisor 4.096 (o modelo recarregava a cada troca).

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "janela-"));
process.env.LOREFORGE_CONFIG = path.join(TMP, "conector.json");
process.env.LOREFORGE_LOG = "0";

const configuracao = require("../config");
const { createDecider } = require("../harness/decider");
const Mente = require("../mente").criarMente();

function ollamaFalso({ lidos }) {
  const original = globalThis.fetch;
  const corpos = [];
  globalThis.fetch = async (url, opts) => {
    corpos.push(JSON.parse((opts && opts.body) || "{}"));
    return new Response(JSON.stringify({
      message: { content: "{}" }, prompt_eval_count: lidos, eval_count: 5,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { corpos, restaurar: () => { globalThis.fetch = original; } };
}

async function planoComOllama({ janela, lidos = 3000 } = {}) {
  const cfg = configuracao.carregar(true);
  cfg.runtime = "local";
  cfg.porRotina = {};
  if (janela !== undefined) cfg.janela = janela; else delete cfg.janela;
  configuracao.gravar(cfg);
  const espiao = ollamaFalso({ lidos });
  try {
    const texto = await Mente.conversar("contrato", "a cena", { rotina: "objetivos", json: true });
    return { texto, corpos: espiao.corpos };
  } finally {
    espiao.restaurar();
  }
}

test("a Mente manda a janela da mesa ao Ollama (8.192 por padrão)", async () => {
  const { corpos } = await planoComOllama();
  assert.strictEqual(corpos[0].options.num_ctx, 8192);
  const outra = await planoComOllama({ janela: 16384 });
  assert.strictEqual(outra.corpos[0].options.num_ctx, 16384);
});

test("a Mente: o Ollama leu a janela inteira → o começo foi cortado, e a resposta é falha", async () => {
  await assert.rejects(planoComOllama({ janela: 8192, lidos: 8191 }), /não coube na janela/);
  const cabe = await planoComOllama({ janela: 8192, lidos: 3363 });
  assert.strictEqual(cabe.texto, "{}");
});

function deciderFalso({ lidos, cfg }) {
  const corpos = [];
  const fetchImpl = async (url, opts) => {
    corpos.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({
      prompt_eval_count: lidos,
      logprobs: [{ top_logprobs: [{ token: "A", logprob: -0.1 }, { token: "B", logprob: -3 }] }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { decider: createDecider({ cfg, fetchImpl }), corpos };
}

test("o decisor usa a MESMA janela da Mente (era 4.096, e o modelo recarregava a cada troca)", async () => {
  const { decider, corpos } = deciderFalso({ lidos: 900, cfg: { decisor: { model: "qwen3:8b" } } });
  await decider.choose("evidência", "critério", [["a", "uma"], ["b", "outra"]]);
  assert.strictEqual(corpos[0].options.num_ctx, 8192);
  const mesa = deciderFalso({ lidos: 900, cfg: { janela: 16384, decisor: { model: "qwen3:8b" } } });
  await mesa.decider.choose("evidência", "critério", [["a", "uma"], ["b", "outra"]]);
  assert.strictEqual(mesa.corpos[0].options.num_ctx, 16384);
});

test("o decisor: a pergunta que não coube na janela não vira escolha", async () => {
  const { decider } = deciderFalso({ lidos: 8191, cfg: { janela: 8192, decisor: { model: "qwen3:8b" } } });
  await assert.rejects(decider.choose("evidência", "critério", [["a", "uma"], ["b", "outra"]]),
    /não coube na janela/);
});
