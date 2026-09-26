// Normalização de texto das caixas de regra (C4, C6, C7, C8D).
//
// Porta de `ferramentas/harness-objetivos/v1/lib.py::norm`: sem acento, caixa baixa,
// e tudo que não é letra ou número vira espaço. É a MESMA função que produziu os
// números do B3/B5/B6 — mudar o jeito de normalizar muda o que casa com o quê.

"use strict";

function norm(s) {
  return String(s == null ? "" : s)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Palavras que não identificam nada ("o", "da", "pra"…).
const STOP = new Set(["o", "a", "os", "as", "de", "do", "da", "dos", "das", "e", "um", "uma",
  "no", "na", "em", "pra", "para", "com", "ao", "aos", "que", "se", "seu", "sua", "meu", "minha"]);

// A parte antes da vírgula: "Fenn, o Dedos-Leves" é citado como "Fenn".
function base(nome) {
  return norm(String(nome == null ? "" : nome).split(",")[0]);
}

// O radical do 1º verbo (pista do verbo, e "pedido ou não" no registro).
function radical(palavra) {
  return norm(palavra).slice(0, 4);
}

function primeiroVerbo(texto) {
  const ws = norm(texto).split(" ").filter(Boolean);
  return ws.length ? ws[0] : "";
}

module.exports = { norm, STOP, base, radical, primeiroVerbo };
