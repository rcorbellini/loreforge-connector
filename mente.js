// A MENTE — a inteligência do personagem, rodando no modelo trazido pelo player.
// Quatro runtimes: Ollama local, Anthropic, OpenRouter e Gemini, os quatro com
// tool-calling nativo.
//
// ESTE ARQUIVO SAIU DO NAVEGADOR (spec 044). Ele era `client/mente.js` e vivia
// numa página servida pelo projeto; agora roda no processo do jogador, na
// máquina dele. O que mudou foi POUCO, de propósito: eram 5 usos de
// `localStorage` e nenhum `window`/`document`, então a saída custou um adaptador
// de armazenamento — não uma reescrita. Os três adaptadores de runtime e o
// streaming abaixo são o código que a spec 043 mediu dirigindo a Mente real, e
// não se toca neles sem medir de novo.
//
// A GARANTIA, agora literal: a credencial nunca esteve — e agora nem poderia
// estar — numa página servida por terceiro. Ela vive em arquivo na máquina do
// jogador, e o `config` a guarda como propriedade não-enumerável para que nem
// um `JSON.stringify` distraído a leve embora.

"use strict";

const configuracao = require("./config");
const HARNESS_PROMPTS = require("./harness/prompts");
const { log: _logExterno } = require("./log");

// A MENTE É UMA POR ASSENTO (spec 072, FR-007).
//
// Era um singleton de módulo: `_mundo`, `_custo` e o cache do resolvedor viviam no
// arquivo, e o conector servia um personagem só. Numa sala isso misturaria a tabela de
// resolução de uma cena com a de outra e a fatura de um jogador com a de outro — em
// silêncio, que é o pior modo.
//
// O REFACTOR FOI LÉXICO, DE PROPÓSITO (research R5): move estado, não move lógica.
// Nenhuma linha de prompt, de payload ou de adaptador de runtime mudou — o aviso do
// topo deste arquivo continua valendo, e é o que a T057 confere por diff.
function criarMente({ mundo, extensoes } = {}) {
  const DEFAULTS = configuracao.DEFAULTS;

  function config() {
    return configuracao.carregar();
  }

  function saveConfig(cfg) {
    return configuracao.gravar(cfg);
  }

  function devlog(label, content) {
    _logExterno(`A Mente · ${label}`, content);
  }

  // O RUNTIME QUE O JOGADOR TRAZ são DOIS agora (spec 075, Princípio VIII): a Mente e o
  // decisor. Sem qualquer um deles não se joga, e é aqui — antes do turno — que isso se
  // diz, em vez de o turno parar no meio.
  async function check() {
    const mente = await _checkMente();
    if (!mente.ok) return mente;
    const { createDecider } = require("./harness/decider");
    const d = await createDecider({ cfg: config() }).check();
    if (!d.ok) return { ok: false, reason: `decisor: ${d.erro}` };
    const dc = config().decisor || {};
    return { ok: true, reason: `${mente.reason} · decisor ${dc.model || "?"}` };
  }

  async function _checkMente() {
    const cfg = config();
    if (cfg.runtime === "remote") {
      if (!cfg.apiKey) return { ok: false, reason: "falta a chave da Anthropic." };
      return { ok: true, reason: `Claude remoto · ${cfg.remoteModel}` };
    }
    if (cfg.runtime === "openrouter") {
      if (!cfg.openrouterKey) return { ok: false, reason: "falta a chave." };
      const host = (cfg.openrouterEndpoint || DEFAULTS.openrouterEndpoint).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      return { ok: true, reason: `${host} · ${cfg.openrouterModel}` };
    }
    if (cfg.runtime === "gemini") {
      if (!cfg.geminiKey) return { ok: false, reason: "falta a chave do Gemini." };
      return { ok: true, reason: `Gemini · ${cfg.geminiModel || DEFAULTS.geminiModel}` };
    }
    try {
      const res = await fetch(cfg.endpoint.replace(/\/$/, "") + "/api/tags");
      if (!res.ok) return { ok: false, reason: `o Ollama respondeu ${res.status}.` };
      const data = await res.json();
      const models = (data.models || []).map((m) => m.name || m.model || "");
      const installed = models.some((n) => n === cfg.model || n.startsWith(cfg.model + ":") || n.startsWith(cfg.model));
      if (models.length && !installed) return { ok: false, reason: `modelo "${cfg.model}" não instalado.` };
      return { ok: true, reason: `Ollama local · ${cfg.model}` };
    } catch (_) {
      return { ok: false, reason: `o Ollama não respondeu em ${cfg.endpoint}.` };
    }
  }


  // O CLIENTE MCP saiu daqui (spec 044): mora em `mundo.js`, que é a única porta
  // do conector para fora. A Mente não conhece endereço nenhum — ela pensa, e quem
  // fala com o mundo é outro. Desde a spec 075 ela nem vê as capacidades: quem as lê
  // (`tools/list`) é o harness, e quem escolhe entre elas é o decisor (C6/C7).
  let _mundo = null;
  function usarMundo(m) { _mundo = m; }
  async function listarCapacidades() {
    if (!_mundo) return [];
    return _mundo.listarCapacidades();
  }

  // As extensões de quem tuna (spec 044). Sem elas, tudo aqui roda no padrão —
  // a vertente de jogar é a de tunar com os defaults.
  let _ext = null;
  function usarExtensoes(e) { _ext = e; }

  // Um prompt substituível. Quem tuna troca o arquivo; o resto do laço não sabe.
  function _sys(nome, padrao) {
    const p = _ext && _ext.prompts && _ext.prompts[nome];
    return typeof p === "string" && p.trim() ? p : padrao;
  }

  // === CUSTO DO TURNO (spec 044) =============================================
  // Quem tuna precisa saber o que cada corrida custou, e quem joga precisa não
  // ser surpreendido pela fatura. É ADITIVO de propósito: os três runtimes
  // continuam devolvendo exatamente o que devolviam — o custo é anotado ao lado.
  //
  // Limitação honesta: nas respostas STREAMADAS o total de tokens nem sempre vem,
  // e aí o custo daquela chamada fica zerado em vez de estimado. Melhor um número
  // ausente que um número inventado.
  let _custo = { entrada: 0, saida: 0, chamadas: 0 };
  function _contabiliza(entrada, saida) {
    _custo.entrada += Number(entrada) || 0;
    _custo.saida += Number(saida) || 0;
    _custo.chamadas += 1;
  }
  function custoDoTurno() { return { ..._custo }; }
  function zerarCusto() { _custo = { entrada: 0, saida: 0, chamadas: 0 }; }


  // === O DIALETO DE CADA PROVEDOR ===========================================
  // `dialeto.js` MORREU na spec 075. Ele traduzia o schema das TOOLS e o histórico de
  // tool calling para cada provedor — e a Mente não recebe mais tool nenhuma: ela só
  // conversa (objetivos, querer, narrar). Cada runtime abaixo fala texto puro.

  async function callModel(system, user, opts = {}) {
    // A ROTINA PODE TROCAR O MODELO E AS OPÇÕES (item 79, spec 073 T026).
    //
    // `opts.rotina` é o nome da rotina (`objetivos`, `narrar`…). Quando `porRotina`
    // tem entrada para ela, o que estiver ali SOBREPÕE o config geral — inclusive
    // `think`, que não é detalhe: pensando, o `qwen3` gasta 86 s e devolve plano
    // vazio em 6 de 8. Sem entrada, nada muda e o caminho é byte-a-byte o de antes.
    // NÃO espalhe o config aqui: em `config.js` os SEGREDOS são não-enumeráveis de
    // propósito (a trava que os mantém fora de todo log e dump), e `{...cfg}` os
    // apaga em silêncio — as três integrações remotas morrem com "configure sua
    // chave". A herança por protótipo sobrepõe o que a rotina pediu e deixa o resto
    // (segredos inclusive) vindo do original.
    const _base = config();
    const _daRotina = (opts.rotina && (_base.porRotina || {})[opts.rotina]) || {};
    const cfg = Object.keys(_daRotina).length
      ? Object.assign(Object.create(_base), _daRotina)
      : _base;
    const label = opts.label || "chamada ao modelo";
    const alvo = cfg.runtime === "remote" ? cfg.remoteModel
               : cfg.runtime === "openrouter" ? cfg.openrouterModel
               : cfg.runtime === "gemini" ? (cfg.geminiModel || DEFAULTS.geminiModel)
               : cfg.model;
    // O `think` GERAL (2026-09-25) viaja também — o default da Mente passou a ser o
    // `qwen3:8b`, e sem o campo no corpo TODA rotina pensaria (86 s, plano vazio). A
    // rotina que declara o dela sobrepõe; a que não declara herda o geral.
    const _think = _daRotina.think !== undefined ? _daRotina.think : _base.think;
    if (_think !== undefined) opts = { ...opts, think: _think };

    devlog(`ENVIADO À MENTE — ${label}`, `[runtime] ${cfg.runtime} (${alvo})\n\n[system]\n${system}\n\n[user]\n${user}`);

    // `opts.onToken` (spec 043) atravessa para o runtime, que streama se houver.
    // Sem callback, o caminho é byte-a-byte o de antes (um tiro, sem stream).
    const raw = cfg.runtime === "remote" ? await anthropic(cfg, system, user, opts)
              : cfg.runtime === "openrouter" ? await openrouter(cfg, system, user, opts)
              : cfg.runtime === "gemini" ? await gemini(cfg, system, user, opts)
              : await ollama(cfg, system, user, opts);

    devlog(`RETORNO DA MENTE — ${label}`, raw);
    return raw;
  }

  // === STREAMING DE TOKEN (spec 043) ==========================================
  // Só a NARRAÇÃO streama. As chamadas que devolvem JSON (interpretar, autonomia)
  // seguem em um tiro: streamar um JSON não adianta nada — ninguém consegue ler
  // metade de um objeto, e o parse só acontece no fim de qualquer jeito.
  //
  // O ganho é de PERCEPÇÃO: a prosa é a parte longa do turno, e vê-la nascer
  // palavra a palavra tira a sensação de travamento. O texto final é idêntico.
  //
  // `onToken(delta)` recebe cada pedaço; quem chama concatena ou pinta. Erro no
  // callback NUNCA derruba a geração (o turno já mudou o mundo; perder a prosa
  // por um erro de tela seria trocar o certo pelo cosmético).
  function _safeToken(onToken) {
    if (typeof onToken !== "function") return null;
    return (delta) => { try { onToken(delta); } catch (_) { /* tela caiu; segue */ } };
  }

  // Lê um corpo de resposta linha a linha (NDJSON do Ollama, SSE dos outros).
  async function _lines(res, onLine) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const linha = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (linha) onLine(linha);
      }
    }
    if (buf.trim()) onLine(buf.trim());
  }

  // Extrai o payload de uma linha SSE ("data: {...}"), ou null se não for dado.
  function _sse(linha) {
    if (!linha.startsWith("data:")) return null;
    const corpo = linha.slice(5).trim();
    if (!corpo || corpo === "[DONE]") return null;
    try { return JSON.parse(corpo); } catch (_) { return null; }
  }

  async function ollama(cfg, system, user, { forceJson = false, temperature = 0.4, onToken, think } = {}) {
    const emit = _safeToken(onToken);
    const body = {
      model: cfg.model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      stream: !!emit,
      options: { temperature },
      // spec 073: `think:false` viaja no CORPO — `/no_think` no prompt não funciona
      // nesta versão do Ollama. Só desce quando a rotina pediu.
      ...(think !== undefined ? { think } : {}),
    };
    if (forceJson) body.format = "json";
    let res;
    try {
      res = await fetch(cfg.endpoint.replace(/\/$/, "") + "/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
    } catch (_) { throw new Error("não foi possível falar com o Ollama local."); }
    if (!res.ok) throw new Error(`erro do modelo local (${res.status}).`);
    if (!emit) {
      const data = await res.json();
      _contabiliza(data.prompt_eval_count, data.eval_count);
      const msg = data.message || {};
      return msg.content || "";
    }
    // NDJSON: uma linha JSON por token, com o delta em `message.content`.
    let texto = "";
    await _lines(res, (linha) => {
      let obj; try { obj = JSON.parse(linha); } catch (_) { return; }
      const delta = obj.message && obj.message.content;
      if (delta) { texto += delta; emit(delta); }
      // o ÚLTIMO pedaço (`done`) traz a conta da chamada inteira — sem isto a narração,
      // que é a única chamada streamada, sumia do custo do turno (C9 sem `custo_pago`)
      if (obj.done) _contabiliza(obj.prompt_eval_count, obj.eval_count);
    });
    return texto;
  }

  async function anthropic(cfg, system, user, { forceJson = false, temperature = 0.4, onToken } = {}) {
    if (!cfg.apiKey) throw new Error("configure sua chave da Anthropic no ⚙.");
    const emit = _safeToken(onToken);
    const messages = [{ role: "user", content: user }];
    if (forceJson) messages.push({ role: "assistant", content: "{" });
    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          // `anthropic-dangerous-direct-browser-access` saiu com a cisão: fora
          // do navegador não há navegador a quem avisar do perigo.
          "content-type": "application/json", "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: cfg.remoteModel, max_tokens: 1024, temperature: Math.min(temperature, 1),
          system, messages, stream: !!emit,
        }),
      });
    } catch (_) { throw new Error("não foi possível falar com a Anthropic."); }
    if (!res.ok) {
      let msg = `erro Anthropic (${res.status}).`;
      try { const err = await res.json(); if (err?.error?.message) msg = err.error.message; } catch (_) {}
      throw new Error(msg);
    }
    if (emit) {
      // SSE: o texto vem em `content_block_delta` com `delta.text`.
      let texto = "";
      await _lines(res, (linha) => {
        const ev = _sse(linha);
        const delta = ev && ev.type === "content_block_delta" && ev.delta && ev.delta.text;
        if (delta) { texto += delta; emit(delta); }
      });
      return forceJson ? "{" + texto : texto;
    }
    const data = await res.json();
    _contabiliza(data?.usage?.input_tokens, data?.usage?.output_tokens);
    let text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    if (forceJson) text = "{" + text;
    return text;
  }

  async function openrouter(cfg, system, user, { forceJson = false, temperature = 0.4, onToken, think } = {}) {
    const url = (cfg.openrouterEndpoint || DEFAULTS.openrouterEndpoint).replace(/\/$/, "") + "/chat/completions";
    // O MESMO FORMATO (OpenAI) serve a outra API: a do DeepSeek. Ela PENSA POR PADRÃO
    // (o `deepseek-flash` também), e o thinking nativo nunca entra (mantenedor, 03/10):
    // desliga-se com `thinking` no corpo. O OpenRouter tem outro campo para isso, ainda
    // não medido — por ora só o DeepSeek o recebe.
    const deepseek = /api\.deepseek\.com/.test(url);
    const quem = deepseek ? "DeepSeek" : "OpenRouter";
    if (!cfg.openrouterKey) throw new Error(`configure sua chave do ${quem} no ⚙.`);
    const emit = _safeToken(onToken);
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.openrouterKey, "X-Title": "Loreforge" },
        body: JSON.stringify({
          model: cfg.openrouterModel, temperature, stream: !!emit,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          ...(deepseek ? { thinking: { type: think === true ? "enabled" : "disabled" } } : {}),
          // o plano pede JSON: o mesmo modo que o Ollama (`format`) e o Gemini (`responseMimeType`) têm
          ...(deepseek && forceJson ? { response_format: { type: "json_object" } } : {}),
          // sem isto a narração (a única chamada streamada) some do custo do turno
          ...(deepseek && emit ? { stream_options: { include_usage: true } } : {}),
        }),
      });
    } catch (_) { throw new Error(`não foi possível falar com o ${quem}.`); }
    if (!res.ok) {
      let msg = `erro ${quem} (${res.status}).`;
      try { const err = await res.json(); if (err?.error?.message) msg = err.error.message; } catch (_) {}
      throw new Error(msg);
    }
    if (emit) {
      // SSE estilo OpenAI: o delta vem em `choices[0].delta.content`; o último pedaço
      // traz `usage` quando a API o manda.
      let texto = "";
      await _lines(res, (linha) => {
        const ev = _sse(linha);
        const delta = ev && ev.choices && ev.choices[0] && ev.choices[0].delta
                      && ev.choices[0].delta.content;
        if (delta) { texto += delta; emit(delta); }
        if (ev && ev.usage) _contabiliza(ev.usage.prompt_tokens, ev.usage.completion_tokens);
      });
      return texto;
    }
    const data = await res.json();
    _contabiliza(data?.usage?.prompt_tokens, data?.usage?.completion_tokens);
    const msg = data.choices?.[0]?.message || {};
    return msg.content || "";
  }

  // O THINKING NATIVO NUNCA ENTRA (mantenedor, 03/10): o pensar do harness é o contrato
  // dele (o M), e não se troca pelo raciocínio escondido do modelo. O Gemini 3.5 Flash
  // PENSA POR PADRÃO — sem `thinkingConfig`, a bateria do M2 gastou de 383 a 2.882 tokens
  // de thinking por chamada, pagos e fora do contrato. `thinkingBudget: 0` foi medido
  // nesse modelo: 0 token de thinking. Só a mesa que liga o `think` volta ao padrão dele.
  async function gemini(cfg, system, user, { temperature = 0.4, onToken, forceJson = false, think } = {}) {
    if (!cfg.geminiKey) throw new Error("configure sua chave do Gemini no ⚙.");
    const emit = _safeToken(onToken);
    const contents = [{ role: "user", parts: [{ text: String(user ?? "") }] }];
    const modelo = cfg.geminiModel || DEFAULTS.geminiModel;
    const metodo = emit ? "streamGenerateContent" : "generateContent";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:${metodo}`
              + (emit ? "?alt=sse" : "");
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        // a chave vai em CABEÇALHO, não na URL — uma URL com chave acaba em log
        // de acesso e em histórico de terminal com uma facilidade que um
        // cabeçalho não tem.
        headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.geminiKey },
        body: JSON.stringify({
          contents, systemInstruction: { parts: [{ text: system }] },
          // o plano do C3 (spec 076) é JSON: o modo JSON do Gemini foi o que a bateria mediu
          generationConfig: { temperature: Math.min(temperature, 2),
                              ...(forceJson ? { responseMimeType: "application/json" } : {}),
                              ...(think === true ? {} : { thinkingConfig: { thinkingBudget: 0 } }) },
        }),
      });
    } catch (_) { throw new Error("não foi possível falar com o Gemini."); }
    if (!res.ok) {
      let msg = `erro Gemini (${res.status}).`;
      try { const err = await res.json(); if (err?.error?.message) msg = err.error.message; } catch (_) {}
      throw new Error(msg);
    }
    if (emit) {
      // SSE: cada evento é um `GenerateContentResponse` inteiro, com o pedaço de
      // texto novo em `candidates[0].content.parts`.
      let texto = "";
      await _lines(res, (linha) => {
        const ev = _sse(linha);
        const partes = ev && ev.candidates && ev.candidates[0] && ev.candidates[0].content
                      && ev.candidates[0].content.parts;
        const delta = (partes || []).map((p) => p.text || "").join("");
        if (delta) { texto += delta; emit(delta); }
      });
      return texto;
    }
    const data = await res.json();
    // o thinking é pago como saída: se a mesa o ligou, ele aparece no custo do turno
    const uso = data?.usageMetadata || {};
    _contabiliza(uso.promptTokenCount, (Number(uso.candidatesTokenCount) || 0) + (Number(uso.thoughtsTokenCount) || 0));
    const cand = (data.candidates && data.candidates[0]) || {};
    return ((cand.content && cand.content.parts) || []).map((p) => p.text || "").join("");
  }

  const NARRATE_SYSTEM = `Você é o narrador de um RPG. Sua única função é narrar as consequências da última ação do personagem ("personagem").

REGRA DE OURO (PONTO DE VISTA): A narração DEVE ser na 2ª pessoa ("você"), dirigindo-se DIRETAMENTE ao "personagem". O sistema enviará os fatos ("acontecido", "mudou_no_mundo") escritos em 3ª pessoa (ex: "Corbellini fez X"), mas você é OBRIGADO a traduzir para a 2ª pessoa (ex: "Você fez X"). Nunca trate o personagem como uma terceira pessoa separada do jogador.

HIERARQUIA DE EVENTOS:
1. "nao_aconteceu" — a tentativa frustrada.
2. "mudou_no_mundo" — a consequência DIRETA e fato consumado.

NUNCA INVENTE FATO (a regra mais importante):
- Narre SOMENTE o que vier em "acontecido", "mudou_no_mundo" e "nao_aconteceu". Se um fato não está ali, ele NÃO ACONTECEU.
- É PROIBIDO narrar chegadas, partidas, portas, gestos de terceiros ou qualquer evento que os fatos não afirmem. Quem está na cena JÁ ESTÁ nela — não narre ninguém entrando, nem o personagem chegando a lugar nenhum.
- Quando os fatos são poucos, a narração é CURTA. Uma frase fiel vale mais que um parágrafo bonito e falso. Preencher o vazio com cenário inventado é o pior erro possível: o jogador passa a decidir com base num mundo que não existe.
- Se o único fato é uma tentativa FRUSTRADA, narre a tentativa e a frustração — e mais nada. NADA de completar com o que "talvez" houvesse: se você precisa escrever "talvez", "como se" ou "provavelmente", PARE — é sinal de que está inventando.
- NÃO troque o sujeito. Se o fato diz que FULANO está de mãos ocupadas, são as mãos DELE — nunca as suas. Ler o fato errado e narrar por outra pessoa é o pior tipo de mentira, porque parece verdade.
- NÃO invente objetos. Só existem os itens que os fatos e o contexto nomeiam. Nada de "frascos, talvez, ou ervas".

RESTRIÇÕES SEVERAS:
- Prosa fluida, literária e curta (1 a 2 parágrafos).
- NÃO liste os NPCs presentes de forma mecânica. Mencione do cenário apenas quem for diretamente impactado pela sua ação.
- É ESTRITAMENTE PROIBIDO terminar a narração fazendo perguntas ao jogador (ex: "O que você faz agora?") ou oferecendo opções (ex: "Você pode escolher..."). Apenas narre o fato e encerre o texto secamente.
- SEM termos de sistema (id, json, action).`;

  const OBSERVE_SYSTEM = `Você é a mente do personagem "observador", olhando para algo percebido. Escreva em 1-2 frases curtas, centrada nele, o que vê — TINGIDO pela vivência. NUNCA fale como narrador externo.`;

  // Os ids que a cena põe diante dele: quem está aqui e onde ele está. A memória que
  // envolve um deles volta sozinha, mesmo velha — é o que distingue "lembrar" de
  // "estar lembrando".
  function _quemEvoca(cena) {
    const c = cena || {};
    const ids = ((c.characters || []).map((x) => x && x.id)).filter(Boolean);
    const lugar = (c.place && c.place.id) || (c.location && c.location.id);
    if (lugar) ids.push(lugar);
    return new Set(ids);
  }

  // === O QUE ESTÁ GRITANDO NA CABEÇA DELE AGORA ===
  //
  // Desde 2026-09-17 o `get_context` entrega o ALCANCE inteiro — tudo o que ele
  // conseguiria lembrar se parasse para tentar, viva ou vencida (`docs/fluxo-do-
  // contrato.md` § "O princípio, afiado"). Decidir o que está PRESENTE passou a ser
  // daqui, e são três cortes, nesta ordem:
  //
  //   1. VIVA. A vencida é alcançável — é o que faz `consultar_memoria` poder ser
  //      respondida sem voltar ao mundo —, mas não está na cabeça dele sozinha.
  //   2. EVOCAÇÃO. Fica o que está vívido POR SI, mais o que envolve alguém presente
  //      ou o lugar atual. A regra é da spec 013 e não mudou; mudou de lado. Os
  //      insumos dela (`salience`, `recency`) continuam vindo do mundo, calculados do
  //      relógio e da intensidade — são FATO.
  //   3. TETO de 12. Quanto cabe depende do modelo, e é o BFF que sabe.
  //
  // `evocadoPor` são os ids presentes na cena mais o do lugar. Sem ele (chamada que
  // não tem cena à mão), a evocação é pulada e só o corte de vida e o teto valem.
  function _limparMemorias(memories, evocadoPor) {
    if (!memories || !memories.length) return [];

    const evoca = evocadoPor instanceof Set ? evocadoPor : new Set(evocadoPor || []);
    const presentes = (memories || []).filter((m) => {
      // `estado` só existe no contrato novo. Ausente = o servidor já filtrou (era o
      // que ele fazia até 17/09), e aí não há o que cortar aqui.
      if (m && m.estado && m.estado !== "viva") return false;
      if (!evoca.size) return true;
      if (m && m.salience === "vivida") return true;
      return (m && m.involved || []).some((i) => evoca.has(i));
    });

    // 1. Ordena explicitamente pelo tempo (mais recentes/maior timestamp primeiro)
    const ordenadas = [...presentes].sort((a, b) => 
      (b.timestamp_start || 0) - (a.timestamp_start || 0)
    );

    const seen = new Set();
    const cleaned = [];
    
    // 2. Varre as mais recentes e desduplica
    for (const m of ordenadas) {
      // O ALCANCE NÃO CARREGA O CORPO — só o `summary`. Ler apenas `content` aqui
      // devolveria lista VAZIA no contrato novo, em silêncio, e a Mente jogaria sem
      // memória nenhuma com a suíte verde. É o modo de falha que o
      // `docs/fluxo-do-contrato.md` existe para impedir; o fallback mantém o contrato
      // ANTIGO funcionando, para um servidor mais velho não quebrar o conector.
      const text = (m.summary || m.content || m.conteudo || "").trim();
      if (!text) continue;
      
      if (!seen.has(text)) {
        seen.add(text);
        // 3. unshift insere no início do array.
        // Assim, a memória mais recente (índice 0 do loop) vai parar no FINAL do array 'cleaned',
        // permitindo que a LLM leia os eventos na ordem cronológica (do mais antigo para o mais novo).
        cleaned.unshift({
          saliencia: m.salience,
          recencia: m.recency,
          intensidade: m.intensity,
          o_que: text,
        });
      }
      
      // 4. Trava de segurança para a Carga Cognitiva da LLM (ex: 12 memórias vitais).
      // Como ordenamos por tempo primeiro, se houver corte, cortaremos as mais antigas.
      if (cleaned.length >= 12) break;
    }
    
    return cleaned;
  }

  // Desduplicador simples para arrays de strings (usado em reconhecimentos)
  function _limparTextos(arrayDeTextos) {
    if (!arrayDeTextos || !arrayDeTextos.length) return [];
    return [...new Set(arrayDeTextos.map(t => typeof t === 'string' ? t.trim() : t.conteudo))].filter(Boolean).slice(-5);
  }

  function _pertenceA(node) {
    if (!node) return null;
    return {
      nome: node.name,
      descricao: node.prose,
      belongs_to: _pertenceA(node.belongs_to),
    };
  }

  // O TRECHO SOCIAL (spec 066) — o CONTRATO 2, e ele é só nosso.
  //
  // O servidor entrega o fato NA ENTIDADE (`bond` e `sentiment` em cada presente) e não
  // se preocupa com como uma LLM lê. Quem decide a redação é o conector, e é por isso
  // que um jogador pode trocá-lo inteiro sem que o mundo mude.
  //
  // DUAS REGRAS, e as duas são MEDIDAS, não intuídas:
  //
  //  1. O AFETO VEM ANTES DO VÍNCULO na entrada de cada pessoa. Medido em 8 rodadas
  //     contra o llama3.1:8b: nesta ordem o vínculo sobrevive 6-8/8; na ordem inversa,
  //     0-1/8. **O MECANISMO NÃO ESTÁ IDENTIFICADO** — nove variantes foram testadas,
  //     duas vencem e são estruturalmente opostas, e três explicações foram falsificadas
  //     pela variante seguinte. A regra é empírica. Quem for mexer aqui: rode
  //     `server/tests/exploracao/sondagem_slot1_frase.py` ANTES, e não confie em
  //     explicação, porque não há uma. (E a métrica é um proxy: mede se o modelo ECOA a
  //     palavra, não se ele DECIDE com ela.)
  //
  //  2. NENHUM POSSESSIVO AMBÍGUO para o personagem. "seu" em português é *dele/dela*
  //     OU *de você*, e num objeto que descreve outra pessoa a leitura natural inverte o
  //     eixo em silêncio — devolvendo justamente o que o outro sente, que é segredo do
  //     mundo e nunca desce. Por isso "Você guarda mágoa dela", nunca "seu afeto".
  //
  // Fato e crença se distinguem pela GRAMÁTICA, não por chave: aposto para o vínculo
  // ("Hulda, irmã"), verbo psicológico para o afeto ("Você guarda mágoa dela").
  // O rótulo NEUTRO do afeto. A spec 067 fez o contrato ficar COMPLETO — `sentiment`
  // desce SEMPRE, inclusive neutro — e empurrou este custo para cá, que é o lugar
  // certo: o servidor entrega o mundo inteiro, o conector decide o que a LLM lê.
  //
  // Sem este filtro a prosa saía agramatical em toda a praça: "Você sem história que
  // pese num sentido ou noutro de Bento." — treze vezes, uma por estranho.
  //
  // Comparar com a string não é parsear prosa: o vocabulário de `sentiment` é parte
  // PUBLICADA do contrato (`docs/contrato-do-contexto.md`), como um enum seria.
  const AFETO_NEUTRO = "sem história que pese num sentido ou noutro";

  function _trechoSocial(presentes) {
    const frases = [];
    for (const c of presentes) {
      const nome = c.name;
      if (!nome) continue;
      const afeto = (c.sentiment && c.sentiment !== AFETO_NEUTRO) ? c.sentiment : null;
      // quem não qualifica não entra: o trecho ENCOLHE com a multidão em vez de crescer
      if (!afeto && !c.relation) continue;
      if (afeto) frases.push(`Você ${afeto} de ${nome}.`);
      if (c.relation) frases.push(`${nome}, ${c.relation}.`);
    }
    if (!frases.length) return null;   // ausente, nunca vazio
    return "Quem lhe diz alguma coisa aqui: " + frases.join(" ");
  }

  async function _contextoPayload(context, { comCapacidades = true } = {}) {
    // O conector LÊ um contrato que ele não controla (spec 067: `self` / `scene`), e
    // um jogador pode trocar este arquivo inteiro. Acesso defensivo aqui não é
    // compatibilidade retroativa — é não explodir a face por um nó ausente.
    const _self = context.self || {};
    const _scene = context.scene || {};
    const _place = _scene.place || {};
    const _outros = (_scene.characters || []).filter((c) => c.state !== "self");
    const _social = _trechoSocial(_outros);
    return {
      personalidade: _self.prose,
      // O QUE ELE SENTE (item 51, fatia 1). Vem em RÓTULO do mundo — nunca número,
      // que é segredo dele. Sem isto o personagem não tinha como SABER que estava
      // com fome: o payload não trazia status nenhum, e a única porta era um campo
      // (`survival_level`) que nunca existiu.
      // rótulo em PORTUGUÊS também no JSON: o `AUTONOMY_SYSTEM` manda "Leia a
      // `necessidade`", e o que ele encontrava era `hunger`/`thirst`. Ver
      // `_necessidadeEmPortugues`.
      necessidade: _necessidadeComRotulo(_self.needs),
      contexto: {
        local: _place.name,
        descricao: _place.prose,
        belongs_to: _pertenceA(_place.belongs_to),
        // spec 066: o vínculo com o LUGAR, onde o lugar já está. Omitido quando não há.
        ...(_place.relation ? { vinculo_com_o_local: _place.relation } : {}),
        // spec 066: o TRECHO SOCIAL vem ANTES de `presentes` — a ordem das chaves no
        // JSON é preservada, e o formato foi medido com o trecho antes da lista.
        // Omitido por inteiro quando ninguém qualifica: nunca desce vazio.
        ...(_social ? { contexto_social: _social } : {}),
        // O ID SAI DAQUI (spec 060, US2): a Mente aponta por NOME e o conector
        // resolve. Ela nunca vê um id — e por isso não tem como inventar um,
        // que era a família de recusa mais comum do item 52.5.
        //
        // spec 066: a lista fica LIMPA — vínculo e afeto vivem no trecho social acima,
        // não repetidos aqui. Duplicar informação no mesmo prompt já custou acerto neste
        // projeto (o bloco `capacidades`, 2026-08-17: 4 de 9 chamadas saíam sem
        // tool_call). Não se repete o erro.
        presentes: _outros.map((c) => ({
          nome: c.name, fazendo: c.action, carrega: (c.carrying || []).map((it) => it.name),
        })),
        objetos_presentes: (_scene.objects || []).map((o) => ({
          nome: o.name, interactions: o.interactions || null, contem: (o.contains || []).map((c) => c.name),
        })),
        // spec 066: o vínculo com o ITEM viaja com o item — o servidor já o entrega ali.
        // A REDAÇÃO dele para A Mente NÃO foi medida (só o caso pessoa-pessoa passou pela
        // sondagem), então ele desce como campo, sem prosa composta: entregar o dado é
        // honesto, inventar redação não medida não é.
        itens_presentes: (_scene.items || []).map((it) => ({
          nome: it.name,
          interactions: it.interactions || null,
          ...(it.relation ? { vinculo: it.relation } : {}),
          // spec 070: o TRABALHO PARADO. O contrato entrega `started_by` (o id de quem
          // começou) e `work_in_progress` (a capacidade que retoma); quem compara com a
          // vez e escreve a frase é este lado — a divisão da spec 067.
          //
          // O ID MORRE AQUI: para a prosa vai um booleano e um NOME, porque nenhum id de
          // cena pode chegar ao modelo (spec 060, US2 — e foi medido que ele atrapalha).
          ...(it.work_in_progress ? { retoma_com: it.work_in_progress } : {}),
          ...(it.started_by
            ? (it.started_by === _self.id
                ? { comecado_por_mim: true }
                : { comecado_por: _nomeNaCena(_scene, it.started_by) })
            : {}),
          ...(it.urgency ? { urgencia: it.urgency } : {}),
        })),
        inventario: (_self.inventory || []).map((it) => it.name),
      },
      // Aplica a blindagem aqui:
      // QUEM EVOCA: os presentes na cena mais o lugar. É o que a spec 013 chama de
      // "o antigo só volta se o contexto evoca" — a regra agora roda aqui, com os
      // insumos (`salience`) vindos do mundo.
      memorias: _limparMemorias(_self.memories, _quemEvoca(_scene)),
      rotas_disponiveis: (_scene.exits || []).map((r) => ({ nome: r.name, para: r.destination_name })),
      // `comCapacidades` é FALSE no harness por objetivos (spec 075): a Mente diz o que
      // quer SEM ver a face — escolher a capacidade é do decisor. Repetir as
      // capacidades em prosa já era medido como nocivo (2026-08-17: 4 de 9 chamadas sem
      // tool_call com o bloco duplicado; `specs/043-tools-exposed-to-mind/
      // testar_duplicacao_capacidades.py`). O parâmetro fica para a bancada.
      ...(comCapacidades ? { capacidades: (context.capacidades || []).map((c) => ({
        nome: c.nome,
        o_que_faz: c.descricao,
        // `alvos_possiveis` (LISTA de opções) tem nome DIFERENTE do `alvos` que a
        // proposta devolve (a ESCOLHA, um valor por parâmetro). Chamar os dois de
        // "alvos" fazia o modelo espelhar a forma que via: devolvia a lista inteira
        // ou um array de um elemento no lugar do id. Medido com llama3.1:8b — era a
        // causa dominante de turno perdido.
        alvos_possiveis: c.alvos,
        // O QUE É OBRIGATÓRIO. Sem isto o modelo escolhe a capacidade certa e
        // esquece o parâmetro que não tem lista de opções — `set_intention` sem
        // `content`, `promise` sem `expectativa`. Medido: era a recusa mais comum
        // depois que os nomes de capacidade passaram a sair certos.
        exige: c.exige,
      })) } : {}),
    };
  }

  // O RÓTULO DA NECESSIDADE VAI EM PORTUGUÊS PARA A MENTE — e esta função existe
  // porque a fronteira aqui é a do projeto inteiro: o CONTRATO é API e fala inglês
  // (`hunger`/`thirst`/`fatigue`/`sleep`, spec 067, e está certo); a PROSA é para um
  // modelo que raciocina em português, e montá-la é trabalho do conector.
  //
  // Antes da 067 as chaves já eram português e a linha saía sozinha certa. Depois dela
  // o `_cenaEmProsa` passou a interpolar a chave CRUA, e a Mente lia
  // "Como ele está: hunger: com fome, thirst: sem sede" — rótulo em inglês colado num
  // valor em português. O item 30 mediu que o NOME é o que o modelo lê para decidir
  // (`sleep` 6/10 contra `wake_up` 10/10 com a MESMA descrição), então nome meia-boca
  // não é cosmético aqui.
  //
  // Chave desconhecida passa direto, sem tradução: um campo novo no contrato aparece
  // na prosa em vez de sumir em silêncio, que é o modo de falha que já custou caro.
  const _ROTULO_NECESSIDADE = { hunger: "fome", thirst: "sede",
                                fatigue: "cansaço", sleep: "sono" };


  // id -> nome, olhando só a cena. Devolve `null` (e não o id) quando não acha: um id
  // cru na prosa é justamente o que a spec 060 tirou do prompt depois de medir que
  // atrapalha. Sem nome, a peça vira "em processo" e ninguém mente sobre a autoria.
  function _nomeNaCena(scene, id) {
    const c = ((scene || {}).characters || []).find((x) => x.id === id);
    // QUEM COMEÇOU PODE TER IDO EMBORA — e foi o que aconteceu no caso real: o Draven
    // largou o alaúde na taverna e viajou. Sem nome, dizer "de outra pessoa" é o que se
    // sabe honestamente; cuspir o id seria mentir num formato feio.
    return (c && c.name) || "outra pessoa";
  }

  function _necessidadeEmPortugues(needs) {
    return Object.entries(needs || {})
      // `sleep` é `null` para quem está acordado (o server devolve o rótulo só quando
      // dorme) — filtrar o vazio é o certo, e não é o que escondia o campo.
      .filter(([, v]) => v)
      .map(([k, v]) => [_ROTULO_NECESSIDADE[k] || k, v]);
  }

  // A mesma tradução, na forma de OBJETO — para os payloads que ainda viajam em JSON
  // (autonomia e narração). `null` quando não há nada a dizer, como antes.
  function _necessidadeComRotulo(needs) {
    const pares = _necessidadeEmPortugues(needs);
    return pares.length ? Object.fromEntries(pares) : null;
  }

  function _cenaEmProsa(d) {
    const c = d.contexto || {};
    const linhas = [];
    linhas.push(`Ele está em ${c.local || "algum lugar"}.` +
                (c.descricao ? ` ${c.descricao}` : ""));
    // `_pertenceA` devolve uma CADEIA aninhada ({nome, descricao, belongs_to}) —
    // a hierarquia de lugares. Interpolar o objeto cru rendia "[object Object]",
    // e foi assim que saiu no primeiro turno real. Aqui ela vira o caminho que
    // uma pessoa diria: "dentro de Porto Negro, na Costa de Ferro".
    const cadeia = [];
    for (let n = c.belongs_to; n && n.nome && cadeia.length < 4; n = n.belongs_to) {
      cadeia.push(n.nome);
    }
    if (cadeia.length) linhas.push(`Fica dentro de ${cadeia.join(", que fica em ")}.`);
    if (d.personalidade) linhas.push(`Quem ele é: ${d.personalidade}`);
    if (d.necessidade) {
      const n = _necessidadeEmPortugues(d.necessidade)
        .map(([k, v]) => `${k}: ${v}`).join(", ");
      if (n) linhas.push(`Como ele está: ${n}.`);
    }
    const presentes = (c.presentes || []).map((p) => {
      const carrega = (p.carrega || []).length
        ? `, carregando ${(p.carrega || []).join(", ")}` : "";
      return `${p.nome}${p.fazendo ? ` (${p.fazendo})` : ""}${carrega}`;
    });
    // spec 066: O TRECHO SOCIAL vem ANTES da lista de presentes — o formato foi medido
    // assim, e a ordem é parte do que se mediu. Ver `_trechoSocial` para as duas regras
    // (afeto antes do vínculo; nenhum possessivo ambíguo) e para a ressalva de que o
    // mecanismo por trás delas NÃO está identificado.
    if (c.contexto_social) linhas.push(c.contexto_social);
    linhas.push(presentes.length
      ? `Estão aqui: ${presentes.join("; ")}.` : "Não há mais ninguém aqui.");
    // spec 066: o vínculo com o LUGAR entra junto de onde o lugar já é dito.
    if (c.vinculo_com_o_local) {
      linhas.push(`${c.local || "Este lugar"}, ${c.vinculo_com_o_local}.`);
    }
    // spec 066: o vínculo com ITEM viaja com o item. A redação para item NÃO passou por
    // sondagem (só o caso pessoa-pessoa passou) — por isso é aposto simples, a forma
    // mais próxima da que se mediu, sem inventar construção nova.
    // O TRABALHO PARADO SAI DA LISTA (spec 070). Como um nome numa lista, a peça em
    // processo é ignorada: MEDIDO em 2026-09-08, com sussurro diretivo para retomar o
    // conserto, `craft` saía 6/10 — e em 3 dessas 10 a Mente tentava VIAJAR, porque nada
    // dizia que a peça estava ali e era dela. Com a frase abaixo: 10/10, por 38 tokens.
    //
    // Só o trabalho DELE ganha linha própria. O de outro fica na lista com o aposto de
    // quem começou — é cena ("a peça da Elga está no meio"), não chamado à ação.
    const meus = (c.itens_presentes || []).filter((i) => i.retoma_com && i.comecado_por_mim);
    const outros = (c.itens_presentes || []).filter((i) => !meus.includes(i));
    for (const i of meus) {
      linhas.push(`Trabalho seu, parado: ${i.nome}. Está aqui, e é com \`${i.retoma_com}\``
        + ` que se retoma.` + (i.urgencia ? ` ${i.urgencia}` : ""));
    }
    const itens = outros.map((i) => {
      const notas = [];
      if (i.vinculo) notas.push(i.vinculo);
      if (i.retoma_com && i.comecado_por) {
        notas.push(`trabalho de ${i.comecado_por}, no meio`);
      } else if (i.retoma_com && !/em processo|pela metade/i.test(i.nome)) {
        // O NOME DA PEÇA JÁ COSTUMA DIZER. `criar_peca` batiza "Remendão (em processo)",
        // e acrescentar o aposto rendia "Remendão (em processo) (em processo)".
        notas.push("em processo");
      }
      return notas.length ? `${i.nome} (${notas.join("; ")})` : i.nome;
    });
    if (itens.length) linhas.push(`No chão: ${itens.join(", ")}.`);
    const objs = (c.objetos_presentes || []).map((o) => {
      const dentro = (o.contem || []).length ? ` (com ${(o.contem || []).join(", ")})` : "";
      return `${o.nome}${dentro}`;
    });
    if (objs.length) linhas.push(`Por perto: ${objs.join(", ")}.`);
    const inv = c.inventario || [];
    linhas.push(inv.length ? `Ele carrega: ${inv.join(", ")}.` : "Ele não carrega nada.");
    const rotas = (d.rotas_disponiveis || []).map((r) =>
      `${r.nome}${r.para ? `, que leva a ${r.para}` : ""}`);
    if (rotas.length) linhas.push(`Saídas: ${rotas.join("; ")}.`);
    // `_limparMemorias` entrega `{saliencia, recencia, intensidade, o_que}` — é o
    // `o_que` que carrega o texto. Aceitar as outras formas é defensivo, não
    // esperança: se a forma mudar, a prosa não emudece em silêncio.
    const mem = (d.memorias || []).map((m) =>
      typeof m === "string" ? m
        : (m && (m.o_que || m.summary || m.content || m.conteudo || m.resumo)) || "")
      .filter(Boolean);
    if (mem.length) linhas.push(`Ele lembra: ${mem.join(" | ")}`);
    const intencoes = (d.intencoes || []).map((i) =>
      typeof i === "string" ? i : (i && (i.content || i.conteudo)) || "").filter(Boolean);
    if (intencoes.length) linhas.push(`Ele se comprometeu a: ${intencoes.join(" | ")}`);
    return linhas.join("\n");
  }

  // `onToken` (spec 043): recebe cada pedaço da prosa conforme ela nasce, para a
  // tela mostrar a narração se formando em vez de um vazio até o fim. É a única
  // chamada que streama — as que devolvem JSON não ganham nada com isso.
  // SEM `eventosParalelos` (achado 2026-09-29 — corrigido no mesmo dia): o
  // "enquanto isso ao redor" tecido dentro desta MESMA prosa dependia da
  // Mente escrever um marcador literal ("Enquanto isso, ao redor: ...") que
  // o client reconhecesse pra separar visualmente — e ela nem sempre
  // escrevia, então o recorte às vezes não disparava e tudo saía junto,
  // sem divisor. O diff (`diffTextual`) é DADO determinístico, não carece de
  // narração nenhuma: agora viaja pro client como evento PRÓPRIO
  // (`laco.js._emite("paralelo", ...)`), fora desta chamada — narrar não é
  // mais o canal dele.
  async function narrate(narrativeHint, context, failedEffects, viradas, aconteceu, informes, reconhecimentos, material, onToken) {
    const failures = (failedEffects || []).filter(Boolean);
    const twists = (viradas || []).map((v) => v.o_que).filter(Boolean);
    // `_self`/`_scene` são locais por função, nunca do módulo (o defeito de 06/09).
    const _self = context.self || {};
    const _scene = context.scene || {};
    const _place = _scene.place || {};

    const payload = {
      personagem: _self.name,
      acontecido: narrativeHint,
      mudou_no_mundo: (aconteceu || []).length ? aconteceu : null,
      nao_aconteceu: failures.length ? failures : null,
      viradas_do_destino: twists.length ? twists : null,
      perguntou_a_alguem: (informes || []).length ? informes : null,
      // ITEM 52.3: o MATERIAL das capacidades CONSULTIVAS. Vinha do server em canais
      // que o MCP não encaminhava — `lido` (o texto que o `examine` leu), `wares` (o
      // que o vendedor tem), `falas` (o que o informante disse do caminho). A Mente
      // examinava e não recebia NADA de volta; medido na Nerissa: `examine` 90x,
      // `ask_directions` 83x, `ask_wares` 24x — metade dos turnos dela em capacidades
      // cujo resultado nunca chegava. Um parâmetro só, com o nome do conceito
      // (`_MATERIAL_CH` do lado do server), em vez de três posicionais a mais.
      leu: ((material || {}).lido || []).length ? material.lido : null,
      viu_a_venda: ((material || {}).wares || []).length ? material.wares : null,
      ouviu_sobre_o_caminho: ((material || {}).falas || []).length ? material.falas : null,
      reconhece_na_cena: (reconhecimentos || []).length ? reconhecimentos.map((r) => ({
        o_que: r.name,
        familiaridade: r.familiaridade,
        afeto: r.afeto,
        // Limpa também as memórias vivas redundantes do reconhecimento
        lembra: r.grau === "nitido" ? _limparTextos(r.memorias_vivas) : null,
      })) : null,
      personalidade: _self.prose,
      // O QUE ELE SENTE (item 51, fatia 1). Vem em RÓTULO do mundo — nunca número,
      // que é segredo dele. Sem isto o personagem não tinha como SABER que estava
      // com fome: o payload não trazia status nenhum, e a única porta era um campo
      // (`survival_level`) que nunca existiu.
      // rótulo em PORTUGUÊS também no JSON: o `AUTONOMY_SYSTEM` manda "Leia a
      // `necessidade`", e o que ele encontrava era `hunger`/`thirst`. Ver
      // `_necessidadeEmPortugues`.
      necessidade: _necessidadeComRotulo(_self.needs),
      local: _place.name,
      belongs_to: _pertenceA(_place.belongs_to),
      presentes: (_scene.characters || []).filter((c) => c.state !== "self").map((c) => ({ nome: c.name, fazendo: c.action })),
      // Aplica a blindagem nas memórias descritivas da narração:
      // QUEM EVOCA: os presentes na cena mais o lugar. É o que a spec 013 chama de
      // "o antigo só volta se o contexto evoca" — a regra agora roda aqui, com os
      // insumos (`salience`) vindos do mundo.
      memorias: _limparMemorias(_self.memories, _quemEvoca(_scene)),
    };
    return (
      await callModel(
        _sys("narrar", NARRATE_SYSTEM),
        "Narre ao jogador.\n\n" + JSON.stringify(payload, null, 2),
        { forceJson: false, temperature: 0.7, label: "NARRAR (acontecido → prosa)",
          onToken }
      )
    ).trim();
  }

  async function narrateObservation(pacote, context) {
    const grau = pacote.grau || "ausente";
    const payload = {
      observador: (context && context.self && context.self.name) || pacote.observer || "ele",
      o_que_e: pacote.name ? `${pacote.name}: ${pacote.description || pacote.prosa || ""}` : (pacote.description || pacote.prosa || ""),
      grau,
      familiaridade: grau === "ausente" ? null : pacote.familiaridade || null,
      afeto: pacote.afeto || null,
      // Limpa as memórias da observação
      lembrancas: grau === "nitido" ? _limparTextos(pacote.memorias_vivas) : null,
    };
    return (
      await callModel(
        OBSERVE_SYSTEM,
        "Narre o que ele vê.\n\n" + JSON.stringify(payload, null, 2),
        { forceJson: false, temperature: 0.7, label: "OBSERVAR (reconhecer → prosa)" }
      )
    ).trim();
  }


  // Os textos PADRÃO de cada rotina, para a página de configuração mostrar o que
  // está em uso e o que se está substituindo. Os do harness (objetivos, querer,
  // querer, e os do decisor) vivem em `harness/prompts.js` — um lugar só, com versão.
  function promptsPadrao() {
    return { narrar: NARRATE_SYSTEM, ...HARNESS_PROMPTS.PADRAO };
  }

  // AS ROTINAS (spec 075). Saíram `interpretar` (a escolha de tool por tool calling),
  // `autonomia` e `refletir`: a Mente agora só DIZ o que quer (objetivos), PLANEJA e
  // NARRA — escolher a capacidade e os ids é do decisor local, de graça.
  const ROTINAS = [
    ...HARNESS_PROMPTS.ROTINAS_HARNESS,
    { nome: "narrar",
      titulo: "Narrar o desfecho (C9)",
      quando: "ao fim de todo turno" },
  ];

  // UMA CONVERSA SEM TOOLS — a única forma de chamar a Mente no harness por objetivos.
  //
  // O schema das tools nunca desce (invariante 1 do contrato 01): o que ela devolve é
  // prosa, e quem aponta tool e ids é o decisor. `rotina` escolhe o modelo por
  // `porRotina` e entra no rótulo do log. Devolve o TEXTO.
  // `json`: a rotina devolve JSON (o plano do C3, spec 076) — o runtime liga o modo JSON
  // quando tem um (Ollama `format`, Gemini `responseMimeType`); os outros seguem pelo prompt.
  async function conversar(system, user, { rotina, label, temperature = 0.4, maxTokens, json = false } = {}) {
    const r = await callModel(system, user, {
      rotina, label: label || rotina || "conversa", temperature,
      ...(maxTokens ? { maxTokens } : {}), ...(json ? { forceJson: true } : {}) });
    if (typeof r === "string") return r;
    return (r && (r.texto || r.text)) || "";
  }

  // As dependências podem vir na construção (o caminho da sala) ou depois, pelos
  // setters (o caminho que os testes e o `bin/conector.js` já usavam).
  if (mundo) usarMundo(mundo);
  if (extensoes) usarExtensoes(extensoes);

  return {
    promptsPadrao, ROTINAS,
    config, saveConfig, check, usarMundo, usarExtensoes, conversar,
    narrate, narrateObservation, log: devlog, DEFAULTS,
    custoDoTurno, zerarCusto, listarCapacidades,
    get extensoes() { return _ext; },
    _contextoPayload, _cenaEmProsa, _limparMemorias,
  };
}

// A PORTA DO MÓDULO PARA O QUE NÃO TEM ESTADO.
//
// `_cenaEmProsa`, `_contextoPayload`, `_limparMemorias`, os prompts
// padrão e as constantes são PUROS — não dependem de assento nenhum. Uma instância criada
// uma vez serve de porta para eles, e é isso que mantém `require("./mente")._cenaEmProsa`
// funcionando exatamente como antes (é assim que os testes da 060 os alcançam).
//
// Ela NÃO é a Mente de ninguém: não tem mundo, não joga turno, e o custo dela nunca é
// lido. Quem joga é a instância do assento (`criarMente` em `sala.js`).
const _semEstado = criarMente();

module.exports = {
  criarMente,
  // constantes e funções puras — o mesmo contrato de antes da spec 072
  promptsPadrao: _semEstado.promptsPadrao,
  ROTINAS: _semEstado.ROTINAS,
  DEFAULTS: _semEstado.DEFAULTS,
  config: _semEstado.config,
  saveConfig: _semEstado.saveConfig,
  check: _semEstado.check,
  _contextoPayload: _semEstado._contextoPayload,
  _cenaEmProsa: _semEstado._cenaEmProsa,
  _limparMemorias: _semEstado._limparMemorias,
};
