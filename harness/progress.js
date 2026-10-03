// C8 · ANDOU? — progresso e exaustão, por REGRA (0 token pago). Desde a spec 077 o "passo" é o
// PEDIDO inteiro: a vez repensa o plano, e o que se mede é se o pedido andou.
//
// Porta de `v1/progresso.py::Passo` (B8: 24/24 loops reais pegos cedo — o `wake_up` do
// Draven parado na 2ª tentativa, e não na 192ª).
//
//   PROGRESSO = estado NOVO (nunca visto neste passo — voltar a um já visto é ciclo) ou
//               SABER NOVO (memória nova de aprendizado ou ouvida: `event`/`heard_from`,
//               o contrato que o B7 pediu e o `get_context` passou a expor).
//   BLOCKED   = 3 abordagens distintas sem progresso · repetir o que falhou no mesmo
//               estado · o mesmo motivo de recusa 3× · o mesmo verbo+alvo 3× no passo
//               (a rede de segurança da teimosia com estado novo — a Petrila acusando 8×).
//
// A assinatura de estado IGNORA `status.action`: toda ação aceita reescreve esse campo
// (B7), e um "estado mudou?" ingênuo cairia nele sempre.
//
// Os limiares são do ecossistema do personagem, parametrizáveis por mesa (`cfg.harness`).

"use strict";

const crypto = require("crypto");

const BOX = "C8";

// Eventos de memória que são SABER (aprender, ouvir, testemunhar algo relevante). Chegar
// e partir de gente é ruído do lugar vivo: contaria como progresso a cada tick.
const SABER = /^(hearsay|inform|learn_|witness_)/;
const RUIDO = new Set(["witness_arrival", "witness_departure"]);

function stateSignature(ctx) {
  const s = (ctx && ctx.scene) || {};
  const self = (ctx && ctx.self) || {};
  const doc = {
    lugar: (s.place && s.place.id) || null,
    transito: (self.transit && (self.transit.to_id || self.transit.route_id)) || null,
    inv: (self.inventory || []).map((i) => i.id).sort(),
    necess: self.needs || null,
    chao: (s.items || []).map((i) => i.id).sort(),
    presentes: (s.characters || []).map((p) => p.id).filter((id) => id !== self.id).sort(),
  };
  return crypto.createHash("sha1").update(JSON.stringify(doc)).digest("hex").slice(0, 12);
}

// Memórias novas que são SABER, entre duas fotos do contexto.
function newKnowledge(antes, depois) {
  const vistas = new Set((((antes && antes.self) || {}).memories || []).map((m) => m.id));
  return ((((depois && depois.self) || {}).memories) || []).filter((m) => {
    if (!m || vistas.has(m.id)) return false;
    if (m.heard_from) return true;
    return !!(m.event && SABER.test(m.event) && !RUIDO.has(m.event));
  });
}

const _k = (tool, args) => `${tool}\u0000${JSON.stringify(_semProsa(args))}`;
function _semProsa(args) {
  const o = {};
  for (const [k, v] of Object.entries(args || {})) if (k !== "prosa") o[k] = v;
  return Object.keys(o).sort().reduce((a, k) => ((a[k] = o[k]), a), {});
}
const _verboAlvo = (tool, args) => {
  const a = _semProsa(args);
  const alvo = Object.values(a).find((v) => typeof v === "string") || "";
  return `${tool}\u0000${alvo}`;
};

// O estado de UM passo: serializável (vai para o caderno do conector).
function newStep(estadoInicial) {
  return { vistos: [estadoInicial], atual: estadoInicial, falhas: [], distintas: [],
           motivos: {}, verbos: {} };
}

function limits(cfg) {
  const h = (cfg && cfg.harness) || {};
  return { abordagens: h.abordagens || 3, repeticoes: h.repeticoes || 3, motivos: 3 };
}

// Chamado ANTES de executar: repetir o que já falhou no MESMO estado é BLOCKED.
function before(step, tool, args) {
  const sig = `${_k(tool, args)}\u0000${step.atual}`;
  return step.falhas.includes(sig) ? { bloqueio: "repeticao" } : null;
}

// Depois de executar. → { veredito: "progresso"|"sem_progresso"|"blocked", motivo? }
function after(step, { tool, args, aceita, recusa, estadoDepois, saber, cfg }) {
  const lim = limits(cfg);
  const sig = `${_k(tool, args)}\u0000${step.atual}`;
  const va = _verboAlvo(tool, args);
  step.verbos[va] = (step.verbos[va] || 0) + 1;
  const novo = !!estadoDepois && !step.vistos.includes(estadoDepois);
  if (novo || saber) {
    if (estadoDepois && novo) step.vistos.push(estadoDepois);
    if (estadoDepois) step.atual = estadoDepois;
    step.distintas = [];
    step.motivos = {};
    if (step.verbos[va] >= lim.repeticoes) return { veredito: "blocked", motivo: "teimosia" };
    return { veredito: "progresso", motivo: novo ? "estado_novo" : "saber_novo" };
  }
  if (estadoDepois) step.atual = estadoDepois;
  if (!step.falhas.includes(sig)) step.falhas.push(sig);
  const k = _k(tool, args);
  if (!step.distintas.includes(k)) step.distintas.push(k);
  if (!aceita && recusa) step.motivos[recusa] = (step.motivos[recusa] || 0) + 1;
  if (Object.values(step.motivos).some((n) => n >= lim.motivos)) return { veredito: "blocked", motivo: "mesmo_motivo" };
  if (step.distintas.length >= lim.abordagens) return { veredito: "blocked", motivo: "abordagens" };
  if (step.verbos[va] >= lim.repeticoes) return { veredito: "blocked", motivo: "teimosia" };
  return { veredito: "sem_progresso" };
}

// O teto de custo do pedido (FR-009b da 075; spec 077): um pedido que queima tokens sem fechar. Era 8
// mil por desejo, quando o plano rodava uma vez; com o M2 a CADA vez (~3–4 mil tokens no qwen, medido na
// bateria do caso 3), 8 mil largava o pedido na 3ª vez, muito antes do teto de 12 vezes. O padrão
// passou a 50 mil (≈ 12 vezes); `tetoTokensDesejo` segue valendo para a mesa que já o declarou.
function overBudget(tokensPagos, cfg) {
  const h = (cfg && cfg.harness) || {};
  const teto = h.tetoTokensPedido || h.tetoTokensDesejo || 50000;
  return tokensPagos > teto;
}

module.exports = { BOX, stateSignature, newKnowledge, newStep, before, after, overBudget, limits };
