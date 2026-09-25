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

// QUAIS PARÂMETROS APONTAM PARA ALGO DA CENA, ditos pelo MUNDO (braço B).
//
// Só a MARCA, nunca a lista: os candidatos vêm do contexto (ver `candidatosDe`).
// Sem ela, `ask_directions.quem` e `set_intention.content` seriam os dois "string
// sem enum", e resolver o segundo trocaria a frase da Mente por um id.
function _tabelaPorNome(tools) {
  const tabela = {};
  for (const t of tools || []) {
    const marca = (t.annotations && t.annotations.byName) || null;
    const params = Array.isArray(marca) ? marca
                 : (marca && typeof marca === "object") ? Object.keys(marca) : null;
    if (params && params.length) tabela[t.name] = new Set(params);
  }
  return tabela;
}

// O MAPA POR PARÂMETRO, com os nomes — `{tool: {param: {id: nome}}}` (17/09).
//
// O `byName` sempre carregou isto; o conector lia só as CHAVES ("quais parâmetros são
// referência") e jogava os valores fora, porque a decisão de 11/09 foi tirar o nome do
// CONTEXTO. Continua certo para entidade: o contexto é mais fresco e diz o que existe
// AGORA.
//
// O que mudou é que apareceu um parâmetro cujo conjunto NÃO está no contexto e não é a
// cena: `memoria_id`. Resolver uma lembrança contra o dicionário inteiro dá 876
// candidatos misturados — pessoas, itens, lugares e memórias no mesmo balaio — e a
// margem do resolvedor colapsa: medido, 2/5 contra as 811 memórias, e pior ainda
// misturando. O `byName` tem o ESCOPO exato, por parâmetro, e não custa um token: ele
// morre no `traduzTools`, antes do corpo da requisição.
//
// Não é uma segunda fonte de verdade sobre nome de entidade: o contexto continua
// mandando onde ele tem a resposta (ver `candidatosDe`, ordem 1-2-3).
function _mapaPorParametro(tools) {
  const mapa = {};
  for (const t of tools || []) {
    const marca = (t.annotations && t.annotations.byName) || null;
    if (!marca || typeof marca !== "object" || Array.isArray(marca)) continue;
    for (const [param, pares] of Object.entries(marca)) {
      if (pares && typeof pares === "object" && Object.keys(pares).length) {
        (mapa[t.name] = mapa[t.name] || {})[param] = pares;
      }
    }
  }
  return mapa;
}

// Os enums que SOBREVIVERAM no schema (vocabulário fechado, subconjunto calculado).
// No braço B os de ENTIDADE já não chegam aqui — saíram na fonte, em `face.py`.
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
    this.porNomeDaCena = null;      // quais params são referência (braço B)
    this._nomesDaCena = null;       // id -> nome, colhido do contexto
    this._ausentes = null;          // spec 060: quem ele sabe nomear e não está aqui
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
    // A TABELA DE RESOLUÇÃO PRECISA DOS NOMES, e é aqui que eles chegam.
    //
    // A face traz os ids válidos por parâmetro; o CONTEXTO traz como cada coisa
    // se chama. Sem casar os dois, a tabela fica só com ids e o resolvedor cai
    // no fallback `nome: id` — e aí o nome CURTO casa por continência enquanto o
    // nome COMPLETO não casa, que é o inverso do que se quer.
    //
    // Medido em jogo (20 turnos do Irmão Tobias, spec 060): "Nerissa" resolvia
    // 9 vezes e "Nerissa, a Boticária" — o nome EXATO da cena — falhava 8, porque
    // "nerissa boticaria" (o id) não contém nem está contido em "nerissa a
    // boticaria". O ` a ` do meio quebrava a continência nos dois sentidos.
    this.registrarNomes(ctx);
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
    // A TABELA DE RESOLUÇÃO (spec 060, US2).
    //
    // Aqui os schemas eram DESCARTADOS — guardava-se só o `Set` de nomes. Mas é
    // dentro deles que vem a lista de ids válidos por parâmetro, e é ela que
    // permite à Mente apontar por NOME sem nunca ver um id: o conector converte.
    // O dado já chegava à máquina do jogador; só estava sendo jogado fora.
    this.candidatosDaCena = _tabelaDeCandidatos(tools);
    this.porNomeDaCena = _tabelaPorNome(tools);
    this.paresPorParametro = _mapaPorParametro(tools);
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

  // Os candidatos de um parâmetro, já emparelhados com o NOME que a Mente vê.
  //
  // BRAÇO B — O MAPA VEM DO CONTEXTO (2026-09-11).
  //
  // O desenho é o do documento de propostas, e a divisão é esta:
  //
  //   · o SCHEMA é estável — não carrega mais o elenco da cena (`face.py` parou de
  //     emitir enum de entidade). Ele diz a FORMA, nunca o conteúdo.
  //   · o CONTEXTO diz o que existe agora, com id e nome — e é dele que sai este
  //     mapa chave→valor, montado por `registrarNomes` a cada leitura de cena.
  //   · o mapa FICA NA MEMÓRIA DO CONECTOR. Nunca desce ao prompt: A Mente aponta
  //     pelo nome que ela já leu na cena, e a conversão acontece aqui.
  //   · o MUNDO valida. Resolver largo não afrouxa nada — quem decide se o alvo
  //     serve é o Motor, que revalida tudo (Princípio III).
  //
  // `annotations.byName` diz apenas QUAIS parâmetros são referência. Sem essa marca,
  // `set_intention.content` — que é prosa livre — seria "resolvido" contra a lista de
  // entidades, e o teor de um compromisso viraria um id, calado.
  candidatosDe(capacidade, parametro) {
    const nomes = this._nomesDaCena || {};
    // 1. o enum que SOBREVIVEU (vocabulário fechado, subconjunto calculado): ele é
    //    mais estreito que a cena e continua mandando onde existe.
    const porParam = this.candidatosDaCena && this.candidatosDaCena[capacidade];
    const ids = porParam && porParam[parametro];
    if (ids && ids.length) return ids.map((id) => ({ id, nome: nomes[id] || id }));
    const refs = this.porNomeDaCena && this.porNomeDaCena[capacidade];
    if (!refs || !refs.has(parametro)) return null;
    // 2. o MAPA POR PARÂMETRO do `byName`, quando o CONTEXTO não sabe nomear aquilo.
    //
    // Só vale para o que não está no dicionário da cena — hoje, a memória. Para
    // entidade o contexto continua mandando (ordem 3), porque ele é mais fresco: diz
    // o que existe AGORA, e o `byName` tem a idade do último `tools/list`.
    //
    // A diferença é de ESCOPO, e ela é medida: resolver `memoria_id` contra o
    // dicionário inteiro são 876 candidatos misturados; contra o mapa do parâmetro,
    // as 510 que são memória. O resolvedor abstém-se por margem, e margem colapsa com
    // vizinho parecido — quanto mais estreito o conjunto certo, mais ele resolve.
    const pares = this.paresPorParametro && this.paresPorParametro[capacidade];
    const doParametro = pares && pares[parametro];
    if (doParametro) {
      const fora = Object.entries(doParametro)
        .filter(([id]) => !nomes[id])       // o que o contexto nomeia, o contexto nomeia
        .map(([id, nome]) => ({ id, nome }));
      if (fora.length) return fora;
    }
    // 3. o MAPA DO CONTEXTO, para os parâmetros que o mundo marcou como referência.
    const doContexto = Object.entries(nomes).map(([id, nome]) => ({ id, nome }));
    return doContexto.length ? doContexto : null;
  }

  // O DICIONÁRIO id -> nome, colhido do contexto. Sem ele a tabela teria só ids,
  // e resolver por nome seria impossível — é o contexto que sabe como cada coisa
  // se chama. Chamado por quem lê o contexto, uma vez por cena.
  registrarNomes(contexto) {
    const nomes = {};
    const guarda = (e) => { if (e && e.id) nomes[e.id] = e.name || e.nome || e.id; };
    const c = contexto || {};
    ((c.scene && c.scene.characters) || []).forEach((p) => {
      guarda(p);
      (p.carrying || []).forEach(guarda);
    });
    ((c.scene && c.scene.items) || []).forEach(guarda);
    ((c.scene && c.scene.objects) || []).forEach((o) => {
      guarda(o);
      (o.contains || []).forEach(guarda);
    });
    ((c.self && c.self.inventory) || []).forEach(guarda);
    ((c.scene && c.scene.exits) || []).forEach((r) => {
      if (r && r.id) nomes[r.id] = r.name || r.nome || r.id;
    });
    if (c.scene && c.scene.place && c.scene.place.id) {
      nomes[c.scene.place.id] = c.scene.place.name || c.scene.place.id;
    }
    // QUEM ELE SABE NOMEAR MAS NÃO ESTÁ AQUI (spec 060). Vem do `involved` das
    // lembranças vivas, e é o que permite resolver "Ossa, a Cavadora" quando ela
    // saiu da taverna. Ver `_ausentes` e o comentário em `_peneira` sobre por que
    // essa proposta PRECISA chegar ao mundo em vez de morrer aqui.
    // spec 067: virou LISTA de {id, name} e mora em `self`. Antes era um mapa com o id
    // de CHAVE — um objeto cujas chaves variam com o conteúdo, impossível de tipar.
    //
    // E o nome ficou explícito: `known` sozinho não dizia O QUÊ nem ONDE. São as
    // entidades que ele SABE NOMEAR e que NÃO estão na cena — o que permite propor
    // sobre quem se lembra e deixar o mundo recusar com frase de mundo.
    const known = ((c.self && c.self.known_elsewhere) || []);
    this._ausentes = new Set(known.map((k) => k.id).filter(Boolean));
    for (const { id, name } of known) {
      if (id && !nomes[id]) nomes[id] = name || id;
    }
    this._nomesDaCena = nomes;
    return nomes;
  }

  // Este id é de algo que ele SABE NOMEAR mas que não está na cena? É a pergunta
  // que separa "a Mente inventou" de "a Mente lembrou" — e são casos com
  // desfechos opostos: o primeiro morre aqui, o segundo vai ao mundo.
  ehAusenteConhecido(id) {
    return !!(this._ausentes && this._ausentes.has(id));
  }

  // Os candidatos de um parâmetro MAIS o que ele sabe nomear de fora da cena.
  // Resolver contra este conjunto maior é o que faz a proposta CHEGAR ao mundo
  // com um id de verdade, para ele recusar com a frase dele.
  candidatosOuConhecidos(capacidade, parametro) {
    // `null` de `candidatosDe` significa "esta tool não pede id aqui, é texto
    // livre por desenho" (set_intention.content, promise.expectativa...) — e
    // tem de PERMANECER `null`, nunca virar `[]`. Um array vazio parece "há
    // lista, mas está vazia" pra quem chama, e isso faz `_resolverAlvos`
    // tentar casar a frase inteira contra zero candidatos: falha garantida,
    // sempre, pra todo parâmetro que nunca teve enum. Foi o que travou
    // `set_intention` em produção por dois dias (81 falhas no devlog) antes
    // de ninguém nunca conseguir formar um compromisso.
    const daCena = this.candidatosDe(capacidade, parametro);
    if (!daCena || !daCena.length || !this._ausentes || !this._ausentes.size) {
      return daCena;
    }
    const vistos = new Set(daCena.map((c) => c.id));
    const fora = [];
    for (const id of this._ausentes) {
      if (!vistos.has(id)) fora.push({ id, nome: (this._nomesDaCena || {})[id] || id });
    }
    return daCena.concat(fora);
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

// `_tabelaDeCandidatos` sai exposta para teste: é a peça que transforma a face
// em tabela de resolução, e um defeito nela é invisível de fora.
module.exports = { Mundo, _tabelaDeCandidatos };
