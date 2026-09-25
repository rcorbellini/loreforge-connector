// O ENVELOPE JSON-RPC 2.0 do Agent Client Protocol (schema v2) — só a casca das
// mensagens. NENHUMA lógica de jogo mora aqui (Structure Decision, spec 074).
//
// Trafega sobre o par que `canal.js` já serve (POST + GET /eventos, SSE) — não é
// WebSocket, não é stdio (ver specs/074-acp-connector-transport/research.md,
// Decisão 1, revisada). Este módulo só sabe montar/ler o envelope; QUEM manda por
// onde é responsabilidade de `canal.js` e `acp/sessao.js`.

"use strict";

// Uma NOTIFICAÇÃO: sem `id`, sem resposta esperada. É a forma de `session/update`
// (o Connector avisa o Client de algo, sem que o Client tenha perguntado).
function notificacao(method, params) {
  return { jsonrpc: "2.0", method, params };
}

// Uma REQUISIÇÃO: tem `id`, espera uma resposta. É a forma de `session/new`,
// `session/prompt`, `session/load` — o Client pede algo ao Connector.
function requisicao(id, method, params) {
  return { jsonrpc: "2.0", id, method, params };
}

// A RESPOSTA de sucesso a uma requisição — mesmo `id`, `result` no lugar de `params`.
function resposta(id, result) {
  return { jsonrpc: "2.0", id, result };
}

// A RESPOSTA de erro — códigos JSON-RPC 2.0 padrão quando fizer sentido usar um
// (-32600 Invalid Request, -32601 Method not found, -32602 Invalid params,
// -32603 Internal error); qualquer outro código é específico do domínio.
function erro(id, codigo, mensagem, dados) {
  const e = { code: codigo, message: mensagem };
  if (dados !== undefined) e.data = dados;
  return { jsonrpc: "2.0", id, error: e };
}

// Valida o envelope mínimo de uma mensagem recebida — não valida o `params`/`result`
// contra o schema completo (isso é `validarContraSchema`, T033/US3, que lê
// `acp/schema-v2.json` para checagem de forma mais funda).
function envelopeValido(msg) {
  if (!msg || typeof msg !== "object") return false;
  if (msg.jsonrpc !== "2.0") return false;
  const ehNotificacao = "method" in msg && !("id" in msg);
  const ehRequisicao = "method" in msg && "id" in msg;
  const ehResposta = "id" in msg && ("result" in msg || "error" in msg) && !("method" in msg);
  return ehNotificacao || ehRequisicao || ehResposta;
}

module.exports = { notificacao, requisicao, resposta, erro, envelopeValido };
