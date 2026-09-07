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
const Mente = require("../mente");

// A RAIZ do contrato (spec 067): "Nada mais fica na raiz." Se o server um dia
// acrescentar um terceiro nó, é esta lista que se atualiza — e o teste estático abaixo
// passa a cobrar o conector por ele.
const RAIZ_DO_CONTRATO = ["scene", "self"];

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
// Este teste nasceu achando cinco leituras de raiz inexistente. Duas (`intentions`)
// eram defeito claro e foram consertadas na hora. As outras três continuam aqui, de
// propósito, porque consertá-las é decisão de desenho e não de digitação — e uma lista
// explícita as mantém VISÍVEIS em vez de deixá-las passar num filtro genérico.
//
// A asserção é de IGUALDADE: uma deriva nova quebra o teste, e consertar uma destas
// também — obrigando a atualizar a lista em vez de deixá-la envelhecer.
const MORTAS_CONHECIDAS = {
  "mente.js: capacidades": (
    "O `AUTONOMY_SYSTEM` monta o bloco `capacidades` em prosa a partir daqui, e o "
    + "comentário em mente.js:684 diz que ali ele é a ÚNICA fonte do que o personagem "
    + "pode fazer (não há `tools` nativas nesse caminho). Mas NADA jamais atribui "
    + "`context.capacidades`: `mundo.contexto()` devolve o `/api/context` cru, e o "
    + "server nunca teve essa chave. Ou seja, o prompt de autonomia lista ZERO "
    + "capacidades. Consertar é ligar `mundo.listarCapacidades()` aqui — o que MUDA o "
    + "que o modelo vê, e por isso pede medição antes (regra da spec 058)."),
  "laco.js: capacidades": (
    "Mesma raiz: `_porQueNada` só dá o recado específico quando a cena tem de 1 a 3 "
    + "capacidades, e como a lista é sempre vazia esse ramo nunca dispara — o jogador "
    + "recebe sempre a mensagem genérica. Sai junto com a de cima."),
  "mente.js: character_id": (
    "Fallback defensivo em `interpret`: `(context.self && context.self.id) || "
    + "context.character_id`. O lado esquerdo é o contrato e sempre vence; o direito é "
    + "resto de um formato anterior. Inofensivo, mas é código morto."),
};

test("nenhum consumidor lê chave fora da raiz do contrato", () => {
  const achadas = new Set();
  for (const arquivo of FONTES) {
    const linhas = fs.readFileSync(arquivo, "utf8").split("\n");
    linhas.forEach((linha, i) => {
      if (/^\s*(\/\/|\*)/.test(linha)) return;   // comentário não é código
      for (const m of linha.matchAll(/\b(?:context|contexto)\.([a-z_][a-z0-9_]*)/gi)) {
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
