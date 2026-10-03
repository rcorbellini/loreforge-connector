// AS REGRAS DO RESOLVEDOR SEGURO (spec 076): R1 destino → saída, R2 "sobre" sem assunto,
// R3/R5 referência da cena não citada. Medidas a seco na V3-resolver antes de existirem
// (`ferramentas/harness-objetivos/v2/V3-resolver/`, rodada 3): 0 atos legítimos barrados.
// Cada uma tem de reprovar aqui quando desligada.

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const H = require("../harness");

const EXITS = [
  { id: "portao-lateral", name: "Portão Lateral", destination_name: "Taverna do Gancho" },
  { id: "caminho-da-muralha", name: "Caminho da Muralha", destination_name: "Torre da Vigília" },
];

function ctxDe(extra = {}) {
  return {
    self: { id: "eu", name: "Eu", inventory: [], known_elsewhere: [{ id: "taverna-do-gancho", name: "Taverna do Gancho" }] },
    scene: { place: { id: "forja", name: "Forja de Ferro" }, characters: [], items: [], objects: [], exits: EXITS, ...extra },
  };
}

const ENTER_ROUTE = { name: "enter_route", inputSchema: { type: "object",
  properties: { route: { type: "string", enum: ["portao-lateral", "caminho-da-muralha"] } }, required: ["route"] } };
const DECIDER = { tournament: async (e, c, ops) => ({ vencedora: ops[0][0], margem: 0, ranking: [] }),
                  choose: async (e, c, ops) => ({ vencedora: ops[0][0], margem: 0, ranking: [] }) };

// --- R1 ------------------------------------------------------------------------ //

test("R1: o passo que nomeia o DESTINO usa a saída que leva lá", async () => {
  const ctx = ctxDe();
  const idx = H.scene.sceneIndex(ctx);
  const texto = "Virar as costas e caminhar para a Taverna do Gancho";
  const citados = H.target.withDestinations(texto, H.target.cited(texto, idx), ctx, H.tool.refsOf(ENTER_ROUTE));
  assert.deepStrictEqual(citados.map((a) => a.id), ["portao-lateral"]);
  const r = await H.params.fillParams({ texto, tool: ENTER_ROUTE, citados, ctx, decider: DECIDER, pergunta: "?" });
  assert.strictEqual(r.args && r.args.route, "portao-lateral");
});

test("R1: o destino citado como lugar CONHECIDO (longe) é trocado pela saída — senão o C7 subiria", () => {
  const ctx = ctxDe();
  const idx = H.scene.sceneIndex(ctx);
  const texto = "sair da forja e ir para a taverna";
  const antes = H.target.cited(texto, idx);
  assert.ok(antes.some((a) => a.id === "taverna-do-gancho" && a.onde === "longe"), "o fixture mudou");
  const depois = H.target.withDestinations(texto, antes, ctx, H.tool.refsOf(ENTER_ROUTE));
  assert.deepStrictEqual(depois.map((a) => a.id), ["portao-lateral"]);
});

test("R1 só vale depois da escolha: capacidade sem saída, ou saída já citada, não muda nada", () => {
  const ctx = ctxDe();
  const idx = H.scene.sceneIndex(ctx);
  const eat = { name: "eat", inputSchema: { type: "object", properties: { item: { type: "string", enum: ["pao"] } }, required: ["item"] } };
  const t1 = "rezar pelos mortos da Taverna do Gancho";
  assert.deepStrictEqual(H.target.withDestinations(t1, H.target.cited(t1, idx), ctx, H.tool.refsOf(eat)),
    H.target.cited(t1, idx));
  const t2 = "sair pelo Caminho da Muralha rumo à Taverna do Gancho";
  assert.deepStrictEqual(
    H.target.withDestinations(t2, H.target.cited(t2, idx), ctx, H.tool.refsOf(ENTER_ROUTE)).map((a) => a.id),
    H.target.cited(t2, idx).map((a) => a.id));
});

test("R1: o índice da cena NÃO ganha o destino (o C4 de quem só cita um lugar não muda)", () => {
  const idx = H.scene.sceneIndex(ctxDe());
  assert.ok(!(idx.get("taverna do gancho") || []).some((a) => a.id === "portao-lateral"));
});

// --- R2 ------------------------------------------------------------------------ //

const ASK = { name: "ask_about", inputSchema: { type: "object",
  properties: { quem: { type: "string", enum: ["bruna"] }, sobre: { type: "string" } }, required: ["quem", "sobre"] } };

test("R2: 'sobre' sem assunto não é pergunta — o passo é ato sem capacidade (sem_tool)", async () => {
  const ctx = ctxDe({ characters: [{ id: "bruna", name: "Bruna, a Marteleira" }] });
  const idx = H.scene.sceneIndex(ctx);
  const texto = "Vai até Bruna e pede ajuda para coletar materiais — Bruna, a Marteleira";
  const r = await H.params.fillParams({ texto, tool: ASK, citados: H.target.cited(texto, idx), ctx, decider: DECIDER, pergunta: "?" });
  assert.strictEqual(r.args, null);
  assert.strictEqual(r.subiu, "sem_tool");
});

test("R2: a pergunta com assunto segue, e o assunto não leva os nomes do `com`", async () => {
  const ctx = ctxDe({ characters: [{ id: "bruna", name: "Bruna, a Marteleira" }] });
  const idx = H.scene.sceneIndex(ctx);
  const texto = "Perguntar à Bruna sobre o depósito de ferramentas — Bruna, a Marteleira";
  const r = await H.params.fillParams({ texto, tool: ASK, citados: H.target.cited(texto, idx), ctx, decider: DECIDER, pergunta: "?" });
  assert.strictEqual(r.args.sobre, "o depósito de ferramentas");
  assert.strictEqual(r.args.quem, "bruna");
});

// --- R3/R5 --------------------------------------------------------------------- //

test("R3/R5: a pessoa que o passo NÃO citou não é escolhida do conjunto inteiro (o carry do Bramm)", async () => {
  const ctx = { self: { id: "verro", name: "Verro", inventory: [] },
                scene: { place: { id: "porto-negro", name: "Porto Negro" },
                         characters: [{ id: "bramm", name: "Bramm, o Estivador-Mor" }], items: [], objects: [],
                         exits: [{ id: "estrada-do-vau", name: "Estrada do Vau", destination_name: "Vau de Pedra" }] } };
  const carry = { name: "carry", inputSchema: { type: "object",
    properties: { alvo: { type: "string", enum: ["bramm"] }, rota: { type: "string", enum: ["estrada-do-vau"] } },
    required: ["alvo", "rota"] } };
  const idx = H.scene.sceneIndex(ctx);
  const texto = "Levo o corpo em direção à saída Estrada do Vau";
  const r = await H.params.fillParams({ texto, tool: carry, citados: H.target.cited(texto, idx), ctx, decider: DECIDER, pergunta: "?" });
  assert.strictEqual(r.args, null, "carregou o Bramm sem ninguém dizer o nome dele");
  assert.strictEqual(r.subiu, "alvo_ausente");
});

test("R3/R5: a lembrança (fora da cena) o decisor ainda escolhe — o accuse segue", async () => {
  const ctx = ctxDe({ characters: [{ id: "torvin", name: "Torvin, o Ferreiro" }] });
  const accuse = { name: "accuse", inputSchema: { type: "object",
    properties: { alvo: { type: "string", enum: ["torvin"] }, memoria_id: { type: "string", enum: ["mem-1", "mem-2"] } },
    required: ["alvo", "memoria_id"] } };
  const idx = H.scene.sceneIndex(ctx);
  const texto = "Acusar Torvin do que eu vi na praça";
  const r = await H.params.fillParams({ texto, tool: accuse, citados: H.target.cited(texto, idx), ctx, decider: DECIDER, pergunta: "?" });
  assert.strictEqual(r.args.alvo, "torvin");
  assert.strictEqual(r.args.memoria_id, "mem-1");
});
