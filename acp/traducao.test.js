"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { traduzir } = require("./traducao");

const CONTRATOS = path.join(__dirname, "..", "..",
  "specs", "074-acp-connector-transport", "contracts");

function lerFixture(nome) {
  return JSON.parse(fs.readFileSync(path.join(CONTRATOS, nome), "utf8"));
}

const SESSION_ID = "sess-draven-a1b2";

test("US1 — traduzir('tentativa', ...) bate com o 1º elemento de contracts/01", () => {
  const [emProgresso] = lerFixture("01-tentativa-aplicada.json");
  const params = traduzir("tentativa", {
    toolCallId: "tc-0091", nome: "attack",
    descricaoDoTool: "Golpear um personagem presente na cena.",
    rotina: "interpretar",
  }, SESSION_ID);
  assert.deepEqual(params, emProgresso.params);
});

test("US1 — traduzir('beat', ...) bate com o 2º elemento de contracts/01 (completed)", () => {
  const [, completo] = lerFixture("01-tentativa-aplicada.json");
  const params = traduzir("beat", {
    toolCallId: "tc-0091",
    texto: "O golpe acerta o flanco do lobo, que uiva e recua mancando para dentro da moita.",
  }, SESSION_ID);
  assert.deepEqual(params, completo.params);
});

test("US1 — o título é a prosa DESTA tentativa (tituloDinamico), não a description " +
     "genérica repetida a cada chamada da mesma capacidade", () => {
  const a = traduzir("tentativa", { toolCallId: "tc-1", nome: "investigate",
    tituloDinamico: "Ele examina o baú de perto.",
    descricaoDoTool: "Investigar algo presente na cena." }, SESSION_ID);
  const b = traduzir("tentativa", { toolCallId: "tc-2", nome: "investigate",
    tituloDinamico: "Ele examina a porta ao fundo.",
    descricaoDoTool: "Investigar algo presente na cena." }, SESSION_ID);
  assert.equal(a.update.title, "Ele examina o baú de perto.");
  assert.equal(b.update.title, "Ele examina a porta ao fundo.");
  assert.notEqual(a.update.title, b.update.title,
    "duas tentativas da MESMA capacidade não podem mostrar o mesmo parágrafo genérico " +
    "— é o defeito achado jogando em 2026-09-23");
});

test("US1 — sem tituloDinamico, cai no fallback da description estática", () => {
  const params = traduzir("tentativa",
    { toolCallId: "tc-1", nome: "attack", descricaoDoTool: "Golpear um alvo." },
    SESSION_ID);
  assert.equal(params.update.title, "Golpear um alvo.");
});

test("US1 — recusa do mundo também produz status 'completed', nunca 'failed' (Decisão 2b)", () => {
  const params = traduzir("recusa", { toolCallId: "tc-0099", texto: "Coppo não quis dizer." },
    SESSION_ID);
  assert.equal(params.update.status, "completed",
    "recusa do mundo é EXECUÇÃO bem-sucedida da tool call, não falha de protocolo — " +
    "se este teste falhar porque alguém trocou para 'failed', é regressão da Decisão 2b");
});

test("US1 — item 78: falha de emissão bate com contracts/02 (nasce e morre 'failed')", () => {
  const [falhou] = lerFixture("02-tentativa-falha-item78.json");
  const params = traduzir("tentativa_falha_emissao", {
    toolCallId: "tc-falha-0042", nomeSuspeito: "ask_about",
  }, SESSION_ID);
  assert.deepEqual(params, falhou.params);
});

test("US1 — falha de emissão NUNCA usa o texto de recusa do mundo (não confundir os dois)", () => {
  const params = traduzir("tentativa_falha_emissao",
    { toolCallId: "tc-1", nomeSuspeito: "ask_about" }, SESSION_ID);
  const texto = params.update.content[0].content.text;
  assert.equal(/Coppo|não quis/.test(texto), false);
  assert.equal(params.update.status, "failed");
});

test("US2 — traduzir('pensamento', ...) bate com contracts/03", () => {
  const [esperado] = lerFixture("03-pensamento.json");
  const params = traduzir("pensamento", {
    toolCallId: "tc-0091",
    pensamento: "O lobo já está ferido e a matilha se afastou — é a abertura mais " +
                "segura para encerrar a ameaça sem arriscar outro confronto.",
  }, SESSION_ID);
  assert.deepEqual(params, esperado.params);
});

test("US2 — pensamento vazio (rotina 'narrar') não produz notificação", () => {
  assert.equal(traduzir("pensamento", { toolCallId: "tc-1", pensamento: "" }, SESSION_ID), null);
  assert.equal(traduzir("pensamento", { toolCallId: "tc-1" }, SESSION_ID), null);
});

test("US2 — traduzir('rotina_ativa'/'rotina_ociosa', ...) bate com contracts/04", () => {
  const [refletirRunning, idleEndTurn, interpretarRunning] = lerFixture("04-rotina-ativa.json");
  assert.deepEqual(
    traduzir("rotina_ativa", { rotina: "refletir", titulo: "Criar um compromisso" }, SESSION_ID),
    refletirRunning.params);
  assert.deepEqual(
    traduzir("rotina_ociosa", { stopReason: "end_turn" }, SESSION_ID),
    idleEndTurn.params);
  assert.deepEqual(
    traduzir("rotina_ativa", { rotina: "interpretar", titulo: "Escolher a ação" }, SESSION_ID),
    interpretarRunning.params);
});

// ACHADO 2026-09-29: "onde ele está" (o breadcrumb da location) vira um
// `state_update` extra com `_meta.breadcrumb` — mesmo molde de `rotina_ativa`.
test("achado 2026-09-29 — 'local' vira state_update com _meta.breadcrumb", () => {
  const { update } = traduzir("local",
    { breadcrumb: ["Costa de Ferro", "Porto Negro"] }, SESSION_ID);
  assert.equal(update.sessionUpdate, "state_update");
  assert.equal(update.state, "running");
  assert.deepEqual(update._meta.breadcrumb, ["Costa de Ferro", "Porto Negro"]);
});

test("achado 2026-09-29 — 'local' sem breadcrumb (raiz do mundo) não produz notificação", () => {
  assert.equal(traduzir("local", { breadcrumb: [] }, SESSION_ID), null);
  assert.equal(traduzir("local", {}, SESSION_ID), null);
});

test("US3 — eventos de mesa (fora de banda) devolvem null, nunca lançam", () => {
  for (const ev of ["sala", "fila", "entrou", "saiu", "autonomia", "estado", "expulso"]) {
    assert.equal(traduzir(ev, {}, SESSION_ID), null, `evento '${ev}' deveria ser null`);
  }
});

test("evento desconhecido devolve null (erra para o lado do silêncio)", () => {
  assert.equal(traduzir("evento_que_nao_existe_ainda", {}, SESSION_ID), null);
});

test("sem sessionId, nunca traduz (não há para onde mandar)", () => {
  assert.equal(traduzir("beat", { toolCallId: "tc-1", texto: "x" }, null), null);
});

test("Polish — narração (agent_message_chunk) tem messageId estável por turno", () => {
  const inicio = traduzir("narracao_inicio", { numeroTurno: 7 }, SESSION_ID);
  const pedaco = traduzir("narracao", { numeroTurno: 7, pedaco: "Você avança" }, SESSION_ID);
  assert.equal(inicio.update.sessionUpdate, "agent_message_chunk");
  assert.equal(inicio.update.messageId, pedaco.update.messageId);
  assert.equal(pedaco.update.content.text, "Você avança");
});

test("Polish — narracao_fim vira agent_message (upsert, não chunk), mesmo messageId", () => {
  const pedaco = traduzir("narracao", { numeroTurno: 7, pedaco: "Você avança" }, SESSION_ID);
  const fim = traduzir("narracao_fim",
    { numeroTurno: 7, texto: "Você avança pela trilha estreita." }, SESSION_ID);
  assert.equal(fim.update.sessionUpdate, "agent_message");
  assert.equal(fim.update.messageId, pedaco.update.messageId,
    "o fechamento precisa correlacionar com os chunks pelo mesmo messageId");
  assert.equal(fim.update.content[0].text, "Você avança pela trilha estreita.");
});

test("Polish — narracao_fim sem texto (descartada) não produz notificação", () => {
  assert.equal(traduzir("narracao_fim", { numeroTurno: 7, texto: "" }, SESSION_ID), null);
  assert.equal(traduzir("narracao_fim", { numeroTurno: 7 }, SESSION_ID), null);
});

test("Polish — sistema/erro viram agent_message_chunk marcado _meta.diagnostico", () => {
  const params = traduzir("sistema", { texto: "Uma ação já está em andamento." }, SESSION_ID);
  assert.equal(params.update.sessionUpdate, "agent_message_chunk");
  assert.equal(params.update._meta.diagnostico, true);
});

// ACHADO 2026-09-29 (corrigido no mesmo dia): "paralelo" ("enquanto isso, ao
// redor") vira `agent_message` PRÓPRIA — nunca se funde com a narração
// principal (messageId diferente), marcada em `_meta.paralelo` pro client
// estilizar sem precisar reconhecer texto nenhum dentro da prosa.
test("achado 2026-09-29 — 'paralelo' vira agent_message marcada _meta.paralelo, " +
     "messageId diferente da narração", () => {
  const paralelo = traduzir("paralelo",
    { numeroTurno: 7, texto: "Draven se aproxima do mercado." }, SESSION_ID);
  const narracao = traduzir("narracao_fim",
    { numeroTurno: 7, texto: "Você avança pela trilha." }, SESSION_ID);
  assert.equal(paralelo.update.sessionUpdate, "agent_message");
  assert.equal(paralelo.update._meta.paralelo, true);
  assert.equal(paralelo.update.content[0].text, "Draven se aproxima do mercado.");
  assert.notEqual(paralelo.update.messageId, narracao.update.messageId,
    "precisa de messageId PRÓPRIO — senão o upsert de um sobrescreveria o outro");
});

test("achado 2026-09-29 — 'paralelo' sem texto não produz notificação", () => {
  assert.equal(traduzir("paralelo", { numeroTurno: 7, texto: "" }, SESSION_ID), null);
  assert.equal(traduzir("paralelo", { numeroTurno: 7 }, SESSION_ID), null);
});
