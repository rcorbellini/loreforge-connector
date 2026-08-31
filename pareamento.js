// O CODIGO DE PAREAMENTO (spec 056, US4) — a prova de que quem esta colando
// isto no client tem acesso LOCAL a este conector (terminal ou painel), sem
// depender do Google nem do loreforge-server pra gerar ou guardar nada.
//
// O server so entra depois, pra UMA coisa: confirmar que o JWT que chegou
// junto com o codigo e autentico (`mundo.validarToken`, /api/auth/me). O
// codigo em si nunca sai desta maquina antes de alguem colar-lo de volta.

"use strict";

const crypto = require("crypto");

// sem 0/O/1/I/L — letras e numeros que se confundem ao digitar a mao.
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const VALIDADE_MS = 10 * 60 * 1000;

function gerarCodigo() {
  const bloco = () => Array.from({ length: 4 },
    () => ALFABETO[crypto.randomInt(ALFABETO.length)]).join("");
  return `${bloco()}-${bloco()}`;
}

module.exports = { gerarCodigo, VALIDADE_MS };
