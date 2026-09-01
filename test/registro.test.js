// O REGISTRO DO TURNO, do lado do conector.
//
// Duas coisas se guardam aqui, e nenhuma é o formato:
//   · registrar NUNCA derruba o turno — o jogo vale mais que o dado sobre o jogo;
//   · o corpo SEMPRE sobe. Foi opção do jogador por um tempo, e o dono do mundo
//     derrubou a opção: telemetria voluntária num jogo hospedado é telemetria
//     que não existe.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.LOREFORGE_CONFIG =
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "reg-")), "conector.json");
process.env.LOREFORGE_LOG = "0";

const registro = require("../registro");

const CFG = { personagem: "fulano", runtime: "local", model: "llama3.1:8b" };

function mundoQueAceita() {
  const linhas = [];
  return { linhas, registrar: async (l) => { linhas.push(l); return true; } };
}

const EXT = { versaoPrompt: () => "padrao" };
const MENTE = { zerarCusto: () => {}, custoDoTurno: () => ({ entrada: 120, saida: 40, chamadas: 2 }) };

test("o envelope carrega quem, quando, qual modelo, versão de prompt e custo", async () => {
  const mundo = mundoQueAceita();
  const t = registro.criar({ mundo, cfg: CFG, extensoes: EXT, mente: MENTE }).abrir();
  t.sussurro("pegue a corda", "manual");
  await t.fechar();

  const l = mundo.linhas[0];
  assert.strictEqual(l.personagem, "fulano");
  assert.strictEqual(l.modelo, "ollama/llama3.1:8b");
  assert.strictEqual(l.versao_prompt, "padrao");
  assert.ok(l.turno_id, "sem turno_id não há como costurar as duas metades");
  assert.ok(l.instante);
  assert.strictEqual(l.custo.entrada, 120);
  assert.ok(typeof l.custo.duracao_ms === "number");
});

test("rotuloDoModelo: cada runtime nomeia o SEU modelo — nenhum cai no padrão do Ollama por engano", () => {
  assert.strictEqual(registro.rotuloDoModelo({ runtime: "local", model: "llama3.1:8b" }),
                     "ollama/llama3.1:8b");
  assert.strictEqual(registro.rotuloDoModelo({ runtime: "remote", remoteModel: "claude-x" }),
                     "anthropic/claude-x");
  assert.strictEqual(registro.rotuloDoModelo({ runtime: "openrouter", openrouterModel: "or-x" }),
                     "openrouter/or-x");
  assert.strictEqual(registro.rotuloDoModelo({ runtime: "gemini", geminiModel: "gemini-2.5-flash" }),
                     "gemini/gemini-2.5-flash");
});

test("a recusa entra no corpo COM o motivo, em linguagem de mundo", async () => {
  const mundo = mundoQueAceita();
  const t = registro.criar({ mundo, cfg: CFG, extensoes: EXT, mente: MENTE }).abrir();
  t.propos("give", { to: "ninguem" }, { acao: "entrega" },
           { recusado: true, texto: "não há ninguém com esse nome aqui" });
  await t.fechar();

  const escolha = mundo.linhas[0].corpo.escolhas[0];
  assert.strictEqual(escolha.recusado, true);
  assert.match(escolha.recusa, /ninguém/);
});

test("o pensamento é o que a MENTE disse de si, não o que nós inferimos", async () => {
  const mundo = mundoQueAceita();
  const t = registro.criar({ mundo, cfg: CFG, extensoes: EXT, mente: MENTE }).abrir();
  t.pensou({ pensamento: "a corda serve para descer o penhasco" });
  await t.fechar();
  assert.strictEqual(mundo.linhas[0].corpo.pensamento,
                     "a corda serve para descer o penhasco");
});

// O CORPO SEMPRE SOBE — regra da casa, não configuração.
//
// Houve um interruptor aqui, e o dono do mundo o derrubou pelo motivo certo:
// quem hospeda precisa medir, e telemetria voluntária num jogo hospedado é
// telemetria que não existe. Este teste existe para que ninguém o reintroduza
// por engano achando que está "respeitando o jogador".
test("o corpo sobe sempre, mesmo com configuração antiga mandando o contrário", async () => {
  const mundo = mundoQueAceita();
  const cfg = { ...CFG, enviarCorpo: false };   // resquício de config antiga
  const t = registro.criar({ mundo, cfg, extensoes: EXT, mente: MENTE }).abrir();
  t.sussurro("pegue a corda", "manual");
  t.pensou({ pensamento: "o racional que o mundo precisa medir" });
  await t.fechar();

  const l = mundo.linhas[0];
  assert.ok(l.corpo, "o corpo não subiu");
  assert.strictEqual(l.corpo.pensamento, "o racional que o mundo precisa medir");
  assert.strictEqual(l.corpo_suprimido, false);
  assert.ok(l.personagem && l.modelo, "o envelope sumiu");
});

test("destino fora do ar NÃO derruba o turno", async () => {
  const mundoQuebrado = {
    registrar: async () => { throw new Error("sem rede"); },
  };
  const t = registro.criar({ mundo: mundoQuebrado, cfg: CFG, extensoes: EXT,
                             mente: MENTE }).abrir();
  t.sussurro("pegue a corda", "manual");
  // se isto levantar, um turno jogado se perde por causa de telemetria
  await assert.doesNotReject(() => t.fechar());
});

test("turno descartado (a Mente não tinha o que fazer) não vira linha", async () => {
  const mundo = mundoQueAceita();
  const t = registro.criar({ mundo, cfg: CFG, extensoes: EXT, mente: MENTE }).abrir();
  t.descartar();
  await t.fechar();
  assert.strictEqual(mundo.linhas.length, 0);
});

test("falha de extensão é anotada, nunca engolida", async () => {
  const mundo = mundoQueAceita();
  const t = registro.criar({ mundo, cfg: CFG, extensoes: EXT, mente: MENTE }).abrir();
  t.falhaDeExtensao("antes_de_propor", "estourei");
  await t.fechar();
  assert.deepStrictEqual(mundo.linhas[0].corpo.falhas_de_extensao,
                         [{ ponto: "antes_de_propor", erro: "estourei" }]);
});

// O PORQUÊ do tick autônomo, que antes morria no stderr do conector — existia
// enquanto a janela do terminal durasse. É a única coisa que explica a DECISÃO DE
// AGIR (personalidade × biologia × intenções), e numa análise retrospectiva era
// justo o que mais faltava: dava para ver o que o personagem fez, nunca por que.
test("o racional da AUTONOMIA sobe, e em campo próprio", async () => {
  const mundo = mundoQueAceita();
  const t = registro.criar({ mundo, cfg: CFG, extensoes: EXT, mente: MENTE }).abrir();
  t.sussurro("ele se levanta e observa", "autonoma", "está com fome e não confia em ninguém");
  t.pensou({ pensamento: "quer comer sem pedir" });
  await t.fechar();

  const c = mundo.linhas[0].corpo;
  assert.strictEqual(c.racional_autonomo, "está com fome e não confia em ninguém");
  // e NÃO se confundem: são dois raciocínios de prompts diferentes
  assert.strictEqual(c.pensamento, "quer comer sem pedir");
});

test("sussurro manual não inventa racional de autonomia", async () => {
  const mundo = mundoQueAceita();
  const t = registro.criar({ mundo, cfg: CFG, extensoes: EXT, mente: MENTE }).abrir();
  t.sussurro("pegue a faca", "manual");
  await t.fechar();
  assert.strictEqual(mundo.linhas[0].corpo.racional_autonomo, null);
});
