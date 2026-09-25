// A TRADUÇÃO — o que `laco.js._emite` já emite hoje, virando `session/update` real.
//
// NENHUMA LÓGICA DE JOGO MORA AQUI, só mapeamento (Structure Decision, spec 074
// plan.md). `traduzir()` é uma função PURA: entrada (evento, dados, sessionId) ->
// saída (os params de uma notificação `session/update`, ou `null` se o evento não é
// por-sessão — ver a tabela de `research.md`, Decisão 2, última linha).
//
// A correlação de UMA TENTATIVA (o `toolCallId`) não nasce aqui — nasce em
// `laco.js._executar`, que já tem `p.id` (o id nativo da tool call, de `_mapear` em
// `mente.js`). Este módulo só lê o que já vem pronto em `dados.toolCallId`.

"use strict";

const { kindDe, tituloDe } = require("./capacidade_kind");

function _su(sessionId, sessionUpdate, resto) {
  return { sessionId, update: { sessionUpdate, ...resto } };
}

function _textoContent(texto) {
  return [{ type: "content", content: { type: "text", text: texto } }];
}

// --- o rascunho bruto (agent_thought_chunk) ------------------------------------ //
//
// `intencao_inicio/intencao/intencao_fim` é o "pensando em voz alta" ANTES de a
// proposta existir de forma parseável — por isso não tem `toolCallId` (T016-T019: só
// nasce quando `p.id` existe). Mapeia para `agent_thought_chunk`, não `tool_call_
// update` (revisão registrada em `contracts/README.md`, "O que mudou"). FR-003: o
// CLIENT é quem decide colapsar/preservar ao fim do turno — o protocolo não apaga
// nada, só para de emitir chunks novos.

function _rascunho(evento, dados, sessionId) {
  const messageId = `rascunho-${dados.numeroTurno || "atual"}`;
  if (evento === "intencao_inicio") {
    return _su(sessionId, "agent_thought_chunk",
      { messageId, content: { type: "text", text: "" } });
  }
  if (evento === "intencao") {
    return _su(sessionId, "agent_thought_chunk",
      { messageId, content: { type: "text", text: dados.pedaco || "" } });
  }
  // intencao_fim não precisa de notificação própria: o próximo evento (a tentativa
  // despachada, ou o fim do turno) já indica que o rascunho encerrou.
  return null;
}

// --- o ciclo de vida da tentativa (tool_call_update) --------------------------- //

function _tentativa(evento, dados, sessionId) {
  if (evento === "tentativa") {
    // Nasce direto em "in_progress": por esta granularidade não existe uma janela
    // de "pending" a reportar (FR-005, sem aprovação; o rascunho já é o agent_
    // thought_chunk acima) — data-model.md, "Transições válidas".
    return _su(sessionId, "tool_call_update", {
      toolCallId: dados.toolCallId,
      name: dados.nome,
      // A prosa ESPECÍFICA desta tentativa (o que o Árbitro recebeu como
      // descrição do ato) vence sobre a description genérica da capacidade —
      // ver o comentário em `laco.js` onde `tituloDinamico` nasce. Sem ela
      // (não deveria acontecer), cai no fallback estático de sempre.
      title: dados.tituloDinamico || tituloDe(dados.nome, dados.descricaoDoTool),
      kind: kindDe(dados.nome),
      status: "in_progress",
      _meta: { rotina: dados.rotina || null },
    });
  }
  if (evento === "beat") {
    // "Recusa" e "sucesso" são as duas `completed` (research.md, Decisão 2b) — a
    // chamada EXECUTOU e voltou um resultado; o que muda é só o `content`.
    return _su(sessionId, "tool_call_update", {
      toolCallId: dados.toolCallId,
      status: "completed",
      content: _textoContent(dados.texto),
    });
  }
  if (evento === "recusa") {
    return _su(sessionId, "tool_call_update", {
      toolCallId: dados.toolCallId,
      status: "completed",   // NUNCA "failed" — ver Decisão 2b. É recusa do MUNDO.
      content: _textoContent(dados.texto),
    });
  }
  if (evento === "tentativa_falha_emissao") {
    // O item 78: nasce e já morre no mesmo upsert (contracts/02, "O que mudou").
    return _su(sessionId, "tool_call_update", {
      toolCallId: dados.toolCallId,
      name: dados.nomeSuspeito || null,
      title: "Uma tentativa começou a ser composta e não se completou.",
      kind: dados.nomeSuspeito ? kindDe(dados.nomeSuspeito) : "other",
      status: "failed",
      content: _textoContent(
        "A tentativa não chegou a se completar — a resposta do modelo terminou de " +
        "forma incompleta antes de a ação ficar pronta. Não é uma recusa do mundo " +
        "nem uma decisão do personagem de não agir."),
      _meta: { causa: "emissao_malformada" },
    });
  }
  return null;
}

// --- a rotina ativa (state_update) — FR-014 ------------------------------------ //

function _rotina(evento, dados, sessionId) {
  if (evento === "rotina_ativa") {
    return _su(sessionId, "state_update", {
      state: "running",
      _meta: { rotina: dados.rotina, titulo: dados.titulo },
    });
  }
  if (evento === "rotina_ociosa") {
    const upd = { state: "idle" };
    if (dados.stopReason) upd.stopReason = dados.stopReason;
    return _su(sessionId, "state_update", upd);
  }
  return null;
}

// --- o pensamento já extraído (agent_thought) — FR-015 ------------------------- //

function _pensamento(evento, dados, sessionId) {
  if (evento !== "pensamento") return null;
  if (!dados.pensamento) return null;   // nem toda rotina produz um (ex.: narrar)
  return _su(sessionId, "agent_thought", {
    messageId: `thought-${dados.toolCallId || dados.numeroTurno || "atual"}`,
    content: [{ type: "text", text: dados.pensamento }],
  });
}

// --- a narração final (agent_message_chunk) ------------------------------------ //

function _narracao(evento, dados, sessionId) {
  const messageId = `narracao-${dados.numeroTurno || "atual"}`;
  if (evento === "narracao_inicio") {
    return _su(sessionId, "agent_message_chunk",
      { messageId, content: { type: "text", text: "" } });
  }
  if (evento === "narracao") {
    return _su(sessionId, "agent_message_chunk",
      { messageId, content: { type: "text", text: dados.pedaco || "" } });
  }
  if (evento === "narracao_fim") {
    // AO CONTRÁRIO do rascunho bruto (que só descarta, FR-003 não pede
    // persistência do rascunho em si — só que ele não seja perdido ANTES do
    // fim), a narração é a resposta de verdade e PRECISA de um fechamento
    // autoritativo: `agent_message` (upsert, não chunk) carrega o texto
    // completo que `laco.js._narrar()` já produz (`prosa`), a mesma fonte que
    // os chunks vieram — não é um texto novo, é o mesmo consolidado. Sem
    // `dados.texto` (a narração foi descartada), não há o que finalizar.
    if (!dados.texto) return null;
    return _su(sessionId, "agent_message",
      { messageId, content: [{ type: "text", text: dados.texto }] });
  }
  return null;
}

// --- "enquanto isso" (agent_message, mensagem PRÓPRIA) -------------------------- //
//
// Achado 2026-09-29, corrigido no mesmo dia: isto ANTES viajava DENTRO da narração
// (o payload de `narrate()` levava `aconteceu_ao_redor`, e a Mente era instruída a
// tecer um parágrafo "Enquanto isso, ao redor: ..." na MESMA prosa — o client então
// reconhecia esse marcador por regex para separar visualmente). Nem sempre a Mente
// escrevia o marcador — texto livre não é confiável pra isso —, e sem ele tudo saía
// junto, sem divisor. `diffTextual` (`laco.js`) é DADO determinístico; agora vira sua
// PRÓPRIA `agent_message`, com `messageId` diferente da narração (nunca se funde a
// ela) e `_meta.paralelo` marcando o que é — o client estiliza sem precisar
// reconhecer texto nenhum.

function _paralelo(evento, dados, sessionId) {
  if (evento !== "paralelo") return null;
  if (!dados.texto) return null;
  return _su(sessionId, "agent_message", {
    messageId: `paralelo-${dados.numeroTurno || "atual"}`,
    content: [{ type: "text", text: dados.texto }],
    _meta: { paralelo: true },
  });
}

// --- diagnóstico de harness (sistema/erro) -------------------------------------- //
//
// Não é narrativa de mundo — é diagnóstico do CONECTOR (pane de juízo, orçamento,
// prazo). Vai como `agent_message_chunk` marcado em `_meta`, para o client poder
// estilizar diferente da narração sem precisar de um SessionUpdate à parte.

function _sistema(evento, dados, sessionId) {
  if (evento !== "sistema" && evento !== "erro") return null;
  return _su(sessionId, "agent_message_chunk", {
    messageId: `sistema-${Date.now()}`,
    content: { type: "text", text: dados.texto || "" },
    _meta: { diagnostico: true },
  });
}

// --- a decisão autônoma (decidiu) ----------------------------------------------- //
//
// O sussurro que a autonomia produziu é a MESMA trilha de uma tentativa proposta
// manualmente — só a origem (`_meta.rotina: "autonomia"`) diferencia. Reusa `_tentativa`
// via o evento `"tentativa"` que `laco.js` já emite depois de `decidiu` (autonomia
// sempre desemboca num `_executar` como qualquer outra vez) — este evento em si vira
// só um `agent_message_chunk` avulso com o sussurro decidido, para o cliente saber
// QUE frase a autonomia escolheu, antes de ver as tentativas que ela gera.

function _decidiu(evento, dados, sessionId) {
  if (evento !== "decidiu") return null;
  return _su(sessionId, "agent_thought", {
    messageId: `decidiu-${dados.numeroTurno || Date.now()}`,
    content: [{ type: "text", text: dados.texto || "" }],
  });
}

// --- onde ele está (local) -------------------------------------------------------- //
//
// FR-016/Princípio V/IX de novo aqui, do jeito certo: `breadcrumb` é PROSA — nomes de
// lugar que já são player-facing em `.scene` (spec 035) — não vocabulário de máquina.
// Não existe uma notificação nativa "onde o personagem está" no schema v2; o mesmo
// molde de `rotina_ativa` (state_update + `_meta`, extensão sancionada pelo próprio
// protocolo) serve — `state: "running"` porque é sempre emitido dentro de um turno já
// em curso, nunca sozinho.

function _local(evento, dados, sessionId) {
  if (evento !== "local") return null;
  if (!dados.breadcrumb || !dados.breadcrumb.length) return null;
  return _su(sessionId, "state_update", {
    state: "running",
    _meta: { breadcrumb: dados.breadcrumb },
  });
}

// --- o roteador ------------------------------------------------------------------ //
//
// Eventos que NÃO são por-sessão (research.md, Decisão 2, última linha da tabela) —
// `sala`/`fila`/`entrou`/`saiu`/`autonomia`/`estado`/`expulso` — devolvem `null`
// aqui: são reportados fora de banda (roster da sala), não dentro de um
// `session/update`. Um evento desconhecido também devolve `null` — errar para o
// lado do silêncio é recuperável (o mesmo princípio que já regia `escopoDe` em
// `laco.js` antes desta spec).
function traduzir(evento, dados, sessionId) {
  if (!sessionId) return null;
  const d = dados || {};
  return (
    _rascunho(evento, d, sessionId) ||
    _tentativa(evento, d, sessionId) ||
    _rotina(evento, d, sessionId) ||
    _pensamento(evento, d, sessionId) ||
    _narracao(evento, d, sessionId) ||
    _paralelo(evento, d, sessionId) ||
    _sistema(evento, d, sessionId) ||
    _decidiu(evento, d, sessionId) ||
    _local(evento, d, sessionId) ||
    null
  );
}

module.exports = { traduzir };
