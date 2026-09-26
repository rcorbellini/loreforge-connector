// AS CAIXAS DE REGRA, PORTADAS — paridade com o protótipo que mediu os números (T014).
//
// C4 (onde está o alvo), o filtro do C6 e a pista do verbo são REGRA: sem modelo, e por
// isso têm de decidir EXATAMENTE como o protótipo Python que produziu o B3 (64/65) e o
// B5 (42/47). Um desvio de porte muda o número sem ninguém saber — este teste roda os
// dois lados sobre os mesmos gabaritos e compara caso a caso.
//
// Depende de `ferramentas/harness-objetivos/v1/` (as cenas congeladas S1–S15 e o
// protótipo); fora do repositório do jogo, o teste é PULADO, não falso-verde.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const H = require("../harness");

const V1 = path.join(__dirname, "..", "..", "ferramentas", "harness-objetivos", "v1");
const TEM = fs.existsSync(path.join(V1, "paridade.py")) && fs.existsSync(path.join(V1, "cenas", "S1.json"));

let _py = null;
function python() {
  if (!_py) {
    _py = JSON.parse(execFileSync("python3", [path.join(V1, "paridade.py")],
      { cwd: V1, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" }));
  }
  return _py;
}

const _cenas = {};
function cena(sid) {
  if (!_cenas[sid]) _cenas[sid] = JSON.parse(fs.readFileSync(path.join(V1, "cenas", `${sid}.json`), "utf8"));
  return _cenas[sid];
}

test("C4: o porte decide ONDE ESTÁ O ALVO igual ao protótipo (gabarito B3 inteiro)", { skip: !TEM }, () => {
  const difs = [];
  for (const r of python().B3) {
    const c = cena(r.cena);
    const idx = H.scene.sceneIndex(c.contexto);
    const js = H.target.whereIs(r.objetivo, idx);
    if (js.onde !== r.onde || (js.nome || null) !== (r.nome || null)) {
      difs.push(`${r.id} "${r.objetivo}": py=${r.onde}/${r.nome} js=${js.onde}/${js.nome}`);
    }
  }
  // tolerância zero para regra portada: toda diferença é defeito de porte
  assert.deepStrictEqual(difs, []);
});

test("C6: o filtro por UNIÃO de alvos devolve as mesmas candidatas (gabarito B5 inteiro)", { skip: !TEM }, () => {
  const difs = [];
  for (const r of python().B5) {
    const c = cena(r.cena);
    const idx = H.scene.sceneIndex(c.contexto);
    const alvos = H.target.cited(r.objetivo, idx).filter((a) => a.onde === "aqui" || a.onde === "longe");
    const js = H.tool.candidates(c.tools_cruas, alvos).sort();
    if (JSON.stringify(js) !== JSON.stringify(r.candidatas)) {
      const falta = r.candidatas.filter((x) => !js.includes(x));
      const sobra = js.filter((x) => !r.candidatas.includes(x));
      difs.push(`${r.id} "${r.objetivo}": falta=${falta} sobra=${sobra}`);
    }
  }
  assert.deepStrictEqual(difs, []);
});

test("C6: a pista do verbo aponta a mesma tool que o protótipo (gabarito B5 inteiro)", { skip: !TEM }, () => {
  const difs = [];
  for (const r of python().B5) {
    const c = cena(r.cena);
    const tools = c.tools_mente.map((t) => ({ name: t.function.name, description: t.function.description }));
    const js = H.tool.verbHint(tools, r.objetivo);
    if ((js || null) !== (r.pista || null)) difs.push(`${r.id} "${r.objetivo}": py=${r.pista} js=${js}`);
  }
  assert.deepStrictEqual(difs, []);
});

test("C7: homônimos — a regra do DONO desempata sem perguntar ao decisor", async () => {
  const ctx = {
    self: { id: "eu", name: "Eu", inventory: [{ id: "moeda-1", name: "Moeda de Prata" }] },
    scene: { characters: [{ id: "coppo", name: "Coppo, o Rato de Cais",
                            carrying: [{ id: "moeda-2", name: "Moeda de Prata" }] }],
             items: [], objects: [], exits: [] },
  };
  const tool = { name: "steal", inputSchema: { type: "object",
    properties: { alvo: { type: "string", enum: ["coppo"] }, item: { type: "string", enum: ["moeda-1", "moeda-2"] } },
    required: ["alvo", "item"] } };
  const idx = H.scene.sceneIndex(ctx);
  const texto = "furtar a Moeda de Prata do Coppo";
  const perguntas = [];
  const decider = { tournament: async (e, c, ops) => { perguntas.push(ops); return { vencedora: ops[0][0], margem: 0, ranking: [] }; } };
  const r = await H.params.fillParams({ texto, tool, citados: H.target.cited(texto, idx), ctx, decider, pergunta: "?" });
  assert.strictEqual(r.args.item, "moeda-2", "pegou a moeda errada — a regra do dono não desempatou");
  assert.strictEqual(r.args.alvo, "coppo");
  assert.strictEqual(perguntas.length, 0, "perguntou ao decisor o que a regra resolvia");
});

test("C7: o OBJETO DO VERBO sem lugar SOBE — nunca troca pela outra coisa (a Faca e a Bolsinha)", async () => {
  const ctx = { self: { id: "eu", name: "Eu", inventory: [{ id: "bolsinha", name: "Bolsinha" }] },
                scene: { characters: [{ id: "fenn", name: "Fenn" }], items: [], objects: [], exits: [] } };
  const tool = { name: "give", inputSchema: { type: "object",
    properties: { item: { type: "string", enum: ["bolsinha"] }, to: { type: "string", enum: ["fenn"] } },
    required: ["item", "to"] } };
  const idx = H.scene.sceneIndex(ctx);
  idx.set("faca", [{ onde: "longe", nome: "Faca", id: "faca" }]);
  const texto = "dar a Faca para o Fenn";
  const decider = { tournament: async (e, c, ops) => ({ vencedora: ops[0][0], margem: 0, ranking: [] }) };
  const r = await H.params.fillParams({ texto, tool, citados: H.target.cited(texto, idx), ctx, decider, pergunta: "?" });
  assert.strictEqual(r.args, null, "trocou a Faca pela Bolsinha em silêncio");
  assert.strictEqual(r.subiu, "alvo_ausente");
});

test("decisor: ' B' e 'B' colidem — fica o MAIOR logprob, e a margem é a diferença", async () => {
  const { createDecider } = H.decider;
  const d = createDecider({ cfg: { decisor: { endpoint: "http://x", model: "m" } },
    fetchImpl: async () => ({ ok: true, json: async () => ({ prompt_eval_count: 7,
      logprobs: [{ top_logprobs: [{ token: "B", logprob: -3 }, { token: " B", logprob: -0.1 }, { token: "A", logprob: -2 }] }] }) }) });
  const r = await d.choose({}, "?", [["a", "A"], ["b", "B"]]);
  assert.strictEqual(r.vencedora, "b");
  assert.ok(Math.abs(r.margem - 1.9) < 1e-9);
  assert.deepStrictEqual(d.custoLocal(), { chamadas: 1, tokens_prompt: 7 });
});

test("decisor: torneio com 20 opções decide em grupos e não passa de 16 por pergunta", async () => {
  const { createDecider } = H.decider;
  const tamanhos = [];
  const d = createDecider({ cfg: { decisor: { endpoint: "http://x", model: "m" } },
    fetchImpl: async (_u, o) => {
      tamanhos.push(JSON.parse(JSON.parse(o.body).messages[1].content).options.length);
      return { ok: true, json: async () => ({ logprobs: [{ top_logprobs: [{ token: "A", logprob: -0.1 }] }] }) };
    } });
  const ops = Array.from({ length: 20 }, (_, i) => [`t${i}`, `tool ${i}`]);
  const r = await d.tournament({}, "?", ops, ["(nenhuma)", "nada"]);
  assert.ok(r.vencedora);
  assert.ok(tamanhos.every((n) => n <= 16), `pergunta com ${Math.max(...tamanhos)} opções`);
  assert.ok(tamanhos.length >= 3);
});

test("decisor: endpoint fora do ar vira DeciderUnavailable — sem fallback (Princípio VIII)", async () => {
  const { createDecider, DeciderUnavailable } = H.decider;
  const d = createDecider({ cfg: { decisor: { endpoint: "http://x", model: "m" } },
    fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
  await assert.rejects(() => d.choose({}, "?", [["a", "A"], ["b", "B"]]), DeciderUnavailable);
});

test("C7: o texto livre leva o ASSUNTO, não o objetivo inteiro (caso 2: o `sobre` do ask_about)", () => {
  const { assunto } = H.params;
  assert.strictEqual(assunto("Perguntar à Hulda sobre o furto do Pé de Cabra", []), "o furto do Pé de Cabra");
  assert.strictEqual(assunto("Perguntar ao Bram a respeito do Nuno.", []), "Nuno");
  assert.strictEqual(assunto("Perguntar à Hulda quem viu o Nuno", [{ nome: "Nuno" }]), "Nuno");
  assert.strictEqual(assunto("Conversar com a Bruna", []), "Conversar com a Bruna");
});
