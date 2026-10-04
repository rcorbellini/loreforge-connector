// OS RÓTULOS NEUTROS da camada visível (contrato 02, FR-021).
//
// É o que o jogador lê enquanto o turno anda — em PT, sem número, sem id, sem nome de
// tool. O `{alvo}` é sempre o NOME da cena. A guarda da camada visível
// (`test/harness-front.test.js`) varre estes textos contra a face e a cena.

"use strict";

const { extractEnding } = require("./ending");

const ROTULOS = {
  C3: "pensando no que fazer…",
  C4: "procurando onde está {alvo}…",
  C4_SEM: "procurando por onde começar…",
  C6: "pensando em como fazer isso…",
  C7: "escolhendo com o quê…",
  C8: "vendo se adiantou…",
  C8D: "conferindo se já conseguiu…",
  C3P: "pensando no que quer…",
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

// O RACIONAL do plano (specs 076 e 077) para a camada VISÍVEL: a postura, uma linha por passo e
// a fala, como a Mente escreveu, em prosa. O que fica para DEPOIS não vai aqui: ele sobe como o
// plano (`plano` → `plan_update`), que a tela mostra logo abaixo — nos dois, saía repetido
// (achado jogando, 03/10). Sem nome de capacidade, id nem número (a guarda é o
// `harness-front.test.js`). É o que ele PENSA e PRETENDE: o que aconteceu vem do mundo.
//
// O PORQUÊ DE CADA PASSO (mantenedor, 04/10/2026: "mostrar o racional é o que vai dar mais
// imersão, você passa a entender os motivos das decisões"): o plano já dizia, por passo, o que
// ele ESPERA conseguir, e o fato que dá o pedido por feito; a tela não mostrava. A linha do passo
// leva o `espera` depois de " → ", e o fato vira "Dá por feito quando …", em palavras de mundo.
function rationaleText(plan) {
  const linhas = [];
  if (plan && plan.stance) linhas.push(plan.stance);
  for (const s of (plan && plan.steps) || []) {
    if (!s.action || s.type === "defeito") continue;
    const espera = String(s.expects || "").trim();
    linhas.push(`— ${_acaoComNomes(s)}${espera ? ` → ${espera}` : ""}`);
  }
  const pronto = prontoEmPalavras(plan && plan.doneWhen);
  if (pronto) linhas.push(`Dá por feito quando ${pronto}.`);
  if (plan && plan.reply) linhas.push(`"${plan.reply}"`);
  return linhas.join("\n");
}

// O fato que fecha (as formas do M2), como o jogador diria: "posse de Peixe Fresco" → "tiver
// Peixe Fresco". "nenhum" (ou fora das formas) não vira linha: não há fato a mostrar.
const _NECESSIDADE = { fome: "a fome passar", sede: "a sede passar", sono: "o sono passar" };
function prontoEmPalavras(doneWhen) {
  const f = extractEnding(doneWhen);
  const alvo = String((f && f.alvo) || "").replace(/[.;:!?\s]+$/, "");
  if (!f || f.familia === "nenhuma") return null;
  if (f.familia === "necessidade") return _NECESSIDADE[f.alvo] || null;
  if (!alvo) return null;
  if (f.familia === "posse") return `tiver ${alvo}`;
  if (f.familia === "lugar") return `estiver em ${alvo}`;
  if (f.familia === "lembranca") return `souber algo sobre ${alvo}`;
  return null;
}

// A linha do passo no racional: a ação como a Mente escreveu e, quando os nomes da cena ficaram só no
// `com` (o qwen escreve "Seguir" e põe "Ladeira do Sal" à parte), os nomes junto — a mesma leitura do
// resolvedor. Sem isso a tela lia "— Seguir", "— Ir" (achado da revisão da 076 e da bateria da 077).
function _acaoComNomes(s) {
  const nomes = (s.with || []).filter(Boolean);
  const acao = String(s.action || "");
  const baixo = acao.toLowerCase();
  const faltam = nomes.filter((n) => !baixo.includes(String(n).toLowerCase()));
  return faltam.length ? `${acao} — ${faltam.join(", ")}` : acao;
}

module.exports = { ROTULOS, label, motivoEmMundo, rationaleText, prontoEmPalavras };
