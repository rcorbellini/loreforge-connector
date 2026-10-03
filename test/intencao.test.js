// O CICLO DO DESEJO, DO LADO DO HARNESS (spec 075, US4) — trava de regressão.
//
// Desde a opção 2 (25/09), o desejo é GUARDADO pelo world e DECIDIDO pelo harness. Este
// arquivo prende as peças que decidem, uma a uma, sem modelo:
//
//   · a PROSA da intenção (desejo + passos + "Pronto quando") vai e volta sem perda;
//   · o CADERNO nunca contradiz o world (arquiva o que fechou, re-deriva o que mudou);
//   · o C8 separa progresso de ciclo, e bloqueia por exaustão (B8: 24/24);
//   · o C8D confere as quatro famílias de fim (B11: 32/32);
//   · a prosa do PEDIDO (spec 077): as palavras do jogador, o que falta e o fato que fecha;
//   · o fato de um plano: aterrado ao pedido, e nunca o que já era verdade;
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

test("o caderno RE-DERIVA o que falta quando o jogador edita a prosa — guarda a origem e as vezes, desfaz o travamento", () => {
  const nb = new H.desire.Notebook("edita");
  let d = nb.sync([{ id: "int-2", status: "ativa", content: "A.\n- x\n- y" }]);
  nb.marcarOrigem("int-2", "pedido");
  nb.contarVez("int-2", false);
  d.bloqueio = { motivo: "sem_avanco" };
  d.intervencao = { ticks: 0 };
  nb.salvar();
  d = nb.sync([{ id: "int-2", status: "ativa", content: "A.\nB.\n- z" }]);
  assert.deepStrictEqual(d.passos, ["z"]);
  assert.deepStrictEqual(d.palavras, ["A", "B"]);
  assert.strictEqual(d.origem, "pedido");
  assert.strictEqual(d.vezes, 1);
  assert.strictEqual(d.bloqueio, null);
  assert.strictEqual(d.intervencao, null);
});

test("o caderno SOBREVIVE ao processo (arquivo 0600) — e sem ele, re-deriva do world", () => {
  const a = new H.desire.Notebook("persiste");
  a.sync([{ id: "int-3", status: "ativa", content: "A.\n- x\n- y" }]);
  a.contarVez("int-3", true);
  a.marcarOrigem("int-3", "pedido");
  const b = new H.desire.Notebook("persiste");
  assert.strictEqual(b.get("int-3").vezes, 1);
  assert.strictEqual(b.get("int-3").origem, "pedido");
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

test("C8: o teto de custo do PEDIDO (FR-009b da 075; spec 077) é o da mesa, e o padrão cabe ~12 vezes do M2", () => {
  assert.strictEqual(H.progress.overBudget(9000, { harness: { tetoTokensPedido: 8000 } }), true);
  assert.strictEqual(H.progress.overBudget(100, { harness: { tetoTokensPedido: 8000 } }), false);
  assert.strictEqual(H.progress.overBudget(35000, {}), false, "12 vezes do M2 (~2,9 mil cada) estouram o padrão");
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
// 5. O PEDIDO em prosa (spec 077)
// --------------------------------------------------------------------------- //

test("o pedido em prosa: as palavras do jogador (uma linha por sussurro), o que falta e o fato", () => {
  const c = H.desire.formatContent(["consiga peixe fresco no cais", "traga dois"],
    ["chegar ao cais", "comprar o peixe"], "posse de Peixe Fresco");
  assert.strictEqual(c, "consiga peixe fresco no cais.\ntraga dois.\n- chegar ao cais\n- comprar o peixe\nPronto quando: posse de Peixe Fresco.");
  const p = H.desire.parseContent(c);
  assert.deepStrictEqual(p.palavras, ["consiga peixe fresco no cais", "traga dois"]);
  assert.deepStrictEqual(p.passos, ["chegar ao cais", "comprar o peixe"]);
  assert.strictEqual(p.fim, "posse de Peixe Fresco");
});

test("com a autonomia desligada, só o pedido do JOGADOR anda — o que ele inventou espera", () => {
  const nb = new H.desire.Notebook("so-pedido");
  nb.sync([{ id: "int-1700000000001", status: "ativa", content: "Quero comer." },
           { id: "int-1700000000002", status: "ativa", content: "Quero dormir." }]);
  assert.strictEqual(nb.ativo({ soPedido: true }), null);
  nb.marcarOrigem("int-1700000000001", "pedido");
  assert.strictEqual(nb.ativo().id, "int-1700000000002");
  assert.strictEqual(nb.ativo({ soPedido: true }).id, "int-1700000000001");
});

test("o fato de um plano: o que JÁ era verdade não fecha nada; fora do pedido vale 'nenhum'; o resto vale", () => {
  const ctx = { self: { inventory: [{ id: "peixe", name: "Peixe Assado" }], needs: { hunger: "faminto" } },
                scene: { place: { id: "t", name: "Taverna do Gancho" } } };
  const ja = H.ending.fromPlan("posse de Peixe Assado", ["coma o peixe assado"], ["Comer o Peixe Assado"], ctx);
  assert.strictEqual(ja.fim.familia, "nenhuma");
  assert.strictEqual(ja.motivo, "já era verdade");
  const fora = H.ending.fromPlan("estar em Cais Velho", ["coma o peixe assado"], ["Comer o Peixe Assado"], ctx);
  assert.strictEqual(fora.motivo, "fora do pedido");
  const vale = H.ending.fromPlan("fome saciada", ["coma o peixe assado"], ["Comer o Peixe Assado"], ctx);
  assert.strictEqual(vale.fim.familia, "necessidade");
  assert.strictEqual(vale.motivo, null);
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

test("a rotina com entrada em `porRotina` manda o `think` e o modelo DELA no corpo da requisição", async () => {
  const cfg = configuracao.carregar(true);
  cfg.porRotina = { objetivos: { model: "modelo-do-pensar", think: false } };
  configuracao.gravar(cfg);
  const e = espia("{}");
  try { await Mente.conversar("sys", "user", { rotina: "objetivos" }); } finally { e.restaurar(); }
  assert.strictEqual(e.chamadas[0].corpo.think, false);
  assert.strictEqual(e.chamadas[0].corpo.model, "modelo-do-pensar");
  cfg.porRotina = {};
  configuracao.gravar(cfg);
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

test("C8D: o fim COPIADO do exemplo do prompt não vale — o alvo tem de ser do desejo (B9b)", () => {
  const g = (fim, desejo, passos) => H.ending.groundEnding(H.ending.extractEnding(fim), desejo, passos);
  // o caso real: "posse de Faca de Mercador" num desejo de fazer um plano de segurança
  assert.strictEqual(g("posse de Faca de Mercador", "Fazer um plano de segurança para o porto", ["Falar com a Ossa"]).familia, "nenhuma");
  assert.strictEqual(g("estar em Cais Velho", "Aprender o caminho do Santuário", ["Perguntar ao Tobias"]).familia, "nenhuma");
  // o fim do próprio desejo continua valendo
  assert.strictEqual(g("posse de Ungüento de Arnica", "Conseguir o Ungüento de Arnica do Obadiah", ["Comprar o Ungüento"]).familia, "posse");
  assert.strictEqual(g("estar em Taverna do Gancho", "Chegar à Taverna do Gancho", []).familia, "lugar");
  assert.strictEqual(g("fome saciada", "Matar a fome", []).familia, "necessidade");
});

test("o harness anda o desejo MAIS RECENTE — a intenção velha do world não sequestra o novo (caso 2)", () => {
  const nb = new H.desire.Notebook("recente");
  nb.sync([{ id: "int-1788725803802-01f5c5b4", status: "ativa", content: "Análise o contexto e decida o que achar melhor." },
           { id: "int-1790460000000-aaaa0000", status: "ativa", content: "Matar a fome.\n- Comer o Bocado" }]);
  assert.strictEqual(nb.ativo().desejo, "Matar a fome");
});
