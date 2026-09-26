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

// --- o harness por objetivos (spec 075, contrato 02) ---------------------------- //
//
// DUAS CAMADAS, e a marca é o que o client lê para decidir o que abre:
//   · VISÍVEL — a Mente em 1ª pessoa (`objetivos`) e os rótulos NEUTROS do harness
//     (`harness`: "procurando onde está a caneca…"). Sem número, id ou nome de tool
//     (FR-021, Princípio V).
//   · BASTIDOR — o que o resolvedor decidiu (tool, alvos, margem, motivo de subida).
//     Vai marcado `_meta.camada: "bastidor"`, e o client o mostra RECOLHIDO e só
//     leitura: não é menu, não decide nada (o mesmo gate da 074 para `name`).

function _harness(evento, dados, sessionId) {
  if (evento === "objetivos") {
    if (!dados.texto) return null;
    return _su(sessionId, "agent_thought", {
      messageId: `objetivos-${dados.numeroTurno || Date.now()}`,
      content: [{ type: "text", text: dados.texto }],
      _meta: { camada: "visivel", rotina: "objetivos" },
    });
  }
  if (evento === "harness") {
    if (!dados.texto) return null;
    return _su(sessionId, "agent_thought_chunk", {
      messageId: `harness-${dados.numeroTurno || "atual"}-${dados.box || ""}-${Date.now()}`,
      content: { type: "text", text: dados.texto },
      _meta: { camada: "visivel", box: dados.box || null },
    });
  }
  if (evento === "bastidor") {
    const { box, numeroTurno, personagem, escopo, ...resto } = dados;
    return _su(sessionId, "agent_thought_chunk", {
      messageId: `bastidor-${numeroTurno || "atual"}-${box || ""}-${Date.now()}`,
      content: { type: "text", text: JSON.stringify(resto) },
      _meta: { camada: "bastidor", box: box || null, dados: resto },
    });
  }
  if (evento === "plano") {
    // schema v2: `plan_update` com o plano INTEIRO a cada vez (o client substitui).
    return _su(sessionId, "plan_update", {
      plan: { type: "items", planId: dados.planId || "desejo",
              entries: (dados.entries || []).map((e) => ({
                content: e.content, priority: "medium", status: e.status || "pending" })) },
      _meta: { desejo: dados.desejo || null },
    });
  }
  if (evento === "bloqueio") {
    if (!dados.texto) return null;
    return _su(sessionId, "agent_message", {
      messageId: `bloqueio-${Date.now()}`,
      content: [{ type: "text", text: dados.texto }],
      _meta: { intervencao: true, motivo: dados.motivo || null },
    });
  }
  return null;
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
    _tentativa(evento, d, sessionId) ||
    _rotina(evento, d, sessionId) ||
    _harness(evento, d, sessionId) ||
    _narracao(evento, d, sessionId) ||
    _paralelo(evento, d, sessionId) ||
    _sistema(evento, d, sessionId) ||
    _local(evento, d, sessionId) ||
    null
  );
}

module.exports = { traduzir };
