// OS RÓTULOS NEUTROS da camada visível (contrato 02, FR-021).
//
// É o que o jogador lê enquanto o turno anda — em PT, sem número, sem id, sem nome de
// tool. O `{alvo}` é sempre o NOME da cena. A guarda da camada visível
// (`test/harness-front.test.js`) varre estes textos contra a face e a cena.

"use strict";

const ROTULOS = {
  C3: "pensando no que fazer…",
  C4: "procurando onde está {alvo}…",
  C4_SEM: "procurando por onde começar…",
  C6: "pensando em como fazer isso…",
  C7: "escolhendo com o quê…",
  C8: "vendo se adiantou…",
  C8D: "conferindo se já conseguiu…",
  C3P: "traçando um caminho…",
  C3R: "tentando outro jeito…",
  C9: "",
  TRANSITO: "a caminho de {destino}…",
  SUBIU: "isso não dá para fazer assim.",
  QUERER: "pensando no que quer…",
};

function label(box, vars) {
  let t = ROTULOS[box] || "";
  for (const [k, v] of Object.entries(vars || {})) t = t.replace(`{${k}}`, String(v || ""));
  return t.replace(/\{[a-z]+\}/g, "").replace(/\s+…/, "…").trim();
}

// O motivo de uma subida em LINGUAGEM DE MUNDO, para a narração (nunca mecânica).
function motivoEmMundo(subiu, objetivo, extra) {
  const alvo = (extra && extra.objeto) || null;
  switch (subiu) {
    case "alvo_ausente": return alvo ? `não havia ${alvo} ali para isso` : `não havia com o que ${objetivo.toLowerCase()}`;
    case "alvo_longe": return `${alvo || "aquilo"} não estava ali, e sim em outro lugar`;
    case "alvo_desconhecido": return "ele não sabia onde encontrar o que precisava";
    case "sem_tool": return "não havia como fazer isso ali";
    case "gesto": return null;
    case "empate": return "ele não soube bem com qual das coisas fazer isso";
    default: return "não aconteceu";
  }
}

module.exports = { ROTULOS, label, motivoEmMundo };
