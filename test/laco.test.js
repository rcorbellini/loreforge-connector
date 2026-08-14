// O LAÇO DO TURNO, de ponta a ponta, contra um mundo simulado.
//
// O que mais importa aqui não é o caminho feliz — é a RECUSA. Um turno em que o
// mundo diz não já chegou à Mente com NADA (nem beat, nem falha, nem hint), e ela
// inventou a cena inteira a partir da descrição do lugar: uma entrega recusada
// virou uma narração de chegada a um lugar onde ninguém chegou. Recusa nunca é
// silenciosa — nem na tela, nem na narração, nem no registro.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.LOREFORGE_CONFIG =
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "laco-")), "conector.json");
process.env.LOREFORGE_LOG = "0";

const { Laco, diffTextual, sanitizeMovement } = require("../laco");
const extensoes = require("../extensoes");

const CENA = { self: { id: "fulano", name: "Fulano" },
               characters_present: [], items_present: [], routes: [] };

function extVazio() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "ext-"));
  return extensoes.criar(raiz);
}

function mundoDe({ respostas, capacidades }) {
  const chamadas = [];
  const conhecidas = capacidades ? new Set(capacidades) : null;
  return {
    chamadas,
    turnoId: null,
    conhece: (nome) => (conhecidas ? conhecidas.has(nome) : null),
    contexto: async () => CENA,
    chamarCapacidade: async (nome, args) => {
      chamadas.push({ nome, args });
      const r = respostas.shift();
      if (!r) throw new Error("o teste não previu mais chamadas");
      return r;
    },
  };
}

// O `interpret` real devolve uma SESSÃO: as propostas MAIS o fio da conversa
// (`continuar`), para o desfecho de cada proposta voltar à Mente sem remontar o
// contexto. `depois` é o que ela propõe quando recebe esse desfecho; `recebeu`
// guarda os resultados que chegaram, que é o que estes testes precisam inspecionar.
function menteDe({ propostas, narracao = "prosa", depois = null }) {
  const sessao = (props, resto) => ({
    pensamento: "penso",
    propostas: props,
    continuar: async (resultados) => {
      menteDe.recebeu = (menteDe.recebeu || []).concat(resultados);
      return resto && resto.length ? sessao(resto, null) : null;
    },
  });
  return {
    interpret: async () => sessao(propostas, depois),
    narrate: async (hint, ctx, falhas, viradas, aconteceu) => {
      menteDe.ultimo = { hint, falhas, viradas, aconteceu };
      return narracao;
    },
    deriveWhisper: async () => null,
  };
}

function coletor() {
  const eventos = [];
  return { eventos, emitir: (ev, d) => eventos.push({ ev, ...d }) };
}

test("um turno feliz: proposta, beat e narração", async () => {
  const c = coletor();
  const laco = new Laco({
    mundo: mundoDe({ respostas: [
      { recusado: false, texto: "",
        narrativa: { aconteceu: ["Fulano pegou a corda."],
                     narrative_hint: "ele guarda a corda" } },
    ] }),
    mente: menteDe({ propostas: [{ capacidade: "take", alvos: { item: "corda" },
                                   prosa: { acao: "pega a corda" } }] }),
    extensoes: extVazio(), registro: null, emitir: c.emitir,
  });

  await laco.sussurrar("pegue a corda");

  const tipos = c.eventos.map((e) => e.ev);
  assert.ok(tipos.includes("beat"), "o fato não virou beat");
  assert.strictEqual(c.eventos.find((e) => e.ev === "beat").texto,
                     "Fulano pegou a corda.");
  assert.ok(tipos.includes("narracao_fim"), "não narrou");
  assert.deepStrictEqual([tipos[0], tipos[tipos.length - 1]],
                         ["estado", "estado"], "o estado não abriu e fechou");
});

test("A RECUSA NÃO É SILENCIOSA: vira evento e chega à narração", async () => {
  const c = coletor();
  const mente = menteDe({ propostas: [{ capacidade: "give",
                                        alvos: { to: "ninguem" },
                                        prosa: { acao: "entrega" } }] });
  const laco = new Laco({
    mundo: mundoDe({ respostas: [
      { recusado: true, texto: "não há ninguém com esse nome aqui",
        narrativa: {} },
    ] }),
    mente, extensoes: extVazio(), registro: null, emitir: c.emitir,
  });

  await laco.sussurrar("entregue a corda");

  const recusa = c.eventos.find((e) => e.ev === "recusa");
  assert.ok(recusa, "a recusa não virou evento");
  assert.match(recusa.texto, /ninguém/);
  // e a Mente PRECISA receber a recusa como matéria — senão ela inventa a cena
  assert.ok(menteDe.ultimo.falhas.length,
            "a narração foi chamada sem saber que houve recusa");
});

// ITEM 53.2 — O PLANO MORRE COM O PASSO QUE FALHOU.
// Este teste afirmava o CONTRÁRIO ("recusa no meio não interrompe as propostas
// seguintes"), e o mantenedor virou a decisão: uma sequência é encadeada, e os
// passos de trás pressupõem os da frente. Se o do meio não aconteceu, o de depois
// pede ao mundo algo cujo pré-requisito não existe. O turno CONTINUA — mas com um
// plano NOVO, pensado a partir do que barrou.
test("a recusa mata o resto da fila, e o desfecho volta à MENTE", async () => {
  const c = coletor();
  delete menteDe.recebeu;
  const mundo = mundoDe({ respostas: [
    { recusado: true, texto: "isso não está ao seu alcance", narrativa: {} },
    { recusado: false, texto: "",
      narrativa: { aconteceu: ["Fulano pegou a faca."] } },
  ] });
  const laco = new Laco({
    mundo,
    mente: menteDe({
      // o plano: pegar a lua (o mundo recusa) e então a faca
      propostas: [
        { id: "c0", capacidade: "take", alvos: { item: "lua" }, prosa: { acao: "tenta" } },
        { id: "c1", capacidade: "take", alvos: { item: "faca" }, prosa: { acao: "pega" } },
      ],
      // o que ela propõe DEPOIS de saber que a lua não deu
      depois: [
        { id: "c2", capacidade: "take", alvos: { item: "faca" }, prosa: { acao: "pega" } },
      ],
    }),
    extensoes: extVazio(), registro: null, emitir: c.emitir,
  });

  await laco.sussurrar("pegue as coisas");

  // a 2ª do plano ORIGINAL não foi ao mundo: ela pressupunha a 1ª
  assert.deepStrictEqual(mundo.chamadas.map((ch) => ch.args.item), ["lua", "faca"]);
  // e o motivo chegou à Mente como RESULTADO, em linguagem de mundo — é isto que a
  // faz seguir de onde parou em vez de recomeçar às cegas
  assert.ok(menteDe.recebeu && menteDe.recebeu.length, "o desfecho não voltou à Mente");
  assert.strictEqual(menteDe.recebeu[0].id, "c0");
  assert.match(menteDe.recebeu[0].conteudo, /alcance/);
  assert.ok(c.eventos.some((e) => e.ev === "recusa"));
  assert.ok(c.eventos.some((e) => e.ev === "beat"));
});

test("replanejar não reenvia ao mundo o passo que acabou de ser barrado", async () => {
  const c = coletor();
  const mundo = mundoDe({ respostas: [
    { recusado: true, texto: "isso não está ao seu alcance", narrativa: {} },
  ] });
  const laco = new Laco({
    mundo,
    // A Mente teimosa: replaneja e devolve EXATAMENTE o mesmo passo
    mente: menteDe({ propostas: [
      { capacidade: "take", alvos: { item: "lua" }, prosa: { acao: "tenta" } },
    ] }),
    extensoes: extVazio(), registro: null, emitir: c.emitir,
  });

  await laco.sussurrar("pegue a lua");

  assert.strictEqual(mundo.chamadas.length, 1,
                     "o passo barrado voltou ao mundo no replanejamento");
});

test("a trava do conector impede dois turnos ao mesmo tempo", async () => {
  const c = coletor();
  let solta;
  const laco = new Laco({
    mundo: { turnoId: null, contexto: () => new Promise((r) => { solta = r; }) },
    mente: menteDe({ propostas: [] }),
    extensoes: extVazio(), registro: null, emitir: c.emitir,
  });

  const primeiro = laco.sussurrar("um");
  const segundo = await laco.sussurrar("dois");
  assert.strictEqual(segundo, null, "o segundo turno não foi barrado");
  assert.ok(c.eventos.some((e) => e.ev === "sistema" &&
                                  /já está em andamento/.test(e.texto)));
  solta(CENA);
  await primeiro;
});

// DESDE QUANDO o turno corre. `ocupado` sozinho não distingue um turno de vinte
// segundos de um pendurado há vinte minutos — e é o pendurado que trava tudo em
// silêncio (a autonomia para, e a configuração adiada nunca entra em vigor). Sem
// este instante, a tela não tem como avisar; foi o que aconteceu de verdade.
test("o turno registra DESDE QUANDO corre, e limpa ao terminar", async () => {
  const c = coletor();
  let solta;
  const laco = new Laco({
    mundo: { turnoId: null, contexto: () => new Promise((r) => { solta = r; }) },
    mente: menteDe({ propostas: [] }),
    extensoes: extVazio(), registro: null, emitir: c.emitir,
  });

  assert.strictEqual(laco.ocupadoDesde, null, "nasceu ocupado");
  const antes = Date.now();
  const turno = laco.sussurrar("um");
  assert.ok(laco.ocupadoDesde >= antes && laco.ocupadoDesde <= Date.now(),
    `ocupadoDesde fora da janela: ${laco.ocupadoDesde}`);
  // e o instante VIAJA no evento, porque a tela precisa dele sem recarregar
  const abriu = c.eventos.find((e) => e.ev === "estado" && e.ocupado === true);
  assert.ok(abriu && abriu.ocupadoDesde === laco.ocupadoDesde,
    "o evento de estado não levou `ocupadoDesde`");

  solta(CENA);
  await turno;
  assert.strictEqual(laco.ocupadoDesde, null, "não limpou ao terminar o turno");
  const fechou = c.eventos.filter((e) => e.ev === "estado" && e.ocupado === false).pop();
  assert.ok(fechou && fechou.ocupadoDesde === null);
});

test("modelo fora do ar interrompe o turno e NÃO substitui por outro", async () => {
  const c = coletor();
  const laco = new Laco({
    mundo: { turnoId: null, contexto: async () => CENA },
    mente: { interpret: async () => { throw new Error("o Ollama não respondeu"); } },
    extensoes: extVazio(), registro: null, emitir: c.emitir,
  });

  await laco.sussurrar("faça algo");

  const erro = c.eventos.find((e) => e.ev === "erro");
  assert.ok(erro, "a falha do modelo não foi contada ao jogador");
  assert.match(erro.texto, /Ollama/);
  assert.ok(!c.eventos.some((e) => e.ev === "narracao_fim"),
            "narrou mesmo sem Mente — isso seria inventar a cena");
});

test("o diff conta quem chegou, quem saiu e o que apareceu no chão", () => {
  const eventos = diffTextual(
    { characters_present: [{ name: "Verro" }], items_present: [] },
    { characters_present: [{ name: "Odila" }], items_present: [{ name: "corda" }] });
  assert.deepStrictEqual(eventos, [
    "Odila chegou ao local.", "Verro saiu do local.",
    "Um(a) corda apareceu no chão.",
  ]);
});

test("movimento inventado pela Mente é descartado — prosa aponta, não cria", () => {
  const rotas = [{ id: "r-porto", name: "trilha do porto",
                   destination_name: "Porto Negro" }];
  const bom = { movement: { enter_route: "Porto Negro" } };
  sanitizeMovement(bom, rotas);
  assert.deepStrictEqual(bom.movement, { enter_route: "r-porto" });

  const inventado = { movement: { enter_route: "Cidade das Nuvens" } };
  sanitizeMovement(inventado, rotas);
  assert.strictEqual(inventado.movement, null);
});

// A PENEIRA DE CAPACIDADE INVENTADA — escrita a partir de um log real de jogo.
//
// O modelo local propôs 'comprar' sete vezes, 'pedir' sete vezes e 'ir' quatro,
// nenhuma delas existindo na cena. Cada uma virou uma ida ao mundo e uma recusa
// "não existe capacidade 'comprar'" na TELA DO JOGADOR — vocabulário de máquina
// onde só deveria haver mundo.
test("nome de capacidade inventado NÃO vai ao mundo nem à tela", async () => {
  const c = coletor();
  const mundo = mundoDe({
    capacidades: ["take", "give"],
    respostas: [{ recusado: false, texto: "",
                  narrativa: { aconteceu: ["Fulano pegou a corda."] } }],
  });
  const laco = new Laco({
    mundo,
    mente: menteDe({ propostas: [
      { capacidade: "comprar", alvos: {}, prosa: { acao: "tenta comprar" } },
      { capacidade: "ir", alvos: {}, prosa: { acao: "tenta ir" } },
      { capacidade: "take", alvos: { item: "corda" }, prosa: { acao: "pega" } },
    ] }),
    extensoes: extVazio(), registro: null, emitir: c.emitir,
  });

  await laco.sussurrar("faça algo");

  assert.deepStrictEqual(mundo.chamadas.map((x) => x.nome), ["take"],
    "uma capacidade inventada foi mandada ao mundo");
  const texto = JSON.stringify(c.eventos);
  assert.ok(!texto.includes("comprar") && !texto.includes("capacidade"),
    "vocabulário de máquina vazou para a tela do jogador");
});

// FACE VAZIA — o caso do personagem MORTO. A face passou a devolver `[]` para quem
// morreu (o servidor já recusava toda ação dele; agora também não oferece), e isso
// tornou a cena de face vazia REAL em vez de teórica. O que não pode acontecer é a
// Mente inventar um verbo no vácuo e o conector encaminhá-lo: `conhece()` sabe que
// a cena não tem nada, então desmente TUDO, e nenhuma proposta chega ao mundo.
test("face vazia (morto): nada chega ao mundo, nem que a Mente insista", async () => {
  const c = coletor();
  const mundo = mundoDe({ capacidades: [], respostas: [] });
  const laco = new Laco({
    mundo,
    mente: menteDe({ propostas: [
      { capacidade: "attack", alvos: { alvo: "sarga" }, prosa: { acao: "ergue o braço" } },
      { capacidade: "levantar", alvos: {}, prosa: { acao: "tenta se erguer" } },
    ] }),
    extensoes: extVazio(), registro: null, emitir: c.emitir,
  });

  await laco.sussurrar("levante e ataque");

  assert.deepStrictEqual(mundo.chamadas.map((x) => x.nome), [],
    "uma proposta foi ao mundo com a face vazia");
  const texto = JSON.stringify(c.eventos);
  assert.ok(!texto.includes("attack") && !texto.includes("levantar"),
    "vocabulário de máquina vazou para a tela do jogador");
});

test("proposta repetida é a mesma proposta — vai ao mundo UMA vez", async () => {
  const c = coletor();
  const mundo = mundoDe({
    capacidades: ["take"],
    respostas: [{ recusado: false, texto: "", narrativa: { aconteceu: ["pegou"] } }],
  });
  const laco = new Laco({
    mundo,
    mente: menteDe({ propostas: [
      { capacidade: "take", alvos: { item: "corda" }, prosa: { acao: "pega" } },
      { capacidade: "take", alvos: { item: "corda" }, prosa: { acao: "pega" } },
      { capacidade: "take", alvos: { item: "corda" }, prosa: { acao: "pega" } },
    ] }),
    extensoes: extVazio(), registro: null, emitir: c.emitir,
  });

  await laco.sussurrar("pegue");
  assert.strictEqual(mundo.chamadas.length, 1);
});

test("turno só de invenções NÃO narra — narrar sem fato é inventar mundo", async () => {
  const c = coletor();
  const mundo = mundoDe({ capacidades: ["take"], respostas: [] });
  const laco = new Laco({
    mundo,
    mente: menteDe({ propostas: [
      { capacidade: "olhar", alvos: {}, prosa: { acao: "olha" } },
    ] }),
    extensoes: extVazio(), registro: null, emitir: c.emitir,
  });

  await laco.sussurrar("olhe");

  assert.strictEqual(mundo.chamadas.length, 0);
  assert.ok(!c.eventos.some((e) => e.ev === "narracao_fim"),
    "narrou um turno sem fato nenhum — é assim que a Mente inventa cenário");
  const sis = c.eventos.find((e) => e.ev === "sistema");
  assert.ok(sis && /hesitou/.test(sis.texto), "o jogador ficou sem saber do vazio");
});

// O VAZIO PRECISA DIZER POR QUÊ — escrito a partir de um turno real.
//
// O Coppo tinha adormecido no laço autônomo. A cena passou a oferecer UMA coisa
// (acordar), a Mente insistiu em caminhar, e o jogador leu apenas que ela
// "hesitou" — sem nunca saber que o personagem estava dormindo. Mensagem honesta
// e inútil é quase tão ruim quanto silêncio.
test("cena estreita explica o vazio com as palavras do próprio mundo", async () => {
  const c = coletor();
  const cenaDormindo = {
    ...CENA,
    // a face de quem dorme é UMA capacidade, e desde o item 50 ela é `wake_up` com
    // a própria descrição — não mais `sleep` alternador dizendo "chame de novo".
    capacidades: [{ nome: "wake_up",
                    descricao: "O personagem está dormindo, e esta é a ação de "
                             + "despertar e se levantar. Uma noite completa devolve "
                             + "toda a fadiga; acordar cedo devolve só uma fração." }],
  };
  const mundo = {
    turnoId: null,
    conhece: (n) => n === "wake_up",
    contexto: async () => cenaDormindo,
    chamarCapacidade: async () => { throw new Error("não devia chamar"); },
  };
  const laco = new Laco({
    mundo,
    mente: menteDe({ propostas: [
      { capacidade: "caminhar", alvos: {}, prosa: { acao: "caminha" } },
    ] }),
    extensoes: extVazio(), registro: null, emitir: c.emitir,
  });

  await laco.sussurrar("faz algo");

  const sis = c.eventos.find((e) => e.ev === "sistema");
  assert.ok(sis, "o jogador ficou sem recado");
  assert.match(sis.texto, /dormindo/,
    "o vazio não disse por quê — o jogador não tem como saber o que houve");
  assert.ok(!/sleep|capacidade/.test(sis.texto),
    "vazou o nome da engrenagem em vez da prosa do mundo");
});

test("cena LARGA não vira cardápio de mecânica na tela", async () => {
  const c = coletor();
  const muitas = Array.from({ length: 12 }, (_, i) =>
    ({ nome: `cap${i}`, descricao: `faz a coisa ${i}` }));
  const mundo = {
    turnoId: null,
    conhece: () => false,
    contexto: async () => ({ ...CENA, capacidades: muitas }),
    chamarCapacidade: async () => { throw new Error("não devia chamar"); },
  };
  const laco = new Laco({
    mundo,
    mente: menteDe({ propostas: [{ capacidade: "voar", alvos: {}, prosa: { acao: "voa" } }] }),
    extensoes: extVazio(), registro: null, emitir: c.emitir,
  });

  await laco.sussurrar("voe");

  const sis = c.eventos.find((e) => e.ev === "sistema");
  assert.ok(!/faz a coisa/.test(sis.texto),
    "listou a cena inteira na tela — isso é cardápio de mecânica");
  assert.match(sis.texto, /hesitou/);
});

test("o que mudou AO REDOR viaja no desfecho que volta à Mente", async () => {
  const c = coletor();
  delete menteDe.recebeu;
  // a cena MUDA entre a proposta e o replanejamento: alguém chega
  const cena1 = { characters_present: [{ name: "Elga" }], items_present: [],
                  routes: [], capacidades: [] };
  const cena2 = { characters_present: [{ name: "Elga" }, { name: "Torvin" }],
                  items_present: [], routes: [], capacidades: [] };
  let vez = 0;
  const mundo = {
    chamadas: [], turnoId: null,
    conhece: () => null,
    contexto: async () => (vez++ === 0 ? cena1 : cena2),
    chamarCapacidade: async (nome, args) => {
      mundo.chamadas.push({ nome, args });
      return { recusado: true, texto: "isso não está ao seu alcance", narrativa: {} };
    },
  };
  const laco = new Laco({
    mundo,
    mente: menteDe({
      propostas: [{ id: "c0", capacidade: "take", alvos: { item: "lua" },
                    prosa: { acao: "tenta" } }],
      depois: [{ id: "c1", capacidade: "examine", alvos: { alvo: "Torvin" },
                 prosa: { acao: "olha" } }],
    }),
    extensoes: extVazio(), registro: null, emitir: c.emitir,
  });

  await laco.sussurrar("pegue a lua");

  const rec = menteDe.recebeu || [];
  assert.ok(rec.length, "o desfecho não voltou à Mente");
  // o motivo da recusa E a notícia do ambiente, na mesma volta
  assert.match(rec[0].conteudo, /alcance/);
  assert.match(rec[0].conteudo, /ao redor/i);
  assert.match(rec[0].conteudo, /Torvin/,
               "a Mente replanejaria sem saber que alguém chegou");
});

// O SUSSURRO MANUAL não podia estar quebrado, e estava: uma substituição larga pôs
// `decidido.racional` no caminho manual, variável que só existe no tick autônomo.
// Era `ReferenceError` em TODA ação digitada, e o try/catch a mascarava como "algo
// interrompeu a cena". Passou porque o jogo roda sozinho e ninguém digitou nada.
test("o sussurro MANUAL não estoura, e é registrado como manual", async () => {
  const c = coletor();
  const linhas = [];
  const registro = {
    abrir: () => ({
      id: "t1",
      pretendia(i) { linhas.push({ ev: "pretendia", i }); },
      sussurro(texto, origem, rac) { linhas.push({ ev: "sussurro", origem, rac }); },
      pensou() {}, propos() {}, narrou() {}, falha() {}, falhaDeExtensao() {},
      descartar() {}, fechar: async () => {},
    }),
  };
  const laco = new Laco({
    mundo: mundoDe({ respostas: [{ recusado: false, texto: "",
                                   narrativa: { aconteceu: ["fez."] } }] }),
    mente: menteDe({ propostas: [{ id: "c0", capacidade: "take",
                                   alvos: { item: "faca" }, prosa: { acao: "pega" } }] }),
    extensoes: extVazio(), registro, emitir: c.emitir,
  });

  await laco.sussurrar("pegue a faca", "manual");

  const erro = c.eventos.find((e) => e.ev === "erro");
  assert.ok(!erro, `o turno manual estourou: ${erro && erro.texto}`);
  const s = linhas.find((l) => l.ev === "sussurro");
  assert.strictEqual(s.origem, "manual");
  assert.strictEqual(s.rac, undefined, "manual não tem racional de autonomia");
});

test("o registro guarda o que o personagem PRETENDIA no início do turno", async () => {
  const c = coletor();
  const vistas = [];
  const registro = {
    abrir: () => ({
      id: "t1",
      pretendia(i) { vistas.push(i); },
      sussurro() {}, pensou() {}, propos() {}, narrou() {}, falha() {},
      falhaDeExtensao() {}, descartar() {}, fechar: async () => {},
    }),
  };
  const CENA = { characters_present: [], items_present: [], routes: [],
                 capacidades: [],
                 intentions: [{ id: "int-1", status: "ativa", content: "achar Hulda" }] };
  const laco = new Laco({
    mundo: { chamadas: [], turnoId: null, conhece: () => null,
             contexto: async () => CENA,
             chamarCapacidade: async () => ({ recusado: false, texto: "",
                                              narrativa: { aconteceu: ["fez."] } }) },
    mente: menteDe({ propostas: [{ id: "c0", capacidade: "take",
                                   alvos: { item: "faca" }, prosa: { acao: "pega" } }] }),
    extensoes: extVazio(), registro, emitir: c.emitir,
  });

  await laco.sussurrar("pegue a faca");

  // é a FOTO do início do turno: sem ela não há como perguntar se o personagem se
  // comporta diferente quando TEM compromisso
  assert.deepStrictEqual(vistas[0], CENA.intentions);
});
