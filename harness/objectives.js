// C3 · O PLANO DO TURNO — a única chamada PAGA antes de o mundo agir (spec 076).
//
// A Mente recebe a instrução e a cena em PROSA, e NUNCA o schema das tools (invariante 1
// do contrato 01). Ela devolve o plano no CONTRATO M do mantenedor: a condição do corpo, a
// postura diante do pedido, os passos marcados (ato, fala, gesto) e a fala. Só o passo ATO
// vira chamada ao mundo, e quem aponta tool e ids é o resolvedor local, de graça. Fala e
// gesto são o que ele diz e expressa: entram no racional, nunca no mundo.
//
// Saída fora do contrato é FALHA (Princípio VIII; memória "juízo ausente é falha"): não há
// volta ao formato antigo de lista, que esconderia a mesa que ficou com o prompt velho.
//
// A cena é a mesma prosa que o jogo já montava para o caminho antigo
// (`_cenaEmProsa(_contextoPayload(ctx, {comCapacidades:false}))`).

"use strict";

const BOX = "C3";
const TYPES = new Set(["ato", "fala", "gesto"]);

class PlanContractError extends Error {
  constructor(message, raw) {
    super(message);
    this.name = "PlanContractError";
    this.raw = raw;
  }
}

function _asObject(text) {
  try {
    const j = JSON.parse(text);
    return j && typeof j === "object" && !Array.isArray(j) ? j : null;
  } catch (_) {
    return null;
  }
}

// O objeto JSON da resposta: puro, entre cercas de código, ou o primeiro {…} balanceado.
// Cerca e texto em volta são FORMATO (o Gemini sem modo JSON e o Anthropic, que não tem,
// costumam cercar); não é volta a outro contrato.
function _firstObject(text) {
  const s = String(text || "").trim();
  const puro = _asObject(s);
  if (puro) return puro;
  const cerca = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cerca) {
    const j = _asObject(cerca[1].trim());
    if (j) return j;
  }
  const ini = s.indexOf("{");
  if (ini < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = ini; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === "\"") inString = false;
      continue;
    }
    if (c === "\"") inString = true;
    else if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return _asObject(s.slice(ini, i + 1));
    }
  }
  return null;
}

const _text = (v) => (typeof v === "string" ? v.trim() : "");

// `com` pode vir como lista ou como texto; o texto fica INTEIRO (nomes da cena têm vírgula:
// "Bram, o Pescador").
function _names(com) {
  if (Array.isArray(com)) return com.map((x) => _text(String(x ?? ""))).filter(Boolean);
  const t = _text(com);
  return t ? [t] : [];
}

// → { body, stance, reply, steps: [{ type, action, with, expects }] }
// `type` é "ato" | "fala" | "gesto", ou "defeito" quando o passo veio sem tipo válido ou
// sem ação: na dúvida, o passo não muda o mundo.
function parsePlan(text) {
  const obj = _firstObject(text);
  if (!obj) throw new PlanContractError("o plano não veio em JSON", text);
  const cot = obj.chain_of_thought && typeof obj.chain_of_thought === "object" ? obj.chain_of_thought : {};
  const lista = Array.isArray(cot.passos_do_plano) ? cot.passos_do_plano
    : Array.isArray(obj.passos_do_plano) ? obj.passos_do_plano : null;
  if (!lista) throw new PlanContractError("o plano não trouxe passos_do_plano", text);
  const steps = lista.map((p) => {
    const o = p && typeof p === "object" && !Array.isArray(p) ? p : {};
    const type = _text(o.tipo).toLowerCase();
    const action = _text(o.acao);
    return {
      type: TYPES.has(type) && action ? type : "defeito",
      action,
      with: _names(o.com),
      expects: _text(o.espera),
    };
  });
  return {
    body: _text(cot.condicao_fisica) || _text(obj.condicao_fisica),
    stance: _text(cot.avaliacao_de_viabilidade) || _text(obj.avaliacao_de_viabilidade),
    reply: _text(obj.resposta),
    steps,
  };
}

// O texto que o resolvedor lê: a ação e os nomes da cena que o plano listou (medido na
// V3-resolver: a ação sozinha perde o alvo quando o plano o põe só no `com`).
function actText(step) {
  return step.with.length ? `${step.action} — ${step.with.join(", ")}` : step.action;
}

async function userOf(mente, ctx, instrucao) {
  const prosa = mente._cenaEmProsa(await mente._contextoPayload(ctx, { comCapacidades: false }));
  return "O que ele faz?\n\nINSTRUÇÃO: " + instrucao + "\n\n" + prosa;
}

// → { plan, steps, cru, user } — ou lança PlanContractError (o laço registra a falha e não age)
async function objectives({ mente, ctx, instrucao, system }) {
  const user = await userOf(mente, ctx, instrucao);
  const cru = await mente.conversar(system, user,
    { rotina: "objetivos", label: "PLANO (C3)", temperature: 0.4, maxTokens: 1200, json: true });
  const plan = parsePlan(cru);
  return { plan, steps: plan.steps, cru, user };
}

module.exports = { BOX, PlanContractError, objectives, parsePlan, actText, userOf };
