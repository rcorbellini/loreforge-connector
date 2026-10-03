// C3 · O PLANO E O PENSAR DO PEDIDO — a única chamada PAGA antes de o mundo agir (specs 076 e 077).
//
// A Mente recebe a instrução e a cena em PROSA, e NUNCA o schema das tools (invariante 1
// do contrato 01). Ela devolve o plano no CONTRATO M2 do mantenedor: a postura diante do
// pedido (com o corpo numa frase), os passos marcados (ato, fala, gesto), o que ainda falta
// além desta cena (`depois`), o fato que fecha o pedido (`pronto_quando`) e a fala. Só o passo
// ATO vira chamada ao mundo, e quem aponta tool e ids é o resolvedor local, de graça. Fala e
// gesto são o que ele diz e expressa: entram no racional, nunca no mundo.
//
// Na vez N de um pedido aberto (spec 077), o ANDAMENTO chega como dado no `user` — o que ele
// já fez e o que o mundo respondeu, o que faltava, a sugestão do jogador, o pedido anterior — e
// o prompt não muda (medido em `ferramentas/harness-objetivos/v2/V4-andamento/`).
//
// Saída fora do contrato é FALHA (Princípio VIII; memória "juízo ausente é falha"): não há
// volta ao formato antigo de lista, que esconderia a mesa que ficou com o prompt velho.
//
// A cena é a mesma prosa que o jogo já montava para o caminho antigo
// (`_cenaEmProsa(_contextoPayload(ctx, {comCapacidades:false}))`).

"use strict";

const { extractEnding } = require("./ending");

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

// O que ainda falta (spec 077): só os itens que são texto. Lista ausente, ou que não é lista, não
// é inventada — vale "nada a carregar", e o defeito vai ao registro.
// Um item que só NEGA ("Nenhum passo adicional necessário", "nada mais") é a lista vazia dita em
// palavras (o qwen, na bateria do caso 3): não carrega nada.
const _SO_NEGA = /^(nenhum|nenhuma|nada)\b/i;

function _later(v, defects) {
  if (!Array.isArray(v)) { defects.push("depois"); return []; }
  return v.map((x) => _text(x)).filter((x) => x && !_SO_NEGA.test(x));
}

// O fato que fecha (spec 077): uma das formas do C8D, ou "nenhum". Fora das formas, ou ausente,
// vale "nenhum" com o defeito registrado — nunca um fato adivinhado.
function _doneWhen(v, defects) {
  const t = _text(v);
  if (!t) { defects.push("pronto_quando"); return "nenhum"; }
  if (/^nenhum[a]?\.?$/i.test(t)) return "nenhum";
  if (extractEnding(t).familia === "nenhuma") { defects.push("pronto_quando"); return "nenhum"; }
  return t.replace(/\.$/, "");
}

// → { stance, reply, steps: [{ type, action, with, expects }], later, doneWhen, defects }
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
  const defects = [];
  const later = _later(cot.depois !== undefined ? cot.depois : obj.depois, defects);
  const doneWhen = _doneWhen(cot.pronto_quando !== undefined ? cot.pronto_quando : obj.pronto_quando, defects);
  return {
    stance: _text(cot.avaliacao_de_viabilidade) || _text(obj.avaliacao_de_viabilidade),
    reply: _text(obj.resposta),
    steps,
    later,
    doneWhen,
    defects,
  };
}

// O texto que o resolvedor lê: a ação e os nomes da cena que o plano listou (medido na
// V3-resolver: a ação sozinha perde o alvo quando o plano o põe só no `com`).
function actText(step) {
  return step.with.length ? `${step.action} — ${step.with.join(", ")}` : step.action;
}

// O ANDAMENTO da vez N (contrato `specs/077-ciclo-do-pedido/contracts/andamento.md`):
//   { antes: [palavras anteriores do jogador], feito: [linhas "ação → o que o mundo disse"],
//     faltava: [o último `depois`], sugestao: "o que o jogador sugeriu na intervenção" }
// Quando o jogador fala de novo (há `antes`), o "O QUE FALTAVA" NÃO vai: era o plano do pedido
// velho e, medido, puxava o personagem para ele por cima do sussurro novo (V4-andamento, V7).
function andamentoText(andamento) {
  const a = andamento || {};
  const partes = [];
  const antes = (a.antes || []).map(_text).filter(Boolean);
  if (antes.length) partes.push("ANTES, O JOGADOR TINHA PEDIDO: " + antes.join(" · "));
  const bloco = [];
  const feito = (a.feito || []).map(_text).filter(Boolean);
  if (feito.length) bloco.push("O QUE ELE JÁ FEZ POR ESTE PEDIDO:\n" + feito.map((f) => "- " + f).join("\n"));
  const faltava = (a.faltava || []).map(_text).filter(Boolean);
  if (faltava.length && !antes.length) bloco.push("O QUE FALTAVA:\n" + faltava.map((f) => "- " + f).join("\n"));
  if (_text(a.sugestao)) bloco.push("O JOGADOR SUGERIU: " + _text(a.sugestao));
  if (bloco.length) partes.push(bloco.join("\n"));
  return partes.join("\n\n");
}

async function userOf(mente, ctx, instrucao, andamento) {
  const prosa = mente._cenaEmProsa(await mente._contextoPayload(ctx, { comCapacidades: false }));
  const extra = andamentoText(andamento);
  return "O que ele faz?\n\nINSTRUÇÃO: " + instrucao + "\n\n" + (extra ? extra + "\n\n" : "") + prosa;
}

// → { plan, steps, cru, user } — ou lança PlanContractError (o laço registra a falha e não age)
async function objectives({ mente, ctx, instrucao, system, andamento }) {
  const user = await userOf(mente, ctx, instrucao, andamento);
  const cru = await mente.conversar(system, user,
    { rotina: "objetivos", label: "PLANO (C3)", temperature: 0.4, maxTokens: 1200, json: true });
  const plan = parsePlan(cru);
  return { plan, steps: plan.steps, cru, user };
}

module.exports = { BOX, PlanContractError, objectives, parsePlan, actText, userOf, andamentoText };
