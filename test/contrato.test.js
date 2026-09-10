// O CONTRATO DO CONTEXTO, DO LADO DE QUEM CONSOME (spec 067) — trava de regressão.
//
// POR QUE ESTE ARQUIVO EXISTE. Em 2026-09-06 o Draven passou 6h30 sem agir: 321 ticks
// autônomos seguidos morreram em ~230 ms, com ZERO chamadas ao modelo, no mesmo erro —
// `_self is not defined`. A causa foi o retrofit da spec 067: `_self` virou uma const
// LOCAL de `_contextoPayload`, mas `deriveWhisper` e `narrate` passaram a usá-la fora
// do escopo dela. Erro de uma linha, seis horas de personagem parado, e NENHUM teste
// gritou.
//
// A lacuna estava documentada em `autonomia.test.js`, no fim do arquivo: o ramo de
// `deriveWhisper` COM compromisso ativo não era testado "porque dispararia o modelo, e
// um fetch em voo trava o processo de teste". A premissa tinha dois furos:
//
//   1. O erro acontece ANTES da chamada ao modelo — na montagem do payload. Nem era
//      preciso deixar o fetch acontecer.
//   2. A costura para não chamar modelo nenhum JÁ EXISTIA neste diretório: o
//      `espiaFetch` do `mente.test.js` intercepta `globalThis.fetch` desde a spec 045.
//
// Então o que este arquivo faz é o que faltava: exercita TODA função que lê o contexto,
// nos DOIS lados de cada bifurcação, com o fetch interceptado. Um `ReferenceError` na
// montagem do payload estoura aqui, em milissegundos, sem modelo nenhum no caminho.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "contrato-"));
process.env.LOREFORGE_CONFIG = path.join(TMP, "conector.json");
process.env.LOREFORGE_LOG = "0";

const configuracao = require("../config");
// spec 072: a Mente é uma POR ASSENTO. Só a construção mudou — as asserções abaixo
// são as mesmas de antes, e é isso que prova que o refactor foi léxico (research R5).
const Mente = require("../mente").criarMente();

// A RAIZ do que o CONECTOR recebe — e ela não é a mesma coisa que a raiz do
// `get_context`. Distinção que custou uma conclusão errada, então fica escrita:
//
//   `motor.get_context()`  ->  { self, scene }              (a spec 067: "nada mais
//                                                             fica na raiz")
//   `GET /api/context`     ->  { self, scene, capacidades }  (app.py:1143 acrescenta
//                                                             `face.build(ctx)`)
//
// O conector consome o ENDPOINT, não a função. Então `capacidades` é chave legítima
// aqui, e é por ela que a face da cena — nome, o que faz, alvos possíveis e parâmetros
// exigidos de cada capacidade — chega ao `AUTONOMY_SYSTEM`, que não tem `tools`
// nativas e depende desse bloco em prosa.
const RAIZ_DO_CONTRATO = ["capacidades", "scene", "self"];

// Fixture COPIADA da forma real de `get_context` (capturada do `draven-vigia` em
// 2026-09-07), não inventada à mão: é a forma real que faz o teste valer. Todo campo
// opcional está PRESENTE, porque o contrato é completo por decisão (spec 067) — quem
// filtra é o conector.
const CONTEXTO = {
  self: {
    id: "fulano", name: "Fulano", prose: "Um sujeito qualquer.",
    attributes: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
    skills: {},
    status: { hp: 100, hp_max: 100, action: "age", mood: "tenso", conditions: [] },
    needs: { hunger: "sem fome", thirst: "sedento", fatigue: "cansado", sleep: null },
    physics: {
      carry_capacity_kg: 98, push_capacity_kg: 196, carried_weight_kg: 0,
      free_hands: 2, total_hands: 2, grasp_slot: "mao",
      body: { mao: 2 }, slots_in_use: {},
    },
    is_busy: false, is_deep_asleep: false, is_resting: false,
    inventory: [{ id: "caneca", name: "Caneca", prose: null }],
    memories: [{
      id: "mem-1", intensity: "medium", involved: ["caneca"],
      summary: "Bebi da caneca.", content: "Bebi da caneca.",
      timestamp_start: 1788451530, timestamp_end: 1789661130,
      recency: "há dias", salience: "vivida",
    }],
    intentions: [],
    known_elsewhere: [], transit: null,
  },
  scene: {
    place: { id: "taverna", name: "Taverna", prose: "Cheira a lenha.", belongs_to: null },
    characters: [{ id: "outro", name: "Outro", prose: null, state: "presente",
                   action: "bebe", relation: null, sentiment: "neutro" }],
    items: [], objects: [], exits: [],
  },
};

// Um contexto é imutável do ponto de vista do conector: cada teste recebe uma cópia,
// para que um teste que mutasse o payload não contaminasse o seguinte.
const copia = (extra = {}) => {
  const c = JSON.parse(JSON.stringify(CONTEXTO));
  if (extra.intentions) c.self.intentions = extra.intentions;
  return c;
};

const COMPROMISSO = [{ id: "int-1", status: "ativa",
                       content: "Vigiar a pira até o amanhecer" }];

// Mesmo molde do `espiaFetch` do `mente.test.js`: nenhuma chamada sai da máquina.
function fetchFalso(texto = "narrado") {
  const original = globalThis.fetch;
  let chamadas = 0;
  globalThis.fetch = async () => {
    chamadas += 1;
    return {
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        message: { content: texto, tool_calls: [] },
        prompt_eval_count: 10, eval_count: 5,
      }),
    };
  };
  return { restaurar: () => { globalThis.fetch = original; },
           get chamadas() { return chamadas; } };
}

// --------------------------------------------------------------------------- //
// 1. O RAMO QUE NINGUÉM TESTAVA — e que parou o Draven por 6h30
// --------------------------------------------------------------------------- //

test("deriveWhisper COM compromisso ativo monta o payload sem estourar", async () => {
  configuracao.carregar(true);
  const espia = fetchFalso("{}");
  try {
    // Antes do conserto, isto lançava `ReferenceError: _self is not defined` ao montar
    // `itens_que_possuo`, ANTES de qualquer fetch — exatamente o que matou os 321 ticks.
    await Mente.deriveWhisper(copia({ intentions: COMPROMISSO }));
  } finally {
    espia.restaurar();
  }
});

test("deriveWhisper SEM compromisso continua determinístico e não chama modelo",
     async () => {
  configuracao.carregar(true);
  const espia = fetchFalso();
  try {
    const d = await Mente.deriveWhisper(copia({ intentions: [] }));
    assert.strictEqual(d.rotina, "refletir");
    assert.strictEqual(espia.chamadas, 0,
      "o ramo da reflexão passou a chamar o modelo — ele é para ser determinístico");
  } finally {
    espia.restaurar();
  }
});

test("narrate monta o payload sem estourar", async () => {
  configuracao.carregar(true);
  const espia = fetchFalso("o salão ficou em silêncio");
  try {
    // `narrate` lia `_self.needs` e `_self.memories` fora de escopo. Como ela só roda
    // quando o turno PRODUZ escolha, o defeito ficou invisível enquanto os turnos
    // morriam antes — o registro do mundo não tem narração bem-sucedida desde 03/09.
    await Mente.narrate("ele bebeu", copia(), [], [], [], [], [], [], null);
  } finally {
    espia.restaurar();
  }
});

test("o AUTONOMY_SYSTEM só cobra chaves que o payload realmente manda", async () => {
  // O prompt de autonomia manda a Mente ler campos POR NOME ("consulte as `capacidades`",
  // "Leia a `necessidade`"), e o código diz, num comentário, que o payload "é
  // incrementado para expor as chaves exatas que o prompt cobra". Só que ninguém
  // conferia, e em 2026-09-07 duas não casavam:
  //
  //   - `livro_de_regras` — o prompt mandava consultar o livro; a lista chega como
  //     `capacidades`. Resíduo do portal da spec 036, aposentado pela 043.
  //   - "seu status de sobrevivência" — anunciado na abertura, mas `status_sobrevivencia`
  //     foi REMOVIDO do payload (era constante zero e o modelo lia o zero como urgência).
  //
  // Pedir por um nome que não chega é pior que não pedir: o modelo procura, não acha, e
  // preenche o buraco com o que inventar.
  configuracao.carregar(true);
  const espia = fetchFalso("{}");
  let corpo = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    if (!corpo) corpo = JSON.parse((o && o.body) || "{}");
    return originalFetch(u, o);
  };
  try {
    // com compromisso ativo, para cair no ramo que monta o payload de autonomia
    await Mente.deriveWhisper(copia({ intentions: COMPROMISSO }));
  } finally {
    globalThis.fetch = originalFetch;
    espia.restaurar();
  }
  assert.ok(corpo, "não capturei o pedido de autonomia");
  const sys = (corpo.messages.find((m) => m.role === "system") || {}).content || "";
  const usr = (corpo.messages.find((m) => m.role === "user") || {}).content || "";
  const payload = JSON.parse(usr.slice(usr.indexOf("{")));

  // toda `chave` em crase no system tem de existir no payload (aceita um nível: `a.b`)
  const citadas = [...new Set((sys.match(/`([a-z_.]+)`/g) || [])
    .map((s) => s.replace(/`/g, "")))];
  const semDono = citadas.filter((k) => {
    const [a, b] = k.split(".");
    if (!(a in payload)) return true;
    return b ? !(b in (payload[a] || {})) : false;
  });
  assert.deepStrictEqual(semDono, [],
    "o prompt de autonomia cobra chave que o payload não manda: " + semDono.join(", "));
  assert.doesNotMatch(sys, /status de sobreviv/i,
    "o prompt voltou a anunciar `status_sobrevivencia`, que não existe no payload");
  assert.doesNotMatch(sys, /livro_de_regras/,
    "o prompt voltou a chamar as `capacidades` de `livro_de_regras`");
});

test("a necessidade chega à Mente com rótulo em PORTUGUÊS", async () => {
  // A 067 renomeou as chaves de `needs` para inglês — e fez certo, o contrato é API.
  // Mas o `_cenaEmProsa` interpolava a chave CRUA, e a Mente lia "Como ele está:
  // hunger: com fome, thirst: sem sede" — rótulo em inglês colado em valor português.
  // Traduzir é trabalho do CONECTOR, que é quem monta a prosa para o modelo.
  configuracao.carregar(true);
  const espia = fetchFalso("{}");
  const vistos = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    const corpo = JSON.parse((o && o.body) || "{}");
    (corpo.messages || []).forEach((m) => vistos.push(String(m.content || "")));
    return originalFetch(u, o);
  };
  try {
    await Mente.narrate("algo", copia(), [], [], [], [], [], [], null);
  } finally {
    globalThis.fetch = originalFetch;
    espia.restaurar();
  }
  const tudo = vistos.join("\n");
  assert.match(tudo, /fome/, "o rótulo de fome não chegou em português");
  assert.doesNotMatch(tudo, /\bhunger\b/,
    "a chave crua do contrato vazou para o prompt — traduza em `_necessidadeEmPortugues`");
  assert.doesNotMatch(tudo, /\bthirst\b|\bfatigue\b/,
    "outra chave crua de `needs` vazou para o prompt");
});

test("resposta de autonomia com FORMA inesperada não derruba o turno", async () => {
  // O prompt de autonomia pede `acoes_declaradas` como ARRAY. O modelo às vezes manda
  // string — e a linha de auditoria fazia `.join` sem checar, matando o turno inteiro
  // por causa de um log. Medido no Draven: 3 de 265 turnos (~1%).
  //
  // O que vem do modelo é DADO, não promessa de forma. Este teste cobre as três formas
  // que já apareceram, e a de array, que é a esperada.
  configuracao.carregar(true);
  for (const acoes of ['"uma string só"', '["a","b"]', "null", "42"]) {
    const original = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true, headers: { get: () => "application/json" },
      json: async () => ({
        message: { content: `{"agir":true,"racional":"porque sim",`
          + `"acoes_declaradas":${acoes},"sussurro":"ele age"}`, tool_calls: [] },
        prompt_eval_count: 10, eval_count: 5,
      }),
    });
    try {
      const d = await Mente.deriveWhisper(copia({ intentions: COMPROMISSO }));
      assert.ok(d, `acoes_declaradas=${acoes} não devolveu decisão`);
    } finally {
      globalThis.fetch = original;
    }
  }
});

// --------------------------------------------------------------------------- //
// spec 070 — o TRABALHO PARADO na prosa
// --------------------------------------------------------------------------- //

const COM_PECA = (started_by) => {
  const c = copia();
  c.scene.items = [{
    id: "peca-1", name: "Remendão (em processo)", prose: null,
    work_in_progress: "craft", started_by,
    urgency: "a cola ainda está fresca; secando, a junta não pega mais",
    relation: null, sentiment: "neutro",
  }];
  c.scene.characters = [{ id: "elga", name: "Elga, a Taverneira", prose: null,
                          state: "presente", action: "serve", relation: null,
                          sentiment: "neutro" }];
  return c;
};

// A CENA EM PROSA sai pelo `interpret` (o caminho do sussurro), não pelo `deriveWhisper`
// — a autonomia continua em JSON de propósito (ver o comentário de `_cenaEmProsa`).
// Errar isso foi o primeiro defeito deste teste, e o comentário fica para o próximo.
async function prosaDe(contexto) {
  Mente.usarMundo({
    listarCapacidades: async () => [
      { name: "craft", description: "Cria ou continua algo.",
        inputSchema: { type: "object", properties: {} } },
    ],
    chamarCapacidade: async () => ({ recusado: false, texto: "", narrativa: {} }),
  });
  Mente.usarExtensoes({ toolsLocais: () => [], ehLocal: () => false,
                        hook: async (_p, d) => d });
  const vistos = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_u, o) => {
    const corpo = JSON.parse((o && o.body) || "{}");
    (corpo.messages || []).forEach((m) => vistos.push(String(m.content || "")));
    return { ok: true, headers: { get: () => "application/json" },
             json: async () => ({ message: { content: "", tool_calls: [] },
                                  prompt_eval_count: 1, eval_count: 1 }) };
  };
  try {
    await Mente.interpret("olhe em volta", contexto, () => {}, {});
  } finally { globalThis.fetch = original; }
  return vistos.join("\n");
}

test("070: o trabalho DELE ganha linha própria, com o verbo de retomada", async () => {
  // MEDIDO em 2026-09-08: como um nome numa lista, a peça é ignorada — `craft` saía
  // 6/10 sob ordem direta, e em 3 das 10 a Mente tentava VIAJAR, porque nada dizia que
  // a peça estava ali e era dela. Com esta linha: 10/10, ao custo de 38 tokens.
  configuracao.carregar(true);
  const prosa = await prosaDe(COM_PECA("fulano"));   // `fulano` é o id do próprio
  assert.match(prosa, /Trabalho seu, parado: Remendão/,
    "a peça do próprio personagem não ganhou linha própria");
  assert.match(prosa, /craft/, "a prosa não diz com que verbo se retoma");
  assert.match(prosa, /cola ainda está fresca/, "a urgência não chegou à Mente");
});

test("070: o trabalho de OUTRO é cena, não chamado à ação", async () => {
  configuracao.carregar(true);
  const prosa = await prosaDe(COM_PECA("elga"));
  assert.doesNotMatch(prosa, /Trabalho seu/,
    "a peça de outra pessoa foi anunciada como sendo dele");
  assert.match(prosa, /trabalho de Elga, a Taverneira, no meio/,
    "a autoria alheia não virou aposto na lista");
});

test("070: sem `started_by`, a peça é só 'em processo' — e nenhum id vaza", async () => {
  // O contrato devolve `started_by: null` para quem não viu começar (o gate de R5).
  // Nesse caso a prosa não pode inventar autoria nem, pior, cuspir o id cru: a spec 060
  // mediu que id de cena no prompt atrapalha, e tirou todos.
  configuracao.carregar(true);
  const prosa = await prosaDe(COM_PECA(null));
  assert.match(prosa, /Remendão \(em processo\)/);
  assert.doesNotMatch(prosa, /Trabalho seu/);
  assert.doesNotMatch(prosa, /peca-1/, "um id de cena vazou para o prompt");
});

test("os consumidores aguentam um contexto MÍNIMO sem quebrar", async () => {
  // O contrato é lido, não controlado: um jogador pode apontar o conector para outro
  // server. Faltar um nó não pode virar exceção — é o que o acesso defensivo promete.
  configuracao.carregar(true);
  const espia = fetchFalso("{}");
  try {
    await Mente.deriveWhisper({});
    await Mente.narrate("algo", {}, [], [], [], [], [], [], null);
  } finally {
    espia.restaurar();
  }
});

// --------------------------------------------------------------------------- //
// 2. A DERIVA DE CHAVE — o defeito irmão, que quebrou o HUD no mesmo retrofit
// --------------------------------------------------------------------------- //
//
// No client, `renderMemories(context.memories)` sobreviveu à 067 lendo uma chave que
// deixou de existir na raiz (ela virou `self.memories`). Não estourou: devolveu
// `undefined`, e a tela mostrou "zero memórias" para um personagem com 38. Falha
// silenciosa é pior que exceção — por isso ela é procurada ESTATICAMENTE aqui.

const FONTES = ["mente.js", "laco.js", "mundo.js"]
  .map((f) => path.join(__dirname, "..", f))
  .filter((p) => fs.existsSync(p));

// CHAVES MORTAS CONHECIDAS — dívida nomeada, não exceção silenciosa.
//
// A asserção é de IGUALDADE: uma deriva nova quebra o teste, e consertar uma destas
// também — obrigando a atualizar a lista em vez de deixá-la envelhecer.
//
// CORREÇÃO (2026-09-07, no mesmo dia): a primeira versão desta lista acusava também
// `capacidades` (mente.js:688, laco.js:538), com a conclusão de que "o prompt de
// autonomia lista ZERO capacidades". ERRADO, e o erro foi meu: eu procurei quem
// atribuía a chave nos arquivos do CONECTOR, não achei, e concluí que ninguém
// atribuía. Quem atribui é o server, na camada HTTP (`app.py:1143`), depois do
// `get_context`. Conferido no payload real: as capacidades descem completas, com
// descrição, `alvos_possiveis` e `exige`. Fica registrado porque a lição é do tipo que
// se repete — ausência de escrita em UM repositório não é ausência no sistema.
const MORTAS_CONHECIDAS = {
  "mente.js: character_id": (
    "Fallback defensivo em `interpret`: `(context.self && context.self.id) || "
    + "context.character_id`. O lado esquerdo é o contrato e sempre vence; o direito é "
    + "resto de um formato anterior. Inofensivo, mas é código morto."),
};

// OS CAMPOS DE SEGUNDO NÍVEL. Copiados da saída real de `get_context`
// (`draven-vigia`, 2026-09-07) — a mesma lista que o teste da tela usa.
//
// ESTA LISTA NASCEU DE UMA FALHA DESTE ARQUIVO. A primeira versão checava só a RAIZ, e
// a raiz estava limpa — mas a guarda de sono profundo em `laco.js` lia
// `contexto.self.sono_profundo`, o nome PRÉ-067 do campo que virou `is_deep_asleep`.
// Um nível abaixo do que eu olhava, e o mesmo mecanismo: `undefined` é falso, a guarda
// deixou de existir sem avisar, e o personagem passou a pagar uma chamada de modelo por
// tick para tentar acordar de um sono do qual o Motor não deixa acordar.
const CAMPOS = {
  self: ["attributes", "id", "intentions", "inventory", "is_busy", "is_deep_asleep",
         "is_resting", "known_elsewhere", "memories", "name", "needs", "physics",
         "prose", "skills", "status", "transit"],
  scene: ["characters", "exits", "items", "objects", "place"],
};

test("o que os consumidores leem de `self`/`scene` existe mesmo no contrato", () => {
  const violacoes = [];
  for (const arquivo of FONTES) {
    fs.readFileSync(arquivo, "utf8").split("\n").forEach((linha, i) => {
      if (/^\s*(\/\/|\*)/.test(linha)) return;
      // pega tanto `contexto.self.x` quanto o `_self.x` local de cada função
      const padroes = [/\.(self|scene)\.([a-z_][a-z0-9_]*)/gi,
                       /[^\w.](_self|_scene)\.([a-z_][a-z0-9_]*)/g];
      for (const p of padroes) {
        for (const m of linha.matchAll(p)) {
          const no = m[1].replace(/^_/, "");
          if (!CAMPOS[no].includes(m[2])) {
            violacoes.push(`${path.basename(arquivo)}:${i + 1} lê ${no}.${m[2]}`);
          }
        }
      }
    });
  }
  assert.deepStrictEqual(violacoes, [],
    "campo que `get_context` não devolve. É a falha SILENCIOSA: em JavaScript isso é\n"
    + "`undefined`, então uma guarda vira sempre-falso e um payload vira sempre-vazio,\n"
    + "sem uma linha de erro em lugar nenhum:\n  " + violacoes.join("\n  "));
});

test("nenhum consumidor lê chave fora da raiz do contrato", () => {
  const achadas = new Set();
  for (const arquivo of FONTES) {
    const linhas = fs.readFileSync(arquivo, "utf8").split("\n");
    linhas.forEach((linha, i) => {
      if (/^\s*(\/\/|\*)/.test(linha)) return;   // comentário não é código
      // TEXTO DE PROMPT NÃO É ACESSO. Os system prompts nomeiam chaves do payload
      // entre crases escapadas (\\`contexto.presentes\\`) — isso é o prompt DIZENDO à
      // Mente onde olhar, não o conector lendo. Sem esta linha, alinhar o prompt com o
      // payload fazia este teste acusar a própria correção.
      const codigo = linha.replace(/\\`[^`]*\\`/g, "");
      for (const m of codigo.matchAll(/\b(?:context|contexto)\.([a-z_][a-z0-9_]*)/gi)) {
        if (!RAIZ_DO_CONTRATO.includes(m[1])) {
          achadas.add(`${path.basename(arquivo)}: ${m[1]}`);
        }
      }
    });
  }
  assert.deepStrictEqual(
    [...achadas].sort(), Object.keys(MORTAS_CONHECIDAS).sort(),
    "a raiz do contexto tem só `self` e `scene` (spec 067). Uma chave NOVA nesta lista "
    + "é uma leitura que devolve `undefined` em silêncio — o defeito que apagou as "
    + "memórias do HUD. Uma que SUMIU foi consertada: tire-a de MORTAS_CONHECIDAS.");
});

// --------------------------------------------------------------------------- //
// 3. A CONVENÇÃO DO `_local` — o guarda estático do erro exato
// --------------------------------------------------------------------------- //

test("todo `_self`/`_scene`/`_place` é declarado na função que o usa", () => {
  const VARS = ["_self", "_scene", "_place"];
  const violacoes = [];
  for (const arquivo of FONTES) {
    const linhas = fs.readFileSync(arquivo, "utf8").split("\n");
    let fn = "(topo do módulo)";
    let declarado = new Set();
    linhas.forEach((linha, i) => {
      const nova = linha.match(/^\s{0,4}(?:async\s+)?function\s+(\w+)/);
      if (nova) { fn = nova[1]; declarado = new Set(); }
      const decl = linha.match(/\b(?:const|let|var)\s+(_\w+)\s*=/);
      if (decl) declarado.add(decl[1]);
      if (/^\s*(\/\/|\*)/.test(linha)) return;
      for (const v of VARS) {
        if (new RegExp(`[^\\w.]${v}\\.`).test(linha) && !declarado.has(v)) {
          violacoes.push(`${path.basename(arquivo)}:${i + 1} — ${fn}() usa ${v} sem declarar`);
        }
      }
    });
  }
  assert.deepStrictEqual(violacoes, [],
    "`_self` e irmãos são locais POR FUNÇÃO — não existem no escopo do módulo:\n"
    + violacoes.join("\n"));
});
