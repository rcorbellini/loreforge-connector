// O PAINEL — e as duas coisas que ele nunca pode fazer.
//
// A página de configuração é servida pelo próprio conector, e com `--expor`
// ligado ela viaja pela rede de casa. Duas garantias importam mais que qualquer
// funcionalidade dela:
//
//   1. NUNCA devolver a credencial — nem para preencher o próprio campo. É assim
//      que chaves vazam: por uma página de configuração prestativa demais.
//   2. NUNCA gravar código. Prompt é TEXTO. Se fosse `.js` carregado por
//      `require`, esta página estaria escrevendo código executável — e com
//      `--expor`, qualquer aparelho da rede escreveria.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.LOREFORGE_CONFIG =
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "painel-")), "conector.json");
process.env.LOREFORGE_LOG = "0";

const configuracao = require("../config");
const extensoes = require("../extensoes");

function pastaVazia() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "ext-"));
  fs.mkdirSync(path.join(raiz, "prompts"), { recursive: true });
  return raiz;
}

test("o painel NUNCA devolve a credencial — só diz que existe", () => {
  const cfg = configuracao.carregar(true);
  cfg.apiKey = "sk-ant-SEGREDO-NAO-VAZAR";
  cfg.openrouterKey = "sk-or-SEGREDO-NAO-VAZAR";

  const visto = configuracao.paraPagina(cfg);
  assert.ok(!JSON.stringify(visto).includes("SEGREDO"),
            "a chave viajou para a página");
  assert.strictEqual(visto.temChaveAnthropic, true);
  assert.strictEqual(visto.temChaveOpenrouter, true);
});

test("salvar sem informar chave NÃO apaga a que está gravada", () => {
  const cfg = configuracao.carregar(true);
  cfg.apiKey = "sk-ant-JA-GRAVADA";
  configuracao.aplicar(cfg, { model: "outro-modelo" });   // sem apiKey
  assert.strictEqual(cfg.apiKey, "sk-ant-JA-GRAVADA",
    "salvar outra coisa apagou a credencial — o jogador perderia a chave sem ver");
  assert.strictEqual(cfg.model, "outro-modelo");
});

test("chave em branco também não zera (campo vazio = manter)", () => {
  const cfg = configuracao.carregar(true);
  cfg.apiKey = "sk-ant-JA-GRAVADA";
  configuracao.aplicar(cfg, { apiKey: "   " });
  assert.strictEqual(cfg.apiKey, "sk-ant-JA-GRAVADA");
});

test("prompt é gravado como TEXTO, nunca como código", () => {
  const raiz = pastaVazia();
  const ext = extensoes.criar(raiz);
  ext.gravarPrompt("narrar", "narre seco");

  const arquivos = fs.readdirSync(path.join(raiz, "prompts"));
  assert.deepStrictEqual(arquivos, ["narrar.txt"]);
  assert.ok(!arquivos.some((f) => f.endsWith(".js")),
            "a página gravou um arquivo executável");
  assert.strictEqual(ext.prompts.narrar, "narre seco");
});

test("texto vazio volta ao padrão — quem tunou consegue desfazer", () => {
  const raiz = pastaVazia();
  const ext = extensoes.criar(raiz);
  ext.gravarPrompt("narrar", "narre seco");
  assert.ok(ext.versaoPrompt().startsWith("tunado-"));

  ext.gravarPrompt("narrar", "");
  assert.strictEqual(ext.versaoPrompt(), "padrao");
  assert.strictEqual(ext.prompts.narrar, undefined);
  assert.deepStrictEqual(fs.readdirSync(path.join(raiz, "prompts")), []);
});

test("nome de prompt com travessia de caminho é recusado", () => {
  const raiz = pastaVazia();
  const ext = extensoes.criar(raiz);
  for (const ruim of ["../../etc/passwd", "a/b", "narrar.js", "", "COM-MAIUSCULA"]) {
    const r = ext.gravarPrompt(ruim, "nao");
    assert.ok(r.erro, `aceitou o nome ${JSON.stringify(ruim)}`);
  }
  assert.deepStrictEqual(fs.readdirSync(path.join(raiz, "prompts")), []);
});

test("o inventário mostra o que está em uso, sem inventar", () => {
  const raiz = pastaVazia();
  fs.mkdirSync(path.join(raiz, "tools"), { recursive: true });
  fs.writeFileSync(path.join(raiz, "tools", "bloco.js"),
    'module.exports = { nome: "bloco", descricao: "anota", executar: async () => 1 };');
  const ext = extensoes.criar(raiz);
  ext.gravarPrompt("autonomia", "aja");

  const inv = ext.inventario();
  assert.deepStrictEqual(inv.prompts.map((p) => p.nome), ["autonomia"]);
  assert.deepStrictEqual(inv.tools.map((t) => t.nome), ["bloco"]);
  assert.strictEqual(inv.hooks.length, extensoes.PONTOS.length);
  assert.ok(inv.versaoPrompt.startsWith("tunado-"));
});

// A GUARDA DE ESCRITA, pela porta de verdade.
//
// Eu errei isto na primeira versão: comparei o endereço com `127.0.0.1` e pronto,
// o que trancava o DONO para fora do próprio conector assim que ele abrisse o
// painel pelo IP da rede — que é o endereço que ele já usa para a tela. Uma
// trava de segurança que impede o dono e não o intruso é pior que nenhuma: ela
// convida a desligar a trava.
test("escrever vale de qualquer endereço DESTA máquina", async () => {
  const os = require("os");
  const { servir } = require("../canal");

  const lacoFalso = { ocupado: false, numeroTurno: 0, autonomia: null };
  const painelFalso = {
    ler: async () => ({ config: {}, personagens: [] }),
    salvar: async () => ({ ok: true }),
    gravarPrompt: () => ({ ok: true }),
  };
  const c = await servir({ porta: 0, laco: lacoFalso, cfg: { personagem: "x" },
                           expor: true, painel: painelFalso });
  const porta = c.servidor.address().port;

  // todos os endereços desta máquina contam como "de casa"
  const meus = ["127.0.0.1"];
  for (const ifaces of Object.values(os.networkInterfaces() || {})) {
    for (const i of ifaces || []) if (i.family === "IPv4") meus.push(i.address);
  }
  for (const ip of meus) {
    const r = await fetch(`http://${ip}:${porta}/api/config`);
    const d = await r.json();
    assert.strictEqual(d.podeEscrever, true,
      `o dono foi barrado vindo de ${ip} — o próprio endereço da máquina dele`);
  }
  await c.fechar();
});

// --- REINICIAR ------------------------------------------------------------- //
// Existe porque um turno pendurado trava o conector inteiro em silêncio: `ocupado`
// nunca volta a false, a autonomia para, e a configuração adiada (a troca de
// personagem) fica presa no disco sem entrar em vigor. Aconteceu de verdade.
//
// É controle de PROCESSO, não jogada — então vale a guarda mais estrita que já
// existe aqui, a mesma do `/api/config`.

// (a recusa de FORA da máquina já é coberta por `daPropriaMaquina`, exercitada no
// teste acima; daqui não há como fingir outro endereço de socket sem outra máquina.
// O que ESTE teste prova é que a rota existe, chega ao painel, e que CABEÇALHO
// forjado não move a guarda — nem para abrir, nem para fechar.)
test("reiniciar chega ao painel, e cabeçalho forjado não move a guarda", async () => {
  const { servir } = require("../canal");
  let pedidos = 0;
  const c = await servir({
    porta: 0,
    laco: { ocupado: false, numeroTurno: 0, autonomia: null },
    cfg: { personagem: "x" }, expor: true,
    painel: {
      ler: async () => ({ config: {}, personagens: [] }),
      salvar: async () => ({ ok: true }),
      gravarPrompt: () => ({ ok: true }),
      reiniciar: async () => { pedidos++; return { ok: true, reiniciando: true }; },
    },
  });
  const porta = c.servidor.address().port;

  const r = await fetch(`http://127.0.0.1:${porta}/api/reiniciar`, { method: "POST" });
  const d = await r.json();
  assert.strictEqual(r.status, 200, JSON.stringify(d));
  assert.strictEqual(d.reiniciando, true);
  assert.strictEqual(pedidos, 1, "o pedido não chegou ao painel");

  // de fora: o canal responde 403 e NÃO chama o painel
  const forasteiro = await fetch(`http://127.0.0.1:${porta}/api/reiniciar`, {
    method: "POST", headers: { "X-Forwarded-For": "203.0.113.9" },
  });
  // a guarda é pelo endereço do socket, não por cabeçalho — este pedido segue
  // sendo local, e o teste afirma justamente que cabeçalho NÃO abre nem fecha a
  // porta (forjar `X-Forwarded-For` não pode virar chave nem cadeado).
  assert.strictEqual(forasteiro.status, 200,
    "um cabeçalho forjado mudou a decisão da guarda");
  assert.strictEqual(pedidos, 2);

  await c.fechar();
});

test("`fechar` volta mesmo com a tela ouvindo eventos (senão o reinício pendura)", async () => {
  const { servir } = require("../canal");
  const c = await servir({
    porta: 0,
    laco: { ocupado: false, numeroTurno: 0, autonomia: null },
    cfg: { personagem: "x" }, expor: false,
    painel: { ler: async () => ({ config: {} }), salvar: async () => ({ ok: true }),
              gravarPrompt: () => ({ ok: true }), reiniciar: async () => ({ ok: true }) },
  });
  const porta = c.servidor.address().port;

  // abre um `text/event-stream` e NÃO o fecha — é o que a tela faz de propósito.
  // Sem `closeAllConnections`, `servidor.close()` espera por ele para sempre, o
  // reinício nunca libera a porta e o processo novo não consegue escutar.
  const ctrl = new AbortController();
  const sse = await fetch(`http://127.0.0.1:${porta}/eventos`, { signal: ctrl.signal });
  assert.ok(sse.headers.get("content-type").includes("event-stream"));

  await Promise.race([
    c.fechar(),
    new Promise((_, rej) => setTimeout(() => rej(new Error(
      "`fechar` pendurou com um ouvinte de eventos aberto")), 3000)),
  ]);
  ctrl.abort();
});
