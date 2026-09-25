"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { notificacao, requisicao, resposta, erro, envelopeValido } = require("./jsonrpc");

const CONTRATOS = path.join(__dirname, "..", "..",
  "specs", "074-acp-connector-transport", "contracts");

function lerFixture(nome) {
  return JSON.parse(fs.readFileSync(path.join(CONTRATOS, nome), "utf8"));
}

test("notificacao() bate campo a campo com contracts/01-tentativa-aplicada.json", () => {
  const [pending] = lerFixture("01-tentativa-aplicada.json");
  const montado = notificacao("session/update", pending.params);
  assert.deepEqual(montado, { jsonrpc: "2.0", method: "session/update", params: pending.params });
  assert.deepEqual(montado, { jsonrpc: pending.jsonrpc, method: pending.method, params: pending.params });
});

test("notificacao() bate com o caso de falha do item 78 (contracts/02)", () => {
  const [falhou] = lerFixture("02-tentativa-falha-item78.json");
  const montado = notificacao("session/update", falhou.params);
  assert.deepEqual(montado, falhou);
});

test("notificacao() bate com agent_thought (contracts/03)", () => {
  const [pensamento] = lerFixture("03-pensamento.json");
  assert.deepEqual(notificacao("session/update", pensamento.params), pensamento);
});

test("notificacao() bate com state_update (contracts/04, as três entradas)", () => {
  const eventos = lerFixture("04-rotina-ativa.json");
  for (const ev of eventos) {
    assert.deepEqual(notificacao("session/update", ev.params), ev);
  }
});

test("requisicao()/resposta()/erro() têm a forma mínima do JSON-RPC 2.0", () => {
  assert.deepEqual(requisicao("r1", "session/new", { cwd: "/x" }),
    { jsonrpc: "2.0", id: "r1", method: "session/new", params: { cwd: "/x" } });
  assert.deepEqual(resposta("r1", { sessionId: "sess-1" }),
    { jsonrpc: "2.0", id: "r1", result: { sessionId: "sess-1" } });
  assert.deepEqual(erro("r1", -32602, "Invalid params"),
    { jsonrpc: "2.0", id: "r1", error: { code: -32602, message: "Invalid params" } });
});

test("envelopeValido() classifica notificação, requisição e resposta corretamente", () => {
  assert.equal(envelopeValido(notificacao("session/update", {})), true);
  assert.equal(envelopeValido(requisicao("r1", "session/new", {})), true);
  assert.equal(envelopeValido(resposta("r1", {})), true);
  assert.equal(envelopeValido(erro("r1", -32600, "Invalid Request")), true);
  assert.equal(envelopeValido({ method: "session/update" }), false); // sem jsonrpc
  assert.equal(envelopeValido(null), false);
});

test("todos os 4 arquivos de contracts/ têm jsonrpc:'2.0' em toda entrada", () => {
  for (const nome of ["01-tentativa-aplicada.json", "02-tentativa-falha-item78.json",
                       "03-pensamento.json", "04-rotina-ativa.json"]) {
    for (const ev of lerFixture(nome)) {
      assert.equal(ev.jsonrpc, "2.0", `${nome} tem entrada sem jsonrpc:"2.0"`);
      assert.equal(envelopeValido(ev), true, `${nome} tem entrada com envelope inválido`);
    }
  }
});
