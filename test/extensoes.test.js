// OS PONTOS DE EXTENSÃO — e os dois invariantes que tornam o harness seguro.
//
// Abrir o conector inteiro para quem quer tunar a Mente só é seguro porque:
//   1. uma tool local NUNCA muda o mundo (ela raciocina, não age);
//   2. um hook quebrado NUNCA derruba o turno nem reescreve o desfecho julgado.
//
// Sem o primeiro, "tunar" viraria "trapacear". Sem o segundo, uma extensão
// mal-escrita de terceiro derrubaria o jogo de quem a instalou.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const extensoes = require("../extensoes");

function pastaDeExtensoes(arquivos) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "ext-"));
  for (const sub of ["prompts", "tools", "hooks"]) {
    fs.mkdirSync(path.join(raiz, sub), { recursive: true });
  }
  for (const [rel, conteudo] of Object.entries(arquivos)) {
    fs.writeFileSync(path.join(raiz, rel), conteudo);
  }
  return raiz;
}

test("sem nenhuma extensão, o conector roda no padrão", () => {
  const ext = extensoes.criar(pastaDeExtensoes({}));
  assert.deepStrictEqual(ext.toolsLocais(), []);
  assert.strictEqual(ext.versaoPrompt(), "padrao");
  assert.deepStrictEqual(ext.falhas, []);
});

test("uma tool local aparece para a Mente e resolve dentro do conector", async () => {
  const ext = extensoes.criar(pastaDeExtensoes({
    "tools/bloco.js": `module.exports = {
      nome: "bloco_de_notas",
      descricao: "anota algo para lembrar depois",
      executar: async (args) => ({ anotado: args.texto }),
    };`,
  }));
  const tools = ext.toolsLocais();
  assert.strictEqual(tools.length, 1);
  assert.strictEqual(tools[0].name, "bloco_de_notas");
  assert.strictEqual(tools[0]._origem, "local");

  const r = await ext.executarLocal("bloco_de_notas", { texto: "a corda" });
  assert.deepStrictEqual(r.resultado, { anotado: "a corda" });
});

test("a tool local recebe SÓ os próprios argumentos — nunca o mundo", async () => {
  const ext = extensoes.criar(pastaDeExtensoes({
    "tools/curiosa.js": `module.exports = {
      nome: "curiosa",
      executar: async function () { return { recebi: arguments.length }; },
    };`,
  }));
  const r = await ext.executarLocal("curiosa", { x: 1 });
  assert.strictEqual(r.resultado.recebi, 1,
    "a tool local recebeu mais que os próprios argumentos");
});

test("tool local que estoura não derruba nada — devolve o erro", async () => {
  const ext = extensoes.criar(pastaDeExtensoes({
    "tools/ruim.js": `module.exports = {
      nome: "ruim", executar: async () => { throw new Error("quebrei"); },
    };`,
  }));
  const r = await ext.executarLocal("ruim", {});
  assert.strictEqual(r.erro, "quebrei");
});

test("tool local malformada não impede as outras de carregar", () => {
  const ext = extensoes.criar(pastaDeExtensoes({
    "tools/boa.js": `module.exports = { nome: "boa", executar: async () => 1 };`,
    "tools/sem-nome.js": `module.exports = { executar: async () => 1 };`,
  }));
  assert.strictEqual(ext.toolsLocais().length, 1);
  assert.strictEqual(ext.falhas.length, 1);
});

test("substituir um prompt muda a versão registrada", () => {
  const semTunagem = extensoes.criar(pastaDeExtensoes({}));
  const tunado = extensoes.criar(pastaDeExtensoes({
    "prompts/narrar.js": `module.exports = "narre como um bardo bêbado";`,
  }));
  assert.strictEqual(semTunagem.versaoPrompt(), "padrao");
  assert.ok(tunado.versaoPrompt().startsWith("tunado-"));
  assert.strictEqual(tunado.prompts.narrar, "narre como um bardo bêbado");
});

test("prompts diferentes geram versões diferentes (senão comparar corridas é chute)", () => {
  const a = extensoes.criar(pastaDeExtensoes({
    "prompts/narrar.js": `module.exports = "versao A";`,
  }));
  const b = extensoes.criar(pastaDeExtensoes({
    "prompts/narrar.js": `module.exports = "versao B";`,
  }));
  assert.notStrictEqual(a.versaoPrompt(), b.versaoPrompt());
});

test("os quatro hooks disparam, na ordem em que o laço os chama", async () => {
  const ordem = [];
  global.__ordem = ordem;      // antes do `criar`: é ele que carrega o arquivo
  const ext = extensoes.criar(pastaDeExtensoes({
    "hooks/espiao.js": `module.exports = {
        antes_de_pensar: (d) => { global.__ordem.push("antes_de_pensar"); return d; },
        antes_de_propor: (d) => { global.__ordem.push("antes_de_propor"); return d; },
        depois_do_desfecho: (d) => { global.__ordem.push("depois_do_desfecho"); return d; },
        antes_de_narrar: (d) => { global.__ordem.push("antes_de_narrar"); return d; },
      };`,
  }));
  for (const p of extensoes.PONTOS) await ext.hook(p, {});
  assert.deepStrictEqual(ordem, extensoes.PONTOS);
  delete global.__ordem;
});

test("hook que estoura NÃO derruba o turno, e a falha fica anotada", async () => {
  const ext = extensoes.criar(pastaDeExtensoes({
    "hooks/bomba.js": `module.exports = {
      antes_de_propor: () => { throw new Error("estourei"); },
    };`,
  }));
  const anotadas = [];
  const registroFalso = {
    falhaDeExtensao: (ponto, erro) => anotadas.push({ ponto, erro }),
  };
  const dado = { intacto: true };
  const saida = await ext.hook("antes_de_propor", dado, registroFalso);

  assert.deepStrictEqual(saida, dado, "o dado foi corrompido por um hook quebrado");
  assert.strictEqual(anotadas.length, 1);
  assert.strictEqual(anotadas[0].ponto, "antes_de_propor");
});

test("hook pode transformar o dado, e o valor devolvido é o que segue", async () => {
  const ext = extensoes.criar(pastaDeExtensoes({
    "hooks/filtro.js": `module.exports = {
      antes_de_propor: (lista) => lista.filter((p) => p.capacidade !== "attack"),
    };`,
  }));
  const saida = await ext.hook("antes_de_propor",
    [{ capacidade: "take" }, { capacidade: "attack" }]);
  assert.deepStrictEqual(saida, [{ capacidade: "take" }]);
});
