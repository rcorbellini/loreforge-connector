// O CICLO DO DESEJO, DO LADO DO HARNESS (spec 075, US4) — trava de regressão.
//
// Desde a opção 2 (25/09), o desejo é GUARDADO pelo world e DECIDIDO pelo harness. Este
// arquivo prende as peças que decidem, uma a uma, sem modelo:
//
//   · a PROSA da intenção (desejo + passos + "Pronto quando") vai e volta sem perda;
//   · o CADERNO nunca contradiz o world (arquiva o que fechou, re-deriva o que mudou);
//   · o C8 separa progresso de ciclo, e bloqueia por exaustão (B8: 24/24);
//   · o C8D confere as quatro famílias de fim (B11: 32/32);
//   · o C3P rejeita o plano que fala consigo ou abre com o que não está aqui (caso 2);
//   · a rotina escolhe modelo e `think` no CORPO da requisição (item 79).

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "intencao-"));
process.env.LOREFORGE_CONFIG = path.join(TMP, "conector.json");
process.env.LOREFORGE_HARNESS_DIR = path.join(TMP, "harness");
process.env.LOREFORGE_LOG = "0";

const configuracao = require("../config");
const Mente = require("../mente").criarMente();
const H = require("../harness");

// --------------------------------------------------------------------------- //
// 1. A prosa da intenção
// --------------------------------------------------------------------------- //

test("a intenção em prosa vai e volta: desejo, passos e fim", () => {
  const c = H.desire.formatContent("Conseguir o Ungüento de Arnica do Obadiah",
    ["Ir até o Obadiah", "Comprar o Ungüento"], "posse de Ungüento de Arnica");
  assert.match(c, /^Conseguir o Ungüento de Arnica do Obadiah\.\n- Ir até o Obadiah\n- Comprar o Ungüento\nPronto quando: posse de Ungüento de Arnica\.$/);
  const p = H.desire.parseContent(c);
  assert.strictEqual(p.desejo, "Conseguir o Ungüento de Arnica do Obadiah");
  assert.deepStrictEqual(p.passos, ["Ir até o Obadiah", "Comprar o Ungüento"]);
  assert.strictEqual(p.fim, "posse de Ungüento de Arnica");
});

test("fim 'nenhum' não vira linha de 'Pronto quando' — fecha por vontade", () => {
  const c = H.desire.formatContent("Fazer as pazes com a Elga", ["Falar com a Elga"], "nenhum");
  assert.ok(!/Pronto quando/.test(c));
});

test("a intenção ANTIGA (spec 073, sem 'Pronto quando') ainda é lida — o pronto_quando legado vira o fim", () => {
  const nb = new H.desire.Notebook("legado");
  const d = nb.sync([{ id: "int-9", status: "ativa", pronto_quando: "hunger",
                       content: "Matar minha fome.\n- pegar o pão\n- comer o pão" }]);
  assert.deepStrictEqual(d.passos, ["pegar o pão", "comer o pão"]);
  assert.strictEqual(d.fim.familia, "necessidade");
  assert.strictEqual(d.fim.fonte, "prosa");   // o legado 'hunger' é traduzido para a família
});

// --------------------------------------------------------------------------- //
// 2. O caderno nunca contradiz o world
// --------------------------------------------------------------------------- //

test("o caderno ARQUIVA o desejo que o world não tem mais como ativo", () => {
  const nb = new H.desire.Notebook("arquiva");
  nb.sync([{ id: "int-1", status: "ativa", content: "A.\n- x" }]);
  nb.sync([]);
  assert.strictEqual(nb.ativo(), null);
  assert.ok(nb.dados.arquivados["int-1"]);
});

test("o caderno RE-DERIVA passos e zera o passo quando o jogador edita o content", () => {
  const nb = new H.desire.Notebook("edita");
  let d = nb.sync([{ id: "int-2", status: "ativa", content: "A.\n- x\n- y" }]);
  d.passo_atual = 1;
  nb.salvar();
  d = nb.sync([{ id: "int-2", status: "ativa", content: "A.\n- z" }]);
  assert.deepStrictEqual(d.passos, ["z"]);
  assert.strictEqual(d.passo_atual, 0);
});

test("o caderno SOBREVIVE ao processo (arquivo 0600) — e sem ele, re-deriva do world", () => {
  const a = new H.desire.Notebook("persiste");
  a.sync([{ id: "int-3", status: "ativa", content: "A.\n- x\n- y" }]);
  a.get("int-3").passo_atual = 1;
  a.salvar();
  const b = new H.desire.Notebook("persiste");
  assert.strictEqual(b.get("int-3").passo_atual, 1);
  const arq = fs.readdirSync(process.env.LOREFORGE_HARNESS_DIR).find((f) => f.startsWith("persiste"));
  const modo = fs.statSync(path.join(process.env.LOREFORGE_HARNESS_DIR, arq)).mode & 0o777;
  assert.strictEqual(modo, 0o600);
});

// --------------------------------------------------------------------------- //
// 3. C8 — andou? (B8)
// --------------------------------------------------------------------------- //

const cfg = { harness: { abordagens: 3, repeticoes: 3 } };

test("C8: estado NOVO é progresso; voltar a um estado já visto é CICLO, não progresso", () => {
  const s = H.progress.newStep("E0");
  assert.strictEqual(H.progress.after(s, { tool: "take", args: { item: "a" }, aceita: true, estadoDepois: "E1", cfg }).veredito, "progresso");
  assert.strictEqual(H.progress.after(s, { tool: "drop", args: { item: "a" }, aceita: true, estadoDepois: "E0", cfg }).veredito, "sem_progresso");
});

test("C8: três abordagens DISTINTAS sem progresso → BLOCKED", () => {
  const s = H.progress.newStep("E0");
  for (const [t, a] of [["ask_about", "x"], ["ask_directions", "y"], ["recognize", "z"]]) {
    var v = H.progress.after(s, { tool: t, args: { alvo: a }, aceita: false, recusa: `não (${a})`, estadoDepois: "E0", cfg });
  }
  assert.deepStrictEqual(v, { veredito: "blocked", motivo: "abordagens" });
});

test("C8: repetir o que JÁ FALHOU no mesmo estado é BLOCKED antes de ir ao mundo (o wake_up do Draven)", () => {
  const s = H.progress.newStep("E0");
  H.progress.after(s, { tool: "wake_up", args: {}, aceita: false, recusa: "dorme fundo", estadoDepois: "E0", cfg });
  assert.deepStrictEqual(H.progress.before(s, "wake_up", {}), { bloqueio: "repeticao" });
});

test("C8: SABER NOVO é progresso mesmo sem estado novo — e o 'não sei' não é", () => {
  const antes = { self: { memories: [{ id: "m1" }] } };
  const ouvida = { self: { memories: [{ id: "m1" }, { id: "m2", event: "hearsay_reconto", heard_from: "bram" }] } };
  const propria = { self: { memories: [{ id: "m1" }, { id: "m3", event: "unanswered" }] } };
  const chegou = { self: { memories: [{ id: "m1" }, { id: "m4", event: "witness_arrival" }] } };
  assert.strictEqual(H.progress.newKnowledge(antes, ouvida).length, 1);
  assert.strictEqual(H.progress.newKnowledge(antes, propria).length, 0);
  assert.strictEqual(H.progress.newKnowledge(antes, chegou).length, 0, "gente chegando não é saber");
});

test("C8: TEIMOSIA com estado novo (a Petrila acusando 8×) — o teto de verbo+alvo pega", () => {
  const s = H.progress.newStep("E0");
  let v;
  for (let i = 1; i <= 3; i++) {
    v = H.progress.after(s, { tool: "accuse", args: { alvo: "mira" }, aceita: true, estadoDepois: `E${i}`, cfg });
  }
  assert.deepStrictEqual(v, { veredito: "blocked", motivo: "teimosia" });
});

test("C8: a assinatura de estado IGNORA `status.action` (toda ação o reescreve — B7)", () => {
  const a = { self: { status: { action: "espera" }, inventory: [] }, scene: { place: { id: "p" }, items: [] } };
  const b = { self: { status: { action: "come" }, inventory: [] }, scene: { place: { id: "p" }, items: [] } };
  assert.strictEqual(H.progress.stateSignature(a), H.progress.stateSignature(b));
});

test("C8: o teto de custo do desejo (FR-009b)", () => {
  assert.strictEqual(H.progress.overBudget(9000, { harness: { tetoTokensDesejo: 8000 } }), true);
  assert.strictEqual(H.progress.overBudget(100, { harness: { tetoTokensDesejo: 8000 } }), false);
});

// --------------------------------------------------------------------------- //
// 4. C8D — acabou? (B11)
// --------------------------------------------------------------------------- //

const CTX = {
  self: { inventory: [{ id: "unguento", name: "Ungüento de Arnica" }], needs: { hunger: "sem fome", thirst: "com sede" },
          memories: [{ summary: "Bram me contou que foi o Nuno.", involved: ["nuno"] }], known_elsewhere: [{ id: "nuno", name: "Nuno" }] },
  scene: { place: { id: "taverna", name: "Taverna do Gancho" }, characters: [] },
};

test("C8D: as quatro famílias conferidas por regra", () => {
  const f = (t) => H.ending.isDone(H.ending.extractEnding(t), CTX);
  assert.strictEqual(f("posse de Ungüento de Arnica"), true);
  assert.strictEqual(f("posse de Faca de Mercador"), false);
  assert.strictEqual(f("estar em Taverna do Gancho"), true);
  assert.strictEqual(f("estar no Cais Velho"), false);
  assert.strictEqual(f("fome saciada"), true);
  assert.strictEqual(f("sede saciada"), false);
  assert.strictEqual(f("lembrança sobre Nuno"), true);
  assert.strictEqual(f("nenhum"), null);
});

test("C8D: EM TRÂNSITO não se está em lugar nenhum — o fim de lugar espera a chegada", () => {
  const viajando = { ...CTX, self: { ...CTX.self, transit: { to_id: "taverna" } } };
  assert.strictEqual(H.ending.isDone(H.ending.extractEnding("estar em Taverna do Gancho"), viajando), false);
});

// --------------------------------------------------------------------------- //
// 5. C3P — o plano possível agora (caso 2)
// --------------------------------------------------------------------------- //

test("C3P: planejar falar CONSIGO MESMA é rejeitado (a Mira e a Mira)", () => {
  const ctx = { self: { name: "Mira, a Vigia da Praça", inventory: [] },
                scene: { characters: [{ id: "mira", name: "Mira, a Vigia da Praça" }, { id: "hulda", name: "Hulda" }],
                         items: [], objects: [], exits: [] } };
  const idx = H.scene.sceneIndex(ctx);
  const p = H.plan.validatePlan(["Falar com Mira sobre o Pé de Cabra", "Perguntar à Hulda"], idx, ctx);
  assert.ok(p.some((x) => /você mesmo/.test(x)));
});

test("C3P: o 1º passo tem de usar o que está AQUI — ou ser um passo de descobrir", () => {
  const ctx = { self: { id: "t", name: "Torvin", inventory: [] },
                scene: { characters: [{ id: "obadiah", name: "Obadiah, o Mascate" }], items: [], objects: [], exits: [] } };
  const idx = H.scene.sceneIndex(ctx);
  assert.deepStrictEqual(H.plan.validatePlan(["Perguntar ao Obadiah o preço", "Comprar"], idx, ctx), []);
  assert.deepStrictEqual(H.plan.validatePlan(["Descobrir onde fica a forja", "Ir lá"], idx, ctx), []);
  assert.ok(H.plan.validatePlan(["Aproximar-se sem chamar atenção", "Comprar"], idx, ctx).length);
});

test("C3P: a resposta do modelo vira passos e fim", () => {
  const r = H.plan.parsePlanReply("DESEJO: matar a sede\nPASSOS:\n- Beber do Cantil\n- Descansar\nFIM: sede saciada");
  assert.deepStrictEqual(r.passos, ["Beber do Cantil", "Descansar"]);
  assert.strictEqual(r.fim, "sede saciada");
});

// --------------------------------------------------------------------------- //
// 6. A ROTINA ESCOLHE MODELO E OPÇÕES — `think` viaja no CORPO (item 79)
// --------------------------------------------------------------------------- //

function espia(resposta) {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, opts) => {
    chamadas.push({ url: String(url), corpo: JSON.parse((opts && opts.body) || "{}") });
    return { ok: true, headers: { get: () => "application/json" },
             json: async () => ({ message: { content: resposta }, prompt_eval_count: 10, eval_count: 5 }) };
  };
  return { chamadas, restaurar: () => { globalThis.fetch = original; } };
}

test("a rotina `planejar` manda `think:false` e o modelo DELA no corpo da requisição", async () => {
  const cfg = configuracao.carregar(true);
  assert.ok(cfg.porRotina && cfg.porRotina.planejar);
  const e = espia("- um passo");
  try { await Mente.conversar("sys", "user", { rotina: "planejar" }); } finally { e.restaurar(); }
  assert.strictEqual(e.chamadas[0].corpo.think, false);
  assert.strictEqual(e.chamadas[0].corpo.model, cfg.porRotina.planejar.model);
});

test("o `think` GERAL desce para a rotina que não declara o dela (objetivos)", async () => {
  const cfg = configuracao.carregar(true);
  assert.strictEqual(cfg.think, false, "o default geral perdeu o `think:false`");
  const e = espia("- x");
  try { await Mente.conversar("sys", "user", { rotina: "objetivos" }); } finally { e.restaurar(); }
  assert.strictEqual(e.chamadas[0].corpo.think, false);
  assert.strictEqual(e.chamadas[0].corpo.model, "qwen3:8b",
    "a Mente não está no `qwen3:8b` — o `llama3.1` é desrecomendado para ela");
  assert.ok(!("tools" in e.chamadas[0].corpo), "a conversa levou tools");
});

test("a narração STREAMADA também entra no custo do turno (o último pedaço traz a conta)", async () => {
  const original = globalThis.fetch;
  const linhas = [JSON.stringify({ message: { content: "Você " } }),
                  JSON.stringify({ message: { content: "come." }, done: true, prompt_eval_count: 300, eval_count: 20 })];
  globalThis.fetch = async () => ({ ok: true, body: new Response(linhas.join("\n") + "\n").body });
  Mente.zerarCusto();
  try {
    await Mente.narrate("comeu", { self: { name: "X" }, scene: {} }, [], [], ["comeu"], [], [], null, () => {});
  } finally { globalThis.fetch = original; }
  const c = Mente.custoDoTurno();
  assert.strictEqual(c.entrada, 300);
  assert.strictEqual(c.saida, 20);
});
