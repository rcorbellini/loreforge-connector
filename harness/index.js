// O HARNESS POR OBJETIVOS (spec 075) — uma caixa por módulo, com o MESMO nome da página
// de arquitetura (https://claude.ai/artifact/Aq484wT6jwv6F8F4XRoX4q) e do registro.
//
//   C1  scene.js       a cena como índice (regra)
//   C3  objectives.js  o pensar do pedido e o que fazer agora, no contrato M2 (Mente, pago)
//   C4  target.js      onde está o alvo (regra)
//   C6  tool.js        qual capacidade (Jev, local)
//   C7  params.js      os parâmetros (Jev + regra do dono, local)
//   M2  mundo.js       o mundo executa (tools, MCP)
//   C8  progress.js    andou? exaustão? — do pedido inteiro, vez a vez (regra)
//   C8D ending.js      acabou? (regra; losango do Jev em sombra)
//   C3P laco._tickSemDesejo  o que eu quero agora, com a autonomia ligada (Mente, pago)
//   C9  mente.narrate  narrar (Mente, pago)
//
// O laço (`laco.js`) orquestra: chama as caixas, emite os eventos e registra cada caixa.
// As caixas não emitem nem guardam estado — exceto o caderno do desejo (`desire.js`).

"use strict";

const BOXES = ["C1", "C3", "C4", "C6", "C7", "M2", "C8", "C8D", "C3P", "C9"];

module.exports = {
  BOXES,
  decider: require("./decider"),
  scene: require("./scene"),
  target: require("./target"),
  tool: require("./tool"),
  params: require("./params"),
  objectives: require("./objectives"),
  progress: require("./progress"),
  ending: require("./ending"),
  desire: require("./desire"),
  labels: require("./labels"),
  evidence: require("./evidence"),
  prompts: require("./prompts"),
};
