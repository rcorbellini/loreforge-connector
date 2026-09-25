// VALIDAÇÃO DE FORMA contra o schema oficial vendorizado (`acp/schema-v2.json`) —
// spec 074, T033. NÃO é um motor de JSON-Schema completo: valida só os campos
// obrigatórios dos tipos que este conector de fato emite (`UpdateSessionNotification`,
// e cada variante de `SessionUpdate` usada). É o bastante para pegar o defeito real
// (um campo obrigatório que sumiu na tradução) sem carregar uma dependência nova só
// para isto (Princípio I, em espírito).

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const _schema = JSON.parse(
  fs.readFileSync(path.join(__dirname, "schema-v2.json"), "utf8"));

const _REQUIRED_POR_SESSION_UPDATE = {
  tool_call_update: _schema.$defs.ToolCallUpdate.required,
  agent_thought: _schema.$defs.AgentThought.required,
  agent_message: _schema.$defs.AgentMessage.required,
  agent_thought_chunk: _schema.$defs.ContentChunk.required,
  agent_message_chunk: _schema.$defs.ContentChunk.required,
  state_update: ["state"],
};

// `erros(envelope)` — devolve um array de strings (vazio = válido). Confere:
//  1. `jsonrpc:"2.0"`, `method:"session/update"`;
//  2. `params.sessionId` e `params.update` presentes (UpdateSessionNotification);
//  3. os campos obrigatórios do tipo de `sessionUpdate` em questão.
function erros(envelope) {
  const problemas = [];
  if (!envelope || envelope.jsonrpc !== "2.0") problemas.push("jsonrpc !== '2.0'");
  if (envelope && envelope.method !== "session/update") {
    problemas.push(`method '${envelope.method}' !== 'session/update'`);
  }
  const params = envelope && envelope.params;
  if (!params || !params.sessionId) problemas.push("params.sessionId ausente");
  if (!params || !params.update) {
    problemas.push("params.update ausente");
    return problemas;
  }
  const su = params.update.sessionUpdate;
  const obrigatorios = _REQUIRED_POR_SESSION_UPDATE[su];
  if (!obrigatorios) {
    problemas.push(`sessionUpdate '${su}' desconhecido no schema vendorizado`);
    return problemas;
  }
  for (const campo of obrigatorios) {
    if (!(campo in params.update)) {
      problemas.push(`update.${campo} ausente (obrigatório para '${su}')`);
    }
  }
  return problemas;
}

function valido(envelope) {
  return erros(envelope).length === 0;
}

module.exports = { erros, valido };
