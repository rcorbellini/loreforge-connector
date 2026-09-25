// O CICLO DO COMPROMISSO, DO LADO DA MENTE (spec 073) — trava de regressão.
//
// POR QUE ESTE ARQUIVO EXISTE, e por que não bastou estender `contrato.test.js`.
//
// A 073 acrescentou TRÊS coisas ao que desce para o modelo, e todas são invisíveis a
// olho nu se vazarem:
//
//   · o PROGRESSO (`passos_cumpridos`) — sem ele o prompt de executar não tem como
//     separar o feito do faltante, e o personagem refaz o passo que já deu. Foi
//     medido: o `llama3.1:8b` não sabe em que passo está, refaz e desfaz
//     (`medicoes.md` §5);
//   · a PARADA em RÓTULO — o relógio de estagnação é NÚMERO no `.md` e tem de chegar
//     como texto. Um `parada_desde` cru na tela é o Princípio V furado, e nenhum
//     teste de forma pegaria: é um inteiro num objeto que já tem inteiros;
//   · o PLANEJAR como chamada SEPARADA da de firmar. Juntas mediram 0/9 (item 38):
//     o modelo escreve o compromisso OU o plano, nunca os dois na mesma resposta.
//
// O `contrato.test.js` guarda a FORMA do contexto (que chaves existem). Este guarda o
// CICLO (o que a Mente faz com elas). São coisas diferentes, e misturá-las faria o
// arquivo do contrato crescer para todo lado.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "intencao-"));
process.env.LOREFORGE_CONFIG = path.join(TMP, "conector.json");
process.env.LOREFORGE_LOG = "0";

const configuracao = require("../config");
const Mente = require("../mente").criarMente();

// `planejar` lê a FACE da cena (os verbos que o mundo oferece) — sem mundo não há
// verbo, e ele devolve `null` sem chamar modelo nenhum. Um mundo falso basta.
Mente.usarMundo({
  listarCapacidades: async () => [
    { name: "take", description: "Pega algo.", inputSchema: { type: "object" } },
    { name: "eat", description: "Come algo.", inputSchema: { type: "object" } },
  ],
  chamarCapacidade: async () => ({ texto: "", narrativa: {}, recusado: false }),
  contexto: async () => copia(),
});

// O compromisso COM plano e COM progresso — a forma que a spec 073 cravou.
const COMPROMISSO = [{
  id: "int-1", status: "ativa",
  content: "Matar minha fome.\n- pegar o pão de centeio\n- comer o pão de centeio",
  pronto_quando: "hunger", passos_cumpridos: 1,
  parada: "há algumas voltas sem andar",
}];

const CONTEXTO = {
  self: {
    id: "fulano", name: "Fulano", prose: "Um sujeito qualquer.",
    status: { location: "praca", action: "espera", mood: "calmo", conditions: [] },
    body: {}, inventory: [], memories: [], intentions: COMPROMISSO,
    carencias: [{ o_que: "matar minha fome", porque: "está faminto",
                  pronto_quando: "hunger" }],
  },
  scene: { location: { id: "praca", name: "Praça", prose: "Uma praça." },
           characters: [], objects: [], items: [], routes: [] },
  capacidades: [],
};

// Captura o que SAIU para o modelo, sem deixar nada sair da máquina.
function espia(resposta) {
  const original = globalThis.fetch;
  const chamadas = [];
  globalThis.fetch = async (url, opts) => {
    chamadas.push({ url: String(url), corpo: JSON.parse((opts && opts.body) || "{}") });
    return {
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({
        message: { content: resposta, tool_calls: [] },
        prompt_eval_count: 10, eval_count: 5,
      }),
    };
  };
  return { chamadas, restaurar: () => { globalThis.fetch = original; } };
}

function copia(extra) {
  const c = JSON.parse(JSON.stringify(CONTEXTO));
  if (extra) Object.assign(c.self, extra);
  return c;
}

// --------------------------------------------------------------------------- //
// 1. O PROGRESSO DESCE — e é o que separa o feito do faltante
// --------------------------------------------------------------------------- //

test("o payload leva `passos_cumpridos` junto do compromisso", async () => {
  configuracao.carregar(true);
  const e = espia("{}");
  try {
    await Mente.deriveWhisper(copia());
  } finally {
    e.restaurar();
  }
  assert.strictEqual(e.chamadas.length, 1);
  const texto = JSON.stringify(e.chamadas[0].corpo);
  assert.match(texto, /passos_cumpridos/,
    "o progresso não desceu: sem ele o modelo refaz o passo que já deu (§5)");
});

test("a parada desce em RÓTULO — nunca o instante cru (Princípio V)", async () => {
  configuracao.carregar(true);
  const e = espia("{}");
  try {
    // `parada_desde` é o campo do `.md`. Se ele aparecer no que sai para o modelo, o
    // número do relógio vazou — e o vazamento é permanente: vira texto na tela.
    await Mente.deriveWhisper(copia({
      intentions: [{ ...COMPROMISSO[0], parada_desde: 1757000000 }],
    }));
  } finally {
    e.restaurar();
  }
  const texto = JSON.stringify(e.chamadas[0].corpo);
  assert.ok(!texto.includes("parada_desde"),
    "`parada_desde` vazou para o modelo — é medida interna, não texto de cena");
  assert.ok(!texto.includes("1757000000"),
    "o instante cru vazou para o modelo");
  assert.match(texto, /sem andar/, "o rótulo da parada não desceu");
});

// --------------------------------------------------------------------------- //
// 2. A CARÊNCIA DO CORPO — a fome que vira compromisso (US1)
// --------------------------------------------------------------------------- //

test("a carência desce COM o critério que a encerraria", async () => {
  configuracao.carregar(true);
  const e = espia("{}");
  try {
    await Mente.deriveWhisper(copia());
  } finally {
    e.restaurar();
  }
  const texto = JSON.stringify(e.chamadas[0].corpo);
  assert.match(texto, /carencias/, "a carência não desceu");
  assert.match(texto, /matar minha fome/,
    "a carência desceu sem dizer O QUE resolveria — é o que `set_intention` pede");
  assert.match(texto, /pronto_quando/,
    "a carência desceu sem o critério de fim: a intenção nasceria sem como fechar");
});

// --------------------------------------------------------------------------- //
// 3. PLANEJAR É CHAMADA SEPARADA — juntas mediram 0/9 (item 38)
// --------------------------------------------------------------------------- //

test("planejar() faz UMA chamada e devolve o compromisso com os passos", async () => {
  configuracao.carregar(true);
  const e = espia("- pegar o pão de centeio\n- comer o pão de centeio");
  let plano;
  try {
    plano = await Mente.planejar("Matar minha fome.", copia());
  } finally {
    e.restaurar();
  }
  assert.strictEqual(e.chamadas.length, 1,
    "planejar tem de ser UMA chamada — firmar e planejar juntos mediram 0/9");
  assert.match(plano, /^Matar minha fome\./,
    "o compromisso tem de continuar sendo a 1a linha: é dele que o corpo é lido");
  const passos = plano.split("\n").filter((l) => l.startsWith("- "));
  assert.strictEqual(passos.length, 2, "os dois passos não viraram checklist");
});

test("planejar() com resposta vazia devolve `null` — e o compromisso sobrevive", async () => {
  configuracao.carregar(true);
  const e = espia("Claro! Aqui está o que penso a respeito.");
  let plano;
  try {
    // Medido: pensando, o `qwen3` devolve vazio em 6 de 8 (§3). O `think:false` é a
    // defesa; esta é a rede embaixo dela.
    //
    // `null` é a resposta CERTA, e o contrato importa: quem chama (`laco.js`, no
    // despacho do `set_intention`) só substitui o `content` quando vem plano. Sem
    // plano, o compromisso segue como A Mente o escreveu — e ainda fecha pelo
    // `pronto_quando`. Se `planejar` devolvesse texto de enfeite, ele viraria o
    // corpo da intenção, e o "Claro! Aqui está" seria o compromisso do personagem.
    plano = await Mente.planejar("Matar minha fome.", copia());
  } finally {
    e.restaurar();
  }
  assert.strictEqual(plano, null,
    "prosa sem passo nenhum virou plano — o enfeite do modelo vira o corpo da intenção");
});

// --------------------------------------------------------------------------- //
// 4. A ROTINA ESCOLHE MODELO E OPÇÕES — `think` viaja no CORPO (item 79)
// --------------------------------------------------------------------------- //

test("a rotina `planejar` manda `think:false` no corpo da requisição", async () => {
  const cfg = configuracao.carregar(true);
  assert.ok(cfg.porRotina && cfg.porRotina.planejar,
    "sem entrada em `porRotina`, a rotina não escolhe nada");
  const e = espia("- um passo");
  try {
    await Mente.planejar("Matar minha fome.", copia());
  } finally {
    e.restaurar();
  }
  const corpo = e.chamadas[0].corpo;
  assert.strictEqual(corpo.think, false,
    "`think` não desceu no CORPO — `/no_think` no prompt NÃO funciona nesta versão "
    + "do Ollama, e pensando o plano sai vazio em 6 de 8 (§3)");
  assert.strictEqual(corpo.model, cfg.porRotina.planejar.model,
    "a rotina não trocou o modelo");
});

test("as outras rotinas NÃO herdam o `think` de planejar", async () => {
  const cfg = configuracao.carregar(true);
  // Sem `think` geral, isola o que se quer provar: a sobreposição de `planejar` não
  // vaza. (O default geral existe — ver o teste seguinte.)
  const geral = cfg.think;
  delete cfg.think;
  const e = espia("{}");
  try {
    await Mente.deriveWhisper(copia());
  } finally {
    e.restaurar();
    cfg.think = geral;
  }
  assert.ok(!("think" in e.chamadas[0].corpo),
    "o `think` vazou para uma rotina que não o pediu — a sobreposição tem de ser "
    + "por rotina, não global");
});

test("o `think` GERAL desce para a rotina que não declara o dela", async () => {
  // O default da Mente é `qwen3:8b` (2026-09-25): se o `think:false` geral não
  // descer, a autonomia roda PENSANDO — 86 s e resposta vazia, com a suíte verde.
  const cfg = configuracao.carregar(true);
  assert.strictEqual(cfg.think, false, "o default geral perdeu o `think:false`");
  const e = espia("{}");
  try {
    await Mente.deriveWhisper(copia());
  } finally {
    e.restaurar();
  }
  assert.strictEqual(e.chamadas[0].corpo.think, false,
    "o `think` geral não chegou ao CORPO da autonomia");
  assert.strictEqual(e.chamadas[0].corpo.model, "qwen3:8b",
    "a Mente não está no `qwen3:8b` — o `llama3.1` é desrecomendado para ela");
});

// --------------------------------------------------------------------------- //
// 5. O PLANO NÃO ANDA EM CÍRCULO POR DENTRO (§13.1 e §13.2)
// --------------------------------------------------------------------------- //
//
// As duas travas abaixo prendem a saída LITERAL que o `qwen3:8b` devolveu na
// primeira chamada real de `planejar`, dirigindo o Draven na Praça do Mercado. Não
// é entrada inventada: é o que o modelo fez, e o que a suíte não sabia proibir.

test("passos idênticos são riscados do plano — o círculo por dentro", async () => {
  configuracao.carregar(true);
  // O que o `qwen3` devolveu ao vivo: o mesmo par, quatro vezes, enchendo os oito
  // lugares. Um plano assim nasce com a doença que a spec veio curar — o passo 3 é
  // o passo 1 de novo, então riscar o 1 não faz o personagem avançar: ele volta.
  const e = espia([
    "- take Macieira da Praça", "- eat Macieira da Praça",
    "- take Macieira da Praça", "- eat Macieira da Praça",
    "- take Macieira da Praça", "- eat Macieira da Praça",
    "- take Macieira da Praça", "- eat Macieira da Praça",
  ].join("\n"));
  let plano;
  try {
    plano = await Mente.planejar("Matar minha fome.", copia());
  } finally {
    e.restaurar();
  }
  const passos = plano.split("\n").filter((l) => l.startsWith("- "));
  assert.strictEqual(passos.length, 2, "o plano manteve o passo repetido");
});

test("repetir o VERBO com outro alvo sobrevive — a dedup não é cega", async () => {
  configuracao.carregar(true);
  const e = espia("- take o pão\n- take o queijo\n- eat o pão");
  let plano;
  try {
    plano = await Mente.planejar("Matar minha fome.", copia());
  } finally {
    e.restaurar();
  }
  const passos = plano.split("\n").filter((l) => l.startsWith("- "));
  assert.strictEqual(passos.length, 3,
    "dois `take` de coisas DIFERENTES é plano legítimo, não repetição");
});

test("`set_intention` não é oferecido ao planejar, nem sobrevive como passo", async () => {
  configuracao.carregar(true);
  // Ao vivo, o `qwen3` fechou o plano com `set_intention \"Fome saciada\"` — a Mente
  // planejando anunciar que cumpriu, que é o Princípio IX pelo avesso e o mesmo
  // motivo que aposenta o `give.intention_id`.
  const e = espia("- take o pão\n- eat o pão\n- set_intention \"Fome saciada\"");
  let plano;
  try {
    plano = await Mente.planejar("Matar minha fome.", copia());
  } finally {
    e.restaurar();
  }
  const enviado = e.chamadas[0].corpo.messages[1].content;
  const lista = enviado.split("EXATAMENTE estes:")[1] || "";
  assert.ok(!lista.includes("set_intention"),
    "o verbo de DECLARAR foi oferecido como passo do caminho");
  assert.ok(!plano.includes("set_intention"),
    "a Mente planejou declarar o próprio desfecho e o passo sobreviveu");
});
