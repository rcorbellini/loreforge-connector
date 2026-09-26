// C3P · C3R · PLANEJAR e REPLANEJAR um desejo — chamadas pagas, raras.
//
// Prompt: B9/PLAN_V1 (5 passos em média, violência 0, fim certo 12/22) + a regra que o
// caso 2 pediu: o 1º passo é possível AGORA. O que o modelo precisa saber para não errar
// desce como DADO no user, e não como proibição em prosa (memória
// `restricao-conhecida-desce-como-dado`): quem ele é ("não é interlocutor de si mesmo" —
// a Mira planejou falar com a Mira) e o que carrega (o Draven planejou colher maçã com
// um Bocado na mão).
//
// C3R é a mesma chamada com as TENTATIVAS do passo que se esgotou como dado (B10: 21/24
// atacam o motivo, contra 16 sem os dados).
//
// A saída passa por uma validação POR REGRA (FR-011): o 1º passo tem de citar algo que
// está AQUI (C4), ou ser um passo de descobrir/lembrar; e nenhum passo pode ter o próprio
// personagem como alvo. Violou → replaneja UMA vez com o motivo; violou de novo → segue
// com o plano e marca a falha no registro (nada é descartado em silêncio).

"use strict";

const { norm, base } = require("./text");
const { cited } = require("./target");

const BOX_P = "C3P";
const BOX_R = "C3R";

const DESCOBRIR = /^(descobr|pergunt|procur|lembr|consult|investig|examin|observ|verific|esper|aguard)/;

function parsePlanReply(texto) {
  const t = String(texto || "");
  const passos = [];
  let fim = "nenhum";
  let desejo = null;
  for (const l of t.split("\n")) {
    const s = l.trim();
    const m = s.match(/^FIM:\s*(.+)$/i);
    if (m) { fim = m[1].trim().replace(/^["“]|["”]$/g, ""); continue; }
    const d = s.match(/^DESEJO:\s*(.+)$/i);
    if (d) { desejo = d[1].trim(); continue; }
    if (/^[-*•]\s*\S/.test(s)) passos.push(s.replace(/^[-*•]\s*/, "").trim());
  }
  return { desejo, passos: passos.slice(0, 6), fim };
}

function validatePlan(passos, idx, ctx) {
  const eu = base((ctx && ctx.self && ctx.self.name) || "");
  const problemas = [];
  if (!passos.length) problemas.push("o plano veio sem passos");
  passos.forEach((p, i) => {
    const cit = cited(p, idx);
    if (eu && (base(p).includes(`com ${eu}`) || cit.some((a) => base(a.nome) === eu))) {
      problemas.push(`o passo ${i + 1} tem você mesmo como alvo`);
    }
  });
  if (passos.length) {
    const p0 = passos[0];
    const aqui = cited(p0, idx).some((a) => a.onde === "aqui");
    if (!aqui && !DESCOBRIR.test(norm(p0))) {
      problemas.push("o primeiro passo não usa nada que está na cena nem no que você carrega");
    }
  }
  return problemas;
}

function _dados(ctx) {
  const self = (ctx && ctx.self) || {};
  const inv = (self.inventory || []).map((i) => i.name).filter(Boolean);
  return `VOCÊ É: ${self.name || "?"} — você não é interlocutor de si mesmo.\n`
       + `VOCÊ CARREGA: ${inv.length ? inv.join(", ") : "nada"}\n`;
}

async function _chamar({ mente, ctx, system, user, rotina, label }) {
  const cru = await mente.conversar(system, user, { rotina, label, temperature: 0.4, maxTokens: 400 });
  return { ...parsePlanReply(cru), cru };
}

// → { passos, fim, problemas, cru, tentativasDePlano }
async function plan({ mente, ctx, idx, desejo, tentativas, system, prosaCena }) {
  let user = `DESEJO: ${desejo}\n` + _dados(ctx);
  const replanejando = Array.isArray(tentativas) && tentativas.length;
  if (replanejando) {
    user += "\nTENTATIVAS QUE JÁ FALHARAM NESTE PASSO (o que o mundo respondeu):\n"
          + tentativas.slice(-6).map((t) => `- ${t}`).join("\n")
          + "\nReplaneje o caminho a partir daqui, levando em conta o que as respostas do mundo ensinam.\n";
  }
  user += "\n" + prosaCena;
  const rotina = "planejar";
  const label = replanejando ? "REPLANEJAR (C3R)" : "PLANEJAR (C3P)";
  let r = await _chamar({ mente, ctx, system, user, rotina, label });
  let problemas = validatePlan(r.passos, idx, ctx);
  let tentativasDePlano = 1;
  if (problemas.length) {
    const u2 = user + "\n\nO PLANO ANTERIOR NÃO SERVE: " + problemas.join("; ") + ". Refaça.";
    const r2 = await _chamar({ mente, ctx, system, user: u2, rotina, label: label + " · 2ª" });
    tentativasDePlano = 2;
    const p2 = validatePlan(r2.passos, idx, ctx);
    if (r2.passos.length) { r = r2; problemas = p2; }
  }
  return { passos: r.passos, fim: r.fim, problemas, cru: r.cru, tentativasDePlano };
}

module.exports = { BOX_P, BOX_R, plan, parsePlanReply, validatePlan };
