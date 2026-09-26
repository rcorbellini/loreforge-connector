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

// A TABELA DE RESOLUÇÃO SAIU DAQUI (spec 075). Ela convertia o NOME que a Mente
// escrevia num tool call no id que o mundo espera (`candidatosDe`, `registrarNomes`,
// `candidatosOuConhecidos`), e só servia ao caminho de tool calling. No harness por
// objetivos quem aponta o id é o C7 (`harness/params.js`), escolhendo entre os valores
// do próprio enum da face — o nome nunca precisa ser convertido de volta.


class Mundo {
  constructor(base, personagem) {
    this.base = String(base || "").replace(/\/$/, "");
    this.personagem = personagem;
    this._rpcId = 0;
    // o id do turno viaja na QUERY, nunca nos argumentos da capacidade:
    // argumento de capacidade e materia de julgamento, e isto nao e.
    this.turnoId = null;
    this.capacidadesDaCena = null;
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
    // O VEREDITO DE IDENTIDADE VOLTA A QUEM CUIDA DA SALA (spec 072, research R6).
    //
    // Sem isto, um membro cujo token o mundo deixou de aceitar queima uma chamada de
    // modelo a CADA volta do relógio para o servidor dizer 401 no fim — de graça para o
    // mundo e caro para quem paga. Dois seguidos param os assentos dele.
    //
    // Não existe expiração natural a tratar (o JWT do mundo não tem `exp`), então isto
    // só dispara quando o `auth.secret` do server muda. Raro, e caro de descobrir tarde.
    if (typeof this.onIdentidade === "function") {
      try { this.onIdentidade(res.status); } catch (_) { /* nunca derruba o turno */ }
    }
    if (!res.ok) {
      const erro = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(erro.error || `o mundo respondeu ${res.status}`);
    }
    return res.json();
  }

  // --- leitura ------------------------------------------------------------ //

  async contexto(personagem) {
    const quem = personagem || this.personagem;
    const ctx = await this._json(
      `/api/context?character_id=${encodeURIComponent(quem)}`);
    return ctx;
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

  // Os personagens de OUTRA pessoa que nao o dono deste cliente (spec 072).
  //
  // Numa sala, quem entra com um personagem e um MEMBRO, e a posse tem de ser conferida
  // com o JWT DELE — nunca com o do anfitriao. Perguntar ao server com o token errado
  // devolveria a lista errada, e o assento nasceria com o dono errado; dai em diante todo
  // `tools/call` daquele personagem tomaria 403 do `_authorize_character`.
  async personagensDe(jwt) {
    if (!jwt) return [];
    const res = await fetch(this.base + "/api/characters/mine", {
      headers: { Authorization: "Bearer " + jwt },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    return res.json();
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
    // A DESCRIÇÃO PLAYER-FACING, por nome (spec 074, FR-016) — a MESMA fonte que
    // `loreforge-portal` já cura desde a spec 043/item 036. Guardada aqui porque é
    // exatamente onde o `tools/list` já chega; sem isto, `acp/capacidade_kind.js`
    // não teria de onde tirar o `title` sem inventar texto novo.
    this.descricaoPorNome = {};
    for (const t of tools) this.descricaoPorNome[t.name] = t.description || "";
    log("MCP tools/list", tools.map((t) => t.name).join(", "));
    return tools;
  }

  // O texto player-facing de UMA capacidade (spec 074, FR-016) — string vazia se
  // `tools/list` ainda não rodou ou a capacidade não existe nesta cena.
  descricaoDe(nomeCapacidade) {
    return (this.descricaoPorNome && this.descricaoPorNome[nomeCapacidade]) || "";
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
      // O QUE HÁ DE CORRIGÍVEL NA RECUSA (spec 073). Vem do mundo como DADO
      // (`{campo, validos:[{id,nome}]}`); quem escreve a frase para A Mente é o
      // conector — ver `laco._recusaEmPalavras`. A API não sabe contra qual modelo
      // se está falando, e não deveria.
      recusa: res._recusa || null,
      recusado: res.isError === true,
    };
  }

  // --- o desejo (spec 075, opção 2: o world guarda, o harness decide) ------ //
  //
  // As MESMAS portas que o client usa para o dono editar os compromissos
  // (`/api/intention/*`), autorizadas pelo JWT do dono do assento. Nenhuma passa pelo
  // Árbitro: escrever a própria intenção é ESCOLHA do personagem (Princípio IX classe 3),
  // não juízo — e o Motor valida o arquivo como sempre (Princípios III e VI).
  async _intencao(rota, corpo) {
    return this._json(`/api/intention/${rota}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character_id: this.personagem, ...corpo }),
    });
  }

  criarIntencao(content) { return this._intencao("create", { content }); }

  atualizarIntencao(intentionId, content) {
    return this._intencao("update", { intention_id: intentionId, content });
  }

  // `status`: "concluida" (o fim virou verdade) | "abandonada" (ele desistiu).
  // `lembrar`: a desistência vira memória dele (spec 073, FR-015).
  fecharIntencao(intentionId, status, { lembrar = false } = {}) {
    return this._intencao("close", { intention_id: intentionId, status, lembrar });
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
