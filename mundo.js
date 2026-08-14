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

class Mundo {
  constructor(base, personagem) {
    this.base = String(base || "").replace(/\/$/, "");
    this.personagem = personagem;
    this._rpcId = 0;
    // o id do turno viaja na QUERY, nunca nos argumentos da capacidade:
    // argumento de capacidade e materia de julgamento, e isto nao e.
    this.turnoId = null;
    this.capacidadesDaCena = null;
  }

  async _json(caminho, opcoes) {
    const res = await fetch(this.base + caminho, {
      ...opcoes,
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
    log("MCP tools/list", tools.map((t) => t.name).join(", "));
    return tools;
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

  // --- o caminho legado (/api/act) ---------------------------------------- //
  //
  // NAO e resto morto: quando a Mente devolve prosa solta em vez de propostas
  // nomeadas, e por aqui que o turno acontece. E o que permite trocar de modelo
  // sem quebrar o jogo, e a spec 044 nao o aposenta.
  async agir(intent, aoVivo, origem, plano) {
    const res = await fetch(this.base + "/api/act", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character_id: this.personagem, intent,
                             origem, plano: plano || null }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) {
      const erro = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(erro.error || `o mundo respondeu ${res.status}`);
    }
    const ctype = res.headers.get("Content-Type") || "";
    if (!ctype.includes("x-ndjson")) {
      const outcome = await res.json().catch(() => ({}));
      return { outcome, rejeitado: null, viuFim: true };
    }
    let outcome = null, rejeitado = null, viuFim = false;
    await porLinha(res, (linha) => {
      let ev;
      try { ev = JSON.parse(linha); } catch (_) { return; }
      if (!ev || !ev.ev) return;
      if (ev.ev === "done") { outcome = ev.outcome || {}; viuFim = true; }
      else if (ev.ev === "rejected") { rejeitado = ev; }
      else if (ev.ev === "op_applied" || ev.ev === "failed") {
        if (aoVivo) aoVivo(ev);
      }
      // turn_start / heartbeat: sinal de vida, nada a fazer
    });
    return { outcome, rejeitado, viuFim };
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

// Le uma resposta linha a linha (NDJSON). `TextDecoder` e global no Node.
async function porLinha(res, aoLer) {
  const leitor = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await leitor.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const linha = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (linha) aoLer(linha);
    }
  }
}

module.exports = { Mundo };
