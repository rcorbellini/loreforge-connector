// A DUPLICAÇÃO QUE INICIOU A SPEC 045 — trava de regressão.
//
// `_contextoPayload` (mente.js) descrevia as capacidades em PROSA no `user` ao
// MESMO tempo em que `tools` (o campo nativo) já carregava a mesma informação
// estruturada. Medido ao vivo em 2026-08-17 contra o llama3.1:8b (18 chamadas
// reais, 3 casos × com/sem o bloco × 3 repetições — script em
// `specs/043-tools-exposed-to-mind/testar_duplicacao_capacidades.py`): com o
// bloco duplicado, 4 de 9 chamadas saíam SEM tool_call nenhuma; sem ele, 9 de
// 9 saíram certas, mais rápidas e mais baratas.
//
// Este teste intercepta o `fetch` de verdade (o mesmo caminho que
// `roteamento.test.js` já exercita) e confere o CORPO da requisição que
// `interpret()` manda: quando `tools` vai preenchido, o `content` da mensagem
// `user` não pode conter o bloco `"capacidades"`.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mente-"));
process.env.LOREFORGE_CONFIG = path.join(TMP, "conector.json");
process.env.LOREFORGE_LOG = "0";

const configuracao = require("../config");
// spec 072: a Mente é uma POR ASSENTO. Só a construção mudou — as asserções abaixo
// são as mesmas de antes, e é isso que prova que o refactor foi léxico (research R5).
const Mente = require("../mente").criarMente();

const CENA = {
  self: { id: "fulano", name: "Fulano", memories: [], intentions: [],
          inventory: [], known: [], transit: null },
  scene: { place: { id: "x", name: "X", prose: null, belongs_to: null },
           characters: [], items: [], objects: [], exits: [] },
};

function mundoFalso(tools) {
  return {
    listarCapacidades: async () => tools,
    chamarCapacidade: async () => ({ texto: "", narrativa: {}, recusado: false }),
  };
}

// Captura o corpo de CADA chamada ao Ollama, sem fingir uma resposta fixa —
// devolve sempre "narrate" pronto pra fechar o turno em UMA rodada.
function espiaFetch() {
  const original = globalThis.fetch;
  const corpos = [];
  globalThis.fetch = async (_url, opts) => {
    const corpo = JSON.parse((opts && opts.body) || "{}");
    corpos.push(corpo);
    return {
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        message: {
          content: "",
          tool_calls: [{ function: { name: "narrate",
                         arguments: { narrative_hint: "encerra o turno" } } }],
        },
        prompt_eval_count: 10, eval_count: 5,
      }),
    };
  };
  return { corpos, restaurar: () => { globalThis.fetch = original; } };
}

test("interpret() com tools nativas NÃO duplica as capacidades em prosa no user", async () => {
  const cfg = configuracao.carregar(true);
  cfg.runtime = "local";
  configuracao.gravar(cfg);

  Mente.usarMundo(mundoFalso([
    { name: "take", description: "Pega um item.", inputSchema: { type: "object" } },
    { name: "narrate", description: "Encerra o turno.", inputSchema: { type: "object" } },
  ]));
  Mente.usarExtensoes({ toolsLocais: () => [], ehLocal: () => false,
                        hook: async (_p, dado) => dado });

  const espiao = espiaFetch();
  try {
    await Mente.interpret("pegue a corda", CENA);
  } finally {
    espiao.restaurar();
  }

  assert.strictEqual(espiao.corpos.length, 1, "esperava uma única rodada");
  const corpo = espiao.corpos[0];
  assert.ok(Array.isArray(corpo.tools) && corpo.tools.length > 0,
    "a chamada não levou `tools` — o teste não está exercitando o caminho certo");

  const userMsg = corpo.messages.find((m) => m.role === "user");
  assert.ok(userMsg, "não achei a mensagem 'user' no corpo da requisição");
  assert.ok(!userMsg.content.includes('"capacidades"'),
    "o user ainda descreve as capacidades em prosa — duplicação viva de novo: " +
    userMsg.content.slice(0, 300));
});

// --------------------------------------------------------------------------- //
// O CONTRATO DO MUNDO É O SCHEMA — trava de regressão (2026-08-20).
//
// `cook.ingredientes` é declarado `array` no `inputSchema` que o `tools/list`
// entrega. O llama3.1:8b às vezes manda a lista como texto com vírgulas, e o
// conector repassava verbatim: o mundo tratava a string INTEIRA como um id só e
// respondia "'moeda-a, moeda-b' não está ao alcance" — apontando para ALCANCE
// quando o defeito era FORMATO. A Mente leu isso como "os ingredientes é que
// estão errados" e enumerou 20 combinações em 49 tentativas.
//
// A correção é DESTE lado: o contrato está certo, o cliente é que precisa
// mandar certo — e ele tem o schema em mãos desde o `tools/list`.
// --------------------------------------------------------------------------- //

function espiaProposta(argsDaTool) {
  const original = globalThis.fetch;
  let rodada = 0;
  globalThis.fetch = async (_url, opts) => {
    const corpo = JSON.parse((opts && opts.body) || "{}");
    rodada++;
    const chamada = rodada === 1
      ? { function: { name: "cook", arguments: argsDaTool } }
      : { function: { name: "narrate", arguments: { narrative_hint: "fim" } } };
    return {
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ message: { content: "", tool_calls: [chamada] },
                           prompt_eval_count: 10, eval_count: 5 }),
    };
  };
  return { restaurar: () => { globalThis.fetch = original; }, corpo: null };
}

const TOOLS_COOK = [
  { name: "cook", description: "Cozinha.",
    inputSchema: { type: "object",
      properties: { ingredientes: { type: "array", items: { type: "string" } },
                    fonte_calor: { type: "string" } },
      required: ["ingredientes", "fonte_calor"] } },
  { name: "narrate", description: "Encerra.", inputSchema: { type: "object" } },
];

async function propostaDe(args) {
  const cfg = configuracao.carregar(true);
  cfg.runtime = "local";
  configuracao.gravar(cfg);
  Mente.usarMundo(mundoFalso(TOOLS_COOK));
  Mente.usarExtensoes({ toolsLocais: () => [], ehLocal: () => false,
                        hook: async (_p, dado) => dado });
  const espiao = espiaProposta(args);
  try {
    const sessao = await Mente.interpret("cozinhe algo", CENA);
    return sessao && sessao.propostas && sessao.propostas[0];
  } finally {
    espiao.restaurar();
  }
}

test("param `array`: string com vírgulas vira LISTA antes de subir ao mundo", async () => {
  const p = await propostaDe({ ingredientes: "moeda-a, moeda-b, moeda-c",
                               fonte_calor: "fogao",
                               prosa: { acao: "cozinha", fala: "" } });
  assert.ok(p, "não veio proposta nenhuma");
  assert.deepStrictEqual(p.alvos.ingredientes, ["moeda-a", "moeda-b", "moeda-c"],
    "a string com vírgulas subiu sem virar lista: " + JSON.stringify(p.alvos));
  assert.strictEqual(p.alvos.fonte_calor, "fogao",
    "param `string` NÃO pode ser tocado — só os declarados `array`");
});

test("param `array`: id único vira lista de um; lista já certa não é mexida", async () => {
  const um = await propostaDe({ ingredientes: "coelho-do-cais", fonte_calor: "fogao",
                                prosa: { acao: "cozinha", fala: "" } });
  assert.deepStrictEqual(um.alvos.ingredientes, ["coelho-do-cais"]);

  const ja = await propostaDe({ ingredientes: ["carne-a", "carne-b"],
                                fonte_calor: "fogao",
                                prosa: { acao: "cozinha", fala: "" } });
  assert.deepStrictEqual(ja.alvos.ingredientes, ["carne-a", "carne-b"]);
});

// ===========================================================================
// SPEC 060 — a PARADA FALSA.
//
// Com o turno passando a continuar no sucesso, "sem tool call" virou o sinal de
// que A Mente terminou. Só que às vezes ela NÃO terminou: o modelo escreveu a
// chamada como TEXTO no `content` em vez de emitir tool call, e isso chega
// exatamente igual. Confundir os dois faria a próxima medição de campo mentir —
// o mesmo estrago que o item 52.5 registrou.
// ===========================================================================

test("060: chamada emitida como TEXTO é reconhecida como parada FALSA", () => {
  const { _paradaFalsa } = require("../mente");
  assert.strictEqual(typeof _paradaFalsa, "function",
    "a função precisa estar exposta — teste que não testa nada é pior que teste ausente");
  const tools = [{ name: "ask_directions" }, { name: "take" }];
  assert.strictEqual(
    _paradaFalsa('{"name": "ask_directions", "parameters": {"quem": "odila"}}', tools),
    "ask_directions", "JSON puro com nome conhecido");
  assert.strictEqual(
    _paradaFalsa('Ele decide perguntar. {"name":"take","parameters":{}}', tools),
    "take", "JSON embutido em prosa");
  assert.strictEqual(
    _paradaFalsa("Torvin fica onde está, pensando.", tools), null,
    "prosa de verdade NÃO é parada falsa");
  assert.strictEqual(
    _paradaFalsa('{"name": "comprar", "parameters": {}}', tools), null,
    "nome DESCONHECIDO não é parada falsa — é capacidade inventada, que o " +
    "`_peneira` já trata; confundir as duas troca um defeito por outro");
  assert.strictEqual(_paradaFalsa("", tools), null);
  assert.strictEqual(_paradaFalsa(null, tools), null);
});


// ===========================================================================
// SPEC 060 / US2 — o id NÃO chega à Mente.
//
// Este é o teste que prova a etapa inteira. Se um id vazar para o payload, a
// feature não existe: ela volta a copiar id em vez de apontar por nome, e a
// família de recusa "alvo fantasma" volta junto.
// ===========================================================================

test("060/US2: nenhum id de cena aparece no payload que vai ao modelo", async () => {
  const m = require("../mente");
  const CONTEXTO = {
    self: { id: "torvin-ferreiro", name: "Torvin", prose: "Um ferreiro.",
            inventory: [{ id: "bolsa-de-couro", name: "Bolsa de Couro" }],
            memories: [], intentions: [], known: [], transit: null },
    scene: {
      place: { id: "praca-do-mercado", name: "Praça do Mercado", prose: "Uma praça." },
      characters: [
        { id: "obadiah-mascate", name: "Obadiah, o Mascate", action: "vende",
          carrying: [{ id: "cravos-de-ferro", name: "Cravos de Ferro" }] },
        { id: "torvin-ferreiro", name: "Torvin", state: "self" }],
      items: [{ id: "frasco-de-oleo", name: "Frasco de Óleo" }],
      objects: [{ id: "poco-da-praca", name: "Poço", contains: [] }],
      exits: [{ id: "rua-do-portao", name: "Rua do Portão",
                destination_name: "Porto Negro" }],
    },
  };
  const payload = JSON.stringify(await m._contextoPayload(CONTEXTO,
    { comCapacidades: false }));

  const IDS = ["obadiah-mascate", "frasco-de-oleo", "bolsa-de-couro",
               "cravos-de-ferro", "poco-da-praca", "rua-do-portao"];
  for (const id of IDS) {
    assert.ok(!payload.includes(id), `o id "${id}" vazou para o payload da Mente`);
  }
  // e os NOMES continuam lá: é por eles que ela aponta
  for (const nome of ["Obadiah, o Mascate", "Frasco de Óleo", "Bolsa de Couro",
                      "Rua do Portão"]) {
    assert.ok(payload.includes(nome), `o nome "${nome}" sumiu — ela ficou sem como apontar`);
  }
});

test("060/US2: o enum de referência sai; o CALCULADO e o VOCABULÁRIO ficam", () => {
  const m = require("../mente");
  if (typeof m._semIdDeCena !== "function") {
    assert.fail("_semIdDeCena precisa estar exposta para este teste valer");
  }
  // O RECORTE É DO CONECTOR (o BFF), e a classificação é exaustiva — ver o guarda
  // "todo parâmetro com candidatos está classificado". O mundo entrega o dado
  // completo; o que o MODELO vê se decide aqui, por medição.
  const take = m._semIdDeCena({ name: "take",
    inputSchema: { type: "object",
      properties: { item: { type: "string", enum: ["frasco-de-oleo", "cantil"] } } } });
  assert.ok(!take.inputSchema.properties.item.enum,
    "referência SAI: a Mente já vê isso em prosa, e o enum é a segunda cópia");
  assert.ok(!take.inputSchema.properties.item.description,
    "e NÃO fica dica no parâmetro: ela é dita uma vez no ESCOLHER_SYSTEM (22/09)");

  // O que o mundo NÃO marcou como referência fica intacto — é o subconjunto
  // calculado (quem está caído) ou o vocabulário fechado (ativa/concluida).
  const heal = m._semIdDeCena({ name: "heal",
    inputSchema: { type: "object",
      properties: { alvo: { type: "string", enum: ["fenn-dedos-leves"] } } } });
  assert.deepStrictEqual(heal.inputSchema.properties.alvo.enum, ["fenn-dedos-leves"],
    "subconjunto CALCULADO fica: quem está caído é a ÚNICA fonte, e o contexto " +
    "não diz isso de um jeito que ela use — tirar perderia conhecimento, não peso");

  const voc = m._semIdDeCena({ name: "set_intention",
    inputSchema: { type: "object", properties: {
      pronto_quando: { type: "string", enum: ["hunger", "posse", "lugar"] } } } });
  assert.deepStrictEqual(voc.inputSchema.properties.pronto_quando.enum,
    ["hunger", "posse", "lugar"],
    "VOCABULÁRIO FECHADO fica — foi arrancá-lo que matou duas corridas A/B");

  const arr = m._semIdDeCena({ name: "cook",
    inputSchema: { type: "object",
      properties: { ingredientes: { type: "array", items: { type: "string",
        enum: ["carne", "sal"] } } } } });
  assert.ok(!arr.inputSchema.properties.ingredientes.items.enum,
    "enum dentro de array também sai");

  // TOOL LOCAL (do harness): não está em `_ENUM_SAI`, então o enum dela seria
  // cortado pelo default. É o preço de um default que remove — e por isso o guarda
  // exaustivo existe: quem acrescentar tool local com enum tem de classificá-la.
  const local = m._semIdDeCena({ name: "cook", inputSchema: { type: "object",
    properties: { fonte_calor: { type: "string", enum: ["fogao"] } } } });
  assert.ok(!local.inputSchema.properties.fonte_calor.enum,
    "o que está em _ENUM_SAI sai mesmo");
});


// ===========================================================================
// P2 (rodada 16/09) — a explicação do `prosa` é dita UMA vez, não quarenta.
//
// `mcp_core.input_schema` pendura o MESMO objeto `prosa` explicado em toda
// capacidade de ação: ~320 chars × 40 = 30% do bloco de tools no mundo do marco.
// O conector corta a explicação (e SÓ ela) porque o `ESCOLHER_SYSTEM` já a diz,
// uma vez, no único caminho que vê estas tools.
//
// POR QUE A FORMA NÃO PODE IR JUNTO — medido em 21/09, e o número surpreendeu:
// `ferramentas/sondagem-ref-openapi.js` rodou três variantes do bloco contra o
// modelo real. Tirando o OBJETO `prosa` das capacidades (não a explicação: a chave),
// das 11 chamadas que o modelo fez, **11 voltaram sem prosa nenhuma** — contra 0 de
// 12 com o objeto presente. O `ESCOLHER_SYSTEM` manda preencher prosa em toda
// chamada e o modelo IGNORA: quem faz a prosa existir é a FORMA no schema, não a
// instrução no system.
//
// É a razão de este teste existir com esta forma. A explicação é repetição e sai de
// graça; a chave é o que faz a Mente encenar, e sem ela o `laco.js` cai no fallback
// que narra o PENSAMENTO da Mente no lugar do que o personagem faz — a régua
// passaria a julgar raciocínio em vez de encenação, em silêncio.
//
// A mesma sondagem respondeu `$ref`/`$defs` ao estilo OpenAPI (-4,3%): o modelo não
// resolve a referência. Ela se comportou IDÊNTICA a não ter prosa (0/15). Num OpenAPI
// quem resolve `$ref` é um parser, antes de qualquer leitura; aqui o bloco é
// serializado para dentro do prompt e o "parser" é a atenção de um 8B.
// ===========================================================================

test("P2: a explicação do `prosa` sai, a FORMA dele fica inteira", () => {
  const m = require("../mente");
  const cru = { name: "persuade", inputSchema: { type: "object", properties: {
    personagem: { type: "string" },
    prosa: { type: "object",
      description: "O que o personagem FAZ e DIZ ao tentar isto, in-world.",
      properties: {
        acao: { type: "string", description: "o que ele faz. Obrigatório." },
        fala: { type: "string", description: "o que diz em voz alta, se disser" },
      },
      required: ["acao"] } },
    required: ["personagem", "prosa"] } };
  const t = m._semProsaExplicada(cru);
  const p = t.inputSchema.properties.prosa;

  assert.ok(!p.description, "a explicação repetida do objeto sai");
  assert.ok(!p.properties.acao.description, "e a de cada campo também");
  assert.ok(!p.properties.fala.description);

  // O QUE NÃO PODE SAIR: a forma é o que o schema de fato entrega (spec 043).
  assert.strictEqual(p.type, "object");
  assert.deepStrictEqual(Object.keys(p.properties), ["acao", "fala"],
    "os campos continuam lá — ela não fica sem saber que existe `fala`");
  assert.deepStrictEqual(p.required, ["acao"],
    "`acao` continua OBRIGATÓRIA: é a régua que lê COMO se tentou");
  assert.deepStrictEqual(t.inputSchema.required, ["personagem", "prosa"]);
  assert.deepStrictEqual(t.inputSchema.properties.personagem, { type: "string" },
    "nenhum outro parâmetro é tocado");

  // CAMPO NOVO EM `prosa` CONTINUA DESCENDO. O corte tira `description`, nunca
  // uma chave — perder campo em silêncio já matou duas corridas A/B.
  const comCampoNovo = m._semProsaExplicada({ name: "x", inputSchema: {
    type: "object", properties: { prosa: { type: "object", properties: {
      acao: { type: "string" },
      tom: { type: "string", description: "inventado hoje" } } } } } });
  assert.ok("tom" in comCampoNovo.inputSchema.properties.prosa.properties,
    "um campo novo no contrato aparece no prompt em vez de sumir");

  // CONSULTA não tem `prosa` (perguntar não é tentar) — passa intacta.
  const consulta = { name: "consultar_momento",
    inputSchema: { type: "object", properties: {} } };
  assert.strictEqual(m._semProsaExplicada(consulta), consulta,
    "sem `prosa` não há o que cortar, e a tool volta como veio");
});

test("P2: o FUNIL aplica os dois recortes — é por ele que o jogo e a bancada passam", () => {
  const m = require("../mente");
  const t = m._recorteDaMente({ name: "give", inputSchema: { type: "object",
    properties: {
      to: { type: "string", enum: ["elga-taverneira"] },
      prosa: { type: "object", description: "explicação repetida",
               properties: { acao: { type: "string", description: "o que ele faz" } },
               required: ["acao"] } } } });
  assert.ok(!t.inputSchema.properties.to.enum, "o enum de cena sai (060)");
  assert.ok(!t.inputSchema.properties.to.description,
    "e nada entra no lugar — a dica mora no ESCOLHER_SYSTEM (22/09)");
  assert.ok(!t.inputSchema.properties.prosa.description, "e a prosa explicada sai (P2)");
  assert.ok(!t.inputSchema.properties.prosa.properties.acao.description);
  assert.deepStrictEqual(t.inputSchema.properties.prosa.required, ["acao"]);
});

// A LIGAÇÃO DO FUNIL. Os dois testes acima provam a FUNÇÃO; este prova que ela está
// no fio. Trocar o `map` do `interpret` de volta para `_semIdDeCena` deixaria os dois
// verdes e o modelo lendo a explicação quarenta vezes — o modo de falha do "órfão com
// a suíte verde", que aqui custaria 30% do bloco de tools em silêncio.
test("P2: a explicação do `prosa` NÃO chega ao modelo por `interpret()`", async () => {
  const cfg = configuracao.carregar(true);
  cfg.runtime = "local";
  configuracao.gravar(cfg);

  const prosaExplicada = { type: "object",
    description: "O que o personagem FAZ e DIZ ao tentar isto, in-world.",
    properties: {
      acao: { type: "string", description: "o que ele faz. Obrigatório." },
      fala: { type: "string", description: "o que diz em voz alta, se disser" },
    },
    required: ["acao"] };
  Mente.usarMundo(mundoFalso([
    { name: "take", description: "Pega um item.",
      inputSchema: { type: "object", properties: { prosa: prosaExplicada },
                     required: ["prosa"] } },
    { name: "narrate", description: "Encerra o turno.", inputSchema: { type: "object" } },
  ]));
  Mente.usarExtensoes({ toolsLocais: () => [], ehLocal: () => false,
                        hook: async (_p, dado) => dado });

  const espiao = espiaFetch();
  try {
    await Mente.interpret("pegue a corda", CENA);
  } finally {
    espiao.restaurar();
  }

  const corpo = espiao.corpos[0];
  const take = (corpo.tools || []).find(
    (t) => (t.function && t.function.name) === "take" || t.name === "take");
  assert.ok(take, "a chamada não levou a tool `take` — o teste não exercita o caminho");
  const esq = (take.function && take.function.parameters) || take.inputSchema;
  assert.ok(esq.properties.prosa, "o `prosa` continua no schema — só a lição sai");
  assert.ok(!esq.properties.prosa.description,
    "a explicação do `prosa` chegou ao modelo: o funil do recorte saiu do fio");
  assert.ok(!esq.properties.prosa.properties.acao.description);
  assert.deepStrictEqual(esq.properties.prosa.required, ["acao"],
    "e a obrigatoriedade de `acao` atravessou o fio inteira");
});

// A LIGAÇÃO DA LIÇÃO. Cortar a explicação do schema só é seguro porque ela está DITA no
// `ESCOLHER_SYSTEM` — o único caminho que manda estas tools ao modelo (a autonomia
// não tem `tools` nativas). Se alguém enxugar aquele texto, este teste cai: sem ele,
// o corte acima passa a ser perda de informação, não de repetição.
test("P2: o ESCOLHER_SYSTEM é quem ensina o `prosa` agora — e ainda ensina", () => {
  const m = require("../mente");
  const sys = m.promptsPadrao().interpretar;
  assert.match(sys, /prosa\.acao/,
    "o campo obrigatório precisa ser nomeado: o schema não explica mais");
  assert.match(sys, /prosa\.fala/, "e o opcional também");
  assert.match(sys, /TENTATIVA/,
    "e a regra de descrever a tentativa, nunca o desfecho — era a frase do objeto");
});


// ===========================================================================
// SPEC 060 / US3 — a cena em PROSA.
//
// Medida contra quatro alternativas: a prosa foi a mais barata E a mais certeira
// (20/20 contra 19/20 do JSON). E o resultado NÃO é "menos estrutura é melhor" —
// as linhas `chave: valor` são quase tão baratas e foram as PIORES (15/20).
// ===========================================================================

test("060/US3: a prosa leva TODOS os nomes da cena e NENHUM id", async () => {
  const m = require("../mente");
  const CTX = {
    self: { id: "torvin-ferreiro", name: "Torvin", prose: "Um ferreiro calado.",
            needs: { hunger: "com fome" },
            inventory: [{ id: "bolsa-de-couro", name: "Bolsa de Couro" }],
            memories: [{ content: "Prometi cravos a Obadiah.", timestamp_start: 1 }],
            intentions: [], known: [], transit: null },
    scene: {
      place: { id: "praca-do-mercado", name: "Praça do Mercado",
               prose: "Barracas e gente." },
      characters: [
        { id: "obadiah-mascate", name: "Obadiah, o Mascate", action: "vende",
          carrying: [{ id: "cravos-de-ferro", name: "Cravos de Ferro" }] },
        { id: "torvin-ferreiro", name: "Torvin", state: "self" }],
      items: [{ id: "frasco-de-oleo", name: "Frasco de Óleo" }],
      objects: [{ id: "poco-da-praca", name: "Poço", contains: [] }],
      exits: [{ id: "rua-do-portao", name: "Rua do Portão",
                destination_name: "Porto Negro" }],
    },
  };
  const prosa = m._cenaEmProsa(await m._contextoPayload(CTX, { comCapacidades: false }));

  for (const nome of ["Praça do Mercado", "Obadiah, o Mascate", "Cravos de Ferro",
                      "Frasco de Óleo", "Poço", "Bolsa de Couro", "Rua do Portão",
                      "Porto Negro", "Um ferreiro calado", "com fome"]) {
    assert.ok(prosa.includes(nome), `a prosa perdeu "${nome}"`);
  }
  for (const id of ["obadiah-mascate", "frasco-de-oleo", "bolsa-de-couro",
                    "cravos-de-ferro", "poco-da-praca", "rua-do-portao"]) {
    assert.ok(!prosa.includes(id), `o id "${id}" vazou para a prosa`);
  }
});

test("060/US3: a MEMÓRIA chega à prosa — o campo é `o_que`, não `content`", async () => {
  // Este teste existe por um bug real, pego antes de ir ao ar: o renderizador
  // procurava `summary`/`content`, mas `_limparMemorias` entrega `o_que`. A
  // memória sumiria da cena EM SILÊNCIO — e memória é o eixo do jogo.
  const m = require("../mente");
  const prosa = m._cenaEmProsa(await m._contextoPayload({
    self: { name: "T", inventory: [], memories: [{ content: "Prometi cravos a Obadiah.", timestamp_start: 1 }] },
    scene: { place: { name: "Praça" }, characters: [],
             items: [], objects: [], exits: [] },
  }, { comCapacidades: false }));
  assert.ok(/Ele lembra:.*Prometi cravos/.test(prosa), prosa);
});

test("060/US3: cena vazia não quebra e não mente", async () => {
  const m = require("../mente");
  const prosa = m._cenaEmProsa(await m._contextoPayload({
    self: { name: "T", inventory: [], memories: [] },
    scene: { place: { name: "Ermo" }, characters: [],
             items: [], objects: [], exits: [] },
  }, { comCapacidades: false }));
  assert.ok(prosa.includes("Não há mais ninguém aqui"));
  assert.ok(prosa.includes("Ele não carrega nada"));
  assert.ok(!prosa.includes("undefined"), prosa);
});

test("060/US3: a hierarquia de lugares vira caminho, não [object Object]", async () => {
  // Bug REAL, pego no primeiro turno de jogo depois de aplicar a US3: o payload
  // saiu com "O lugar é de [object Object]." porque `_pertenceA` devolve uma
  // CADEIA aninhada, não uma string. Os testes com dublê não pegaram — a cena
  // sintética não tinha `belongs_to`. É por isso que jogar de verdade faz parte.
  const m = require("../mente");
  const prosa = m._cenaEmProsa(await m._contextoPayload({
    self: { name: "T", inventory: [], memories: [] },
    scene: {
      place: { name: "Boticário", prose: "Uma loja.",
        belongs_to: { name: "Porto Negro", belongs_to: { name: "Costa de Ferro" } } },
      characters: [], items: [], objects: [], exits: [],
    },
  }, { comCapacidades: false }));
  assert.ok(!prosa.includes("[object Object]"), prosa);
  assert.ok(prosa.includes("Porto Negro") && prosa.includes("Costa de Ferro"), prosa);
});

// ===========================================================================
// SPEC 062, US4 — "isso é rota, não destino", fim-a-fim por `interpret()`.
// ===========================================================================

test("062/US4: travel_to para o nome de uma rota produz naoResolvido 'e-rota'",
async () => {
  const cfg = configuracao.carregar(true);
  cfg.runtime = "local";
  configuracao.gravar(cfg);

  const TOOLS = [
    { name: "travel_to", description: "Viaja.",
      inputSchema: { type: "object",
        properties: { destino: { type: "string" } }, required: ["destino"] } },
    { name: "enter_route", description: "Entra numa rota.",
      inputSchema: { type: "object",
        properties: { route: { type: "string" } }, required: ["route"] } },
    { name: "narrate", description: "Encerra.", inputSchema: { type: "object" } },
  ];
  // O par capacidade+param -> candidatos, exatamente como `mundo.js` monta a
  // partir da face + `registrarNomes`: "Praça do Mercado" é um destino de
  // verdade (não casa com "Beco das Sombras"); "beco-das-sombras" só existe
  // como ROTA.
  const CANDIDATOS = {
    "travel_to.destino": [{ id: "praca-do-mercado", nome: "Praça do Mercado" }],
    "enter_route.route": [{ id: "beco-das-sombras", nome: "Beco das Sombras" }],
  };
  const mundo = {
    listarCapacidades: async () => TOOLS,
    chamarCapacidade: async () => ({ texto: "", narrativa: {}, recusado: false }),
    candidatosOuConhecidos: (cap, param) => CANDIDATOS[`${cap}.${param}`] || null,
  };
  Mente.usarMundo(mundo);
  Mente.usarExtensoes({ toolsLocais: () => [], ehLocal: () => false,
                        hook: async (_p, dado) => dado });

  const original = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    const corpo = JSON.parse((opts && opts.body) || "{}");
    return {
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        message: { content: "", tool_calls: [{ function: {
          name: "travel_to", arguments: { destino: "Beco das Sombras" } } }] },
        prompt_eval_count: 10, eval_count: 5,
      }),
    };
  };
  let sessao;
  try {
    sessao = await Mente.interpret("vá pelo beco das sombras", CENA);
  } finally {
    globalThis.fetch = original;
  }

  assert.ok(sessao, "esperava uma sessão de volta");
  const proposta = sessao.propostas.find((p) => p.capacidade === "travel_to");
  assert.ok(proposta, "esperava a proposta de travel_to");
  assert.ok(Array.isArray(proposta.naoResolvido) && proposta.naoResolvido.length,
    "destino não resolvido devia gerar naoResolvido");
  const falha = proposta.naoResolvido.find((f) => f.param === "destino");
  assert.strictEqual(falha.porque, "e-rota",
    "beco-das-sombras é rota, não destino — devia ser marcado como tal, " +
    "não como 'nada-casou' genérico: " + JSON.stringify(proposta.naoResolvido));
});

// --------------------------------------------------------------------------- //
// O RECORTE PARA A LLM NÃO TEM DEFAULT MUDO
// --------------------------------------------------------------------------- //
//
// `_semIdDeCena` decide o que o modelo vê, e o default é REMOVER. Foi assim que
// `set_intention:pronto_quando` sumiu do prompt sem ninguém decidir: nasceu, não
// entrou na lista, e a Mente passou a adivinhar o critério — duas corridas A/B de
// quatro horas morreram nisso.
//
// A lista fica (tentou-se derivá-la e deu 75 divergências: a distinção é um juízo
// sobre o que a Mente infere da prosa, não igualdade de conjuntos). O que muda é que
// ela deixa de ser a única guarda: todo par `tool:parâmetro` COM CANDIDATOS tem de
// estar classificado, num conjunto ou no outro. Um parâmetro novo quebra a suíte até
// alguém escolher por ele.
test("todo parâmetro com candidatos está classificado — sem default mudo", () => {
  const m = require("../mente");
  assert.ok(m._ENUM_FICA instanceof Set && m._ENUM_SAI instanceof Set,
    "os dois conjuntos precisam estar expostos para este guarda valer");
  const nos_dois = [...m._ENUM_FICA].filter((p) => m._ENUM_SAI.has(p));
  assert.deepStrictEqual(nos_dois, [],
    "um par nos DOIS conjuntos é ambiguidade: decida de que lado ele está");
  for (const p of [...m._ENUM_FICA, ...m._ENUM_SAI]) {
    assert.match(p, /^[a-z_]+:[a-z_]+$/,
      `"${p}" não tem a forma tool:parâmetro`);
  }
});

test("o que FICA de fato sobrevive ao recorte, e o que SAI de fato sai", () => {
  const m = require("../mente");
  // um par de cada lado, exercitado pelo caminho real
  const fica = m._semIdDeCena({ name: "set_intention", inputSchema: { type: "object",
    properties: { pronto_quando: { type: "string", enum: ["hunger", "posse"] } } } });
  assert.deepStrictEqual(fica.inputSchema.properties.pronto_quando.enum,
    ["hunger", "posse"],
    "VOCABULÁRIO fica — arrancá-lo foi o que matou duas corridas A/B");

  const sai = m._semIdDeCena({ name: "give", inputSchema: { type: "object",
    properties: { to: { type: "string", enum: ["elga-taverneira"] } } } });
  assert.ok(!sai.inputSchema.properties.to.enum,
    "referência de cena SAI: a Mente já a lê em prosa e aponta por nome");
  assert.ok(!sai.inputSchema.properties.to.description,
    "e nada fica no lugar — a dica mora no ESCOLHER_SYSTEM (22/09)");
});

// ===========================================================================
// O ID DE MEMÓRIA SAI — mas só quando há com que resolvê-lo (16/09)
//
// Era o maior enum que restava: 506 entradas para um personagem de história longa,
// 32% de tudo o que vai no fio. Ficava porque a face mandava o candidato com `nome`
// igual ao próprio id (`name_of` não acha memória), e sem nome não há o que resolver.
//
// Com o resumo descendo como nome, a memória vira o que todo o resto já é: A Mente
// nomeia, o conector converte. Mas nomear memória é trabalho de EMBEDDING — o resumo
// tem 99 chars em média e ela a chama de outro jeito. Medido, 811 candidatos:
//   só literal (o config de hoje) .... 0/5
//   com embedding .................... 2/5, e 3/5 contra o que a consulta evocou
// Zero de cinco não é economia: é `sing`/`accuse`/`write` deixando de ser chamáveis.
// ===========================================================================

test("o enum de memória FICA enquanto não houver camada semântica", () => {
  const m = require("../mente");
  const cfg = configuracao.carregar(true);
  cfg.embeddingModel = "";
  configuracao.gravar(cfg);
  const t = m._semIdDeCena({ name: "sing", inputSchema: { type: "object", properties: {
    memoria_id: { type: "string", enum: ["mem-1", "mem-2"] } } } });
  assert.deepStrictEqual(t.inputSchema.properties.memoria_id.enum, ["mem-1", "mem-2"],
    "sem embedding o resolvedor mede 0/5 — tirar o enum tornaria a tool inchamável");
});

test("com a camada semântica ligada, o enum de memória SAI", () => {
  const m = require("../mente");
  const cfg = configuracao.carregar(true);
  cfg.embeddingModel = "nomic-embed-text:latest";
  configuracao.gravar(cfg);
  const t = m._semIdDeCena({ name: "sing", inputSchema: { type: "object", properties: {
    memoria_id: { type: "string", enum: ["mem-1", "mem-2"] } } } });
  assert.ok(!t.inputSchema.properties.memoria_id.enum, "o enum de 506 ids tinha de sair");
  assert.ok(!t.inputSchema.properties.memoria_id.description,
    "e nada fica no lugar — a dica mora no ESCOLHER_SYSTEM (22/09)");
  cfg.embeddingModel = "";
  configuracao.gravar(cfg);
});

test("`memoria_id` está classificado como SAI — não caiu no default mudo", () => {
  const m = require("../mente");
  for (const par of ["sing:memoria_id", "accuse:memoria_id", "write:memoria_id"]) {
    assert.ok(m._ENUM_SAI.has(par), `${par} precisa estar em _ENUM_SAI`);
    assert.ok(!m._ENUM_FICA.has(par), `${par} não pode estar nos dois`);
    assert.ok(m._SO_COM_SEMANTICA.has(par), `${par} só sai com embedding`);
  }
});

// ===========================================================================
// O ALCANCE DESCE; QUEM CORTA É O CONECTOR (17/09)
//
// `docs/fluxo-do-contrato.md` § "O princípio, afiado": o mundo entrega o que é DELE
// (todas as memórias que ele conseguiria puxar, viva ou vencida), o conector guarda,
// e o payload leva só o que está gritando agora. Os três cortes que moraram no
// servidor por um ano — vivas, evocação, teto — passaram para cá.
// ===========================================================================

const MEMS = [
  { id: "m1", estado: "viva", salience: "vivida", recency: "agora",
    intensity: "large", summary: "Vi Hulda furtar o pe de cabra.",
    involved: ["hulda"], timestamp_start: 500 },
  { id: "m2", estado: "viva", salience: "latente", recency: "ha meses",
    intensity: "small", summary: "Conversei com Elga sobre o tempo.",
    involved: ["elga"], timestamp_start: 400 },
  { id: "m3", estado: "vencida", salience: "latente", recency: "ha meses",
    intensity: "small", summary: "Perdi uma moeda na praca.",
    involved: ["praca"], timestamp_start: 300 },
];

test("o corte lê `summary` — o alcance NÃO carrega `content`", () => {
  const m = require("../mente");
  const saiu = m._limparMemorias(MEMS, new Set());
  assert.ok(saiu.length > 0,
    "lendo só `content`, o contrato novo devolveria lista VAZIA em silêncio — a " +
    "Mente jogaria sem memória nenhuma com a suíte verde");
  assert.ok(saiu.some((x) => x.o_que.includes("Hulda")));
});

test("a VENCIDA é alcançável mas não vai ao payload", () => {
  const m = require("../mente");
  const saiu = m._limparMemorias(MEMS, new Set());
  assert.ok(!saiu.some((x) => x.o_que.includes("moeda")),
    "ela é dele e ele pode parar e lembrar — mas não está gritando na cabeça dele");
});

test("a EVOCAÇÃO: o vívido volta sozinho, o latente só se a cena o chamar", () => {
  const m = require("../mente");
  // ninguém presente: só o vívido por si sobrevive
  const sozinho = m._limparMemorias(MEMS, new Set(["ninguem"]));
  assert.deepStrictEqual(sozinho.map((x) => x.o_que),
    ["Vi Hulda furtar o pe de cabra."],
    "o latente não volta sem a cena o evocar (spec 013)");
  // com a Elga presente, a lembrança dela volta junto
  const comElga = m._limparMemorias(MEMS, new Set(["elga"]));
  assert.strictEqual(comElga.length, 2,
    "quem está presente traz de volta o que o envolve, mesmo latente");
});

test("sem `estado` no payload, o corte de vida é pulado — servidor antigo não quebra",
     () => {
  const m = require("../mente");
  const velho = [{ id: "v1", content: "Uma lembranca do contrato antigo.",
                   salience: "vivida", timestamp_start: 1 }];
  const saiu = m._limparMemorias(velho, new Set());
  assert.strictEqual(saiu.length, 1,
    "o contrato antigo já vinha filtrado pelo servidor; aqui não há o que cortar");
});

test("o TETO de 12 continua, e é o último corte", () => {
  const m = require("../mente");
  const muitas = Array.from({ length: 40 }, (_, i) => ({
    id: `x${i}`, estado: "viva", salience: "vivida", intensity: "small",
    summary: `lembranca numero ${i}`, involved: [], timestamp_start: i }));
  assert.strictEqual(m._limparMemorias(muitas, new Set()).length, 12);
});

// ===========================================================================
// A DICA MUDOU DE LUGAR, NÃO SUMIU (22/09) — teste de LIGAÇÃO.
//
// Até 21/09 todo parâmetro de referência carregava `"o NOME daquilo, como aparece
// na cena"`: a mesma frase, quarenta vezes, 3,6% do bloco em toda chamada. Ela saiu
// do schema e entrou UMA vez no `ESCOLHER_SYSTEM`.
//
// POR QUE ISTO PRECISA DE TESTE PRÓPRIO, e não basta o que afirma que o parâmetro
// ficou nu: se a linha sumir do system, o corte continua passando e a Mente perde a
// única instrução que lhe diz COMO apontar — a economia fica e a informação vai
// embora, sem quebrar nada. É o modo de falha que o projeto chama de órfão com a
// suíte verde, e a defesa é cobrar as DUAS pontas no mesmo teste.
//
// Provado quebrando de propósito: trocando a frase no `ESCOLHER_SYSTEM` por outra
// qualquer, este teste falha; sem ele, a suíte inteira segue verde.
// ===========================================================================

test("a dica saiu do parâmetro E entrou no ESCOLHER_SYSTEM", () => {
  const m = require("../mente");

  // PONTA 1: não desce mais no parâmetro.
  const t = m._recorteDaMente({ name: "give", inputSchema: { type: "object",
    properties: { to: { type: "string", enum: ["elga-taverneira"] } },
    annotations: undefined } });
  assert.ok(!t.inputSchema.properties.to.enum, "o enum de cena tinha de sair");
  assert.ok(!t.inputSchema.properties.to.description,
    "e o parâmetro tinha de ficar NU — a dica não se repete mais por param");

  // PONTA 2: está dita, uma vez, onde a Mente a lê.
  const sys = m.promptsPadrao().interpretar;
  assert.ok(/NOME dele como aparece na cena/.test(sys),
    "a dica SUMIU do ESCOLHER_SYSTEM: o corte no parâmetro virou perda de "
    + "informação, e nada mais no repositório avisa");
  assert.ok(/nunca um c[óo]digo/.test(sys),
    "a metade que impede o id inventado tinha de estar no system também");
});
