// O armazenamento do conector — o que era `localStorage` no navegador.
//
// Eram 5 chamadas em `mente.js` (config, saveConfig, logEnabled, serverBase) e
// nada mais: nenhum `window`, nenhum `document`. Por isso a saida do navegador
// custa este arquivo, e nao uma reescrita (spec 044, research.md R1).
//
// O arquivo fica na MAQUINA DO JOGADOR e nunca sobe para lugar nenhum. Ele
// guarda a credencial do modelo, que e a razao de este artefato existir.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const PADRAO = path.join(os.homedir(), ".loreforge", "conector.json");

function caminho() {
  return process.env.LOREFORGE_CONFIG || PADRAO;
}

function ler() {
  try {
    return JSON.parse(fs.readFileSync(caminho(), "utf8"));
  } catch (_) {
    // sem arquivo, ilegivel, ou com JSON quebrado: e a primeira execucao ate
    // prova em contrario. Quem decide o que fazer com o vazio e o `config`.
    return {};
  }
}

function gravar(dados) {
  const alvo = caminho();
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  // 0600: o arquivo guarda credencial. Nao e paranoia — e o minimo que se deve a
  // quem confiou a chave a um programa que baixou da internet.
  fs.writeFileSync(alvo, JSON.stringify(dados, null, 2) + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(alvo, 0o600); // arquivo pre-existente nao recebe `mode` no write
  } catch (_) { /* sistema sem permissao POSIX: segue */ }
  return alvo;
}

module.exports = { ler, gravar, caminho };
