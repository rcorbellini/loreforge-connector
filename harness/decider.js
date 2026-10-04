// O DECISOR (Open-Jev) — escolha tipada lendo a LETRA da opção, sem gerar texto.
//
// Porta de `v1/lib.py::escolha` e `v1/decisor.py::torneio` (research R2). É o que tira
// do modelo PAGO a escolha de tool e de ids: a Mente diz o que quer, e isto aponta,
// entre as opções que EXISTEM, qual realiza. Custo: uma chamada local de 1 token.
//
// FAZ PARTE DO RUNTIME QUE O JOGADOR TRAZ, como a Mente, e por isso NÃO TEM FALLBACK
// (Princípio VIII): se o endpoint cair, o erro sobe e o turno para com um recado
// honesto. A primeira versão da spec caía no tool calling de hoje — seria manter vivo
// um segundo motor de decisão, o que a spec 045 já proibiu.
//
// E É PARTE DO PERSONAGEM (memória `jev-e-mente-sao-o-mesmo-ecossistema`): os prompts
// são parametrizáveis por mesa, e o Princípio IX vale aqui como vale para a Mente —
// o decisor ESCOLHE, nunca julga desfecho no mundo.
//
// Três armadilhas do instrumento, já pagas no protótipo:
//   1. `" B"` e `"B"` colidem ao tirar o espaço — fica o MAIOR logprob, não o último.
//   2. A softmax satura; a MARGEM (logprob da 1ª − da 2ª) é o que diz a confiança.
//   3. Mais de 16 opções (A–P) não cabem: torneio em grupos intercalados.

"use strict";

const { janelaEstourou, DEFAULTS: { janela: DEFAULTS_JANELA } } = require("../config");

const LETRAS = "ABCDEFGHIJKLMNOP";
const TIMEOUT = 120000;

const SYSTEM_PADRAO = "Apply the supplied criterion to the supplied evidence. Choose exactly one listed "
  + "option. Respond with only its uppercase letter, with no explanation or reasoning.";

class DeciderUnavailable extends Error {
  constructor(msg) { super(msg); this.name = "DeciderUnavailable"; }
}

function createDecider({ cfg, fetchImpl, system } = {}) {
  const conf = { runtime: "ollama", endpoint: "http://localhost:11434", model: "qwen3:8b",
                 ...((cfg && cfg.decisor) || {}) };
  const _fetch = fetchImpl || ((...a) => fetch(...a));
  const custo = { chamadas: 0, tokens_prompt: 0 };

  function sistema() {
    return typeof system === "function" ? system() : (system || SYSTEM_PADRAO);
  }

  // A MESMA janela da Mente (`cfg.janela`, 04/10/2026): era 4.096 aqui e 32.768 lá, e o Ollama
  // recarregava o modelo a cada troca entre os dois (+3,5 s cada).
  const janela = Number(cfg && cfg.janela) || DEFAULTS_JANELA;

  async function _ollama(payload) {
    const corpo = {
      model: conf.model, stream: false, think: false, logprobs: true, top_logprobs: 20,
      keep_alive: "30m", options: { num_predict: 1, temperature: 0, num_ctx: janela },
      messages: [{ role: "system", content: sistema() },
                 { role: "user", content: JSON.stringify(payload) }],
    };
    let res;
    try {
      res = await _fetch(String(conf.endpoint).replace(/\/$/, "") + "/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo), signal: AbortSignal.timeout(TIMEOUT),
      });
    } catch (e) {
      throw new DeciderUnavailable(`o decisor não respondeu (${e.message})`);
    }
    if (!res.ok) throw new DeciderUnavailable(`o decisor respondeu ${res.status}`);
    const r = await res.json();
    // o corte do começo levaria o critério e as opções: uma letra assim não decide nada
    if (janelaEstourou(r.prompt_eval_count, janela)) {
      throw new Error(`a pergunta ao decisor não coube na janela (${janela} tokens)`);
    }
    custo.chamadas += 1;
    custo.tokens_prompt += Number(r.prompt_eval_count) || 0;
    const lps = r.logprobs && r.logprobs[0] && r.logprobs[0].top_logprobs;
    if (!Array.isArray(lps)) throw new DeciderUnavailable("o decisor não devolveu logprobs");
    const top = {};
    for (const tk of lps) {
      const k = String(tk.token || "").trim();
      top[k] = Math.max(top[k] === undefined ? -1e9 : top[k], tk.logprob);
    }
    return top;
  }

  // O SemIf (`~/ferramentas-ia/openjev/semif_server.py`) fala `{state, question,
  // options:[{id, description}]}` e devolve probabilidades por id; a letra vira o id,
  // e a probabilidade volta a logprob para o ranking ser o mesmo nos dois backends.
  async function _semif(payload) {
    const corpo = { state: payload.evidence, question: payload.criterion,
                    options: payload.options.map((o) => ({ id: o.letter, description: o.description })) };
    let res;
    try {
      res = await _fetch(String(conf.endpoint).replace(/\/$/, "") + "/v1/decide", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo), signal: AbortSignal.timeout(TIMEOUT),
      });
    } catch (e) {
      throw new DeciderUnavailable(`o decisor não respondeu (${e.message})`);
    }
    if (!res.ok) throw new DeciderUnavailable(`o decisor respondeu ${res.status}`);
    const r = await res.json();
    custo.chamadas += 1;
    const ans = (r.answers || [])[0] || {};
    custo.tokens_prompt += Number(ans.prompt_tokens) || 0;
    const top = {};
    for (const [letra, p] of Object.entries(ans.probabilities || {})) {
      top[letra] = p > 0 ? Math.log(p) : -100;
    }
    return top;
  }

  // Uma pergunta, 2 a 16 opções `[id, descrição]`. Devolve
  // `{ vencedora, margem, ranking: [[id, prob, logprob], ...] }`.
  async function choose(evidencia, criterio, opcoes) {
    if (!Array.isArray(opcoes) || opcoes.length < 2 || opcoes.length > LETRAS.length) {
      throw new Error(`o decisor aceita 2 a ${LETRAS.length} opções, veio ${opcoes && opcoes.length}`);
    }
    const payload = {
      evidence: evidencia, criterion: criterio,
      options: opcoes.map(([, d], i) => ({ letter: LETRAS[i], description: String(d) })),
    };
    const top = conf.runtime === "semif" ? await _semif(payload) : await _ollama(payload);
    const lp = opcoes.map((_, i) => (top[LETRAS[i]] === undefined ? -100 : top[LETRAS[i]]));
    const m = Math.max(...lp);
    const ex = lp.map((x) => Math.exp(x - m));
    const s = ex.reduce((a, b) => a + b, 0);
    const ranking = opcoes.map(([id], i) => [id, ex[i] / s, lp[i]])
      .sort((a, b) => b[2] - a[2]);
    return { vencedora: ranking[0][0], margem: ranking[0][2] - ranking[1][2], ranking };
  }

  // Torneio para listas longas: grupos intercalados de até 15, e a final disputa com
  // `extra` (a opção NENHUMA, quando houver). Devolve o mesmo formato de `choose`.
  async function tournament(evidencia, criterio, opcoes, extra) {
    const comExtra = (lista) => (extra ? lista.concat([extra]) : lista);
    if (opcoes.length + (extra ? 1 : 0) <= LETRAS.length) {
      if (opcoes.length === 1 && !extra) {
        return { vencedora: opcoes[0][0], margem: Infinity, ranking: [[opcoes[0][0], 1, 0]] };
      }
      return choose(evidencia, criterio, comExtra(opcoes));
    }
    const k = Math.ceil(opcoes.length / 15);
    const grupos = Array.from({ length: k }, (_, j) => opcoes.filter((__, i) => i % k === j));
    const finalistas = [];
    for (const g of grupos) {
      if (g.length === 1) { finalistas.push(g[0]); continue; }
      const r = await choose(evidencia, criterio, g);
      finalistas.push(g.find(([id]) => id === r.vencedora));
    }
    return tournament(evidencia, criterio, finalistas, extra);
  }

  function custoLocal() { return { ...custo }; }
  function zerarCusto() { custo.chamadas = 0; custo.tokens_prompt = 0; }
  function modelo() { return `${conf.runtime}/${conf.model}`; }

  // O `check` do runtime: o modelo existe no endpoint? (Princípio VIII: o jogador
  // precisa saber ANTES de jogar, não no meio do turno.)
  async function check() {
    if (conf.runtime === "semif") {
      try {
        const r = await _fetch(String(conf.endpoint).replace(/\/$/, "") + "/health",
                               { signal: AbortSignal.timeout(5000) });
        return r.ok ? { ok: true } : { ok: false, erro: `o decisor respondeu ${r.status}` };
      } catch (e) { return { ok: false, erro: `o decisor não respondeu (${e.message})` }; }
    }
    try {
      const r = await _fetch(String(conf.endpoint).replace(/\/$/, "") + "/api/tags",
                             { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return { ok: false, erro: `o decisor respondeu ${r.status}` };
      const j = await r.json();
      const tem = (j.models || []).some((m) => m.name === conf.model || m.model === conf.model
        || m.name === `${conf.model}:latest`);
      return tem ? { ok: true }
        : { ok: false, erro: `o modelo do decisor (${conf.model}) não está no Ollama — rode \`ollama pull ${conf.model}\`` };
    } catch (e) {
      return { ok: false, erro: `o decisor não respondeu em ${conf.endpoint} (${e.message})` };
    }
  }

  return { choose, tournament, custoLocal, zerarCusto, modelo, check, LETRAS };
}

module.exports = { createDecider, DeciderUnavailable, SYSTEM_PADRAO, LETRAS };
