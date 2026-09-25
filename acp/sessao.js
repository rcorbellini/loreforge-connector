// UMA SESSÃO ACP POR ASSENTO (spec 074, research.md Decisão 5).
//
// O item 75 do backlog já registrava que a spec 072 "reserva o lugar (o assento e a
// entrada de fila carregam um handle de sessão) sem construí-la" — isto constrói
// esse handle, só que para a sessão do PROTOCOLO (transporte/observação), não para a
// persistência de raciocínio entre turnos do item 75 (que continua fora de escopo,
// independente).
//
// FR-008/FR-009 (2026-09-23): a privacidade por "dono" caiu DENTRO da sala — qualquer
// cliente conectado à sala pode abrir a sessão de qualquer assento presente nela. Este
// módulo por isso não guarda "quem pode ver" — isso é autenticação de SALA (spec 072,
// `canal.js`, guarda G-MEMBRO), inalterada. Aqui só existe o mapeamento
// personagem <-> sessionId.

"use strict";

const crypto = require("node:crypto");

// `sess-<personagem>-<sufixo aleatório>` — legível o bastante para depurar
// (`sess-draven-a1b2c3d4`, como nos exemplos de `contracts/`), único o bastante para
// nunca colidir entre assentos na mesma sala.
function novoSessionId(personagem) {
  const sufixo = crypto.randomBytes(4).toString("hex");
  return `sess-${personagem}-${sufixo}`;
}

// `NewSessionRequest.cwd` é obrigatório no schema real e não tem análogo no domínio
// (research.md, Decisão 3) — um valor sintético estável, nunca lido por ninguém.
function cwdSintetico({ salaId, personagem }) {
  return `/loreforge/sala/${salaId || "local"}/assento/${personagem}`;
}

class Sessoes {
  constructor({ salaId } = {}) {
    this.salaId = salaId || "local";
    this._porPersonagem = new Map();   // personagem -> sessionId
    this._porSessionId = new Map();    // sessionId -> personagem
  }

  // Cria (ou devolve, se já existir) a sessão do assento. Idempotente de propósito:
  // `sala.assentar()` pode ser chamado mais de uma vez para o mesmo personagem numa
  // reconexão, e isso não deve fabricar uma segunda sessão órfã.
  criar(personagem) {
    const existente = this._porPersonagem.get(personagem);
    if (existente) return existente;
    const sessionId = novoSessionId(personagem);
    this._porPersonagem.set(personagem, sessionId);
    this._porSessionId.set(sessionId, personagem);
    return sessionId;
  }

  sessionIdDe(personagem) {
    return this._porPersonagem.get(personagem) || null;
  }

  personagemDe(sessionId) {
    return this._porSessionId.get(sessionId) || null;
  }

  // Chamado quando o assento sai da sala (`sala.desassentar()`) — a sessão morre com
  // ele. Um `sessionId` reaproveitado depois de encerrado nunca deve resolver de novo:
  // por isso `criar()` sempre gera um `sessionId` NOVO, nunca reaproveita o antigo.
  encerrar(personagem) {
    const sessionId = this._porPersonagem.get(personagem);
    if (!sessionId) return;
    this._porPersonagem.delete(personagem);
    this._porSessionId.delete(sessionId);
  }

  newSessionRequest(personagem) {
    return { cwd: cwdSintetico({ salaId: this.salaId, personagem }), mcpServers: [] };
  }
}

module.exports = { Sessoes, novoSessionId, cwdSintetico };
