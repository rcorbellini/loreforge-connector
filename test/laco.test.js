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

// O PLANO M (spec 076) a partir da lista antiga: cada linha vira um passo ATO, sem `com`, para
// os testes que provam o laço e o resolvedor seguirem provando o mesmo; "- (nada)" vira plano
// sem passos.
function planoDeLista(texto, extra = {}) {
  const linhas = String(texto || "").split("\n").map((l) => l.trim())
    .filter((l) => /^[-*•]\s*\S/.test(l)).map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter((l) => !/^\(?\s*nada\s*\)?\.?$/i.test(l));
  return JSON.stringify({
    chain_of_thought: { condicao_fisica: "", avaliacao_de_viabilidade: extra.viabilidade || "",
      passos_do_plano: linhas.map((acao) => ({ tipo: "ato", acao, com: [], espera: "" })) },
    resposta: extra.resposta || "" });
}

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
      return planoDeLista(objetivos);
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

// --- spec 076: o plano M -------------------------------------------------------- //

function planoM(passos, { viabilidade = "", resposta = "" } = {}) {
  return JSON.stringify({ chain_of_thought: { condicao_fisica: "", avaliacao_de_viabilidade: viabilidade,
    passos_do_plano: passos }, resposta });
}

async function turnoComPlano(plano, { respostas = [], decider } = {}) {
  const mundo = mundoDe({ respostas });
  const mente = menteDe({ porRotina: { objetivos: plano } });
  const c = coletor();
  mundoDe.registrados = [];
  const reg = registroMod.criar({ mundo, cfg: { personagem: "fulano", runtime: "local", model: "x" },
                                  extensoes: extVazio(), mente });
  await lacoDe({ mundo, mente, registro: reg, emitir: c.emitir, decider }).sussurrar("faça algo");
  return { mundo, mente, eventos: c.eventos, linha: mundoDe.registrados[0] };
}

test("PLANO M (LIGAÇÃO): só o passo ATO chega ao mundo; fala e gesto ficam no registro, narrados", async () => {
  const { mundo, linha } = await turnoComPlano(planoM([
    { tipo: "gesto", acao: "Olhar a praça com calma", com: [], espera: "" },
    { tipo: "fala", acao: "Dizer que vai ajudar", com: [], espera: "" },
    { tipo: "ato", acao: "Pegar a Corda de Cânhamo", com: ["Corda de Cânhamo"], espera: "a corda na mão" },
  ]), { respostas: [{ recusado: false, texto: "", narrativa: { aconteceu: ["Fulano pegou a corda."] } }] });
  assert.deepStrictEqual(mundo.chamadas.map((c) => c.nome), ["take"], "fala ou gesto chegou ao mundo");
  assert.deepStrictEqual(linha.corpo.passos.map((p) => [p.tipo, p.desfecho]),
    [["gesto", "narrado"], ["fala", "narrado"], ["ato", "executado"]]);
  const ato = linha.corpo.passos[2];
  assert.strictEqual(ato.tool, "take");
  assert.strictEqual(ato.aceito, true);
  assert.strictEqual(ato.espera, "a corda na mão");
  assert.deepStrictEqual(ato.com, ["Corda de Cânhamo"]);
});

test("PLANO M: fora do contrato o turno FALHA honesto — nada vai ao mundo, e a tela não lê 'JSON'", async () => {
  const { mundo, eventos, linha } = await turnoComPlano("- Pegar a Corda de Cânhamo");
  assert.strictEqual(mundo.chamadas.length, 0, "o formato antigo virou ação (fallback)");
  assert.strictEqual(linha.corpo.falha.box, "C3");
  assert.match(linha.corpo.falha.erro, /JSON/);
  const erro = eventos.find((e) => e.ev === "erro");
  assert.ok(erro, "o turno quebrado não avisou o jogador");
  assert.doesNotMatch(erro.texto, /json|passos_do_plano/i, "termo de sistema na tela");
});

test("PLANO M: passo sem tipo NÃO age e sobe como defeito; plano sem passos não toca o mundo", async () => {
  const r1 = await turnoComPlano(planoM([{ acao: "Pegar a Corda de Cânhamo", com: [], espera: "" }]));
  assert.strictEqual(r1.mundo.chamadas.length, 0);
  assert.deepStrictEqual(r1.linha.corpo.passos.map((p) => p.desfecho), ["defeito"]);
  const r2 = await turnoComPlano(planoM([], { viabilidade: "Não vou.", resposta: "Nem pensar." }));
  assert.strictEqual(r2.mundo.chamadas.length, 0);
  const rac = r2.eventos.find((e) => e.ev === "objetivos");
  assert.ok(rac && /Não vou\./.test(rac.texto) && /Nem pensar\./.test(rac.texto), "o racional não subiu");
});

test("PLANO M: ATO que não acha capacidade é SEM TOOL (o sinal de tool ausente), nunca gesto", async () => {
  const { mundo, linha, mente } = await turnoComPlano(planoM([
    { tipo: "ato", acao: "Contar uma piada para distrair todo mundo", com: [], espera: "todos riem" },
  ]), { decider: deciderDe(["(nenhuma)"]) });
  assert.strictEqual(mundo.chamadas.length, 0);
  assert.deepStrictEqual(linha.corpo.passos.map((p) => p.desfecho), ["sem_tool"]);
  assert.ok(JSON.stringify(mente.ultimo || {}).includes("não havia como fazer isso ali"),
    "a narração não soube que o ato não aconteceu");
});

test("PLANO M: o racional sobe na camada visível com o tipo de cada passo em _meta", async () => {
  const { eventos } = await turnoComPlano(planoM([
    { tipo: "gesto", acao: "Olhar a corda", com: [], espera: "" },
    { tipo: "ato", acao: "Pegar a Corda de Cânhamo", com: ["Corda de Cânhamo"], espera: "a corda na mão" },
  ], { viabilidade: "Dá para pegar.", resposta: "É minha agora." }),
  { respostas: [{ recusado: false, texto: "", narrativa: { aconteceu: ["ok"] } }] });
  const rac = eventos.find((e) => e.ev === "objetivos");
  assert.strictEqual(rac.texto, "Dá para pegar.\n— Olhar a corda\n— Pegar a Corda de Cânhamo\n\"É minha agora.\"");
  assert.deepStrictEqual(rac.passos, [{ tipo: "gesto" }, { tipo: "ato" }]);
});

test("VEZ DO DESEJO (spec 077): o M2 repensa o desejo e só o ATO anda; os passos sobem na ordem", async () => {
  const ctx = cenaCom({ self: { id: "t3", intentions: [{ id: "int-3", status: "ativa",
    content: "Ter algo para amarrar.\n- Conseguir alguma coisa que sirva de amarra\nPronto quando: posse de Corda de Cânhamo." }] } });
  const depois = cenaCom({ self: { id: "t3", inventory: [{ id: "corda", name: "Corda de Cânhamo" }],
                                   intentions: ctx.self.intentions } });
  const mundo = mundoDe({ respostas: [{ recusado: false, texto: "", narrativa: { aconteceu: ["Pegou a corda."] } }],
                          contextos: [ctx, depois] });
  mundo.personagem = "t3";
  const mente = menteDe({ porRotina: { objetivos: planoM([
    { tipo: "gesto", acao: "Olhar em volta", com: [], espera: "" },
    { tipo: "ato", acao: "Pegar a Corda de Cânhamo", com: ["Corda de Cânhamo"], espera: "a corda na mão" },
  ]) } });
  mundoDe.registrados = [];
  const reg = registroMod.criar({ mundo, cfg: { personagem: "t3", runtime: "local", model: "x" },
                                  extensoes: extVazio(), mente });
  await lacoDe({ mundo, mente, registro: reg }).talvezAgirSozinho();
  assert.deepStrictEqual(mundo.chamadas.map((x) => x.nome), ["take"]);
  const linha = mundoDe.registrados[0];
  assert.deepStrictEqual(linha.corpo.passos.map((p) => [p.tipo, p.desfecho]), [["gesto", "narrado"], ["ato", "executado"]]);
});

// --- spec 077: o ciclo do pedido ----------------------------------------------------- //
//
// Um mundo que GUARDA as intenções e muda de cena: a vez seguinte enxerga o que a anterior fez.

function mundoVivo({ personagem, cenas, inicial, respostas = [] }) {
  const ativas = [];
  const ops = [];
  const chamadas = [];
  let atual = inicial;
  let seq = 0;
  const m = {
    personagem, chamadas, ops, ativas, turnoId: null,
    get cena() { return atual; },
    vaiPara(c) { atual = c; },
    conhece: (nome) => TOOLS.some((t) => t.name === nome),
    listarCapacidades: async () => TOOLS,
    descricaoDe: (nome) => (TOOLS.find((t) => t.name === nome) || {}).description || "",
    contexto: async () => {
      const c = JSON.parse(JSON.stringify(cenas[atual]));
      c.self.intentions = ativas.map((i) => ({ ...i }));
      return c;
    },
    chamarCapacidade: async (nome, args) => {
      chamadas.push({ nome, args });
      const r = respostas.shift();
      if (!r) throw new Error("o teste não previu mais chamadas");
      if (r._cena) atual = r._cena;
      const { _cena, ...resto } = r;
      return resto;
    },
    criarIntencao: async (content) => {
      const id = `int-${1790000000000 + (++seq)}`;
      ativas.push({ id, status: "ativa", content });
      ops.push({ op: "create", id, content });
      return { ok: true, id };
    },
    atualizarIntencao: async (id, content) => {
      const i = ativas.find((x) => x.id === id);
      if (i) i.content = content;
      ops.push({ op: "update", id, content });
      return { ok: true };
    },
    fecharIntencao: async (id, status, o) => {
      const k = ativas.findIndex((x) => x.id === id);
      if (k >= 0) ativas.splice(k, 1);
      ops.push({ op: "close", id, status, ...(o || {}) });
      return { ok: true };
    },
    registrar: async (l) => { (m.registrados = m.registrados || []).push(l); return true; },
  };
  return m;
}

function planoM2(passos, { depois = [], pronto = "nenhum", viabilidade = "", resposta = "" } = {}) {
  return JSON.stringify({ chain_of_thought: { avaliacao_de_viabilidade: viabilidade, passos_do_plano: passos,
    depois, pronto_quando: pronto }, resposta });
}

// a Mente devolve os planos NA ORDEM, um por chamada da rotina "objetivos"
function menteEmFila(planos, extra = {}) {
  const fila = planos.slice();
  return menteDe({ porRotina: { objetivos: () => fila.shift(), ...extra } });
}

function lacoComPensar({ mundo, mente, emitir, pensar = true }) {
  const reg = registroMod.criar({ mundo, cfg: { personagem: mundo.personagem, runtime: "local", model: "x" },
                                  extensoes: extVazio(), mente });
  return new Laco({ mundo, mente, decider: deciderDe(), extensoes: extVazio(), registro: reg,
                    emitir: emitir || (() => {}), pensar });
}

const ACEITO = (frase, cena) => ({ recusado: false, texto: "", narrativa: { aconteceu: [frase] }, ...(cena ? { _cena: cena } : {}) });
const RECUSADO = (motivo) => ({ recusado: true, texto: motivo, narrativa: {} });
const NOMES_DE_TOOL = /\b(take|drink|recognize|sleep|enter_route|travel_to)\b/;

function cenasDoFulano(id) {
  const base = cenaCom({ self: { id, needs: { thirst: "com sede" } } });
  const comCorda = cenaCom({ self: { id, needs: { thirst: "com sede" }, inventory: [{ id: "corda", name: "Corda de Cânhamo" }] } });
  const saciado = cenaCom({ self: { id, needs: { thirst: "sem sede" }, inventory: [{ id: "corda", name: "Corda de Cânhamo" }] } });
  const outroLugar = cenaCom({ self: { id, needs: { thirst: "com sede" } }, scene: { place: { id: "taverna", name: "Taverna" } } });
  return { base, comCorda, saciado, outroLugar };
}

test("PEDIDO (LIGAÇÃO): o sussurro que deixa algo para depois ABRE o pedido; a vez seguinte, com a autonomia DESLIGADA, o repensa com o andamento e o fato FECHA", async () => {
  const mundo = mundoVivo({ personagem: "p077a", cenas: cenasDoFulano("p077a"), inicial: "base",
    respostas: [ACEITO("Fulano pegou a corda.", "comCorda"), ACEITO("Fulano bebeu do cantil.", "saciado")] });
  const mente = menteEmFila([
    planoM2([{ tipo: "ato", acao: "Pegar a Corda de Cânhamo", com: ["Corda de Cânhamo"], espera: "a corda na mão" }],
            { depois: ["beber do Cantil de Água"], pronto: "sede saciada" }),
    planoM2([{ tipo: "ato", acao: "Beber do Cantil de Água", com: ["Cantil de Água"], espera: "sede saciada" }],
            { depois: [], pronto: "sede saciada" }),
  ]);
  const laco = lacoComPensar({ mundo, mente });
  await laco.sussurrar("mate a sede");
  const criado = mundo.ops.find((o) => o.op === "create");
  assert.ok(criado, "o pedido não abriu");
  assert.strictEqual(criado.content, "mate a sede.\n- beber do Cantil de Água\nPronto quando: sede saciada.");
  const nb = laco._notebook();
  assert.strictEqual(nb.get(criado.id).origem, "pedido");
  assert.strictEqual(mundo.registrados[0].corpo.pedido.desfecho, "abriu");
  assert.ok(laco.temPedidoAberto(), "a fila não saberia do pedido aberto");

  await laco.talvezAgirSozinho({ autonomia: false });
  const userVez2 = mente.conversas[mente.conversas.length - 1].user;
  assert.match(userVez2, /INSTRUÇÃO: mate a sede/);
  assert.match(userVez2, /O QUE ELE JÁ FEZ POR ESTE PEDIDO:\n- Pegar a Corda de Cânhamo → deu certo: Fulano pegou a corda\./);
  assert.match(userVez2, /O QUE FALTAVA:\n- beber do Cantil de Água/);
  assert.doesNotMatch(userVez2, NOMES_DE_TOOL, "nome de capacidade desceu à Mente no andamento");
  assert.ok(mundo.ops.some((o) => o.op === "close" && o.id === criado.id && o.status === "concluida"));
  assert.strictEqual(mundo.registrados[1].corpo.pedido.estado, "cumprido");
  assert.ok((mente.ultimo.aconteceu || []).includes("a sede dele passou"),
    "o fechamento não foi narrado pelo FATO do mundo");
  assert.ok(!(mente.ultimo.aconteceu || []).some((f) => /mate a sede/.test(f)),
    "a narração recebeu o imperativo do jogador em vez do fato");
  assert.ok(nb.dados.arquivados[criado.id].tokens_pagos > 0, "o custo das vezes não entrou no teto do pedido");
  assert.ok(!laco.temPedidoAberto());
});

test("PEDIDO: com o pensar DESLIGADO nada é carregado, nem o que o plano deixou para depois", async () => {
  const mundo = mundoVivo({ personagem: "p077b", cenas: cenasDoFulano("p077b"), inicial: "base",
    respostas: [ACEITO("Fulano pegou a corda.", "comCorda")] });
  const mente = menteEmFila([planoM2([{ tipo: "ato", acao: "Pegar a Corda de Cânhamo", com: [], espera: "" }],
                                     { depois: ["beber do Cantil de Água"], pronto: "sede saciada" })]);
  const laco = lacoComPensar({ mundo, mente, pensar: false });
  await laco.sussurrar("mate a sede");
  assert.strictEqual(mundo.ops.length, 0, "o pedido abriu com o pensar desligado");
  assert.strictEqual(mundo.registrados[0].corpo.pedido, undefined);
});

test("RECUSA: o plano sem nada para depois não abre pedido", async () => {
  const mundo = mundoVivo({ personagem: "p077c", cenas: cenasDoFulano("p077c"), inicial: "base" });
  const mente = menteEmFila([planoM2([{ tipo: "fala", acao: "Dizer que não vai", com: [], espera: "" }],
                                     { depois: [], pronto: "nenhum", viabilidade: "Não vou matar dragão." })]);
  const laco = lacoComPensar({ mundo, mente });
  await laco.sussurrar("mate um dragão");
  assert.strictEqual(mundo.ops.length, 0);
});

test("OS ATOS PARAM no primeiro deslocamento aceito (o resto era da cena velha) e na primeira recusa; o que sobe sem ir ao mundo NÃO para", async () => {
  const mov = mundoVivo({ personagem: "p077d", cenas: cenasDoFulano("p077d"), inicial: "base",
    respostas: [ACEITO("Fulano pegou a corda e saiu.", "outroLugar")] });
  mundoDe.registrados = [];
  const m1 = menteEmFila([planoM2([
    { tipo: "ato", acao: "Pegar a Corda de Cânhamo", com: ["Corda de Cânhamo"], espera: "" },
    { tipo: "ato", acao: "Beber do Cantil de Água", com: ["Cantil de Água"], espera: "" }])]);
  await lacoComPensar({ mundo: mov, mente: m1, pensar: false }).sussurrar("faça algo");
  assert.deepStrictEqual(mov.chamadas.map((c) => c.nome), ["take"], "um ato da cena velha foi ao mundo");
  const p1 = mov.registrados[0].corpo.passos;
  assert.deepStrictEqual(p1.map((p) => [p.desfecho, p.motivo || null]), [["executado", null], ["nao_tentado", "lugar"]]);

  const rec = mundoVivo({ personagem: "p077e", cenas: cenasDoFulano("p077e"), inicial: "base",
    respostas: [RECUSADO("a corda está presa no poste")] });
  const m2 = menteEmFila([planoM2([
    { tipo: "ato", acao: "Pegar a Corda de Cânhamo", com: ["Corda de Cânhamo"], espera: "" },
    { tipo: "ato", acao: "Beber do Cantil de Água", com: ["Cantil de Água"], espera: "" }])]);
  await lacoComPensar({ mundo: rec, mente: m2, pensar: false }).sussurrar("faça algo");
  assert.deepStrictEqual(rec.chamadas.map((c) => c.nome), ["take"]);
  assert.strictEqual(rec.registrados[0].corpo.passos[1].motivo, "recusa");

  const sobe = mundoVivo({ personagem: "p077f", cenas: cenasDoFulano("p077f"), inicial: "base",
    respostas: [ACEITO("Fulano pegou a corda.", "comCorda")] });
  const m3 = menteEmFila([planoM2([
    { tipo: "ato", acao: "Contar uma piada para distrair todo mundo", com: [], espera: "todos riem" },
    { tipo: "ato", acao: "Pegar a Corda de Cânhamo", com: ["Corda de Cânhamo"], espera: "" }])]);
  const decider = deciderDe(["(nenhuma)", "take"]);
  const reg = registroMod.criar({ mundo: sobe, cfg: { personagem: "p077f", runtime: "local", model: "x" },
                                  extensoes: extVazio(), mente: m3 });
  await new Laco({ mundo: sobe, mente: m3, decider, extensoes: extVazio(), registro: reg, emitir: () => {} })
    .sussurrar("faça algo");
  assert.deepStrictEqual(sobe.chamadas.map((c) => c.nome), ["take"], "a subida sem mundo parou o ato seguinte");
});

test("O FATO que já era verdade quando o plano nasceu NÃO fecha o pedido (o qwen e o peixe que o Sorin carregava)", async () => {
  const mundo = mundoVivo({ personagem: "p077g", cenas: cenasDoFulano("p077g"), inicial: "comCorda",
    respostas: [ACEITO("Fulano olhou a corda.")] });
  const mente = menteEmFila([planoM2([{ tipo: "ato", acao: "Olhar a Corda de Cânhamo", com: ["Corda de Cânhamo"], espera: "" }],
                                     { depois: ["beber do Cantil de Água"], pronto: "posse de Corda de Cânhamo" })]);
  const laco = lacoComPensar({ mundo, mente });
  await laco.sussurrar("guarde a corda e beba do cantil");
  assert.ok(mundo.ops.some((o) => o.op === "create"), "o pedido não abriu");
  assert.ok(!mundo.ops.some((o) => o.op === "close"), "o fato que já era verdade fechou o pedido");
  assert.strictEqual(mundo.registrados[0].corpo.pedido.fato.motivo, "já era verdade");
});

test("SUSSURRO com pedido aberto: o plano recebe o pedido anterior e o que já foi feito, SEM o que faltava; 'nada a carregar' FECHA sem lembrança", async () => {
  const mundo = mundoVivo({ personagem: "p077h", cenas: cenasDoFulano("p077h"), inicial: "base",
    respostas: [ACEITO("Fulano pegou a corda.", "comCorda")] });
  const mente = menteEmFila([
    planoM2([{ tipo: "ato", acao: "Pegar a Corda de Cânhamo", com: ["Corda de Cânhamo"], espera: "" }],
            { depois: ["beber do Cantil de Água"], pronto: "sede saciada" }),
    planoM2([{ tipo: "fala", acao: "Dizer que tudo bem", com: [], espera: "" }], { depois: [], pronto: "nenhum" }),
  ]);
  const laco = lacoComPensar({ mundo, mente });
  await laco.sussurrar("mate a sede");
  const id = mundo.ops.find((o) => o.op === "create").id;
  await laco.sussurrar("esquece isso");
  const user = mente.conversas[mente.conversas.length - 1].user;
  assert.match(user, /INSTRUÇÃO: esquece isso\n\nANTES, O JOGADOR TINHA PEDIDO: mate a sede\n\nO QUE ELE JÁ FEZ POR ESTE PEDIDO:/);
  assert.doesNotMatch(user, /O QUE FALTAVA/, "o resto do plano velho foi junto (medido: puxa o pedido velho)");
  const close = mundo.ops.find((o) => o.op === "close");
  assert.deepStrictEqual([close.id, close.status, !!close.lembrar], [id, "abandonada", false]);
  assert.strictEqual(mundo.registrados[1].corpo.pedido.estado, "cancelado");
});

test("SUSSURRO com pedido aberto que AJUSTA: as palavras viram uma sequência e o pedido é regravado", async () => {
  const mundo = mundoVivo({ personagem: "p077i", cenas: cenasDoFulano("p077i"), inicial: "base",
    respostas: [ACEITO("Fulano pegou a corda.", "comCorda")] });
  const mente = menteEmFila([
    planoM2([{ tipo: "ato", acao: "Pegar a Corda de Cânhamo", com: ["Corda de Cânhamo"], espera: "" }],
            { depois: ["beber do Cantil de Água"], pronto: "sede saciada" }),
    planoM2([{ tipo: "fala", acao: "Dizer que vai beber devagar", com: [], espera: "" }],
            { depois: ["beber do Cantil de Água devagar"], pronto: "sede saciada" }),
  ]);
  const laco = lacoComPensar({ mundo, mente });
  await laco.sussurrar("mate a sede");
  await laco.sussurrar("beba devagar");
  const upd = mundo.ops.filter((o) => o.op === "update").pop();
  assert.strictEqual(upd.content, "mate a sede.\nbeba devagar.\n- beber do Cantil de Água devagar\nPronto quando: sede saciada.");
});

test("TRAVAMENTO: duas vezes sem avanço abrem o ponto de intervenção, em palavras de mundo; a janela espera a voz do jogador SEM pagar a Mente", async () => {
  const c = coletor();
  const mundo = mundoVivo({ personagem: "p077j", cenas: cenasDoFulano("p077j"), inicial: "base",
    respostas: [RECUSADO("a corda está presa no poste"), RECUSADO("a corda está presa no poste")] });
  const preso = (n) => planoM2([{ tipo: "ato", acao: "Pegar a Corda de Cânhamo", com: ["Corda de Cânhamo"], espera: "" }],
                              { depois: ["amarrar o barco"], pronto: "posse de Corda de Cânhamo" });
  const mente = menteEmFila([preso(1), preso(2)]);
  const laco = lacoComPensar({ mundo, mente, emitir: c.emitir });
  await laco.sussurrar("amarre o barco com a corda");
  await laco.talvezAgirSozinho({ autonomia: false });
  const b = c.eventos.find((e) => e.ev === "bloqueio");
  assert.ok(b, "duas vezes sem avanço e nenhum ponto de intervenção");
  assert.match(b.texto, /empacou no pedido “amarre o barco com a corda”: a corda está presa no poste/);
  assert.doesNotMatch(b.texto, NOMES_DE_TOOL);
  const pagas = mente.conversas.length;
  await laco.talvezAgirSozinho({ autonomia: false });
  assert.strictEqual(mente.conversas.length, pagas, "a janela de intervenção pagou a Mente");
  assert.strictEqual(mundo.registrados[mundo.registrados.length - 1].corpo.pedido.desfecho, "esperando");
});

test("TETO: o pedido que chega ao teto de vezes, ou de custo, é largado COM a lembrança da desistência", async () => {
  const H = require("../harness");
  for (const [pers, marcar] of [["p077k", (nb, id) => { nb.get(id).vezes = 12; nb.salvar(); }],
                                ["p077l", (nb, id) => nb.pay(id, 60000)]]) {
    const c = coletor();
    const mundo = mundoVivo({ personagem: pers, cenas: cenasDoFulano(pers), inicial: "base" });
    await mundo.criarIntencao("mate a sede.\n- beber do Cantil de Água\nPronto quando: sede saciada.");
    const id = mundo.ativas[0].id;
    const nb = new H.desire.Notebook(pers);
    nb.sync(mundo.ativas);
    nb.marcarOrigem(id, "pedido");
    marcar(nb, id);
    const mente = menteEmFila([]);
    const laco = lacoComPensar({ mundo, mente, emitir: c.emitir });
    laco._nb = null;
    await laco.talvezAgirSozinho({ autonomia: false });
    const close = mundo.ops.find((o) => o.op === "close");
    assert.ok(close && close.status === "abandonada" && close.lembrar === true, `${pers}: o teto não largou com lembrança`);
    assert.strictEqual(mente.conversas.length, 0);
    assert.ok(c.eventos.some((e) => e.ev === "sistema" && /desiste do pedido “mate a sede”/.test(e.texto)));
  }
});

test("DESISTÊNCIA dele (vez sem sussurro, plano sem depois e sem ato) larga COM lembrança; VONTADE (depois vazio, fato nenhum, depois de agir) fecha cumprido", async () => {
  const H = require("../harness");
  const abrir = async (pers, inicial, respostas) => {
    const mundo = mundoVivo({ personagem: pers, cenas: cenasDoFulano(pers), inicial, respostas });
    await mundo.criarIntencao("arrume a praça.\n- juntar a corda");
    const nb = new H.desire.Notebook(pers);
    nb.sync(mundo.ativas);
    nb.marcarOrigem(mundo.ativas[0].id, "pedido");
    return mundo;
  };
  const m1 = await abrir("p077m", "base");
  await lacoComPensar({ mundo: m1, mente: menteEmFila([planoM2([{ tipo: "fala", acao: "Dizer que cansou", com: [], espera: "" }])]) })
    .talvezAgirSozinho({ autonomia: false });
  const c1 = m1.ops.find((o) => o.op === "close");
  assert.deepStrictEqual([c1.status, c1.lembrar], ["abandonada", true]);

  const m2 = await abrir("p077n", "base", [ACEITO("Fulano pegou a corda.", "comCorda")]);
  await lacoComPensar({ mundo: m2, mente: menteEmFila([planoM2([{ tipo: "ato", acao: "Pegar a Corda de Cânhamo", com: ["Corda de Cânhamo"], espera: "" }])]) })
    .talvezAgirSozinho({ autonomia: false });
  const c2 = m2.ops.find((o) => o.op === "close");
  assert.strictEqual(c2.status, "concluida");
  assert.strictEqual(m2.registrados[0].corpo.pedido.estado, "vontade");
});

test("AUTONOMIA DESLIGADA: o desejo que ELE inventou não anda, e nada é pago; ligada, sem desejo, o QUERER faz nascer um desejo só com o texto", async () => {
  const H = require("../harness");
  const mundo = mundoVivo({ personagem: "p077o", cenas: cenasDoFulano("p077o"), inicial: "base" });
  await mundo.criarIntencao("Quero comer alguma coisa.");
  new H.desire.Notebook("p077o").sync(mundo.ativas);
  const mente = menteEmFila([]);
  await lacoComPensar({ mundo, mente }).talvezAgirSozinho({ autonomia: false });
  assert.strictEqual(mente.conversas.length, 0);
  assert.strictEqual(mundo.registrados[0].corpo.descartado, "sem_pedido");

  const vazio = mundoVivo({ personagem: "p077p", cenas: cenasDoFulano("p077p"), inicial: "base" });
  const m2 = menteEmFila([], { querer: "Quero matar a sede" });
  await lacoComPensar({ mundo: vazio, mente: m2 }).talvezAgirSozinho({ autonomia: true });
  const criado = vazio.ops.find((o) => o.op === "create");
  assert.strictEqual(criado.content, "Quero matar a sede.");
  assert.deepStrictEqual(m2.conversas.map((x) => x.opts.rotina), ["querer"], "o planejador antigo ainda é chamado");
});

test("O TETO DE CUSTO é do pedido inteiro (M2 a cada vez): 9 mil tokens não largam mais — o de 8 mil largava na 3ª vez", async () => {
  const H = require("../harness");
  assert.strictEqual(H.progress.overBudget(9000, {}), false);
  assert.strictEqual(H.progress.overBudget(60000, {}), true);
  assert.strictEqual(H.progress.overBudget(9000, { harness: { tetoTokensDesejo: 8000 } }), true,
    "a mesa que já declarou o teto antigo perdeu o dela");
});

test("PLANO FORA DO CONTRATO numa vez do meio: a vez falha honesta e CONTA como vez sem avanço (não prende o pedido)", async () => {
  const H = require("../harness");
  const mundo = mundoVivo({ personagem: "p077q", cenas: cenasDoFulano("p077q"), inicial: "base" });
  await mundo.criarIntencao("mate a sede.\n- beber do Cantil de Água\nPronto quando: sede saciada.");
  const id = mundo.ativas[0].id;
  const nb0 = new H.desire.Notebook("p077q");
  nb0.sync(mundo.ativas);
  nb0.marcarOrigem(id, "pedido");
  const c = coletor();
  const laco = lacoComPensar({ mundo, mente: menteEmFila(["isto não é JSON", "nem isto"]), emitir: c.emitir });
  await laco.talvezAgirSozinho({ autonomia: false });
  assert.strictEqual(laco._notebook().get(id).vezes, 1);
  assert.strictEqual(laco._notebook().get(id).vezes_sem_avanco, 1);
  await laco.talvezAgirSozinho({ autonomia: false });
  assert.ok(c.eventos.some((e) => e.ev === "bloqueio"), "duas vezes fora do contrato e nenhuma intervenção");
  assert.ok(c.eventos.some((e) => e.ev === "erro"), "a vez fora do contrato não falhou honesta");
});

test("PRINCÍPIO V: o que o mundo devolve como objeto (o reconhecimento) NUNCA vira JSON na tela", () => {
  const laco = lacoComPensar({ mundo: mundoVivo({ personagem: "p077r", cenas: cenasDoFulano("p077r"), inicial: "base" }),
                               mente: menteEmFila([]) });
  const txt = laco._desfechoEmPalavras({ ok: true, reconhecimentos: [{ id: "bram-pescador", name: "Bram, o Pescador",
    kind: "character", posse: { de: null, grau: "ausente" }, prosa: "Bram fala pouco." }] });
  assert.strictEqual(txt, "Bram, o Pescador");
  assert.doesNotMatch(txt, /[{}"]|bram-pescador|posse/);
});
