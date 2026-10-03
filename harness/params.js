// C7 · OS PARÂMETROS, um a um — só entre os valores que existem.
//
// Porta de `v1/decisor.py::preencher_v1` com `PRIMEIRO_SEM_LUGAR_INDISP` ligado (B6:
// NOVO 28/30 contra 21/30 pela ordem do texto; 2+ parâmetros 15/16).
//
//   · candidatos de um parâmetro = ids do enum cujo NOME foi citado (homônimos inclusive);
//   · 1 candidato → atribui; 2+ → o DONO citado desempata; senão, o decisor escolhe com
//     rótulo de dono/lugar ("Moeda de Prata (com Coppo)");
//   · o OBJETO DO VERBO é o 1º citado: se ele não coube em parâmetro nenhum, outro item
//     ocupou o lugar dele (a Bolsinha no lugar da Faca) — SOBE, nunca troca em silêncio;
//   · nada citado e o parâmetro é obrigatório → o decisor escolhe no enum inteiro.
//
// Texto livre (`sobre`, `content`, `fala`…) sai da prosa do objetivo, nunca de um id.

"use strict";

const { norm, base } = require("./text");
const { refsOf } = require("./tool");
const { labels } = require("./scene");

const BOX = "C7";

function _schema(tool) {
  const s = tool.inputSchema || tool.parameters || {};
  return { props: s.properties || {}, req: (s.required || []).filter((k) => k !== "prosa") };
}

function _nomeDe(tool, param, id, rot) {
  const by = (tool.annotations && tool.annotations.byName) || {};
  const tab = (by && by[param]) || {};
  return tab[id] || (rot[id] || "").replace(/\s*\(.*\)$/, "") || id;
}

async function _escolher(decider, pergunta, texto, toolName, ops) {
  if (ops.length === 1) return { vencedora: ops[0][0], margem: null, ranking: [[ops[0][0], 1, 0]] };
  return decider.tournament({ passo: texto, capacidade: toolName }, pergunta, ops.slice(0, 64));
}

// O ASSUNTO de um parâmetro de texto livre (`sobre`, `fala`…). Mandar o objetivo inteiro
// ("Conversar com Bruna para entender o que ela precisa") foi o que o caso 2 no conector
// real mostrou: a pergunta chega ao mundo sem assunto. Ordem: o que vem depois de
// "sobre"/"a respeito de"; senão, o alvo citado que sobrou (quem não coube em parâmetro);
// senão, o objetivo como veio.
// → { value, found }. `found` é falso quando nada indicou o assunto e o valor é o objetivo
// inteiro. A busca do "sobre" olha só a AÇÃO: no plano M (spec 076) o texto do resolvedor é
// "ação — nomes do com", e os nomes da cena não são o assunto.
function subjectOf(texto, sobra) {
  const acao = String(texto || "").split(" — ")[0];
  const m = acao.match(/\b(?:sobre|a respeito d[eoa]s?|acerca d[eoa]s?)\s+(.+)$/i);
  if (m && m[1].trim()) return { value: m[1].trim().replace(/[.!?]+$/, ""), found: true };
  if (sobra && sobra.length) return { value: sobra[0].nome, found: true };
  return { value: texto, found: false };
}

function assunto(texto, sobra) {
  return subjectOf(texto, sobra).value;
}

// → { args, subiu?, decisoes: {param: decisao} }
async function fillParams({ texto, tool, citados, ctx, decider, pergunta }) {
  const refs = refsOf(tool);
  const { props, req } = _schema(tool);
  const rot = labels(ctx);
  const nomesCit = new Set(citados.map((a) => base(a.nome)));
  const idsCit = new Set(citados.map((a) => a.id).filter(Boolean));
  const casa = (id, nome) => idsCit.has(id) || nomesCit.has(norm(nome)) || nomesCit.has(base(nome));

  const cands = {};
  for (const [p, en] of Object.entries(refs)) {
    cands[p] = en.filter((id) => casa(id, _nomeDe(tool, p, id, rot)));
  }
  const args = {};
  const decisoes = {};
  const usados = new Set();
  const perguntaDe = (p) => String(pergunta || "")
    .replace("{papel}", p).replace("{tool}", tool.name)
    .replace("{desc}", String((props[p] && props[p].description) || "").slice(0, 120));

  for (const [p, en] of Object.entries(refs)) {
    const cand = cands[p].filter((i) => !usados.has(i));
    if (cand.length === 1) {
      args[p] = cand[0];
      decisoes[p] = { vencedora: cand[0], via: "único citado" };
    } else if (cand.length > 1) {
      // homônimos: o texto cita o DONO ("…do Coppo") e uma opção é dele → ela vence
      const outros = citados.filter((a) => !cand.includes(a.id)).map((a) => base(a.nome));
      const donos = cand.filter((i) => outros.some((o) => o && norm(rot[i] || "").includes(`com ${o}`)));
      if (donos.length === 1) {
        args[p] = donos[0];
        decisoes[p] = { vencedora: donos[0], via: "regra do dono" };
      } else {
        const ops = cand.slice(0, 16).map((i) => [i, rot[i] || `${_nomeDe(tool, p, i, rot)} (na cena)`]);
        const r = await _escolher(decider, perguntaDe(p), texto, tool.name, ops);
        args[p] = r.vencedora;
        decisoes[p] = { vencedora: r.vencedora, margem: r.margem, via: "decisor",
                        descartadas: (r.ranking || []).slice(1, 4).map(([id, pr]) => [id, Number(pr.toFixed(3))]) };
      }
    } else if (req.includes(p) && en.length && !en.some((i) => Object.prototype.hasOwnProperty.call(rot, i))) {
      // R3/R5 (spec 076): escolher do conjunto inteiro só vale para o que NÃO é da cena (as
      // lembranças do accuse, do sing, do write, que o passo descreve em prosa). Pessoa, item,
      // objeto, saída ou lugar que o passo não citou fica vazio e a chamada sobe: era daqui que
      // saíam as trocas silenciosas medidas (carry do Bramm sem o Bramm no passo, o stow do
      // Atiçador de outro, o expulsar pela saída que ninguém disse).
      const ops = en.map((i) => [i, rot[i] || _nomeDe(tool, p, i, rot)]);
      const r = await _escolher(decider, perguntaDe(p), texto, tool.name, ops);
      args[p] = r.vencedora;
      decisoes[p] = { vencedora: r.vencedora, margem: r.margem, via: "decisor (enum inteiro)" };
    }
    if (args[p] !== undefined) usados.add(args[p]);
    // parâmetro de LISTA (materiais, ingredientes): vai como lista
    const esq = props[p] || {};
    if (args[p] !== undefined && esq.type === "array") {
      const todos = cands[p].length ? cands[p] : [args[p]];
      args[p] = [...new Set(todos)];
    }
  }

  // O OBJETO DO VERBO não coube em parâmetro nenhum → sobe (B6 v2).
  if (citados.length && Object.keys(refs).length) {
    const p1 = citados[0];
    const valores = Object.values(args).flat();
    const cabe = valores.some((v) => v === p1.id || base(_nomeDe(tool, "", v, rot)) === base(p1.nome)
      || Object.keys(refs).some((p) => base(_nomeDe(tool, p, v, rot)) === base(p1.nome)));
    if (!cabe) return { args: null, subiu: "alvo_ausente", decisoes, objeto: p1.nome };
  }
  // obrigatório de referência que ficou vazio: a chamada não se monta
  const faltando = req.filter((p) => refs[p] && args[p] === undefined);
  if (faltando.length) return { args: null, subiu: "alvo_ausente", decisoes, faltando };

  // texto livre obrigatório: a prosa do objetivo (ou o nome do alvo que sobrou)
  const sobra = citados.filter((a) => !Object.values(args).flat().includes(a.id));
  for (const p of req) {
    if (args[p] !== undefined || refs[p]) continue;
    const esq = props[p] || {};
    if (esq.type === "boolean") args[p] = false;
    else if (esq.type === "number" || esq.type === "integer") continue;
    else if (esq.type === "string" || !esq.type) {
      const sub = subjectOf(texto, sobra);
      // R2 (spec 076): um "sobre" sem assunto não é pergunta. O passo que o decisor levou a uma
      // pergunta ("pede ajuda para coletar materiais") é um ATO que nenhuma capacidade cobre: o
      // sinal de tool ausente, e não uma pergunta vazia ao mundo.
      if (p === "sobre" && !sub.found) return { args: null, subiu: "sem_tool", decisoes };
      args[p] = sub.value;
    }
  }
  args.prosa = { acao: texto };
  return { args, decisoes };
}

module.exports = { BOX, fillParams, assunto, subjectOf };
