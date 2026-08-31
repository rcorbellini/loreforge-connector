// O MUNDO, visto do conector — a unica porta para fora que muda alguma coisa.
//
// Extraido do bloco de cliente MCP que vivia em `mente.js` (spec 043). Duas
// razoes para ele ser um arquivo proprio agora: a Mente passa a nao ter mais
// nenhum endereco embutido, e este e o lugar onde se verifica, lendo pouca
// coisa, que NADA da credencial do jogador sobe.
//
// CLIENTE, NUNCA SEGUNDO ESCRITOR (Principio III). A trava de turno vive no
// processo do server; este modulo so pede. Um segundo escritor fora dessa trava
// quebraria a mutacao atomica que o mundo promete.

"use strict";

const { log } = require("./log");

const TIMEOUT = 180000;   // o juizo de uma capacidade arbitrada leva dezenas de s

// Percorre os schemas da face e colhe, por capacidade e por parâmetro, a lista de
// ids que o mundo declarou como válidos. É o que o `enum` sempre carregou — só
// que agora ele fica AQUI em vez de descer ao modelo.
function _tabelaDeCandidatos(tools) {
  const tabela = {};
  for (const t of tools || []) {
    const props = ((t.inputSchema || t.parameters || {}).properties) || {};
    const porParam = {};
    for (const [nome, esq] of Object.entries(props)) {
      if (!esq || typeof esq !== "object") continue;
      // escalar com enum, ou array cujos ITENS têm enum (cook.ingredientes)
      const lista = Array.isArray(esq.enum) ? esq.enum
                  : (esq.items && Array.isArray(esq.items.enum)) ? esq.items.enum
                  : null;
      if (lista && lista.length) porParam[nome] = lista.slice();
    }
    if (Object.keys(porParam).length) tabela[t.name] = porParam;
  }
  return tabela;
}


class Mundo {
  constructor(base, personagem) {
    this.base = String(base || "").replace(/\/$/, "");
    this.personagem = personagem;
    this._rpcId = 0;
    // o id do turno viaja na QUERY, nunca nos argumentos da capacidade:
    // argumento de capacidade e materia de julgamento, e isto nao e.
    this.turnoId = null;
    this.capacidadesDaCena = null;
    this.candidatosDaCena = null;   // spec 060: a tabela de resolução
    this._nomesDaCena = null;       // id -> nome, colhido do contexto
    // o JWT do jogador pareado (spec 056) — quando o server exige login, todo
    // pedido daqui sai com ele. `null` = mundo sem auth, ou ainda nao pareado.
    this.jwt = null;
  }

  async _json(caminho, opcoes) {
    const cabecalhos = { ...((opcoes && opcoes.headers) || {}) };
    if (this.jwt) cabecalhos.Authorization = "Bearer " + this.jwt;
    const res = await fetch(this.base + caminho, {
      ...opcoes,
      headers: cabecalhos,
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) {
      const erro = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(erro.error || `o mundo respondeu ${res.status}`);
    }
    return res.json();
  }

  // --- leitura ------------------------------------------------------------ //

  contexto(personagem) {
    const quem = personagem || this.personagem;
    return this._json(`/api/context?character_id=${encodeURIComponent(quem)}`);
  }

  personagens() {
    return this._json("/api/characters");
  }

  // --- autenticacao (spec 056) --------------------------------------------- //

  // Se o mundo exige login, `google_client_id` vem preenchido. Vazio = modo
  // legado — nenhuma checagem daqui pra frente faz sentido.
  authConfig() {
    return this._json("/api/auth/config");
  }

  // So os personagens que sao MEUS (owner == sub do meu JWT). Usado pra
  // recusar cedo, antes de gastar turno de LLM num personagem que nao e meu.
  personagensMinhas() {
    return this._json("/api/characters/mine");
  }

  // Pergunta ao SERVER se este `jwt` (de OUTRO lado, nao necessariamente
  // `this.jwt`) e autentico, e devolve {sub, email, name} ou `null`. E a
  // verificacao que o conector delega em vez de reimplementar — ele nunca
  // guarda o `auth.secret` do server, entao nunca poderia assinar nem
  // conferir a assinatura sozinho.
  async validarToken(jwt) {
    if (!jwt) return null;
    try {
      const res = await fetch(this.base + "/api/auth/me", {
        headers: { Authorization: "Bearer " + jwt },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  // --- MCP: o caminho da Mente -------------------------------------------- //

  async _mcp(mensagens) {
    const lote = Array.isArray(mensagens) ? mensagens : [mensagens];
    const corpo = lote.map((m) => ({ jsonrpc: "2.0", id: ++this._rpcId, ...m }));
    const t = this.turnoId ? `&turno_id=${encodeURIComponent(this.turnoId)}` : "";
    return this._json(
      `/api/mcp?character_id=${encodeURIComponent(this.personagem)}${t}`,
      { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Array.isArray(mensagens) ? corpo : corpo[0]) });
  }

  // As capacidades da cena, ja no formato que os runtimes entendem.
  async listarCapacidades() {
    const r = await this._mcp({ method: "tools/list" });
    const tools = (r.result && r.result.tools) || [];
    // GUARDA OS NOMES DA CENA. O conector JÁ SABE o que existe aqui — não há
    // desculpa para mandar ao mundo um nome que ele mesmo poderia ter
    // desmentido. Ver `conhece`.
    this.capacidadesDaCena = new Set(tools.map((t) => t.name));
    // A TABELA DE RESOLUÇÃO (spec 060, US2).
    //
    // Aqui os schemas eram DESCARTADOS — guardava-se só o `Set` de nomes. Mas é
    // dentro deles que vem a lista de ids válidos por parâmetro, e é ela que
    // permite à Mente apontar por NOME sem nunca ver um id: o conector converte.
    // O dado já chegava à máquina do jogador; só estava sendo jogado fora.
    this.candidatosDaCena = _tabelaDeCandidatos(tools);
    log("MCP tools/list", tools.map((t) => t.name).join(", "));
    return tools;
  }

  // Os candidatos de um parâmetro, já emparelhados com o NOME que a Mente vê.
  // `null` quando o parâmetro não tem lista — e aí não há o que resolver: quem
  // chama manda a referência como veio (é texto livre por desenho, como a prosa).
  candidatosDe(capacidade, parametro) {
    const porParam = this.candidatosDaCena && this.candidatosDaCena[capacidade];
    const ids = porParam && porParam[parametro];
    if (!ids || !ids.length) return null;
    const nomes = this._nomesDaCena || {};
    return ids.map((id) => ({ id, nome: nomes[id] || id }));
  }

  // O DICIONÁRIO id -> nome, colhido do contexto. Sem ele a tabela teria só ids,
  // e resolver por nome seria impossível — é o contexto que sabe como cada coisa
  // se chama. Chamado por quem lê o contexto, uma vez por cena.
  registrarNomes(contexto) {
    const nomes = {};
    const guarda = (e) => { if (e && e.id) nomes[e.id] = e.name || e.nome || e.id; };
    const c = contexto || {};
    (c.characters_present || []).forEach((p) => {
      guarda(p);
      (p.carrying || []).forEach(guarda);
    });
    (c.items_present || []).forEach(guarda);
    (c.objects_present || []).forEach((o) => {
      guarda(o);
      (o.contains || []).forEach(guarda);
    });
    ((c.self && c.self.inventory) || []).forEach(guarda);
    (c.routes || []).forEach((r) => {
      if (r && r.id) nomes[r.id] = r.name || r.nome || r.id;
    });
    if (c.location && c.location.id) {
      nomes[c.location.id] = c.location.name || c.location.id;
    }
    this._nomesDaCena = nomes;
    return nomes;
  }

  // Esta capacidade existe NESTA cena? `null` = ainda não perguntamos, e aí não
  // se afirma nada: negar sem saber seria pior que perguntar ao mundo.
  conhece(nome) {
    if (!this.capacidadesDaCena) return null;
    return this.capacidadesDaCena.has(nome);
  }

  // Uma proposta. Devolve { texto, narrativa, recusado }.
  //
  // O resultado e MAGRO de proposito: `_narrativa` e nao o mundo inteiro. A 043
  // pagou essa conta — pendurar o outcome no resultado virou ~9 KB que, num
  // retorno de tool, sao ENTRADA DO MODELO: desastre de tokens e metagaming.
  // Quem precisa de mais rele o contexto.
  async chamarCapacidade(nome, args) {
    const r = await this._mcp({ method: "tools/call",
                                params: { name: nome, arguments: args } });
    const res = (r && r.result) || {};
    return {
      texto: ((res.content || [])[0] || {}).text || "",
      narrativa: res._narrativa || {},
      // condição de SISTEMA, separada da narrativa de propósito (item 52.1): a pane
      // do juízo não pode ser tecida como fato do mundo.
      sistema: res._sistema || null,
      recusado: res.isError === true,
    };
  }

  // --- o registro do turno (spec 044) ------------------------------------- //
  //
  // Canal PROPRIO, fora do caminho da proposta — de proposito. O que sobe na
  // proposta e lido pelo mundo para DECIDIR; engordar aquilo com o racional da
  // Mente degradaria todas as decisoes do turno, nao so esta.
  //
  // Falhar aqui NUNCA derruba o turno (FR-020).
  async registrar(linha) {
    try {
      await fetch(this.base + "/api/registro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(linha),
        signal: AbortSignal.timeout(15000),
      });
      return true;
    } catch (e) {
      log("REGISTRO NAO SUBIU (o turno segue)", e.message);
      return false;
    }
  }
}

module.exports = { Mundo };
