// A MENTE — a inteligência do personagem, rodando no modelo trazido pelo player.
// Três runtimes: Ollama local, Anthropic e OpenRouter, os três com tool-calling
// nativo.
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
const dialeto = require("./dialeto");
const { log: _logExterno } = require("./log");

// Quantas voltas de RACIOCÍNIO uma vez pode ter — consultas e continuações somadas.
// Não é limite sobre o que A Mente pode querer: é o fim do turno, senão uma conversa
// que não converge pensa para sempre, queimando modelo e segurando a trava.
const MAX_RODADAS = 6;

const Mente = (() => {
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

  async function check() {
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
  // do conector para fora. A Mente deixou de conhecer endereço nenhum — ela
  // pensa, e quem fala com o mundo é outro. Quem a usa injeta esse outro; sem
  // injeção ela simplesmente não vê capacidade nenhuma, e cai na prosa.
  //
  // O que NÃO mudou, e é o que importa: com `tools/list` as capacidades vão ao
  // modelo como TOOLS NATIVAS, e o schema passa a ser IMPOSTO pelo runtime em vez
  // de pedido em prosa. As falhas medidas com llama3.1:8b — array onde se espera
  // string, campo obrigatório omitido — são exatamente as que um schema imposto
  // não deixa acontecer.
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

  // Aviso ÚNICO e VISÍVEL quando o runtime não devolve tool call. Vai para o
  // terminal de verdade, não só para o devlog: degradar para prosa em silêncio é
  // exatamente o defeito que a 043 curou, e ele não pode voltar pela porta dos
  // fundos (spec 044, Edge Cases).
  let _avisouSemTools = false;
  function _avisaSemTools(porque) {
    if (_avisouSemTools) return;
    _avisouSemTools = true;
    process.stderr.write(
      `\n⚠  O modelo não devolveu chamada de capacidade (${porque}).\n` +
      `   Seguindo pelo caminho de prosa, que é mais frágil: o schema deixa de\n` +
      `   ser imposto pelo runtime. Se isso se repetir, o modelo provavelmente\n` +
      `   não suporta tool-calling — rode com --verificar para confirmar.\n\n`);
  }

  // === O DIALETO DE CADA PROVEDOR ===========================================
  // Saiu daqui para `dialeto.js` (2026-08-14). Eram quatro funções que traduziam
  // METADE do problema — schema de tool e leitura da resposta — e nada do
  // histórico, que é onde os provedores mais divergem. Juntar as três traduções num
  // módulo só é o que permite acrescentar um provedor (a OpenAI, que hoje não temos)
  // sem tocar no laço do turno.
  //
  // O `id` da chamada, que este código descartava, agora atravessa: sem ele não há
  // como amarrar `tool_result` a `tool_use`, e sem isso não há histórico nenhum.
  function _dial() {
    return dialeto.de(config().runtime || "local");
  }

  async function callModel(system, user, opts = {}) {
    const cfg = config();
    const label = opts.label || "chamada ao modelo";
    const alvo = cfg.runtime === "remote" ? cfg.remoteModel : cfg.runtime === "openrouter" ? cfg.openrouterModel : cfg.model;
    
    devlog(`ENVIADO À MENTE — ${label}`, `[runtime] ${cfg.runtime} (${alvo})\n\n[system]\n${system}\n\n[user]\n${user}`);

    // `opts.onToken` (spec 043) atravessa para o runtime, que streama se houver.
    // Sem callback, o caminho é byte-a-byte o de antes (um tiro, sem stream).
    const raw = cfg.runtime === "remote" ? await anthropic(cfg, system, user, opts)
              : cfg.runtime === "openrouter" ? await openrouter(cfg, system, user, opts)
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

  // === EXTRATOR DE CAMPO EM JSON STREAMADO (spec 043) =========================
  // A chamada de INTERPRETAR devolve JSON, e é a PRIMEIRA do turno — enquanto ela
  // roda, a tela fica muda. Streamar o JSON cru seria pior que o silêncio (chaves,
  // aspas, nomes de campo). Este extrator surfaça SÓ o conteúdo de UM campo: começa
  // a emitir quando o valor da string abre, e PÁRA na aspa que a fecha — o que vem
  // antes e depois (estrutura do JSON, outros campos) nunca chega à tela.
  //
  // Trabalha sobre o texto ACUMULADO, não sobre o delta: um token pode partir
  // `"action"` no meio, e um extrator que olhasse só o pedaço perderia o começo.
  //
  // Não é um parser de JSON e não tenta ser — é uma varredura de caracteres que
  // sobrevive a JSON malformado (o `parseJsonLenient` continua sendo a autoridade
  // sobre o resultado final; isto aqui é só a vitrine).
  function _extratorDeCampo(campo) {
    const alvo = `"${campo}"`;
    let bruto = "";       // tudo o que chegou
    let cursor = 0;       // até onde já varremos
    let dentro = false;   // estamos dentro do valor?
    let fechou = false;   // o valor já terminou?
    let escapando = false;

    return function aoDelta(delta, emitir) {
      if (fechou) return;
      bruto += delta;
      if (!dentro) {
        const i = bruto.indexOf(alvo);
        if (i < 0) return;
        // procura a aspa que ABRE o valor, depois dos dois-pontos
        const doisPontos = bruto.indexOf(":", i + alvo.length);
        if (doisPontos < 0) return;
        const abre = bruto.indexOf('"', doisPontos + 1);
        if (abre < 0) return;
        dentro = true;
        cursor = abre + 1;
      }
      let saida = "";
      while (cursor < bruto.length) {
        const c = bruto[cursor];
        if (c === "\\") {
          // a escapa pode estar PARTIDA entre dois tokens: se o que falta ainda
          // não chegou, recua e espera. Sem isto, "ã" vira "00e3" e toda
          // palavra acentuada sai quebrada — em português, quase todas.
          const prox = bruto[cursor + 1];
          if (prox === undefined) break;
          if (prox === "u") {
            if (cursor + 6 > bruto.length) break;   // faltam dígitos: espera
            const hex = bruto.slice(cursor + 2, cursor + 6);
            saida += /^[0-9a-fA-F]{4}$/.test(hex)
                   ? String.fromCharCode(parseInt(hex, 16)) : "";
            cursor += 6;
            continue;
          }
          saida += prox === "n" ? "\n" : prox === "t" ? "\t"
                 : prox === "r" ? "" : prox;   // \" \\ \/ entram literais
          cursor += 2;
          continue;
        }
        cursor++;
        if (c === '"') { fechou = true; break; }   // fim do valor: não mostra mais nada
        saida += c;
      }
      if (saida) emitir(saida);
    };
  }

  // Extrai o payload de uma linha SSE ("data: {...}"), ou null se não for dado.
  function _sse(linha) {
    if (!linha.startsWith("data:")) return null;
    const corpo = linha.slice(5).trim();
    if (!corpo || corpo === "[DONE]") return null;
    try { return JSON.parse(corpo); } catch (_) { return null; }
  }

  async function ollama(cfg, system, user, { forceJson = false, temperature = 0.4, onToken, tools, conversa } = {}) {
    const emit = _safeToken(onToken);
    const body = {
      model: cfg.model,
      // `opts.conversa` é o HISTÓRICO (user + assistant + tool), SEM o system —
      // ele é sempre à parte, porque a Anthropic o quer fora de `messages` e
      // uniformizar aqui é o que deixa o histórico igual nos três dialetos.
      messages: [{ role: "system", content: system },
                 ...(conversa || [{ role: "user", content: user }])],
      stream: !!emit,
      options: { temperature },
    };
    // spec 043: com `tools`, o schema é IMPOSTO pelo runtime. Streaming e tools não
    // combinam aqui (o Ollama entrega tool_calls no fim), e não faz falta: a chamada
    // de escolha é curta; quem streama é a narração.
    if (tools && tools.length) {
      body.tools = dialeto.de("ollama").traduzTools(tools);
      body.stream = false;
    }
    else if (forceJson) body.format = "json";
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
      if (tools && tools.length) return dialeto.de("ollama").leResposta(data);
      return msg.content || "";
    }
    // NDJSON: uma linha JSON por token, com o delta em `message.content`.
    let texto = "";
    await _lines(res, (linha) => {
      let obj; try { obj = JSON.parse(linha); } catch (_) { return; }
      const delta = obj.message && obj.message.content;
      if (delta) { texto += delta; emit(delta); }
    });
    return texto;
  }

  async function anthropic(cfg, system, user, { forceJson = false, temperature = 0.4, onToken, tools, conversa } = {}) {
    if (!cfg.apiKey) throw new Error("configure sua chave da Anthropic no ⚙.");
    const emit = tools && tools.length ? null : _safeToken(onToken);
    const messages = conversa ? conversa.slice() : [{ role: "user", content: user }];
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
          // `tools` é parâmetro da REQUISIÇÃO, substituído a cada chamada: a cena
          // mudou, a face mudou, e é a face de agora que vale. Só as mensagens
          // acumulam.
          ...(tools && tools.length
              ? { tools: dialeto.de("anthropic").traduzTools(tools) } : {}),
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
    if (tools && tools.length) return dialeto.de("anthropic").leResposta(data);
    let text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    if (forceJson) text = "{" + text;
    return text;
  }

  async function openrouter(cfg, system, user, { temperature = 0.4, onToken, tools, conversa } = {}) {
    if (!cfg.openrouterKey) throw new Error("configure sua chave do OpenRouter no ⚙.");
    const emit = tools && tools.length ? null : _safeToken(onToken);
    let res;
    const url = (cfg.openrouterEndpoint || DEFAULTS.openrouterEndpoint).replace(/\/$/, "") + "/chat/completions";
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.openrouterKey, "X-Title": "Loreforge" },
        body: JSON.stringify({
          model: cfg.openrouterModel, temperature, stream: !!emit,
          ...(tools && tools.length
              ? { tools: dialeto.de("openai").traduzTools(tools) } : {}),
          messages: [{ role: "system", content: system },
                     ...(conversa || [{ role: "user", content: user }])],
        }),
      });
    } catch (_) { throw new Error("não foi possível falar com o OpenRouter."); }
    if (!res.ok) {
      let msg = `erro OpenRouter (${res.status}).`;
      try { const err = await res.json(); if (err?.error?.message) msg = err.error.message; } catch (_) {}
      throw new Error(msg);
    }
    if (emit) {
      // SSE estilo OpenAI: o delta vem em `choices[0].delta.content`.
      let texto = "";
      await _lines(res, (linha) => {
        const ev = _sse(linha);
        const delta = ev && ev.choices && ev.choices[0] && ev.choices[0].delta
                      && ev.choices[0].delta.content;
        if (delta) { texto += delta; emit(delta); }
      });
      return texto;
    }
    const data = await res.json();
    _contabiliza(data?.usage?.prompt_tokens, data?.usage?.completion_tokens);
    const msg = data.choices?.[0]?.message || {};
    if (tools && tools.length) return dialeto.de("openai").leResposta(data);
    return msg.content || "";
  }

  // spec 043: `consulteRules()` MORREU. Eram 13 frases escritas à mão aqui dentro,
  // que não casavam com capacidade nenhuma do mundo — a Mente escolhia entre uma
  // lista fictícia e o Árbitro tentava adivinhar o que ela queria dizer. A âncora
  // passa a ser `context.capacidades`: o que o mundo DE FATO oferece nesta cena,
  // com os alvos que existem, vindo no mesmo payload do contexto.

 const AUTONOMY_SYSTEM = `[Contexto Global do Jogo]
Este é um mundo persistente onde as necessidades biológicas (fome, sede, cansaço) pioram com o passar do tempo (cada ação tomada é convertida em fração de tempo).

Você é um motor de tomada de decisão para personagens de RPG. A cada turno, você receberá um objeto JSON contendo o estado psicológico do personagem, suas memórias, seu status de sobrevivência, o ambiente atual e as regras do mundo. 

Sua missão é escolher as ações mais lógicas, coerentes e com alta fidelidade interpretativa (Roleplay) para o seu personagem executar a seguir.

Para garantir que sua escolha seja perfeita, siga este fluxo de raciocínio:

1. O Filtro de Personalidade e Inspiração (O "Quem sou eu?"):
- Leia a \`personalidade\`. Identifique o modo de operar, fraquezas, preguiça, vícios ou código moral.
- Regra da Inspiração: A IA deve pontuar alto em interpretação. Escolher a rota mais segura ou óbvia é uma FALHA de roleplay se o personagem for imprudente, apático, covarde ou teimoso. Valorize as falhas e traços do personagem!

2. O Corpo vs a Personalidade:
- Leia a \`necessidade\`: o que ele SENTE de fome e de cansaço, nas palavras dele.
- Enquanto o corpo não incomoda, quem manda é a personalidade: ele age guiado por quem é, e desconforto pequeno não o desvia.
- Quando a necessidade aperta, ela fala mais alto que a índole — e quanto mais aperta, mais ele abandona os próprios traços para resolvê-la. Um corpo em sofrimento faz qualquer um sair do seu jeito.
- NÃO invente necessidade que a \`necessidade\` não afirma: se ela diz que ele não tem fome, ele não tem fome, por mais que a cena fale de comida.

3. A Bússola de Intenções (O "O que eu planejo ou prometi?"):
- Leia as \`intencoes\`. Intenções são desejos ou planos, NÃO são obrigações absolutas.
- Personagens proativos e leais farão de tudo para cumpri-las. Personagens preguiçosos, caóticos ou egoístas podem (e devem) ignorar suas próprias intenções se cumpri-las der muito trabalho e a recompensa não for uma urgência biológica atual.

4. A Leitura de Cenário e Enquadramento:
- Avalie o \`contexto\`, \`presentes\` e consulte o \`livro_de_regras\`.
- Pense na SEQUÊNCIA de ações que ele quer realizar e declare SOMENTE as ações do livro que cumprem essa sequência, na ordem pensada. O livro não é um cardápio a percorrer: ação que não faz parte da sequência não se declara. Se uma delas não der certo, o resto da sequência pode não valer mais — você repensa a partir do que aconteceu.
- TRAVA DE INVENTÁRIO / o que tenho: Você é estritamente proibido de consumir, vestir, vender ou usar itens que não estejam explicitamente listados no SEU array \`itens_que_possuo\`.
- Não invente ações fora do livro.

Formato de Saída Exigido:
Responda EXCLUSIVAMENTE com um objeto JSON válido. Use a chave "sussurro" para enviar a ação narrada final, que será usada pela engine:
{
  "agir": true,
  "racional": "[1. Racional: Explique como o filtro de personalidade, status e intenções ditaram a escolha]",
  "acoes_declaradas": [
    "- [2. Ações Declaradas: Frase EXATA do livro_de_regras 1]",
    "- [2. Ações Declaradas: Frase EXATA do livro_de_regras 2]"
  ],
  "sussurro": "[3. Ação Narrada: Descreva em um parágrafo fluido de roleplay como essa sequência de regras se traduz fisicamente na cena. Descreva a TENTATIVA e SÓ ela: o que ele faz e diz. Nunca escreva o que os outros respondem, o que sentem ou como reagem, nem se ele conseguiu — nada disso é seu para decidir, e o mundo ainda não julgou.]"
}`;

  const INTERPRET_SYSTEM = `Você é A Mente de um personagem de RPG em um mundo persistente. A instrução do jogador (ou pensamento autônomo) é uma sugestão de vontade, mas o personagem NÃO É UM ROBÔ: ele possui uma índole e personalidade inegociáveis.

Você recebe em "capacidades" TUDO o que o personagem pode tentar AQUI, AGORA — o mundo já filtrou pela cena. Cada capacidade traz o que ela faz e os ALVOS possíveis. Escolha entre elas.

Regras de Ouro:
1. SÓ O QUE ESTÁ NA LISTA. Use o "nome" EXATO de uma capacidade de "capacidades", e para cada parâmetro ESCOLHA UM id de "alvos_possiveis" dela. Nome ou alvo inventado é recusado pelo mundo e o turno se perde.
2. PREENCHA TUDO O QUE "exige" PEDE. Parâmetro que não aparece em "alvos_possiveis" é TEXTO LIVRE que você escreve (o conteúdo de um plano, o teor de uma promessa, sobre o que se pergunta) — sem ele a tentativa é recusada.
3. ENCADEIE quando for um movimento contínuo: várias propostas, NA ORDEM de execução. Cada uma resolve antes da seguinte, e a seguinte já vê o mundo mudado.
4. PROSA SEMPRE. Cada proposta leva "prosa.acao" — a descrição in-world, concreta, do que ele faz ali (ex.: "Fenn apanha a moeda do chão com um grunhido"). "prosa.fala" só se ele falar em voz alta.
5. VOCÊ NÃO DECIDE O DESFECHO. Se convenceu, se acertou, se passou despercebido — quem decide é o mundo. Descreva a TENTATIVA, nunca o resultado.
6. JUÍZO MORAL. Se a instrução violar a "personalidade", proponha só o que ele de fato faria (falar, recusar, sair), e a prosa descreve a recusa.
7. Se NADA na lista servir, devolva "propostas": [] e explique em "pensamento".

Responda SOMENTE com JSON válido neste formato:
{
  "pensamento": "Em 1 frase: o que ele quer e por quê.",
  "propostas": [
    {
      "capacidade": "nome EXATO da lista",
      "alvos": { "parametro": "UM id, como TEXTO — nunca uma lista, nunca o array de opções" },
      "prosa": { "acao": "o que ele faz, in-world. NUNCA vazio.", "fala": "o que diz em voz alta, ou null" }
    }
  ]
}`;

  // O RAMO DE CRIAR do tick autônomo (spec 033). Cada volta do relógio bifurca:
  // quem TEM compromisso decide se age por ele; quem não tem PARA e faz um.
  //
  // Não chama modelo aqui de propósito: isto é um SUSSURRO, e entra no `interpret`
  // como qualquer coisa que o jogador digitasse. É lá que a fundamentação em
  // personalidade, memórias e cena acontece — duplicar isso aqui seria decidir
  // duas vezes, com metade do contexto.
  //
  // ESTEVE MORTO POR UMA SEMANA. Nasceu ligado (spec 035, 30/07) e o refactor de
  // prompts de 06/08 apagou o `if` e deixou a constante órfã — nada a referenciava.
  // Falha em SILÊNCIO: um personagem sem intenção simplesmente nunca fazia
  // nenhuma, e isso parece apatia, não defeito. Custou caro: o Irmão Tobias ficou
  // três horas perguntando o mesmo caminho porque, sem intenção e sem urgência
  // biológica, a única bússola que lhe restava era a memória — e ela só tinha
  // repetições do próprio fracasso.
  //
  // O texto foi reescrito para o formato de HOJE: o de antes mandava descrever a
  // 'action', campo do JSON que o caminho de tool-calling aposentou.
  const REFLECT_COMMAND = "Pare o que estiver fazendo: você não tem compromisso "
    + "nenhum, e precisa de um. Olhe o que você lembra e quem está à sua volta, e "
    + "escolha UMA coisa que você quer que seja verdade daqui a alguns dias e "
    + "ainda não é.\n\n"
    + "O compromisso tem de ser SEU e CONCRETO: diga o que você vai fazer, e com "
    + "quem ou com o quê. Nomeie a pessoa, o lugar ou a coisa — um compromisso que "
    + "não aponta para nada de específico não é um compromisso, é uma vontade "
    + "vaga.\n\n"
    + "Não repita nem reformule esta instrução: ela é o que o fez parar para "
    + "pensar, não o que você decidiu. Também não firme como compromisso algo que "
    + "você já tentou muitas vezes sem render nada — se as suas lembranças mostram "
    + "que aquele caminho não leva a lugar nenhum, escolha outro.\n\n"
    + "O que você faz AGORA é decidir. Cumprir vem depois.";

  const NARRATE_SYSTEM = `Você é o narrador de um RPG. Sua única função é narrar as consequências da última ação do personagem ("personagem").

REGRA DE OURO (PONTO DE VISTA): A narração DEVE ser na 2ª pessoa ("você"), dirigindo-se DIRETAMENTE ao "personagem". O sistema enviará os fatos ("acontecido", "mudou_no_mundo") escritos em 3ª pessoa (ex: "Corbellini fez X"), mas você é OBRIGADO a traduzir para a 2ª pessoa (ex: "Você fez X"). Nunca trate o personagem como uma terceira pessoa separada do jogador.

HIERARQUIA DE EVENTOS:
1. "nao_aconteceu" — a tentativa frustrada.
2. "mudou_no_mundo" — a consequência DIRETA e fato consumado.
3. "aconteceu_ao_redor" — eventos paralelos notados perifericamente. NUNCA diga que a sua ação os causou.

NUNCA INVENTE FATO (a regra mais importante):
- Narre SOMENTE o que vier em "acontecido", "mudou_no_mundo", "nao_aconteceu" e "aconteceu_ao_redor". Se um fato não está ali, ele NÃO ACONTECEU.
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

  // === BLINDAGEM DE LIXO DO SERVIDOR (ORIENTADA AO TEMPO) ===
  function _limparMemorias(memories) {
    if (!memories || !memories.length) return [];
    
    // 1. Ordena explicitamente pelo tempo (mais recentes/maior timestamp primeiro)
    const ordenadas = [...memories].sort((a, b) => 
      (b.timestamp_start || 0) - (a.timestamp_start || 0)
    );

    const seen = new Set();
    const cleaned = [];
    
    // 2. Varre as mais recentes e desduplica
    for (const m of ordenadas) {
      const text = (m.content || m.conteudo || "").trim();
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
      descricao: node.narrative,
      pertence_a: _pertenceA(node.pertence_a),
    };
  }

  async function _contextoPayload(context, { comCapacidades = true } = {}) {
    return {
      personalidade: context.self && context.self.body,
      // O QUE ELE SENTE (item 51, fatia 1). Vem em RÓTULO do mundo — nunca número,
      // que é segredo dele. Sem isto o personagem não tinha como SABER que estava
      // com fome: o payload não trazia status nenhum, e a única porta era um campo
      // (`survival_level`) que nunca existiu.
      necessidade: (context.self && context.self.necessidade) || null,
      contexto: {
        local: context.location && context.location.name,
        descricao: context.location && context.location.narrative,
        pertence_a: _pertenceA(context.location && context.location.pertence_a),
        presentes: (context.characters_present || []).filter((c) => c.state !== "self").map((c) => ({
          id: c.id, nome: c.name, fazendo: c.action, carrega: (c.carrying || []).map((it) => ({ id: it.id, nome: it.name })),
        })),
        objetos_presentes: (context.objects_present || []).map((o) => ({
          id: o.id, nome: o.name, interactions: o.interactions || null, contem: (o.contains || []).map((c) => ({ id: c.id, nome: c.name })),
        })),
        itens_presentes: (context.items_present || []).map((it) => ({ id: it.id, nome: it.name, interactions: it.interactions || null })),
        inventario: ((context.self && context.self.inventory) || []).map((it) => ({ id: it.id, nome: it.name })),
      },
      // Aplica a blindagem aqui:
      memorias: _limparMemorias(context.memories),
      rotas_disponiveis: (context.routes || []).map((r) => ({ id: r.id, nome: r.name, para: r.destination_name })),
      // `comCapacidades` é FALSE só na chamada de `interpret` que já manda `tools`
      // nativas (spec 043) — lá, repetir a mesma informação em prosa é DUPLICAÇÃO,
      // não reforço. Medido ao vivo em 2026-08-17 (18 chamadas reais ao llama3.1:8b,
      // 3 casos × com/sem o bloco × 3 repetições): com o bloco duplicado, 4 de 9
      // chamadas saíam SEM tool_call nenhuma — o modelo "pensava em voz alta" sobre
      // qual tool usar em vez de chamar uma (o padrão que o devlog marca como "SEM
      // TOOL CALLS — caindo no caminho de prosa" / "TOOLS DESCRITAS EM PROSA"). Sem
      // o bloco: 9 de 9 saíram certas, com 35-65% menos tokens de prompt e 2-10x
      // mais rápido; quando a chamada saía nas duas variantes, o id vinha certo nas
      // duas — o enum de `tools` já basta. Se cogitar tirar o bloco de outro lugar
      // (o fallback de prosa em `INTERPRET_SYSTEM`, ou `deriveWhisper`/
      // `AUTONOMY_SYSTEM`), NÃO copie esta conclusão sem novo teste: os dois não têm
      // `tools` nativas — lá o `capacidades` em prosa é a ÚNICA fonte do que existe,
      // não uma duplicata. Script do teste, pra rodar de novo antes de mexer aqui:
      // `specs/043-tools-exposed-to-mind/testar_duplicacao_capacidades.py`.
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

  // `onAction` (spec 043): recebe a `action` — e SÓ ela — enquanto o JSON ainda está
  // sendo escrito. É a primeira chamada do turno e a que mais tempo deixava a tela
  // muda; mostrar o personagem decidindo, palavra a palavra, é o maior ganho de
  // percepção do turno inteiro. A estrutura do JSON nunca aparece: o extrator abre no
  // valor da string e fecha na aspa (ver `_extratorDeCampo`).
  // O SYSTEM do caminho por TOOL NATIVA. Curto de propósito: o schema das
  // capacidades já vai estruturado, então este texto não precisa ensinar formato —
  // só quem o personagem é e o que NÃO fazer. O prompt longo continua existindo
  // (INTERPRET_SYSTEM) para o caminho de prosa, onde o formato é tudo.
  const ESCOLHER_SYSTEM = `Você é A Mente de um personagem de RPG num mundo persistente. A instrução do jogador é uma sugestão de vontade — o personagem NÃO é um robô: tem índole e personalidade inegociáveis.

As ferramentas disponíveis são TUDO o que ele pode tentar aqui e agora; o mundo já filtrou pela cena.

ANTES DE AGIR, pense na SEQUÊNCIA de ações que ele quer realizar e escolha as ferramentas que cumprem essa sequência. Depois chame SOMENTE essas, na ordem pensada. A lista disponível não é um cardápio a percorrer: ferramenta que não faz parte da sequência não se chama. Se uma delas falhar, PARE — a cena mudou e o resto da sequência pode não valer mais; pense uma nova a partir do que aconteceu, e aja de novo.

- Toda chamada leva "prosa.acao": o que ele FAZ, in-world e concreto. "prosa.fala" só se falar em voz alta.
- Descreva a TENTATIVA, nunca o desfecho: se convenceu, se acertou, se passou despercebido, quem decide é o mundo.
- Se a instrução violar a personalidade dele, faça o que ele de fato faria — e a prosa conta a recusa.
- Se nada couber exatamente, escolha a ferramenta MAIS PRÓXIMA do que ele quer e diga na prosa o que ele tenta. Quem decide se cabe é o mundo, não você — um "não" dele é jogo; ficar calado não é.
- CONFIRME ANTES DE AGIR. Algumas ferramentas só PERGUNTAM (a sua memória, o momento do dia) — não mudam nada e não gastam a vez. Se o que ele pretende depende de uma CONDIÇÃO ("se aquele ali roubou", "quem é ladrão aqui") ou de um MOMENTO ("ao anoitecer", "no fim do dia"), pergunte primeiro e decida depois. Agir sobre palpite é como se acusa e se fere quem não devia. Nunca cite o nome de uma ferramenta na prosa.`;

  async function interpret(instruction, context, onAction, opts = {}) {
    const charId = (context.self && context.self.id) || context.character_id;
    // CAMINHO NOVO (spec 043): as capacidades vão como TOOLS NATIVAS. O schema é
    // imposto pelo runtime — o modelo não tem como devolver array onde se espera
    // string nem esquecer um campo obrigatório, que eram as duas falhas medidas.
    if (charId) {
      try {
        let doMundo = await listarCapacidades(charId);
        // RECORTE DE FACE POR ROTINA (item 53.6). Quando a pergunta que A Mente
        // está respondendo é UMA — "a que eu me comprometo?" —, oferecer os 27
        // verbos da cena é convidá-la a fazer outra coisa. Medido: com a face
        // inteira, o comando de reflexão produzia `set_intention` em 8 de 12
        // tentativas, e sempre no FIM de uma cadeia atrás de tools que podem
        // recusar — com a regra de que a recusa mata a fila, a intenção morria
        // junto. As CONSULTAS continuam: ela lê a própria memória antes de
        // decidir, e é justamente esse raciocínio que dá conteúdo à decisão.
        //
        // Isto NÃO é um teto sobre o que A Mente pode querer (aquele foi
        // rejeitado, e com razão): é o escopo da PERGUNTA que a rotina faz. Ela
        // segue escrevendo o compromisso — é lá que a agência dela vive.
        if (Array.isArray(opts.somente) && opts.somente.length) {
          doMundo = doMundo.filter(
            (x) => opts.somente.includes(x.name)
                   || (x.annotations && x.annotations.readOnlyHint));
        }
        if (doMundo.length) {
          // AS DUAS ORIGENS, e o roteamento por ORIGEM — nunca por nome.
          //
          // Uma tool local declarada com o nome de uma capacidade do mundo NÃO a
          // sequestra: o nome do mundo ganha, sempre. É o que torna o harness
          // seguro de abrir — quem tuna acrescenta raciocínio, jamais efeito.
          const nomesDoMundo = new Set(doMundo.map((t) => t.name));
          const locais = (_ext ? _ext.toolsLocais() : [])
                           .filter((t) => !nomesDoMundo.has(t.name));
          const tools = doMundo.concat(locais);
          const ehLocal = (nome) =>
            !nomesDoMundo.has(nome) && _ext && _ext.ehLocal(nome);
          // AS CONSULTAS DO MUNDO (spec 040), reconhecidas pela marca do PRÓPRIO
          // MCP — `readOnlyHint`. São do mundo (o nome vem de lá, o corpo roda lá),
          // mas NÃO são proposta: perguntar a hora ou a própria memória não muda
          // nada e não gasta a vez. Entram no mesmo laço das tools locais, por isso
          // a pergunta que o laço faz deixou de ser "é local?" e passou a ser "isto
          // ainda é só pensar?".
          const nomesDeConsulta = new Set(
            doMundo.filter((t) => t.annotations && t.annotations.readOnlyHint)
                   .map((t) => t.name));
          const ehConsulta = (nome) => nomesDeConsulta.has(nome);

          // `comCapacidades: false` — `tools` (abaixo) já manda a mesma informação
          // estruturada; ver o comentário em `_contextoPayload` sobre por que
          // repeti-la aqui é o que estava atrapalhando.
          const base = "O que ele faz?\n\nINSTRUÇÃO: " + instruction + "\n\n"
                     + JSON.stringify(await _contextoPayload(context, { comCapacidades: false }), null, 2);

          // O RACIOCÍNIO É UMA CONVERSA, e não uma sequência de perguntas amnésicas.
          //
          // Antes daqui, cada volta remontava `base + observacoes` — o resultado da
          // consulta voltava como TEXTO colado no fim do pedido. Três consequências,
          // e nenhuma óbvia:
          //   · a Mente NÃO SABIA o que já tinha pedido (o pedido dela não estava na
          //     conversa, só o nosso resumo dele), então repetia;
          //   · como o `user` mudava a cada volta, o prefixo mudava e o cache de
          //     prompt não pegava — cada volta custava o contexto inteiro;
          //   · e o vínculo pedido↔resultado era prosa nossa, não o protocolo.
          //
          // Agora a conversa CRESCE: `assistant` com o que ela pediu, `tool` com o que
          // o mundo respondeu, amarrados pelo id da chamada. O `dialeto` cuida de cada
          // provedor falar isso do seu jeito. O bloco `tools` NÃO entra na conversa —
          // é parâmetro da requisição, substituído a cada chamada, porque a cena muda
          // e é a face de agora que vale.
          const dial = _dial();
          let conversa = [{ role: "user", content: base }];
          let ultima = null;          // a última resposta dela, para o histórico
          let rodadas = 0;

          const _mapear = (calls) => calls.map((c) => ({
            id: c.id,               // é por ele que o resultado volta amarrado
            capacidade: c.nome,
            alvos: Object.fromEntries(Object.entries(c.args || {})
                                      .filter(([k]) => k !== "prosa")),
            prosa: (c.args || {}).prosa || null,
          }));

          async function pensar() {
            while (rodadas++ < MAX_RODADAS) {
              const r = await callModel(_sys("interpretar", ESCOLHER_SYSTEM), base,
                { temperature: 0.4, tools, conversa,
                  label: `ESCOLHER (rodada ${rodadas})` });
              ultima = r;
              const calls = (r && r.toolCalls) || [];
              const pedidosLocais = calls.filter((c) => ehLocal(c.nome));
              const consultas = calls.filter((c) => ehConsulta(c.nome));
              const propostas = calls.filter((c) => !ehLocal(c.nome)
                                                   && !ehConsulta(c.nome));
              if (propostas.length) {
                if (typeof onAction === "function") {
                  const p1 = (propostas[0].args || {}).prosa;
                  if (p1 && p1.acao) onAction(p1.acao);
                }
                return { pensamento: (r.texto || "").trim(),
                         propostas: _mapear(propostas), continuar };
              }
              if (!consultas.length && !(pedidosLocais.length && _ext)) {
                // sem tool_calls: ou o runtime não suporta, ou ela decidiu não agir.
                devlog("SEM TOOL CALLS — caindo no caminho de prosa", r && r.texto);
                _avisaSemTools("nenhuma tool call na resposta");
                return null;
              }
              const resultados = [];
              for (const c of consultas) {
                // a consulta roda NO MUNDO, pelo mesmo caminho de qualquer
                // capacidade — o conector não reimplementa leitura de memória nem
                // de relógio (era a tabela `CONSULT_TOOLS[]` que dessincronizou e
                // sumiu no `17b9a41`; agora o nome e o corpo vêm ambos de lá).
                const saida = await _mundo.chamarCapacidade(c.nome, c.args || {});
                devlog(`CONSULTA AO MUNDO — ${c.nome}`, saida);
                resultados.push({ id: c.id, conteudo: saida.texto || "(nada)" });
              }
              for (const c of pedidosLocais) {
                const saida = await _ext.executarLocal(c.nome, c.args);
                devlog(`FERRAMENTA LOCAL — ${c.nome}`, saida);
                resultados.push({ id: c.id,
                  conteudo: JSON.stringify(saida.resultado ?? saida.erro) });
              }
              conversa = dial.montaHistorico(conversa, r, resultados);
            }
            devlog("ORÇAMENTO DE RODADAS ESGOTADO", `${MAX_RODADAS} rodadas`);
            return null;
          }

          // O QUE O LAÇO CHAMA depois de levar as propostas ao mundo. O resultado de
          // cada uma entra na MESMA conversa — então a Mente recebe o "não" (ou o que
          // aconteceu) sabendo o que pediu, e segue de onde parou em vez de recomeçar.
          // É isto que aposenta o replanejamento por remontagem.
          async function continuar(resultados) {
            conversa = dial.montaHistorico(conversa, ultima, resultados || []);
            return pensar();
          }

          const sessao = await pensar();
          if (sessao) return sessao;
        }
      } catch (e) {
        // o caminho novo NUNCA pode deixar o jogador sem turno: qualquer falha
        // (runtime sem tools, server velho, rede) cai na prosa, que sempre funcionou.
        devlog("MCP/tools indisponível — caminho de prosa", String(e && e.message || e));
        _avisaSemTools(String((e && e.message) || e));
      }
    }

    // CAMINHO DE PROSA (compatibilidade, FR-026): modelo sem tool-calling.
    const payload = { instrucao: instruction, ...(await _contextoPayload(context)) };
    let onToken;
    if (typeof onAction === "function") {
      const extrair = _extratorDeCampo("acao");
      onToken = (delta) => extrair(delta, onAction);
    }
    const raw = await callModel(
      _sys("interpretar_prosa", INTERPRET_SYSTEM),
      "Interprete a instrução e produza a intenção baseada estritamente nas capacidades.\n\n"
      + JSON.stringify(payload, null, 2),
      { forceJson: true, temperature: 0.4, label: "INTERPRETAR (instrução → intenção)",
        onToken }
    );
    return parseJsonLenient(raw);
  }

  async function deriveWhisper(context) {
    const intencoesAtivas = context.intentions || [];

    // A BIFURCAÇÃO DO TICK (spec 033): sem compromisso, o personagem para e faz um.
    // Ver `REFLECT_COMMAND` — inclusive por que ele não chama modelo aqui.
    if (!intencoesAtivas.length) {
      return { texto: _sys("refletir", REFLECT_COMMAND), rotina: "refletir",
               // FATO, não inferência: este ramo é determinístico, e dizer no
               // registro por que ele disparou é o que evita a leitura "o
               // personagem resolveu filosofar do nada".
               racional: "sem compromisso ativo: o tick parou para criar um" };
    }


    // O payload original é incrementado para expor as chaves exatas que o prompt cobra:
    const payload = {
      ...(await _contextoPayload(context)),
      intencoes: intencoesAtivas.map((i) => ({ id: i.id, o_que: i.content })),
      // `status_sobrevivencia: survival_level || 0` MORREU aqui. O campo nunca
      // existiu em lugar nenhum do mundo, então era constante ZERO para todo
      // personagem desde sempre — e o modelo lia o zero como urgência ("com o
      // status de sobrevivência em 0, ele está focado em resolver problemas
      // imediatos, como encontrar comida"). A necessidade agora vem em RÓTULO,
      // pelo `_contextoPayload`, e a seção 2 do prompt raciocina sobre ela.
      itens_que_possuo: ((context.self && context.self.inventory) || []).map((it) => ({ id: it.id, nome: it.name }))
    };
    
    const raw = await callModel(
      _sys("autonomia", AUTONOMY_SYSTEM),
      "Avalie se há algo a fazer agora, a partir das memórias recentes, intenções e do contexto.\n\n" + JSON.stringify(payload, null, 2),
      { forceJson: true, temperature: 0.4, label: "AUTONOMIA (intenção → sussurro?)" }
    );
    const parsed = parseAutonomyJson(raw);
    
    // Opcional: Se quiser que o "racional" e "acoes_declaradas" apareçam no console do desenvolvedor para auditoria:
    if (parsed.agir && parsed.racional) {
        devlog("RACIONAL AUTÔNOMO", `Racional: ${parsed.racional}\nAções: ${parsed.acoes_declaradas?.join(', ')}`);
    }

    return parsed.agir
      ? { texto: parsed.sussurro || null, rotina: "autonomia",
          racional: parsed.racional || null }
      : null;
  }

  // `onToken` (spec 043): recebe cada pedaço da prosa conforme ela nasce, para a
  // tela mostrar a narração se formando em vez de um vazio até o fim. É a única
  // chamada que streama — as que devolvem JSON não ganham nada com isso.
  async function narrate(narrativeHint, context, failedEffects, viradas, aconteceu, informes, reconhecimentos, eventosParalelos, material, onToken) {
    const failures = (failedEffects || []).filter(Boolean);
    const twists = (viradas || []).map((v) => v.o_que).filter(Boolean);
    
    const payload = {
      personagem: context.self && context.self.name,
      acontecido: narrativeHint,
      mudou_no_mundo: (aconteceu || []).length ? aconteceu : null,
      nao_aconteceu: failures.length ? failures : null,
      viradas_do_destino: twists.length ? twists : null,
      aconteceu_ao_redor: (eventosParalelos || []).length ? eventosParalelos : null,
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
      personalidade: context.self && context.self.body,
      // O QUE ELE SENTE (item 51, fatia 1). Vem em RÓTULO do mundo — nunca número,
      // que é segredo dele. Sem isto o personagem não tinha como SABER que estava
      // com fome: o payload não trazia status nenhum, e a única porta era um campo
      // (`survival_level`) que nunca existiu.
      necessidade: (context.self && context.self.necessidade) || null,
      local: context.location && context.location.name,
      pertence_a: _pertenceA(context.location && context.location.pertence_a),
      presentes: (context.characters_present || []).filter((c) => c.state !== "self").map((c) => ({ nome: c.name, fazendo: c.action })),
      // Aplica a blindagem nas memórias descritivas da narração:
      memorias: _limparMemorias(context.memories),
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

  function parseJsonLenient(raw) {
    try { return JSON.parse(raw); } catch (_) {
      const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
      if (s !== -1 && e > s) { try { return JSON.parse(raw.slice(s, e + 1)); } catch (_) {} }
      return { action: raw.slice(0, 200), target: null, utterance: null, movement: null, note: "" };
    }
  }

  function parseAutonomyJson(raw) {
    try { return JSON.parse(raw); } catch (_) {
      const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
      if (s !== -1 && e > s) { try { return JSON.parse(raw.slice(s, e + 1)); } catch (_) {} }
      return { agir: false, sussurro: null };
    }
  }

  // Os textos PADRÃO de cada rotina, para a página de configuração mostrar o que
  // está em uso e o que se está substituindo. Chamado tarde (depois dos `const`
  // acima), então não há problema de ordem.
  function promptsPadrao() {
    return {
      interpretar: ESCOLHER_SYSTEM,
      interpretar_prosa: INTERPRET_SYSTEM,
      autonomia: AUTONOMY_SYSTEM,
      refletir: REFLECT_COMMAND,
      narrar: NARRATE_SYSTEM,
    };
  }

  const ROTINAS = [
    { nome: "interpretar",
      titulo: "Escolher a ação (capacidades nativas)",
      quando: "a cada sussurro, quando o modelo fala tool-calling" },
    { nome: "interpretar_prosa",
      titulo: "Escolher a ação (caminho de prosa)",
      quando: "quando o modelo não devolve chamada de capacidade" },
    { nome: "autonomia",
      titulo: "Decidir agir sozinho",
      quando: "a cada volta do relógio, COM um compromisso em mente" },
    { nome: "refletir",
      titulo: "Criar um compromisso",
      quando: "a cada volta do relógio, quando ele não tem nenhum" },
    { nome: "narrar",
      titulo: "Narrar o desfecho",
      quando: "ao fim de todo turno" },
  ];

  return {
    promptsPadrao, ROTINAS, MAX_RODADAS,
    config, saveConfig, check, usarMundo, usarExtensoes, interpret,
    deriveWhisper, narrate, narrateObservation, log: devlog, DEFAULTS,
    custoDoTurno, zerarCusto,
  };
})();

module.exports = Mente;
