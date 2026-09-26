// O DESEJO — o world GUARDA, o harness DECIDE (opção 2, decidida em 25/09).
//
// Duas metades, uma por camada (`docs/fluxo-do-contrato.md`, as três camadas):
//
//   · no WORLD, a intenção em PROSA: o desejo, o plano em passos e o fim —
//       "Conseguir o Ungüento de Arnica do Obadiah.
//        - Ir até o Obadiah na Praça do Mercado
//        - Comprar o Ungüento
//        Pronto quando: posse de Ungüento de Arnica."
//     É o que atravessa de um conector para outro (a portabilidade que motivou a opção 2).
//
//   · no CONECTOR, o CADERNO: passo corrente, tentativas, estados vistos, tokens pagos,
//     bloqueio, janela de intervenção. É estado que o harness escreve — não verdade do
//     mundo —, e por isso não vai para o `.md` da intenção. Perdido o caderno, o desejo,
//     o plano e o fim voltam a ser derivados da prosa.
//
// O caderno nunca contradiz o world: o que não está mais ativo lá é arquivado aqui, e se
// o `content` mudou (o jogador editou pelo client), passos e fim são re-derivados.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const { extractEnding } = require("./ending");

function dir() {
  return process.env.LOREFORGE_HARNESS_DIR || path.join(os.homedir(), ".loreforge", "harness");
}

function _arquivo(personagem) {
  return path.join(dir(), `${String(personagem).replace(/[^a-z0-9_-]+/gi, "_")}.json`);
}

// --- a prosa da intenção ------------------------------------------------------- //

function parseContent(content) {
  const linhas = String(content || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const passos = [];
  const cabeca = [];
  let fim = null;
  for (const l of linhas) {
    const m = l.match(/^pronto quando:\s*(.+?)\.?$/i);
    if (m) { fim = m[1].trim(); continue; }
    if (/^[-*•]\s*\S/.test(l) || /^\d+[.)]\s*\S/.test(l)) {
      passos.push(l.replace(/^([-*•]|\d+[.)])\s*/, "").trim());
    } else if (!passos.length) cabeca.push(l);
  }
  return { desejo: cabeca.join(" ").replace(/\.$/, "") || String(content || "").split("\n")[0],
           passos, fim };
}

function formatContent(desejo, passos, fimTexto) {
  let s = String(desejo || "").trim().replace(/\.?$/, ".");
  if (passos && passos.length) s += "\n" + passos.map((p) => `- ${p}`).join("\n");
  if (fimTexto && !/^nenhum/i.test(fimTexto)) s += `\nPronto quando: ${fimTexto}.`;
  return s;
}

const _hash = (s) => crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 10);

// --- o caderno ---------------------------------------------------------------- //

class Notebook {
  constructor(personagem) {
    this.personagem = personagem;
    this.dados = { versao: 1, personagem, desejos: {}, arquivados: {} };
    this._carregar();
  }

  _carregar() {
    try {
      const d = JSON.parse(fs.readFileSync(_arquivo(this.personagem), "utf8"));
      if (d && d.desejos) this.dados = { arquivados: {}, ...d };
    } catch (_) { /* primeira vez, ou ilegível: começa vazio (re-derivável do world) */ }
  }

  salvar() {
    if (!this.personagem) return;   // sem dono, não há caderno (nada de `undefined.json`)
    try {
      fs.mkdirSync(dir(), { recursive: true });
      const alvo = _arquivo(this.personagem);
      fs.writeFileSync(alvo, JSON.stringify(this.dados, null, 1) + "\n", { mode: 0o600 });
    } catch (_) { /* o jogo vale mais que o caderno: perdido, re-deriva */ }
  }

  // Alinha com o world: `intentions` é `self.intentions` do contexto (só as ativas).
  sync(intentions) {
    const ativas = new Map((intentions || []).filter((i) => i && i.id).map((i) => [i.id, i]));
    for (const id of Object.keys(this.dados.desejos)) {
      if (!ativas.has(id)) {
        this.dados.arquivados[id] = { ...this.dados.desejos[id], arquivado_em: new Date().toISOString() };
        delete this.dados.desejos[id];
      }
    }
    for (const [id, i] of ativas) {
      const h = _hash(i.content);
      const d = this.dados.desejos[id];
      if (d && d.content_hash === h) continue;
      const p = parseContent(i.content);
      this.dados.desejos[id] = {
        id, desejo: p.desejo, passos: p.passos, fim: extractEnding(p.fim, i),
        content_hash: h, passo_atual: 0, step: null, tentativas: (d && d.tentativas) || [],
        tokens_pagos: (d && d.tokens_pagos) || 0, bloqueio: null, intervencao: null, sombra: [],
        criado_em: (d && d.criado_em) || new Date().toISOString(),
      };
    }
    this.salvar();
    return this.ativo();
  }

  // O desejo em que ele trabalha: o MAIS RECENTE ativo (um de cada vez, como o tick).
  //
  // Era o mais antigo, e o caso 2 no conector real (26/09) mostrou o estrago: os
  // personagens carregam intenções velhas no world ("Análise o contexto e decida o que
  // achar melhor", do Draven, ativa há semanas), e o harness andava ESSAS em vez do
  // desejo que acabou de nascer — pelo jogador ou pelo próprio tick. O desejo novo é a
  // vontade de agora. A idade vem do id da intenção (`int-<epoch ms>-…`), que é o
  // instante em que o world a criou; sem ele, a hora em que o caderno a viu.
  ativo() {
    const quando = (d) => {
      const m = String(d.id || "").match(/^int-(\d{10,13})/);
      if (m) return Number(m[1].length === 10 ? m[1] + "000" : m[1]);
      return Date.parse(d.criado_em) || 0;
    };
    const ds = Object.values(this.dados.desejos);
    ds.sort((a, b) => quando(b) - quando(a));
    return ds[0] || null;
  }

  get(id) { return this.dados.desejos[id] || null; }

  // Depois de um `update` no world, o novo `content` já é o do plano: guarda o hash para o
  // próximo `sync` não zerar o passo à toa.
  replan(id, passos, fim, content) {
    const d = this.get(id);
    if (!d) return;
    d.passos = passos;
    d.fim = fim;
    d.passo_atual = 0;
    d.step = null;
    d.bloqueio = null;
    d.intervencao = null;
    d.content_hash = _hash(content);
    this.salvar();
  }

  attempt(id, t) {
    const d = this.get(id);
    if (!d) return;
    d.tentativas.push({ ...t, instante: new Date().toISOString() });
    if (d.tentativas.length > 60) d.tentativas = d.tentativas.slice(-60);
    this.salvar();
  }

  pay(id, tokens) {
    const d = this.get(id);
    if (!d || !tokens) return;
    d.tokens_pagos += tokens;
    this.salvar();
  }

  foto(id) {
    const d = this.get(id);
    if (!d) return null;
    return { id: d.id, desejo: d.desejo, passo: d.passo_atual, passos: d.passos.length,
             fim: d.fim && d.fim.texto, bloqueio: d.bloqueio, tokens_pagos: d.tokens_pagos };
  }
}

module.exports = { Notebook, parseContent, formatContent, dir };
