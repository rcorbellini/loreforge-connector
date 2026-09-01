// O RESOLVEDOR DE ALVO (spec 060, US2).
//
// A Mente aponta como uma pessoa aponta — "o cantil de água", "o mascate" — e
// aqui a referência vira o id canônico que a capacidade exige. Se não virar, a
// capacidade NÃO É CHAMADA: falta o mínimo que o contrato pede, e isso é um 400
// deste lado, não uma pergunta ao mundo.
//
// POR QUE ISTO MORA AQUI, e não no Motor. O conector JÁ SABE o que existe na
// cena: ele leu `tools/list` e o contexto. É a mesma justificativa que o
// `_peneira` do laço já usa para barrar capacidade INVENTADA — "nome inventado é
// falha DA MENTE, não recusa do mundo; o mundo nem chegou a julgar". Esta peça
// aplica a regra um nível abaixo, aos PARÂMETROS.
//
// O Motor mantém o `_match_scene_ref` dele, e não é duplicação por descuido: são
// jobs diferentes. O daqui decide SE CHEGA A HAVER CHAMADA; o de lá é a rede de
// segurança para qualquer outro host MCP — o stdio é porta pública e nem todo
// host terá resolvedor. As duas seguem a MESMA regra declarada, e o teste de
// conformidade cruzada existe para que não derivem.
//
// MEDIDO antes de existir (specs/060-turn-continuation-payload/baseline):
//   · com enum, alvo AMBÍGUO (3 moedas iguais) deixava a Mente MUDA 5/5;
//   · com enum, alvo AUSENTE ("examine o destilador") fazia o mundo examinar o
//     FOGÃO 5/5 — ação errada com cara de sucesso;
//   · e o enum NÃO era imposto: um id fora dele saiu 4/5 assim mesmo.

"use strict";

// --------------------------------------------------------------------------- //
// Normalização — a mesma que `motor._match_scene_ref` aplica do outro lado.
// --------------------------------------------------------------------------- //

const ACENTOS = /[̀-ͯ]/g;

function normalizar(texto) {
  return String(texto || "")
    .normalize("NFKD")
    .replace(ACENTOS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// --------------------------------------------------------------------------- //
// (1) LITERAL — determinística, sem dependência, resolve o caso comum.
// --------------------------------------------------------------------------- //

// O DESEMPATE (spec 062, US1). Empate resolve, sempre — "se dá match e empatou,
// pega um e usa; se não for apto, o Motor valida e informa" (decisão do
// mantenedor). O que NÃO pode ser sempre o mesmo é QUAL se pega: se a Mente
// insiste na mesma referência (porque o primeiro id escolhido foi recusado por
// outro motivo), repetir a mesma escolha faria a retentativa cair filtrada por
// `tentadas` (laco.js) como proposta já-dispachada, e a vez morreria do jeito
// que motivou esta spec — só que em silêncio, sem nem o recado de "ambíguo".
//
// `jaOferecidos` (Set opcional de ids) é a memória de "já dei estes nesta
// vez" — mora inteira em `mente.js:interpret()` (spec 062, research R2), não
// aqui. Preferimos um id de fora do Set; esgotado, caímos no determinístico de
// sempre (`sort()[0]`), e quem encerra a repetição a partir daí é o `tentadas`
// do laço — não este resolvedor.
function _desempatar(candidatosEmpatados, jaOferecidos) {
  const livres = jaOferecidos
    ? candidatosEmpatados.filter((c) => !jaOferecidos.has(c.id))
    : candidatosEmpatados;
  const pool = livres.length ? livres : candidatosEmpatados;
  return pool.map((c) => c.id).sort()[0];
}

// `candidatos` = [{ id, nome }]. Devolve { id, via } ou { id: null, porque }.
// `jaOferecidos` (spec 062, US1): Set opcional de ids já entregues nesta vez
// para esta MESMA referência — ver `_desempatar` acima.
function literal(referencia, candidatos, jaOferecidos) {
  const lista = (candidatos || []).filter((c) => c && c.id);
  if (!lista.length) return { id: null, porque: "sem-candidatos" };

  // id exato ganha de tudo: se ela escreveu o id, não há o que interpretar.
  const cru = String(referencia || "").trim();
  if (lista.some((c) => c.id === cru)) return { id: cru, via: "id-exato" };

  const alvo = normalizar(referencia);
  if (!alvo) return { id: null, porque: "referencia-vazia" };

  const casou = lista.filter((c) => {
    for (const campo of [c.id, c.nome]) {
      const n = normalizar(campo);
      if (n && (n === alvo || n.includes(alvo) || alvo.includes(n))) return true;
    }
    return false;
  });

  if (casou.length === 1) return { id: casou[0].id, via: "literal" };
  if (!casou.length) return { id: null, porque: "nada-casou" };

  // EMPATE, SEMPRE RESOLVE (spec 062, US1) — nunca mais `{porque: "ambiguo"}`.
  //
  // A NATUREZA do empate só decide o RÓTULO, não se resolve: cinco
  // `moeda-cobre-0XX` de MESMO nome são intercambiáveis (abundância — "guarde
  // uma moeda de cobre" tem resposta óbvia, qualquer uma); "Macieira da Praça"
  // casando com a árvore E com cinco colheitas mal-nomeadas dela são coisas
  // DIFERENTES que só parecem uma (desempate) — mas as duas escolhem pela
  // MESMA função, porque as duas correm o MESMO risco de esgotar `tentadas`
  // se a escolha nunca variar.
  const nomes = new Set(casou.map((c) => normalizar(c.nome)));
  const via = nomes.size === 1 ? "abundancia" : "desempate";
  return { id: _desempatar(casou, jaOferecidos), via, entre: casou.length };
}

// --------------------------------------------------------------------------- //
// (2) SEMÂNTICA — opcional, só quando a literal não resolveu.
// --------------------------------------------------------------------------- //

function cosseno(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return (na && nb) ? d / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

// O CORTE É PELA MARGEM, NÃO PELA SIMILARIDADE — e isso não é afinação, é o
// desenho. Um top-1 sem corte SEMPRE devolve alguma coisa, e devolver "o fogão"
// para quem pediu "o destilador" é a substituição silenciosa que a medição do
// enum registrou como o pior caso.
//
// A margem tem SIGNIFICADO, não só correlação: se a coisa existe, um candidato
// se destaca; se não existe, tudo empata em medíocre. É a versão contínua da
// regra que a camada literal já aplica ("só resolve com candidato único").
//
// Medido (nomic-embed-text, 44 candidatos, 16 referências): resolveu certo com
// margem 0,059–0,415; resolveu errado 0,002–0,019; não existia 0,005–0,044. As
// duas resoluções ERRADAS caíram junto com as ausentes — falharam para o lado
// seguro. n=16 é VIABILIDADE, não calibragem: este limiar é conservador de
// propósito, e a spec pede n maior antes de apertá-lo.
const MARGEM_MINIMA = 0.05;

function semantica(vetorRef, candidatos, vetores, margemMinima = MARGEM_MINIMA) {
  if (!vetorRef || !vetores || !vetores.length) return { id: null, porque: "sem-vetores" };
  const notas = candidatos
    .map((c, i) => ({ id: c.id, nome: c.nome, s: cosseno(vetorRef, vetores[i]) }))
    .sort((x, y) => y.s - x.s);
  if (notas.length === 1) return { id: notas[0].id, via: "semantica", margem: 1 };

  // homônimos também aqui: se o 1o e o 2o são a MESMA coisa por nome, a margem
  // colapsa por construção, e recusar seria punir abundância (ver `literal`).
  if (normalizar(notas[0].nome) === normalizar(notas[1].nome)) {
    const iguais = notas.filter((n) => normalizar(n.nome) === normalizar(notas[0].nome));
    return { id: iguais.map((n) => n.id).sort()[0], via: "abundancia-semantica",
             entre: iguais.length };
  }
  const margem = notas[0].s - notas[1].s;
  if (margem >= margemMinima) return { id: notas[0].id, via: "semantica", margem };
  return { id: null, porque: "margem-insuficiente", margem };
}

// --------------------------------------------------------------------------- //
// A CASCATA — literal primeiro, semântica só se houver com quê.
// --------------------------------------------------------------------------- //

// NÃO É FALLBACK, e a distinção importa (Princípio VIII: "nunca há substituição
// automática"). Sem modelo de embedding não há um mecanismo pior fingindo ser o
// mesmo: há uma camada A MENOS, declarada — o conector resolve menos e rejeita
// mais, e a rejeição é visível no registro e volta à Mente para ela replanejar.
function criarResolvedor({ embedder = null, margemMinima = MARGEM_MINIMA } = {}) {
  const cacheVetores = new Map();      // chave da lista -> vetores dos candidatos

  async function _vetoresDe(candidatos) {
    if (!embedder) return null;
    const chave = candidatos.map((c) => c.id).join(" ");
    if (cacheVetores.has(chave)) return cacheVetores.get(chave);
    let v = null;
    try {
      v = await embedder(candidatos.map((c) => c.nome || c.id));
    } catch (_) {
      v = null;      // embedder caiu: segue sem a camada, nunca inventa
    }
    cacheVetores.set(chave, v);
    return v;
  }

  return {
    // Devolve { id, via } quando resolve, ou { id: null, porque } quando não.
    // Nunca lança: quem chama trata `id: null` como "não há chamada a fazer".
    // `jaOferecidos` (spec 062, US1): repassado à camada literal — ver `_desempatar`.
    async resolver(referencia, candidatos, jaOferecidos) {
      const lit = literal(referencia, candidatos, jaOferecidos);
      if (lit.id) return lit;
      if (lit.porque === "sem-candidatos" || lit.porque === "referencia-vazia") return lit;
      if (!embedder) return { ...lit, semSemantica: true };
      const vet = await _vetoresDe(candidatos);
      if (!vet) return lit;
      let vr;
      try {
        vr = (await embedder([String(referencia || "")]))[0];
      } catch (_) {
        return lit;
      }
      const sem = semantica(vr, candidatos, vet, margemMinima);
      return sem.id ? sem : { ...lit, semantica: sem.porque, margem: sem.margem };
    },
    limparCache() { cacheVetores.clear(); },
  };
}

module.exports = { criarResolvedor, literal, semantica, normalizar, MARGEM_MINIMA };
