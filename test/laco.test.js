// O LAÇO DO TURNO (spec 075), de ponta a ponta, contra um mundo, uma Mente e um decisor
// simulados.
//
// O que mais importa aqui não é o caminho feliz — é o que NÃO pode acontecer:
//   · a troca SILENCIOSA (pediram a caneca que não existe, e ele bebeu do cantil);
//   · o objetivo que SOME (todo objetivo termina no mundo OU numa subida narrada);
//   · a recusa silenciosa (o mundo disse não e a narração não soube);
//   · o schema das tools descendo à Mente (invariante 1 do contrato 01).

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.LOREFORGE_CONFIG =
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "laco-")), "conector.json");
process.env.LOREFORGE_HARNESS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "harness-"));
process.env.LOREFORGE_LOG = "0";

const { Laco, diffTextual } = require("../laco");
const extensoes = require("../extensoes");
const registroMod = require("../registro");

function extVazio() {
  return extensoes.criar(fs.mkdtempSync(path.join(os.tmpdir(), "ext-")));
}

// --- o mundo ---------------------------------------------------------------- //

const TOOLS = [
  { name: "take", description: "Pega um item para a mão do personagem que age.",
    inputSchema: { type: "object", properties: { item: { type: "string", enum: ["corda", "cantil"] },
                   prosa: { type: "object" } }, required: ["item", "prosa"] },
    annotations: { byName: { item: { corda: "Corda de Cânhamo", cantil: "Cantil de Água" } } } },
  { name: "drink", description: "Bebe de um recipiente presente ou na sua mão.",
    inputSchema: { type: "object", properties: { item: { type: "string", enum: ["corda", "cantil"] },
                   prosa: { type: "object" } }, required: ["item", "prosa"] },
    annotations: { byName: { item: { corda: "Corda de Cânhamo", cantil: "Cantil de Água" } } } },
  { name: "recognize", description: "Olha com atenção algo presente, lembrando o que sabe.",
    inputSchema: { type: "object", properties: { alvo: { type: "string", enum: ["corda", "cantil"] },
                   prosa: { type: "object" } }, required: ["alvo", "prosa"] },
    annotations: { readOnlyHint: true, byName: { alvo: { corda: "Corda de Cânhamo", cantil: "Cantil de Água" } } } },
  { name: "sleep", description: "Dorme onde está.",
    inputSchema: { type: "object", properties: { prosa: { type: "object" } }, required: ["prosa"] } },
];

const CENA = {
  self: { id: "fulano", name: "Fulano", inventory: [], needs: { hunger: "sem fome" }, memories: [],
          intentions: [] },
  scene: { place: { id: "praca", name: "Praça" }, characters: [],
           items: [{ id: "corda", name: "Corda de Cânhamo" }, { id: "cantil", name: "Cantil de Água" }],
           objects: [], exits: [] },
};

function mundoDe({ respostas = [], contextos } = {}) {
  const chamadas = [];
  const intencoes = [];
  let n = 0;
  return {
    personagem: "fulano",
    chamadas, intencoes,
    turnoId: null,
    conhece: (nome) => TOOLS.some((t) => t.name === nome),
    listarCapacidades: async () => TOOLS,
    descricaoDe: (nome) => (TOOLS.find((t) => t.name === nome) || {}).description || "",
    contexto: async () => (contextos ? contextos[Math.min(n++, contextos.length - 1)] : CENA),
    chamarCapacidade: async (nome, args) => {
      chamadas.push({ nome, args });
      const r = respostas.shift();
      if (!r) throw new Error("o teste não previu mais chamadas");
      return r;
    },
    criarIntencao: async (content) => { intencoes.push({ op: "create", content }); return { ok: true, id: "int-1" }; },
    atualizarIntencao: async (id, content) => { intencoes.push({ op: "update", id, content }); return { ok: true }; },
    fecharIntencao: async (id, status, o) => { intencoes.push({ op: "close", id, status, ...(o || {}) }); return { ok: true }; },
    registrar: async (l) => { (mundoDe.registrados = mundoDe.registrados || []).push(l); return true; },
  };
}

// --- a Mente ---------------------------------------------------------------- //

function menteDe({ objetivos = "- Pegar a Corda de Cânhamo", narracao = "prosa", porRotina = {} } = {}) {
  const m = {
    conversas: [],
    custo: { entrada: 0, saida: 0, chamadas: 0 },
    config: () => ({ harness: { abordagens: 3, repeticoes: 3, tetoTokensDesejo: 8000,
                                janelaIntervencaoTicks: 1, losangosJev: "desligado" } }),
    ROTINAS: [{ nome: "objetivos", titulo: "Dizer o que quer" }, { nome: "narrar", titulo: "Narrar" }],
    _contextoPayload: async () => ({}),
    _cenaEmProsa: () => "A CENA EM PROSA",
    custoDoTurno() { return { ...m.custo }; },
    async conversar(system, user, opts) {
      m.conversas.push({ system, user, opts });
      m.custo.entrada += 100; m.custo.saida += 20; m.custo.chamadas += 1;
      const r = porRotina[opts && opts.rotina];
      if (r !== undefined) return typeof r === "function" ? r(user) : r;
      return objetivos;
    },
    async narrate(hint, ctx, falhas, viradas, aconteceu) {
      m.ultimo = { hint, falhas, viradas, aconteceu };
      m.custo.entrada += 50; m.custo.chamadas += 1;
      return narracao;
    },
  };
  return m;
}

// --- o decisor -------------------------------------------------------------- //

// Escolhe a opção cujo id está em `prefere` (na ordem), senão a primeira.
function deciderDe(prefere = []) {
  const perguntas = [];
  const escolher = async (evid, crit, ops) => {
    perguntas.push({ evid, crit, ops: ops.map(([id]) => id) });
    const ids = ops.map(([id]) => id);
    const v = prefere.find((p) => ids.includes(p)) || ids[0];
    return { vencedora: v, margem: 2, ranking: [[v, 0.9, -0.1]].concat(ids.filter((i) => i !== v).map((i) => [i, 0.01, -5])) };
  };
  return {
    perguntas,
    choose: escolher,
    tournament: async (evid, crit, ops, extra) => escolher(evid, crit, extra ? ops.concat([extra]) : ops),
    custoLocal: () => ({ chamadas: perguntas.length, tokens_prompt: 0 }),
    modelo: () => "fake/decisor",
  };
}

function coletor() {
  const eventos = [];
  return { eventos, emitir: (ev, d) => eventos.push({ ev, ...d }) };
}

function lacoDe({ mundo, mente, decider, emitir, registro }) {
  return new Laco({ mundo, mente, decider: decider || deciderDe(), extensoes: extVazio(),
                    registro: registro || null, emitir: emitir || (() => {}) });
}

// --------------------------------------------------------------------------- //

test("um turno feliz: objetivo → pista do verbo → id pelo NOME citado → mundo → narração", async () => {
  const c = coletor();
  const mundo = mundoDe({ respostas: [
    { recusado: false, texto: "", narrativa: { aconteceu: ["Fulano pegou a corda."] } }] });
  const mente = menteDe();
  await lacoDe({ mundo, mente, emitir: c.emitir }).sussurrar("pegue a corda");

  assert.deepStrictEqual(mundo.chamadas.map((x) => [x.nome, x.args.item]), [["take", "corda"]]);
  assert.strictEqual(mundo.chamadas[0].args.prosa.acao, "Pegar a Corda de Cânhamo");
  const tipos = c.eventos.map((e) => e.ev);
  assert.ok(tipos.includes("beat"));
  assert.ok(tipos.includes("narracao_fim"));
  assert.deepStrictEqual([tipos[0], tipos[tipos.length - 1]], ["estado", "estado"]);
});

test("LIGAÇÃO (invariante 1): a Mente NUNCA recebe schema de tool — nem nome de capacidade", async () => {
  const mente = menteDe();
  const mundo = mundoDe({ respostas: [{ recusado: false, texto: "", narrativa: { aconteceu: ["ok"] } }] });
  await lacoDe({ mundo, mente }).sussurrar("pegue a corda");
  for (const cv of mente.conversas) {
    assert.ok(!("tools" in (cv.opts || {})), "tools desceu à Mente");
    for (const t of TOOLS) {
      assert.ok(!new RegExp(`\\b${t.name}\\b`).test(cv.system + cv.user),
                `o nome '${t.name}' desceu à Mente`);
    }
  }
});

test("TROCA SILENCIOSA: alvo que não existe SOBE — nunca vira outro item da cena", async () => {
  const mente = menteDe({ objetivos: "- Beber da Caneca de Peltre" });
  const mundo = mundoDe();
  await lacoDe({ mundo, mente }).sussurrar("beba da caneca");
  assert.strictEqual(mundo.chamadas.length, 0, "foi ao mundo com outro recipiente");
  const falhas = (mente.ultimo && mente.ultimo.falhas) || [];
  assert.ok(falhas.some((f) => /Caneca de Peltre/.test(f.o_que_falhou)),
            "o que não aconteceu não chegou à narração");
});

test("NADA SOME: dois objetivos, um resolve e o outro sobe — os dois chegam à narração", async () => {
  const mente = menteDe({ objetivos: "- Pegar a Corda de Cânhamo\n- Beber da Caneca de Peltre" });
  const mundo = mundoDe({ respostas: [{ recusado: false, texto: "", narrativa: { aconteceu: ["Fulano pegou a corda."] } }] });
  await lacoDe({ mundo, mente }).sussurrar("pegue a corda e beba da caneca");
  assert.strictEqual(mundo.chamadas.length, 1);
  assert.deepStrictEqual(mente.ultimo.aconteceu, ["Fulano pegou a corda."]);
  assert.ok(mente.ultimo.falhas.some((f) => /Caneca/.test(f.o_que_falhou)));
});

test("A RECUSA NÃO É SILENCIOSA: vira evento e chega à narração", async () => {
  const c = coletor();
  const mente = menteDe();
  const mundo = mundoDe({ respostas: [{ recusado: true, texto: "A corda está presa ao poste.", narrativa: {} }] });
  await lacoDe({ mundo, mente, emitir: c.emitir }).sussurrar("pegue a corda");
  const r = c.eventos.find((e) => e.ev === "recusa");
  assert.ok(r && /presa ao poste/.test(r.texto));
  assert.ok(mente.ultimo.falhas.some((f) => /presa ao poste/.test(f.o_que_falhou)));
});

test("tentativa CONSULTIVA (sem aconteceu) ainda assim fecha com um beat", async () => {
  const c = coletor();
  const mente = menteDe({ objetivos: "- Olhar com atenção o Cantil de Água" });
  const decider = deciderDe(["recognize"]);
  const mundo = mundoDe({ respostas: [{ recusado: false, texto: "", narrativa: { reconhecimentos: [{ name: "Cantil" }] } }] });
  await lacoDe({ mundo, mente, decider, emitir: c.emitir }).sussurrar("olhe o cantil");
  const t = c.eventos.find((e) => e.ev === "tentativa");
  assert.ok(c.eventos.some((e) => e.ev === "beat" && e.toolCallId === t.toolCallId));
});

test("o título da tentativa é o comando com o NOME do alvo, não o id", async () => {
  const c = coletor();
  const mundo = mundoDe({ respostas: [{ recusado: false, texto: "", narrativa: { aconteceu: ["ok"] } }] });
  await lacoDe({ mundo, mente: menteDe(), emitir: c.emitir }).sussurrar("pegue a corda");
  const t = c.eventos.find((e) => e.ev === "tentativa");
  assert.strictEqual(t.tituloDinamico, "take(Corda de Cânhamo)");
});

test("'enquanto isso' vira evento PRÓPRIO ('paralelo'), fora da narração", async () => {
  const c = coletor();
  const depois = JSON.parse(JSON.stringify(CENA));
  depois.scene.characters = [{ id: "draven", name: "Draven" }];
  const mundo = mundoDe({ respostas: [{ recusado: false, texto: "", narrativa: { aconteceu: ["ok"] } }],
                          contextos: [CENA, depois] });
  await lacoDe({ mundo, mente: menteDe({ narracao: "Você pega a corda." }), emitir: c.emitir })
    .sussurrar("pegue a corda");
  const p = c.eventos.find((e) => e.ev === "paralelo");
  assert.ok(p && /Draven chegou ao local/.test(p.texto));
});

test("turno sem objetivo nenhum NÃO narra — narrar sem fato é inventar mundo", async () => {
  const c = coletor();
  const mente = menteDe({ objetivos: "- (nada)" });
  await lacoDe({ mundo: mundoDe(), mente, emitir: c.emitir }).sussurrar("pense na vida");
  assert.ok(!c.eventos.some((e) => e.ev === "narracao_fim"));
  assert.ok(c.eventos.some((e) => e.ev === "sistema"));
});

test("SEM FALLBACK (Princípio VIII): decisor fora do ar interrompe o turno com recado honesto", async () => {
  const c = coletor();
  const { DeciderUnavailable } = require("../harness/decider");
  const decider = deciderDe();
  decider.tournament = async () => { throw new DeciderUnavailable("o decisor não respondeu (ECONNREFUSED)"); };
  const mente = menteDe({ objetivos: "- Esperar um pouco" });
  const mundo = mundoDe();
  await lacoDe({ mundo, mente, decider, emitir: c.emitir }).sussurrar("espere");
  assert.strictEqual(mundo.chamadas.length, 0);
  const e = c.eventos.find((x) => x.ev === "erro");
  assert.ok(e && /decisor local não respondeu/.test(e.texto));
});

test("REGISTRO: o turno sobe com as caixas NA ORDEM, com custo e versão de prompt", async () => {
  const mundo = mundoDe({ respostas: [{ recusado: false, texto: "", narrativa: { aconteceu: ["ok"] } }] });
  const mente = menteDe();
  mundoDe.registrados = [];
  const reg = registroMod.criar({ mundo, cfg: { personagem: "fulano", runtime: "local", model: "x" },
                                  extensoes: extVazio(), mente });
  await lacoDe({ mundo, mente, registro: reg }).sussurrar("pegue a corda");
  const linha = mundoDe.registrados[0];
  const boxes = linha.corpo.caixas.map((c) => c.box);
  assert.deepStrictEqual(boxes, ["C1", "C3", "C4", "C6", "C7", "M2", "C9"]);
  const c3 = linha.corpo.caixas.find((c) => c.box === "C3");
  assert.ok(c3.custo_pago && c3.custo_pago.chamadas === 1, "o C3 não registrou custo pago");
  assert.match(c3.prompt_versao, /^[0-9a-f]{8}$/);
  assert.strictEqual(linha.corpo.acoes.length, 1);
  assert.strictEqual(linha.corpo.acoes[0].persistente, true);
  assert.strictEqual(linha.corpo.acoes[0].pedida, true);
});

test("REGISTRO: o turno QUEBRADO sobe com a caixa onde quebrou (item 80)", async () => {
  const mundo = mundoDe();
  const mente = menteDe();
  mente.conversar = async () => { throw new Error("o Ollama caiu"); };
  mundoDe.registrados = [];
  const reg = registroMod.criar({ mundo, cfg: { personagem: "fulano", runtime: "local", model: "x" },
                                  extensoes: extVazio(), mente });
  await lacoDe({ mundo, mente, registro: reg }).sussurrar("pegue a corda");
  const linha = mundoDe.registrados[0];
  assert.ok(linha, "o turno quebrado não subiu");
  assert.deepStrictEqual(linha.corpo.falha, { box: "C3", erro: "o Ollama caiu" });
});

test("o front recebe a Mente em 1ª pessoa, rótulos neutros e o bastidor marcado", async () => {
  const c = coletor();
  const mundo = mundoDe({ respostas: [{ recusado: false, texto: "", narrativa: { aconteceu: ["ok"] } }] });
  await lacoDe({ mundo, mente: menteDe(), emitir: c.emitir }).sussurrar("pegue a corda");
  assert.ok(c.eventos.some((e) => e.ev === "objetivos" && /Corda/.test(e.texto)));
  const rotulos = c.eventos.filter((e) => e.ev === "harness").map((e) => e.texto);
  assert.ok(rotulos.length >= 3);
  assert.ok(c.eventos.some((e) => e.ev === "bastidor" && e.box === "C6" && e.tool === "take"));
});

test("diffTextual: quem chegou, quem saiu, o que apareceu e sumiu do chão", () => {
  const a = { scene: { characters: [{ name: "A" }], items: [{ name: "Pão" }] } };
  const b = { scene: { characters: [{ name: "B" }], items: [] } };
  const d = diffTextual(a, b);
  assert.ok(d.includes("B chegou ao local."));
  assert.ok(d.includes("A saiu do local."));
  assert.ok(d.includes("Um(a) Pão sumiu do chão."));
});

// --- o desejo (US4) ------------------------------------------------------------ //

function cenaCom(extra) {
  const c = JSON.parse(JSON.stringify(CENA));
  Object.assign(c.self, extra.self || {});
  Object.assign(c.scene, extra.scene || {});
  return c;
}

test("TICK sem desejo: QUERER → PLANEJAR → o desejo é gravado no world (create)", async () => {
  const semDesejo = cenaCom({ self: { id: "t1", needs: { thirst: "com sede" } } });
  const comDesejo = cenaCom({ self: { id: "t1", intentions: [{ id: "int-1", status: "ativa",
    content: "Matar a sede.\n- Beber do Cantil de Água\nPronto quando: sede saciada." }] } });
  const mundo = mundoDe({ contextos: [semDesejo, comDesejo] });
  mundo.personagem = "t1";
  const mente = menteDe({ porRotina: {
    querer: "Quero matar a sede",
    planejar: "DESEJO: matar a sede\nPASSOS:\n- Beber do Cantil de Água\n- Descansar\nFIM: sede saciada" } });
  const c = coletor();
  await lacoDe({ mundo, mente, emitir: c.emitir }).talvezAgirSozinho();
  const create = mundo.intencoes.find((i) => i.op === "create");
  assert.ok(create, "o desejo não foi gravado no world");
  assert.match(create.content, /- Beber do Cantil de Água/);
  assert.match(create.content, /Pronto quando: sede saciada/);
  assert.ok(c.eventos.some((e) => e.ev === "plano"));
});

test("TICK com passo CONCRETO: resolve localmente, 0 token pago antes do narrar", async () => {
  const ctx = cenaCom({ self: { id: "t2", intentions: [{ id: "int-2", status: "ativa",
    content: "Matar a sede.\n- Beber do Cantil de Água\nPronto quando: sede saciada." }] } });
  const depois = cenaCom({ self: { id: "t2", needs: { thirst: "sem sede" }, intentions: ctx.self.intentions } });
  const mundo = mundoDe({ respostas: [{ recusado: false, texto: "", narrativa: { aconteceu: ["Bebeu."] } }],
                          contextos: [ctx, depois] });
  mundo.personagem = "t2";
  const mente = menteDe();
  await lacoDe({ mundo, mente }).talvezAgirSozinho();
  assert.deepStrictEqual(mundo.chamadas.map((x) => [x.nome, x.args.item]), [["drink", "cantil"]]);
  assert.strictEqual(mente.conversas.length, 0, "pagou a Mente antes de narrar");
});

test("TICK: o fim conferível verdadeiro FECHA o desejo no world (concluida) sem perguntar à Mente", async () => {
  const ctx = cenaCom({ self: { id: "t3", needs: { thirst: "sem sede" }, intentions: [{ id: "int-3", status: "ativa",
    content: "Matar a sede.\n- Beber do Cantil de Água\nPronto quando: sede saciada." }] } });
  const mundo = mundoDe({ contextos: [ctx] });
  mundo.personagem = "t3";
  const mente = menteDe();
  await lacoDe({ mundo, mente }).talvezAgirSozinho();
  assert.ok(mundo.intencoes.some((i) => i.op === "close" && i.status === "concluida"));
  assert.strictEqual(mente.conversas.length, 0);
});

test("TICK EM TRÂNSITO: espera a chegada — nada de C3, nada de tentativa", async () => {
  const ctx = cenaCom({ self: { id: "t4", transit: { route_id: "rua", to_name: "Taverna" },
    intentions: [{ id: "int-4", status: "ativa", content: "Chegar à Taverna.\n- Seguir pela Rua\nPronto quando: estar em Taverna." }] } });
  const mundo = mundoDe({ contextos: [ctx] });
  mundo.personagem = "t4";
  const mente = menteDe();
  const c = coletor();
  await lacoDe({ mundo, mente, emitir: c.emitir }).talvezAgirSozinho();
  assert.strictEqual(mundo.chamadas.length, 0);
  assert.strictEqual(mente.conversas.length, 0);
  assert.ok(c.eventos.some((e) => e.ev === "harness" && /a caminho de Taverna/.test(e.texto)));
});

test("TICK: o TETO DE CUSTO bloqueia o desejo e sobe como ponto de intervenção", async () => {
  const H = require("../harness");
  const ctx = cenaCom({ self: { id: "t5", intentions: [{ id: "int-5", status: "ativa",
    content: "Conseguir o Ungüento.\n- Pegar a Corda de Cânhamo\nPronto quando: posse de Ungüento." }] } });
  const nb = new H.desire.Notebook("t5");
  nb.sync(ctx.self.intentions);
  nb.pay("int-5", 9000);
  const mundo = mundoDe({ contextos: [ctx] });
  mundo.personagem = "t5";
  const c = coletor();
  await lacoDe({ mundo, mente: menteDe(), emitir: c.emitir }).talvezAgirSozinho();
  const b = c.eventos.find((e) => e.ev === "bloqueio");
  assert.ok(b && b.motivo === "custo");
  assert.strictEqual(mundo.chamadas.length, 0);
});

test("MESA (SC-011): um prompt do Jev tunado em extensoes/prompts muda a versão gravada", async () => {
  const rodar = async (ext) => {
    const mundo = mundoDe({ respostas: [{ recusado: false, texto: "", narrativa: { aconteceu: ["ok"] } }] });
    const mente = menteDe();
    mundoDe.registrados = [];
    const reg = registroMod.criar({ mundo, cfg: { personagem: "fulano", runtime: "local", model: "x" },
                                    extensoes: ext, mente });
    const decider = deciderDe();
    await new Laco({ mundo, mente, decider, extensoes: ext, registro: reg, emitir: () => {} })
      .sussurrar("pegue a corda");
    return { linha: mundoDe.registrados[0], decider };
  };
  const a = await rodar(extVazio());
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "ext-"));
  fs.mkdirSync(path.join(raiz, "prompts"));
  fs.writeFileSync(path.join(raiz, "prompts", "c6_tool.txt"), "Que ferramenta, afinal?");
  fs.writeFileSync(path.join(raiz, "prompts", "objetivos.txt"), "Liste o que ele quer.");
  const b = await rodar(extensoes.criar(raiz));
  assert.strictEqual(a.linha.versao_prompt, "padrao");
  assert.match(b.linha.versao_prompt, /^tunado-/, "a mesa tunada não se distingue no envelope");
  const c3a = a.linha.corpo.caixas.find((c) => c.box === "C3").prompt_versao;
  const c3b = b.linha.corpo.caixas.find((c) => c.box === "C3").prompt_versao;
  assert.notStrictEqual(c3a, c3b, "o C3 tunado gravou a mesma versão do padrão");
});
