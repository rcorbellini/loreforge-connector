// O DIALETO DE CADA PROVEDOR — a tradução, num lugar só.
//
// Todo provedor de LLM fala tool-calling de um jeito ligeiramente diferente, e a
// diferença não é só de nome de campo: é de MODELO. Este arquivo existe para que
// essa divergência não vaze para o laço do turno — quem chega novo (a OpenAI, que
// hoje não temos) acrescenta um dialeto e nada mais precisa saber dele.
//
// Três verbos, e é tudo:
//
//   traduzTools(tools)                    o schema do MCP no formato do provedor
//   leResposta(bruto)                     a resposta dele no NOSSO formato
//   montaHistorico(msgs, resp, results)   a conversa com o resultado dentro
//
// O TERCEIRO É O NOVO, e é onde eles mais divergem:
//
//   | provedor  | pede                        | devolve resultado                  |
//   |-----------|-----------------------------|------------------------------------|
//   | Anthropic | bloco `tool_use` com `id`   | role:user + `tool_result` por id   |
//   | OpenAI    | `tool_calls[].id`           | role:tool + `tool_call_id`         |
//   | Ollama    | `tool_calls` SEM id         | role:tool, amarrado pela ORDEM     |
//   | Gemini    | `functionCall` SEM id       | role:function, amarrado pelo NOME  |
//
// O Ollama não emite id. Então o formato interno SEMPRE tem um `id` — sintético
// quando o provedor não dá —, e cada dialeto decide se o escreve de volta. Sem
// isso, "amarrar por id" e "amarrar por ordem" viram dois caminhos no laço, que é
// exactamente o vazamento que este arquivo evita.
//
// O QUE NÃO ENTRA NO HISTÓRICO: o bloco `tools`. Ele é parâmetro da REQUISIÇÃO e é
// SUBSTITUÍDO a cada chamada — a cena mudou, a face mudou, e é a face de agora que
// vale. Só as mensagens acumulam.

"use strict";

// --- formato interno ------------------------------------------------------- //
// { toolCalls: [{ id, nome, args }], texto }
// O `id` nunca é nulo: quem não recebe do provedor recebe um sintético, para o
// laço poder falar de "a chamada tal" sem saber de quem veio.

function _idSintetico(i) {
  return `c${i}`;
}

function _argsDeTexto(args) {
  if (typeof args !== "string") return args || {};
  try {
    return JSON.parse(args);
  } catch (_) {
    return {};
  }
}

// --- OpenAI (e o Ollama, que fala o mesmo dialeto no /api/chat) ------------- //

const openai = {
  traduzTools(tools) {
    return (tools || []).map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description,
                  parameters: t.inputSchema },
    }));
  },

  leResposta(bruto) {
    const msg = (bruto.choices && bruto.choices[0] && bruto.choices[0].message) || {};
    return {
      toolCalls: (msg.tool_calls || [])
        .map((c, i) => ({ id: c.id || _idSintetico(i),
                          nome: (c.function || {}).name,
                          args: _argsDeTexto((c.function || {}).arguments) }))
        .filter((c) => c.nome),
      texto: msg.content || "",
      uso: { entrada: (bruto.usage || {}).prompt_tokens,
             saida: (bruto.usage || {}).completion_tokens },
    };
  },

  montaHistorico(msgs, resp, resultados) {
    return msgs.concat([
      { role: "assistant", content: resp.texto || "",
        tool_calls: (resp.toolCalls || []).map((c) => ({
          id: c.id, type: "function",
          function: { name: c.nome, arguments: JSON.stringify(c.args || {}) } })) },
      ...(resultados || []).map((r) => ({
        role: "tool", tool_call_id: r.id, content: String(r.conteudo ?? "") })),
    ]);
  },
};

// --- Ollama: mesmo dialeto de pedido, e SEM id na volta --------------------- //

const ollama = {
  traduzTools: openai.traduzTools,

  leResposta(bruto) {
    const msg = bruto.message || {};
    return {
      toolCalls: (msg.tool_calls || [])
        .map((c, i) => ({ id: _idSintetico(i), nome: (c.function || {}).name,
                          args: (c.function || {}).arguments || {} }))
        .filter((c) => c.nome),
      texto: msg.content || "",
      uso: { entrada: bruto.prompt_eval_count, saida: bruto.eval_count },
    };
  },

  montaHistorico(msgs, resp, resultados) {
    // sem `tool_call_id`: o Ollama não emite id, então mandá-lo de volta seria
    // inventar amarração que ele não pediu. A ordem é o vínculo — e é por isso que
    // os resultados vão na MESMA ordem das chamadas.
    return msgs.concat([
      { role: "assistant", content: resp.texto || "",
        tool_calls: (resp.toolCalls || []).map((c) => ({
          function: { name: c.nome, arguments: c.args || {} } })) },
      ...(resultados || []).map((r) => ({
        role: "tool", content: String(r.conteudo ?? "") })),
    ]);
  },
};

// --- Anthropic: blocos de conteúdo, não campos de mensagem ------------------ //

const anthropic = {
  traduzTools(tools) {
    return (tools || []).map((t) => ({
      name: t.name, description: t.description, input_schema: t.inputSchema }));
  },

  leResposta(bruto) {
    const blocos = bruto.content || [];
    return {
      toolCalls: blocos.filter((b) => b.type === "tool_use")
        .map((b, i) => ({ id: b.id || _idSintetico(i), nome: b.name,
                          args: b.input || {} })),
      texto: blocos.filter((b) => b.type === "text")
        .map((b) => b.text).join(""),
      uso: { entrada: (bruto.usage || {}).input_tokens,
             saida: (bruto.usage || {}).output_tokens },
    };
  },

  montaHistorico(msgs, resp, resultados) {
    // o assistente volta como BLOCOS, e o texto só entra se existir: bloco de texto
    // vazio é recusado pela API.
    const doAssistente = [];
    if (resp.texto) doAssistente.push({ type: "text", text: resp.texto });
    for (const c of resp.toolCalls || []) {
      doAssistente.push({ type: "tool_use", id: c.id, name: c.nome,
                          input: c.args || {} });
    }
    return msgs.concat([
      { role: "assistant", content: doAssistente },
      // o resultado vem como mensagem de USUÁRIO — é a forma da Anthropic, e
      // confundi-la com `role:"tool"` (que ela não tem) é erro de 400.
      { role: "user", content: (resultados || []).map((r) => ({
          type: "tool_result", tool_use_id: r.id,
          content: String(r.conteudo ?? "") })) },
    ]);
  },
};

// --- Gemini: `functionCall`/`functionResponse`, e o vínculo é o NOME -------- //
//
// O Gemini não devolve id nenhum, como o Ollama — mas ao contrário dele, o que
// ele reconhece de volta não é a ORDEM, é o NOME da função. Por isso o id
// sintético (que ainda existe, para o laço poder falar de "a chamada tal")
// nunca sai daqui: `montaHistorico` o usa só para achar o nome de cada chamada
// e escrever ESSE no `functionResponse`.

const gemini = {
  traduzTools(tools) {
    return [{
      functionDeclarations: (tools || []).map((t) => ({
        name: t.name, description: t.description, parameters: t.inputSchema,
      })),
    }];
  },

  leResposta(bruto) {
    const cand = (bruto.candidates && bruto.candidates[0]) || {};
    const partes = (cand.content && cand.content.parts) || [];
    return {
      toolCalls: partes.filter((p) => p.functionCall)
        .map((p, i) => ({ id: _idSintetico(i), nome: p.functionCall.name,
                          args: p.functionCall.args || {} })),
      texto: partes.filter((p) => typeof p.text === "string")
        .map((p) => p.text).join(""),
      uso: { entrada: (bruto.usageMetadata || {}).promptTokenCount,
             saida: (bruto.usageMetadata || {}).candidatesTokenCount },
    };
  },

  montaHistorico(msgs, resp, resultados) {
    const nomePorId = new Map((resp.toolCalls || []).map((c) => [c.id, c.nome]));
    const partesModelo = [];
    if (resp.texto) partesModelo.push({ text: resp.texto });
    for (const c of resp.toolCalls || []) {
      partesModelo.push({ functionCall: { name: c.nome, args: c.args || {} } });
    }
    return msgs.concat([
      { role: "model", parts: partesModelo },
      // sem `tool_call_id` nem ordem: o Gemini casa o resultado ao pedido pelo
      // NOME da função, então é isso que `functionResponse.name` carrega.
      { role: "function", parts: (resultados || []).map((r) => ({
          functionResponse: { name: nomePorId.get(r.id) || "",
                              response: { content: String(r.conteudo ?? "") } } })) },
    ]);
  },
};

const DIALETOS = { local: ollama, ollama, openrouter: openai, openai, remote: anthropic,
                   anthropic, gemini };

function de(runtime) {
  const d = DIALETOS[runtime];
  if (!d) throw new Error(`runtime sem dialeto: ${runtime}`);
  return d;
}

module.exports = { de, DIALETOS };
