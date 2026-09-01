// O DIALETO de cada provedor. Estes testes existem para que a divergência entre
// eles fique PRESA no adaptador — se ela vazar para o laço, um provedor novo
// (a OpenAI, que hoje não temos) obriga a reescrever o turno inteiro.
//
// O que se guarda aqui é o MODELO, não o nome do campo: a Anthropic devolve
// resultado como mensagem de USUÁRIO com blocos; a OpenAI como `role:tool` com
// `tool_call_id`; o Ollama como `role:tool` SEM id nenhum, amarrado pela ordem.

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { de } = require("../dialeto");

const TOOLS = [{ name: "take", description: "Pega um item.",
                 inputSchema: { type: "object", properties: { item: { type: "string" } },
                                required: ["item"] } }];

test("o schema do MCP vira o formato de cada provedor, sem perder o enum", () => {
  const oa = de("openai").traduzTools(TOOLS)[0];
  assert.strictEqual(oa.type, "function");
  assert.strictEqual(oa.function.name, "take");
  assert.deepStrictEqual(oa.function.parameters, TOOLS[0].inputSchema);

  const an = de("anthropic").traduzTools(TOOLS)[0];
  assert.strictEqual(an.name, "take");
  // `input_schema`, não `parameters` — e é o MESMO schema: o que muda é o embrulho
  assert.deepStrictEqual(an.input_schema, TOOLS[0].inputSchema);

  // o Ollama fala o dialeto da OpenAI no pedido
  assert.deepStrictEqual(de("local").traduzTools(TOOLS), de("openai").traduzTools(TOOLS));

  // o Gemini embrulha as declarações num único objeto `functionDeclarations`
  const ge = de("gemini").traduzTools(TOOLS);
  assert.strictEqual(ge.length, 1);
  assert.strictEqual(ge[0].functionDeclarations[0].name, "take");
  assert.deepStrictEqual(ge[0].functionDeclarations[0].parameters, TOOLS[0].inputSchema);
});

test("toda chamada lida TEM id — sintético quando o provedor não dá", () => {
  // o Ollama não emite id, e é justamente o caso que quebraria o laço se ele
  // tivesse de saber disso
  const r = de("local").leResposta({
    message: { content: "", tool_calls: [
      { function: { name: "take", arguments: { item: "faca" } } },
      { function: { name: "drop", arguments: { item: "corda" } } }] } });
  assert.deepStrictEqual(r.toolCalls.map((c) => c.nome), ["take", "drop"]);
  assert.ok(r.toolCalls.every((c) => c.id), "chamada sem id: o resultado fica órfão");
  assert.notStrictEqual(r.toolCalls[0].id, r.toolCalls[1].id);

  // a OpenAI dá id, e o id DELA é que vale
  const o = de("openai").leResposta({ choices: [{ message: { tool_calls: [
    { id: "call_abc", function: { name: "take", arguments: '{"item":"faca"}' } }] } }] });
  assert.strictEqual(o.toolCalls[0].id, "call_abc");
  // e os args chegam como TEXTO na OpenAI: quem não desserializa recebe string
  assert.deepStrictEqual(o.toolCalls[0].args, { item: "faca" });

  const a = de("anthropic").leResposta({ content: [
    { type: "text", text: "vou pegar" },
    { type: "tool_use", id: "toolu_1", name: "take", input: { item: "faca" } }] });
  assert.strictEqual(a.toolCalls[0].id, "toolu_1");
  assert.strictEqual(a.texto, "vou pegar");

  // o Gemini também não dá id — como o Ollama, ganha um sintético
  const g = de("gemini").leResposta({ candidates: [{ content: { parts: [
    { text: "vou pegar" },
    { functionCall: { name: "take", args: { item: "faca" } } }] } }] });
  assert.strictEqual(g.toolCalls[0].nome, "take");
  assert.deepStrictEqual(g.toolCalls[0].args, { item: "faca" });
  assert.ok(g.toolCalls[0].id, "chamada do Gemini sem id: o resultado fica órfão");
  assert.strictEqual(g.texto, "vou pegar");
});

test("args mal formados não derrubam a leitura — viram objeto vazio", () => {
  const o = de("openai").leResposta({ choices: [{ message: { tool_calls: [
    { id: "x", function: { name: "take", arguments: "{isso não é json" } }] } }] });
  assert.deepStrictEqual(o.toolCalls[0].args, {});
});

// ---- montaHistorico: o verbo novo, e onde eles mais divergem --------------- //

const RESP = { texto: "penso", toolCalls: [
  { id: "id1", nome: "consultar_momento", args: {} }] };
const RESULT = [{ id: "id1", conteudo: "É noite alta." }];

test("OpenAI: assistant com tool_calls + role tool amarrado por id", () => {
  const msgs = de("openai").montaHistorico(
    [{ role: "system", content: "s" }, { role: "user", content: "u" }], RESP, RESULT);
  assert.strictEqual(msgs.length, 4, "o histórico tem de CRESCER, não ser refeito");
  assert.deepStrictEqual(msgs.slice(0, 2).map((m) => m.role), ["system", "user"]);
  const ass = msgs[2];
  assert.strictEqual(ass.role, "assistant");
  assert.strictEqual(ass.tool_calls[0].id, "id1");
  // os args vão como TEXTO no dialeto da OpenAI
  assert.strictEqual(typeof ass.tool_calls[0].function.arguments, "string");
  const res = msgs[3];
  assert.strictEqual(res.role, "tool");
  assert.strictEqual(res.tool_call_id, "id1");
  assert.match(res.content, /noite/);
});

test("Ollama: NÃO devolve tool_call_id — a amarração é a ordem", () => {
  const msgs = de("local").montaHistorico([{ role: "user", content: "u" }], RESP, RESULT);
  const ass = msgs[1], res = msgs[2];
  assert.strictEqual(ass.role, "assistant");
  // inventar id que ele não pediu é mentir sobre a amarração
  assert.strictEqual(ass.tool_calls[0].id, undefined);
  // e os args vão como OBJETO aqui, não como texto
  assert.deepStrictEqual(ass.tool_calls[0].function.arguments, {});
  assert.strictEqual(res.role, "tool");
  assert.strictEqual(res.tool_call_id, undefined);
});

test("Anthropic: blocos, e o resultado volta como mensagem de USUÁRIO", () => {
  const msgs = de("anthropic").montaHistorico([{ role: "user", content: "u" }],
                                              RESP, RESULT);
  const ass = msgs[1], res = msgs[2];
  assert.strictEqual(ass.role, "assistant");
  assert.deepStrictEqual(ass.content.map((b) => b.type), ["text", "tool_use"]);
  assert.strictEqual(ass.content[1].id, "id1");
  // `role:"tool"` NÃO existe na Anthropic — usar dá 400
  assert.strictEqual(res.role, "user");
  assert.strictEqual(res.content[0].type, "tool_result");
  assert.strictEqual(res.content[0].tool_use_id, "id1");
});

test("Anthropic: sem texto, não vai bloco de texto vazio (a API recusa)", () => {
  const msgs = de("anthropic").montaHistorico(
    [], { texto: "", toolCalls: [{ id: "i", nome: "x", args: {} }] },
    [{ id: "i", conteudo: "ok" }]);
  assert.deepStrictEqual(msgs[0].content.map((b) => b.type), ["tool_use"]);
});

test("Gemini: functionCall/functionResponse, e o vínculo é o NOME", () => {
  const msgs = de("gemini").montaHistorico([{ role: "user", parts: [{ text: "u" }] }],
                                           RESP, RESULT);
  const ass = msgs[1], res = msgs[2];
  assert.strictEqual(ass.role, "model");
  assert.deepStrictEqual(ass.parts[1].functionCall,
                         { name: "consultar_momento", args: {} });
  // sem id nenhum no papel — quem casa o resultado é o `name`
  assert.strictEqual(res.role, "function");
  assert.strictEqual(res.parts[0].functionResponse.name, "consultar_momento");
  assert.match(res.parts[0].functionResponse.response.content, /noite/);
});

test("Gemini: a `thoughtSignature` de cada functionCall atravessa a leitura E a re-escrita — sem ela a 2ª rodada dá 400", () => {
  const lido = de("gemini").leResposta({ candidates: [{ content: { parts: [
    { functionCall: { name: "take", args: { item: "maçã" } }, thoughtSignature: "sig-1" }] } }] });
  assert.strictEqual(lido.toolCalls[0].firma, "sig-1");

  const msgs = de("gemini").montaHistorico([], lido, [{ id: lido.toolCalls[0].id, conteudo: "ok" }]);
  assert.strictEqual(msgs[0].parts[0].functionCall.name, "take");
  assert.strictEqual(msgs[0].parts[0].thoughtSignature, "sig-1",
    "sem a firma de volta no papel, a família 3.x recusa a rodada seguinte com 400");
});

test("Gemini: sem `thoughtSignature` do provedor (modelo antigo), o campo simplesmente não aparece — nunca `undefined` escrito", () => {
  const lido = de("gemini").leResposta({ candidates: [{ content: { parts: [
    { functionCall: { name: "take", args: {} } }] } }] });
  assert.strictEqual(lido.toolCalls[0].firma, null);
  const msgs = de("gemini").montaHistorico([], lido, [{ id: lido.toolCalls[0].id, conteudo: "ok" }]);
  assert.ok(!("thoughtSignature" in msgs[0].parts[0]));
});

test("VÁRIAS chamadas numa resposta: cada uma ganha o seu resultado", () => {
  const resp = { texto: "", toolCalls: [
    { id: "a", nome: "take", args: { item: "faca" } },
    { id: "b", nome: "take", args: { item: "corda" } }] };
  const results = [{ id: "a", conteudo: "pegou a faca" },
                   { id: "b", conteudo: "as mãos estão ocupadas" }];
  const oa = de("openai").montaHistorico([], resp, results);
  assert.strictEqual(oa.filter((m) => m.role === "tool").length, 2);
  // na Anthropic os dois resultados cabem numa mensagem só, em dois blocos
  const an = de("anthropic").montaHistorico([], resp, results);
  const user = an.find((m) => m.role === "user");
  assert.strictEqual(user.content.length, 2);
  assert.deepStrictEqual(user.content.map((b) => b.tool_use_id), ["a", "b"]);
});

test("runtime desconhecido falha alto, não em silêncio", () => {
  assert.throws(() => de("inventado"), /sem dialeto/);
});
