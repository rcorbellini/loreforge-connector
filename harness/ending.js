// C8D · ACABOU? — o fim do desejo, conferido por REGRA contra o contexto.
//
// Porta de `v1/progresso.py::fim_cumprido` (B11: 32/32). Quatro famílias:
//   necessidade · "fome saciada", "sede saciada", "sono saciado"
//   posse       · "posse de <item>"
//   lugar       · "estar em <lugar>"
//   lembrança   · "lembrança sobre <alguém>"
// e "nenhum" — fim não conferível, que fecha por VONTADE da Mente ou, se a bateria da
// SC-010 aprovar, pelo losango do Jev (hoje em SOMBRA: roda, grava, não tem efeito).
//
// O `pronto_quando` legado da intenção (spec 073) é lido como fim já declarado.
//
// O Jev aqui pergunta sobre o DESEJO do próprio personagem ("já sei quem furtou?"), que
// é escolha dele — nunca sobre o desfecho de uma ação no mundo (Princípio IX, FR-027).

"use strict";

const { norm, base } = require("./text");

const BOX = "C8D";

const SACIADO = {
  fome: ["hunger", new Set(["sem fome", "saciado", "satisfeito"])],
  sede: ["thirst", new Set(["sem sede", "saciado", "satisfeito"])],
  sono: ["fatigue", new Set(["descansado"])],
};
const LEGADO = { hunger: "fome saciada", thirst: "sede saciada", sleep: "sono saciado" };

// prosa → { familia, alvo, texto } ou { familia: "nenhuma" }
function extractEnding(fimTexto, intencao) {
  if (intencao && intencao.pronto_quando) {
    const pq = intencao.pronto_quando;
    if (LEGADO[pq]) return extractEnding(LEGADO[pq]);
    if (pq === "posse" && intencao.pronto_quando_alvo) {
      return { familia: "posse", alvo: intencao.pronto_quando_alvo, texto: `posse de ${intencao.pronto_quando_alvo}`, fonte: "pronto_quando" };
    }
    if (pq === "lugar" && intencao.pronto_quando_alvo) {
      return { familia: "lugar", alvo: intencao.pronto_quando_alvo, texto: `estar em ${intencao.pronto_quando_alvo}`, fonte: "pronto_quando" };
    }
  }
  const t = String(fimTexto || "").trim();
  const f = norm(t);
  if (!f || f === "nenhum" || f === "nenhuma") return { familia: "nenhuma", texto: t || "nenhum", fonte: "prosa" };
  let m = t.match(/^posse\s+d[eoa]s?\s+(.+)$/i);
  if (m) return { familia: "posse", alvo: m[1].trim(), texto: t, fonte: "prosa" };
  m = t.match(/^estar\s+(?:em|na|no|nos|nas)\s+(.+)$/i);
  if (m) return { familia: "lugar", alvo: m[1].trim(), texto: t, fonte: "prosa" };
  m = t.match(/^lembran[çc]a\s+sobre\s+(.+)$/i);
  if (m) return { familia: "lembranca", alvo: m[1].trim(), texto: t, fonte: "prosa" };
  for (const k of Object.keys(SACIADO)) {
    if (f.startsWith(k) && f.includes("saciad")) return { familia: "necessidade", alvo: k, texto: t, fonte: "prosa" };
  }
  return { familia: "nenhuma", texto: t, fonte: "prosa" };
}

// → true | false | null (null = não conferível por regra)
function isDone(fim, ctx) {
  if (!fim || fim.familia === "nenhuma") return null;
  const s = (ctx && ctx.self) || {};
  const sc = (ctx && ctx.scene) || {};
  const alvo = base(fim.alvo || "");
  if (fim.familia === "posse") {
    return (s.inventory || []).some((i) => base(i.name || "") === alvo || norm(i.id || "") === alvo);
  }
  if (fim.familia === "lugar") {
    if (s.transit) return false;
    const l = sc.place || {};
    return base(l.name || "") === alvo || norm(l.id || "") === alvo;
  }
  if (fim.familia === "necessidade") {
    const [campo, ok] = SACIADO[fim.alvo] || [];
    if (!campo) return null;
    return ok.has(norm(((s.needs || {})[campo]) || ""));
  }
  if (fim.familia === "lembranca") {
    const nomes = {};
    for (const p of sc.characters || []) nomes[p.id] = base(p.name);
    for (const k of s.known_elsewhere || []) nomes[k.id] = base(k.name);
    return (s.memories || []).some((m) => (m.involved || []).some((i) => base(i) === alvo || nomes[i] === alvo)
      || (alvo && norm(m.summary || "").includes(alvo)));
  }
  return null;
}

// O losango em SOMBRA (FR-010a, hipótese): o Jev lê o fim em prosa e o que ele acabou
// de saber. A resposta é GRAVADA ao lado da decisão da regra; só tem efeito com
// `cfg.harness.losangosJev === "ligado"`, depois da bateria B15.
async function shadow({ decider, pergunta, desejo, fim, memoriasNovas }) {
  if (!memoriasNovas || !memoriasNovas.length) return null;
  const r = await decider.choose(
    { desejo, fim: fim && fim.texto, o_que_acabou_de_saber: memoriasNovas.map((m) => m.summary || "").slice(0, 6) },
    pergunta,
    [["cumpre", "se cumpriu: o que ele sabe agora responde o desejo"],
     ["pista", "ainda não, mas ele ganhou uma pista"],
     ["nada", "não mudou nada quanto a este desejo"]]);
  return { losango: "c8d_fim", resposta: r.vencedora, margem: r.margem };
}

module.exports = { BOX, extractEnding, isDone, shadow };
