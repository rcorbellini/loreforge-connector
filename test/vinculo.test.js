// O TRECHO SOCIAL (spec 066) — o CONTRATO 2, e ele é só do conector.
//
// O servidor entrega o fato NA ENTIDADE (`bond`/`sentiment` em cada presente) e não se
// preocupa com como uma LLM lê; a redação é daqui, e é por isso que um jogador pode
// trocar o conector inteiro sem que o mundo mude.
//
// Testa as funções PURAS exportadas (`_contextoPayload`, `_cenaEmProsa`) em vez de
// interceptar o `fetch`: o caminho do sussurro monta PROSA a partir do payload, não
// manda o JSON, e um teste de fetch mediria o lugar errado. (Aprendido implementando:
// a primeira versão deste arquivo espiava o fetch e via só a prosa.)
//
// O QUE ESTES TESTES TRAVAM, e por que cada um existe:
//
//  1. A ORDEM AFETO->VÍNCULO. Medida, não intuída: nesta ordem o vínculo sobrevive
//     6-8/8 contra o llama3.1:8b; invertida, 0-1/8. O MECANISMO NÃO ESTÁ IDENTIFICADO
//     (nove variantes, duas vencedoras estruturalmente opostas, três explicações
//     falsificadas — ver `server/tests/exploracao/sondagem_slot1_frase.py`). Por ser
//     regra empírica e frágil, precisa de trava: uma reordenação "de limpeza" desfaria
//     a medição sem que nada ficasse vermelho.
//
//  2. NENHUM POSSESSIVO AMBÍGUO. "seu" em português é *dele/dela* OU *de você*; num
//     objeto que descreve outra pessoa a leitura natural inverte o eixo e devolve o que
//     o OUTRO sente — que é segredo do mundo e nunca desce.
//
//  3. QUEM NÃO QUALIFICA NÃO ENTRA, e o trecho some por inteiro quando ninguém
//     qualifica. O bloco ENCOLHE com a multidão em vez de crescer.
//
//  4. A LISTA `presentes` FICA LIMPA. Duplicar informação no mesmo prompt já custou
//     acerto aqui (o bloco `capacidades`, 2026-08-17: 4 de 9 chamadas sem tool_call).
//
//  5. O TRECHO CHEGA NA PROSA do sussurro — não basta estar no payload.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vinculo-"));
process.env.LOREFORGE_CONFIG = path.join(TMP, "conector.json");
process.env.LOREFORGE_LOG = "0";

const Mente = require("../mente");

function cena(presentes, extra = {}) {
  return {
    self: { id: "bram", name: "Bram", inventory: [] },
    location: { id: "praca", name: "Praça", narrative: "Bancas.", ...(extra.location || {}) },
    memories: [], routes: [], items_present: extra.items_present || [],
    objects_present: [], intentions: [], capacidades: [],
    characters_present: [{ id: "bram", name: "Bram", state: "self" }, ...presentes],
  };
}

const HULDA = { id: "hulda", name: "Hulda", state: "idle",
                bond: "irmã", sentiment: "guarda mágoa" };

async function ctxDe(c) {
  return (await Mente._contextoPayload(c, { comCapacidades: false })).contexto;
}

test("o AFETO vem antes do VÍNCULO — a ordem medida (6-8/8 contra 0-1/8)", async () => {
  const social = (await ctxDe(cena([HULDA]))).contexto_social;
  assert.ok(social, "o trecho social deveria existir");
  const iAfeto = social.indexOf("guarda mágoa");
  const iVinculo = social.indexOf("Hulda, irmã");
  assert.ok(iAfeto >= 0 && iVinculo >= 0, `faltou peça em: ${social}`);
  assert.ok(iAfeto < iVinculo,
    `o afeto tem de vir ANTES do vínculo (regra medida). Veio: ${social}`);
});

test("nenhum possessivo ambíguo ('seu'/'sua') aponta para o personagem", async () => {
  const social = (await ctxDe(cena([HULDA]))).contexto_social;
  assert.ok(!/\bseu\b|\bsua\b/i.test(social),
    `"seu"/"sua" é ambíguo em português e inverteria o eixo. Veio: ${social}`);
});

test("os DOIS EIXOS convivem — o irmão que se odeia", async () => {
  const social = (await ctxDe(cena([HULDA]))).contexto_social;
  assert.match(social, /irmã/, "o vínculo tem de sobreviver ao afeto negativo");
  assert.match(social, /mágoa/, "o afeto tem de sobreviver ao vínculo positivo");
});

test("só vínculo, ou só afeto, produzem texto gramatical", async () => {
  const soVinculo = (await ctxDe(cena([
    { id: "renn", name: "Renn", state: "idle", bond: "primo" },
  ]))).contexto_social;
  assert.match(soVinculo, /Renn, primo\./);

  const soAfeto = (await ctxDe(cena([
    { id: "coppo", name: "Coppo", state: "idle", sentiment: "nutre forte estima" },
  ]))).contexto_social;
  assert.match(soAfeto, /Você nutre forte estima de Coppo\./);
});

test("quem não qualifica NÃO entra, e o trecho some quando ninguém qualifica", async () => {
  const com = await ctxDe(cena([
    { id: "renn", name: "Renn", state: "idle", bond: "primo" },
    { id: "ossian", name: "Ossian", state: "idle" },
  ]));
  assert.ok(!com.contexto_social.includes("Ossian"),
    "estranho sem vínculo nem afeto não entra no trecho");

  const so = await ctxDe(cena([{ id: "ossian", name: "Ossian", state: "idle" }]));
  assert.strictEqual(so.contexto_social, undefined,
    "sem ninguém que qualifique o trecho é AUSENTE, nunca vazio");
});

test("a lista `presentes` fica LIMPA — sem repetir vínculo nem afeto", async () => {
  const ctx = await ctxDe(cena([HULDA]));
  const hulda = ctx.presentes.find((p) => p.nome === "Hulda");
  assert.ok(hulda, "Hulda deveria estar na lista");
  assert.strictEqual(hulda.bond, undefined, "vínculo não se repete na lista");
  assert.strictEqual(hulda.sentiment, undefined, "afeto não se repete na lista");
});

test("o trecho social vem ANTES de `presentes` na ordem das chaves", async () => {
  const chaves = Object.keys(await ctxDe(cena([HULDA])));
  assert.ok(chaves.indexOf("contexto_social") < chaves.indexOf("presentes"),
    `o formato foi medido com o trecho ANTES da lista. Ordem: ${chaves}`);
});

test("o vínculo com LUGAR e com ITEM desce, onde a entidade já está", async () => {
  const ctx = await ctxDe(cena([], {
    location: { bond: "terra natal" },
    items_present: [{ id: "bigorna", name: "bigorna", bond: "herança do pai" }],
  }));
  assert.strictEqual(ctx.vinculo_com_o_local, "terra natal");
  assert.strictEqual(ctx.itens_presentes[0].vinculo, "herança do pai");
});

test("sem vínculo, as chaves novas são AUSENTES — nunca null (contrato de API)", async () => {
  const ctx = await ctxDe(cena([{ id: "ossian", name: "Ossian", state: "idle" }]));
  assert.ok(!("vinculo_com_o_local" in ctx));
  assert.ok(!("contexto_social" in ctx));
});

test("NENHUM NÚMERO atravessa no trecho social (Princípio V)", async () => {
  const social = (await ctxDe(cena([HULDA]))).contexto_social;
  assert.ok(!/\d/.test(social), `saldo/intensidade nunca saem do server: ${social}`);
});

// --- o caminho do SUSSURRO monta PROSA: estar no payload não basta ---------- //

test("o trecho social CHEGA na prosa do sussurro, antes de 'Estão aqui'", async () => {
  const payload = await Mente._contextoPayload(cena([HULDA]), { comCapacidades: false });
  const prosa = Mente._cenaEmProsa(payload);
  assert.match(prosa, /guarda mágoa/, "o afeto não chegou à prosa");
  assert.match(prosa, /Hulda, irmã/, "o vínculo não chegou à prosa");
  assert.ok(prosa.indexOf("Hulda, irmã") < prosa.indexOf("Estão aqui:"),
    `o trecho tem de vir ANTES da lista. Prosa:\n${prosa}`);
});

test("o vínculo com lugar e item chega na prosa", async () => {
  const payload = await Mente._contextoPayload(cena([], {
    location: { bond: "terra natal" },
    items_present: [{ id: "bigorna", name: "bigorna", bond: "herança do pai" }],
  }), { comCapacidades: false });
  const prosa = Mente._cenaEmProsa(payload);
  assert.match(prosa, /Praça, terra natal\./);
  assert.match(prosa, /bigorna \(herança do pai\)/);
});
