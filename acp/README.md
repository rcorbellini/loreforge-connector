# acp/ — o protocolo real, não um vocabulário próprio

Implementa o Agent Client Protocol (ACP) real entre `loreforge-client` e
`loreforge-connector` — spec `specs/074-acp-connector-transport/`. Leia `plan.md`
daquela spec (Constitution Check) antes de mexer aqui: o gate mais importante deste
módulo é FR-016 — dado técnico de protocolo (`name`, `kind`, `status`) pode virar
anotação passiva na tela, nunca uma opção clicável.

## Arquivos

- `jsonrpc.js` — o envelope JSON-RPC 2.0 (notificação/requisição/resposta/erro). Sem
  lógica de jogo.
- `schema-v2.json` — cópia vendorizada do schema oficial (`github.com/
  agentclientprotocol/agent-client-protocol`, `schema/v2/schema.json`, baixado em
  2026-09-23). **Referência de desenvolvimento e teste, nunca lida em runtime** — é
  aqui que `research.md` (Decisão 4) resolveu "biblioteca vs. schema próprio": sem
  dependência npm nova, `loreforge-connector` continua com zero dependências.
- `capacidade_kind.js` — a tabela Loreforge-específica capacidade → `ToolKind`/título
  player-facing (`data-model.md`).
- `sessao.js` — uma sessão ACP por `Assento` da sala (`sala.js`).
- `traducao.js` — o que o laço (`laco.js._emite`) já emite hoje, traduzido para
  `SessionUpdate` real. É o único módulo que conhece o formato do protocolo por fora
  do transporte; `laco.js`/`mente.js` continuam sem saber que ACP existe.

## Transporte

JSON-RPC 2.0 sobre o par `POST` + `GET /eventos` (SSE) que `canal.js` já serve —
**não WebSocket, não stdio**. `canal.js:3-4` documenta por que este projeto já havia
rejeitado socket bidirecional; esta spec não reabre essa decisão (`research.md`,
Decisão 1).
