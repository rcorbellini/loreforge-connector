// TUDO SOBE PRO FRONT — em duas camadas (spec 075, contrato 02, FR-020/FR-021).
//
// A camada VISÍVEL é o que o jogador lê enquanto espera: a Mente em 1ª pessoa e os
// rótulos neutros do harness. Ela NUNCA mostra nome de capacidade, id de cena nem
// número de nota ou margem (Princípio V: o player lê prosa, sempre). O BASTIDOR leva
// a mecânica — marcado, para o client recolher.
//
// A guarda abaixo varre TODO evento visível de um turno real contra os nomes da face e
// os ids da cena. É o teste que tem de falhar se alguém puser "take" num rótulo.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "front-"));
process.env.LOREFORGE_CONFIG = path.join(TMP, "conector.json");
process.env.LOREFORGE_HARNESS_DIR = path.join(TMP, "harness");
process.env.LOREFORGE_LOG = "0";

const { Laco } = require("../laco");
const extensoes = require("../extensoes");
const { traduzir } = require("../acp/traducao");
const { erros } = require("../acp/validar_schema");
const { notificacao } = require("../acp/jsonrpc");
const labels = require("../harness/labels");

const TOOLS = [
  { name: "take", description: "Pega um item para a mão do personagem que age.",
    inputSchema: { type: "object", properties: { item: { type: "string", enum: ["corda-velha"] } }, required: ["item"] },
    annotations: { byName: { item: { "corda-velha": "Corda Velha" } } } },
];
const CENA = { self: { id: "fulano", name: "Fulano", inventory: [], memories: [], intentions: [] },
               scene: { place: { id: "praca", name: "Praça" }, characters: [],
                        items: [{ id: "corda-velha", name: "Corda Velha" }], objects: [], exits: [] } };

async function turno() {
  const eventos = [];
  const mundo = {
    personagem: "fulano", conhece: () => true, listarCapacidades: async () => TOOLS,
    contexto: async () => CENA, descricaoDe: () => "",
    chamarCapacidade: async () => ({ recusado: false, texto: "", narrativa: { aconteceu: ["Fulano pegou a corda."] } }),
  };
  const mente = {
    config: () => ({ harness: {} }), ROTINAS: [],
    _contextoPayload: async () => ({}), _cenaEmProsa: () => "cena",
    custoDoTurno: () => ({ entrada: 0, saida: 0, chamadas: 0 }),
    conversar: async () => "- Pegar a Corda Velha",
    narrate: async () => "Você pega a corda.",
  };
  const f = async (e, c, ops, extra) => {
    const ids = (extra ? ops.concat([extra]) : ops).map(([id]) => id);
    return { vencedora: ids[0], margem: 3.7, ranking: [[ids[0], 0.97, -0.03]] };
  };
  const laco = new Laco({ mundo, mente, extensoes: extensoes.criar(TMP), registro: null,
    decider: { choose: f, tournament: f, custoLocal: () => ({ chamadas: 0, tokens_prompt: 0 }), modelo: () => "x" },
    emitir: (ev, d) => eventos.push({ ev, ...d }) });
  await laco.sussurrar("pegue a corda");
  return eventos;
}

const VISIVEIS = new Set(["objetivos", "harness"]);

function vazamentos(eventos) {
  const proibidos = TOOLS.map((t) => t.name).concat(["corda-velha", "praca", "fulano"]);
  const out = [];
  for (const e of eventos.filter((x) => VISIVEIS.has(x.ev))) {
    for (const p of proibidos) if (new RegExp(`\\b${p}\\b`).test(e.texto || "")) out.push(`${e.ev}: '${p}' em "${e.texto}"`);
    if (/\d/.test(e.texto || "")) out.push(`${e.ev}: número em "${e.texto}"`);
  }
  return out;
}

test("GUARDA: a camada visível não tem nome de capacidade, id de cena nem número", async () => {
  const eventos = await turno();
  assert.ok(eventos.some((e) => VISIVEIS.has(e.ev)), "nenhum evento visível foi emitido");
  assert.deepStrictEqual(vazamentos(eventos), []);
});

test("GUARDA vista falhar: um rótulo com o nome da tool É pego", async () => {
  const original = labels.ROTULOS.C6;
  labels.ROTULOS.C6 = "vou usar take…";
  try {
    const eventos = await turno();
    assert.ok(vazamentos(eventos).some((v) => /'take'/.test(v)),
      "a guarda não pegou o nome da tool no rótulo — ela é inerte");
  } finally {
    labels.ROTULOS.C6 = original;
  }
});

test("todo BASTIDOR sai marcado `_meta.camada: bastidor` — e a camada visível, `visivel`", async () => {
  const eventos = await turno();
  const sid = "sess-1";
  const bast = eventos.filter((e) => e.ev === "bastidor").map((e) => traduzir(e.ev, e, sid));
  assert.ok(bast.length >= 2);
  for (const b of bast) assert.strictEqual(b.update._meta.camada, "bastidor");
  const vis = eventos.filter((e) => e.ev === "harness").map((e) => traduzir(e.ev, e, sid));
  for (const v of vis) assert.strictEqual(v.update._meta.camada, "visivel");
});

test("os eventos novos validam contra o schema ACP v2 (plan_update, bloqueio, objetivos)", () => {
  const sid = "sess-1";
  const casos = [
    traduzir("plano", { desejo: "x", entries: [{ content: "a", status: "in_progress" }, { content: "b" }] }, sid),
    traduzir("bloqueio", { texto: "Ele desiste disso desse jeito.", motivo: "abordagens" }, sid),
    traduzir("objetivos", { texto: "— Pegar a corda", numeroTurno: 1 }, sid),
    traduzir("harness", { box: "C4", texto: "procurando onde está a corda…" }, sid),
    traduzir("bastidor", { box: "C6", tool: "take", margem: 2 }, sid),
  ];
  for (const p of casos) {
    assert.ok(p, "um evento novo não foi traduzido");
    assert.deepStrictEqual(erros(notificacao("session/update", p)), []);
  }
});
