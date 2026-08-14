// O log do conector — o que a pessoa ve no terminal enquanto a Mente joga.
//
// A VERSAO vai em toda entrada, pelo mesmo motivo que o `server/devlog.py` faz
// isso: ler um log sem saber que codigo o produziu ja custou uma hora e meia de
// jogo contra um server desatualizado.
//
// Silenciar:  LOREFORGE_LOG=0

"use strict";

const LIGADO = process.env.LOREFORGE_LOG !== "0";
const VERSAO = (() => {
  try {
    return require("./package.json").version;
  } catch (_) {
    return "0";
  }
})();

function log(rotulo, conteudo) {
  if (!LIGADO) return;
  const ts = new Date().toLocaleTimeString();
  let corpo = "";
  if (conteudo !== undefined && conteudo !== null) {
    corpo = typeof conteudo === "string"
      ? conteudo
      : (() => {
          try {
            return JSON.stringify(conteudo, null, 2);
          } catch (_) {
            return String(conteudo);
          }
        })();
  }
  process.stderr.write(`\n──── ${ts} · v${VERSAO} · ${rotulo} ────\n`);
  if (corpo) process.stderr.write(corpo.replace(/\s+$/, "") + "\n");
}

module.exports = { log, VERSAO };
