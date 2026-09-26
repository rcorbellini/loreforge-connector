// C6 · QUAL CAPACIDADE realiza o objetivo — decisor local, 0 token pago.
//
// Porta de `v1/decisor.py::escolher_tool_v1` + `pista_verbo` e `v1/regras.py::_refs` /
// `filtro_por_alvos` (B5: NOVO 42/47, NENHUMA indevida 2, −39% de tokens locais).
//
//   1. PISTA DO VERBO: as descrições das tools começam pelo verbo ("Come um item…"), e o
//      objetivo também ("Come o Bocado"). Radical igual e ÚNICO → essa tool, sem perguntar.
//   2. FILTRO POR ALVO, pela UNIÃO: tools cujo parâmetro de referência aceita ALGUM alvo
//      citado, mais as que não têm referência nenhuma (dormir, consultas). A interseção
//      perdia a tool certa (alvo incidental, contêiner).
//   3. O DECISOR escolhe entre as filtradas, com a opção NENHUMA.
//   4. NENHUMA venceu? Repete com TODAS antes de subir: o filtro acelera quando acerta e
//      não trava quando erra.
//
// Nada disto gera nome: o decisor lê a LETRA de uma opção que existe na face.

"use strict";

const { norm, radical } = require("./text");

const BOX = "C6";
const NENHUMA = "(nenhuma)";
const DESC_NENHUMA = "Nenhuma destas capacidades realiza o passo.";

// parâmetro → enum (inclusive dentro de listas), fora `prosa`.
function refsOf(tool) {
  const props = ((tool.inputSchema || tool.parameters || {}).properties) || {};
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    if (k === "prosa" || !v || typeof v !== "object") continue;
    if (Array.isArray(v.enum)) out[k] = v.enum;
    else if (v.items && Array.isArray(v.items.enum)) out[k] = v.items.enum;
  }
  // parâmetro marcado como referência pelo mundo (braço B), mesmo sem enum no schema
  const by = (tool.annotations && tool.annotations.byName) || null;
  if (by && typeof by === "object" && !Array.isArray(by)) {
    for (const [k, pares] of Object.entries(by)) {
      if (!out[k] && pares && typeof pares === "object") out[k] = Object.keys(pares);
    }
  }
  return out;
}

function _nomesAceitos(tool) {
  const by = (tool.annotations && tool.annotations.byName) || {};
  const nomes = new Set();
  if (by && typeof by === "object" && !Array.isArray(by)) {
    for (const tab of Object.values(by)) {
      if (tab && typeof tab === "object") for (const n of Object.values(tab)) nomes.add(norm(n));
    }
  }
  return nomes;
}

function _aceita(tool, alvo) {
  const refs = refsOf(tool);
  if (!Object.keys(refs).length) return false;
  const ids = new Set(Object.values(refs).flat());
  if (alvo.id && ids.has(alvo.id)) return true;
  return !!(alvo.nome && _nomesAceitos(tool).has(norm(alvo.nome)));
}

function candidates(tools, alvos) {
  const semRef = tools.filter((t) => !Object.keys(refsOf(t)).length).map((t) => t.name);
  const porAlvo = [];
  for (const a of alvos) for (const t of tools) if (_aceita(t, a)) porAlvo.push(t.name);
  return [...new Set(porAlvo.concat(semRef))];
}

function verbHint(tools, texto) {
  const m = new Map();
  for (const t of tools) {
    const d = norm(t.description || "");
    if (!d) continue;
    const r = radical(d.split(" ")[0]);
    if (!m.has(r)) m.set(r, []);
    m.get(r).push(t.name);
  }
  const ws = norm(texto).split(" ").filter(Boolean);
  const c = ws.length ? (m.get(radical(ws[0])) || []) : [];
  return c.length === 1 ? c[0] : null;
}

function _opcoes(nomes, descPorNome) {
  return nomes.map((n) => [n, `${n}: ${String(descPorNome[n] || "").slice(0, 220)}`]);
}

// → { tool, subiu?, decisao, candidatas, pista, abriu }
async function chooseTool({ texto, tools, alvos, decider, pergunta }) {
  const descPorNome = Object.fromEntries(tools.map((t) => [t.name, t.description || ""]));
  const pista = verbHint(tools, texto);
  if (pista) {
    return { tool: pista, candidatas: [pista], pista: true, abriu: false,
             decisao: { vencedora: pista, margem: null, via: "pista do verbo", descartadas: [] } };
  }
  const cand = candidates(tools, alvos);
  const extra = [NENHUMA, DESC_NENHUMA];
  const evid = { passo_do_roteiro: texto };
  let r = cand.length
    ? await decider.tournament(evid, pergunta, _opcoes(cand, descPorNome), extra)
    : { vencedora: NENHUMA, margem: null, ranking: [] };
  let abriu = false;
  if (r.vencedora === NENHUMA) {
    const todas = tools.map((t) => t.name);
    r = await decider.tournament(evid, pergunta, _opcoes(todas, descPorNome), extra);
    abriu = true;
  }
  const decisao = { vencedora: r.vencedora, margem: r.margem,
                    descartadas: (r.ranking || []).slice(1, 4).map(([id, p]) => [id, Number(p.toFixed(3))]) };
  if (r.vencedora === NENHUMA) {
    // Sem verbo de ato nenhum do mundo no texto, é GESTO (narrável); com verbo, falta tool.
    return { tool: null, subiu: alvos.length ? "sem_tool" : "gesto", candidatas: cand, abriu, pista: false, decisao };
  }
  return { tool: r.vencedora, candidatas: cand, abriu, pista: false, decisao };
}

module.exports = { BOX, NENHUMA, refsOf, candidates, verbHint, chooseTool };
