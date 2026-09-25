// US3 — "um cliente ACP genérico consegue exibir o ciclo de vida de uma tentativa
// sem conhecimento prévio deste jogo" (spec.md). Este arquivo NUNCA referencia o
// vocabulário antigo (`beat`, `recusa`, `sistema`, `intencao_*`) nos seus próprios
// nomes de asserção — só os termos do protocolo real: `sessionUpdate`, `toolCallId`,
// `status`, `content`. Se um dia este teste precisar saber de um nome de evento do
// vocabulário Loreforge para PASSAR, a US3 falhou (a independência de vocabulário
// quebrou).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { traduzir } = require("./traducao");
const { erros: errosDeSchema, valido } = require("./validar_schema");
const { notificacao } = require("./jsonrpc");

const CONTRATOS = path.join(__dirname, "..", "..",
  "specs", "074-acp-connector-transport", "contracts");

test("US3 — os 4 contratos publicados são válidos contra o schema oficial vendorizado", () => {
  for (const nome of ["01-tentativa-aplicada.json", "02-tentativa-falha-item78.json",
                       "03-pensamento.json", "04-rotina-ativa.json"]) {
    const eventos = JSON.parse(fs.readFileSync(path.join(CONTRATOS, nome), "utf8"));
    for (const ev of eventos) {
      const problemas = errosDeSchema(ev);
      assert.deepEqual(problemas, [], `${nome} tem entrada inválida: ${problemas.join("; ")}`);
    }
  }
});

test("US3 — uma sequência completa de turno (proposta -> desfecho) valida do início ao fim, " +
     "só com vocabulário de protocolo", () => {
  const SESSION_ID = "sess-generico-0001";
  const passos = [
    traduzir("tentativa", { toolCallId: "tc-1", nome: "forage",
                             descricaoDoTool: "Procurar recursos ao redor." }, SESSION_ID),
    traduzir("beat", { toolCallId: "tc-1", texto: "Ele encontra ervas." }, SESSION_ID),
  ];
  for (const p of passos) {
    const envelope = notificacao("session/update", p);
    assert.equal(valido(envelope), true, `inválido: ${errosDeSchema(envelope).join("; ")}`);
    assert.equal(envelope.method, "session/update");
    assert.ok(["tool_call_update", "agent_thought", "agent_thought_chunk",
               "agent_message_chunk", "state_update"].includes(
                 envelope.params.update.sessionUpdate));
  }
  // O MESMO toolCallId do início ao fim — é o que permite a um cliente genérico
  // CORRELACIONAR as duas mensagens sem saber nada de "propostas" ou "beats".
  assert.equal(passos[0].update.toolCallId, passos[1].update.toolCallId);
  assert.equal(passos[1].update.status, "completed");
});

test("US3 — a falha de emissão (item 78) também valida contra o schema, com status 'failed'", () => {
  const envelope = notificacao("session/update",
    traduzir("tentativa_falha_emissao", { toolCallId: "tc-2", nomeSuspeito: "ask_about" },
             "sess-generico-0001"));
  assert.equal(valido(envelope), true, errosDeSchema(envelope).join("; "));
  assert.equal(envelope.params.update.status, "failed");
});

test("US3 — um evento fora de banda (sem sessionId) não produz session-update — " +
     "um cliente genérico nunca vê um envelope quebrado", () => {
  assert.equal(traduzir("sala", { nome: "Taverna" }, null), null);
  assert.equal(traduzir("beat", { texto: "x" }, null), null);
});
