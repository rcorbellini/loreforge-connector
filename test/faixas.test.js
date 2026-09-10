// AS DUAS FAIXAS DA MESA (spec 072, US3).
//
//   A mesa ouve os FATOS. Cada jogador lê a INTERPRETAÇÃO do próprio personagem.
//
// ESTE ARQUIVO EXISTE PORQUE UM VAZAMENTO DE FAIXA É INVISÍVEL A OLHO NU. A tela pode
// estar filtrando por conta própria e mascarando um vazamento no cano; a SC-004 exige,
// por escrito, que isto seja "assertado em teste, não observado". E o estrago é
// permanente: o payload de `narrate` leva `personalidade`, `memorias` e `necessidade`,
// e ninguém desfaz ter mostrado a intimidade de um personagem à mesa inteira.
//
// A terceira asserção é a que protege o FUTURO: nenhum evento sem `escopo`. Ela quebra
// no dia em que alguém acrescentar um evento e esquecer de classificá-lo — que é o modo
// de falha real, não o vazamento deliberado.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.LOREFORGE_CONFIG =
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "faixas-")), "conector.json");
process.env.LOREFORGE_LOG = "0";

const { Sala } = require("../sala");
const { Fila } = require("../fila");
const { escopoDe, _MESA } = require("../laco");
const { servir } = require("../canal");
const configuracao = require("../config");

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Lê um `text/event-stream` e acumula `{evento, dados}` até mandarem parar.
async function ouvir(url, token) {
  const ctrl = new AbortController();
  const recebidos = [];
  const res = await fetch(url, { signal: ctrl.signal,
                                 headers: { Authorization: "Bearer " + token } });
  (async () => {
    const leitor = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let corte;
        while ((corte = buf.indexOf("\n\n")) >= 0) {
          const bloco = buf.slice(0, corte);
          buf = buf.slice(corte + 2);
          const ev = /^event: (.+)$/m.exec(bloco);
          const dd = /^data: (.+)$/m.exec(bloco);
          if (ev && dd) {
            try { recebidos.push({ evento: ev[1], dados: JSON.parse(dd[1]) }); }
            catch (_) {}
          }
        }
      }
    } catch (_) { /* abortado: é o fim normal */ }
  })();
  return { recebidos, parar: () => ctrl.abort() };
}

async function mesaServida() {
  const jwts = { "jwt-A": { sub: "sub-A", email: "a@x", name: "A" },
                 "jwt-B": { sub: "sub-B", email: "b@x", name: "B" } };
  const mundoFalso = {
    validarToken: async (t) => jwts[t] || null,
    personagensDe: async (t) => (t === "jwt-A" ? [{ id: "elga" }]
                              : t === "jwt-B" ? [{ id: "draven" }] : []),
    personagens: async () => [],
  };
  const sala = new Sala({
    nome: "Taverna",
    credenciais: { ler: (s) => (s === "sub-A" ? "jwt-A" : "jwt-B"),
                   gravar: () => {}, apagar: () => {} },
    fabricas: {
      assento: async ({ personagem }) => ({
        nome: personagem, mundo: { personagem },
        mente: { custoDoTurno: () => ({ entrada: 0, saida: 0, chamadas: 0 }) },
        laco: { ocupado: false, ultimoTurnoAplicou: false,
                sussurrar: async () => {}, talvezAgirSozinho: async () => {} },
      }),
    },
  });
  sala.acrescentarMembro({ sub: "sub-A", email: "a@x", nome: "A", jwt: "jwt-A" });
  sala.acrescentarMembro({ sub: "sub-B", email: "b@x", nome: "B", jwt: "jwt-B" });
  await sala.assentar({ personagem: "elga", sub: "sub-A" });
  await sala.assentar({ personagem: "draven", sub: "sub-B" });

  const fila = new Fila({ sala });
  const c = await servir({
    porta: 0, sala, fila, cfg: {}, expor: false, authAtivo: true,
    mundo: mundoFalso, configuracao,
    painel: { ler: async () => ({}), salvar: async () => ({ ok: true }),
              gravarPrompt: () => ({ ok: true }), reiniciar: async () => ({ ok: true }) },
  });
  return { sala, fila, c, porta: c.servidor.address().port };
}


test("072/US3: a tabela de faixas é a de `contracts/eventos-sse.md`", () => {
  for (const ev of ["intencao", "intencao_inicio", "intencao_fim", "decidiu", "beat",
                    "fila", "entrou", "saiu", "sala"]) {
    assert.strictEqual(escopoDe(ev), "mesa", `${ev} deveria ser de mesa`);
  }
  for (const ev of ["narracao", "narracao_inicio", "narracao_fim", "recusa",
                    "sistema", "erro", "estado", "autonomia", "expulso"]) {
    assert.strictEqual(escopoDe(ev), "dono", `${ev} deveria ser do dono`);
  }
});

test("072/US3: evento DESCONHECIDO cai em `dono` — errar para o lado do silêncio", () => {
  // É a garantia que protege o futuro: um evento novo que ninguém classificou fica
  // PRIVADO em vez de vazar. Silêncio é recuperável; vazamento não.
  assert.strictEqual(escopoDe("um_evento_que_ainda_nao_existe"), "dono");
  assert.ok(!_MESA.has("narracao"), "a narração entrou na faixa da mesa");
});

test("072/US3: nenhum evento de DONO cruza de membro (SC-004)", async () => {
  const { c, porta } = await mesaServida();
  const url = `http://127.0.0.1:${porta}/eventos`;
  const a = await ouvir(url, "jwt-A");
  const b = await ouvir(url, "jwt-B");
  await espera(60);

  // 30 turnos de mentira, alternando os dois assentos, com as duas faixas
  for (let i = 0; i < 15; i++) {
    for (const [p] of [["elga"], ["draven"]]) {
      c.emitir("intencao", { personagem: p, escopo: "mesa", pedaco: `tenta ${i}` });
      c.emitir("beat", { personagem: p, escopo: "mesa", texto: `aconteceu ${i}` });
      c.emitir("narracao_fim", { personagem: p, escopo: "dono",
                                 texto: `INTIMIDADE de ${p} #${i}` });
      c.emitir("recusa", { personagem: p, escopo: "dono", texto: `nao deu ${i}` });
    }
  }
  await espera(120);
  a.parar(); b.parar();
  await c.fechar();

  const privadosDe = (recebidos, meu) => recebidos.filter(
    (r) => r.dados.escopo === "dono" && r.dados.personagem && r.dados.personagem !== meu);
  assert.deepStrictEqual(privadosDe(a.recebidos, "elga"), [],
    "o cliente de A recebeu a faixa privada do personagem de B");
  assert.deepStrictEqual(privadosDe(b.recebidos, "draven"), [],
    "o cliente de B recebeu a faixa privada do personagem de A");

  // e o texto íntimo não apareceu nem por engano em outro lugar
  assert.ok(!JSON.stringify(a.recebidos).includes("INTIMIDADE de draven"));
  assert.ok(!JSON.stringify(b.recebidos).includes("INTIMIDADE de elga"));
});

test("072/US3: TODO ouvinte recebe TODOS os beats — a mesa vê o que acontece", async () => {
  const { c, porta } = await mesaServida();
  const url = `http://127.0.0.1:${porta}/eventos`;
  const a = await ouvir(url, "jwt-A");
  const b = await ouvir(url, "jwt-B");
  await espera(60);

  c.emitir("beat", { personagem: "elga", escopo: "mesa", texto: "a Elga serve a mesa" });
  c.emitir("beat", { personagem: "draven", escopo: "mesa", texto: "o Draven entra" });
  c.emitir("intencao", { personagem: "draven", escopo: "mesa", pedaco: "ele se aproxima" });
  await espera(100);
  a.parar(); b.parar();
  await c.fechar();

  const beatsDe = (rs) => rs.filter((r) => r.evento === "beat").map((r) => r.dados.texto);
  assert.deepStrictEqual(beatsDe(a.recebidos).sort(),
                         ["a Elga serve a mesa", "o Draven entra"]);
  assert.deepStrictEqual(beatsDe(b.recebidos).sort(),
                         ["a Elga serve a mesa", "o Draven entra"]);
  // a TENTATIVA também é pública: é o que qualquer um na cena veria
  assert.ok(a.recebidos.some((r) => r.evento === "intencao"));
});

test("072/US3: nenhum evento chega sem `escopo`", async () => {
  const { c, porta } = await mesaServida();
  const a = await ouvir(`http://127.0.0.1:${porta}/eventos`, "jwt-A");
  await espera(60);
  c.emitir("beat", { personagem: "elga", escopo: "mesa", texto: "x" });
  c.emitir("sala", { escopo: "mesa", nome: "Taverna" });
  await espera(80);
  a.parar();
  await c.fechar();

  const semEscopo = a.recebidos.filter((r) => !r.dados.escopo);
  assert.deepStrictEqual(semEscopo, [],
    `evento sem escopo chegou à tela: ${JSON.stringify(semEscopo)}`);
});

test("072/US1: quem não é membro não abre o fluxo de eventos", async () => {
  const { c, porta } = await mesaServida();
  const r = await fetch(`http://127.0.0.1:${porta}/eventos`,
                        { headers: { Authorization: "Bearer jwt-de-estranho" } });
  assert.strictEqual(r.status, 401);
  await c.fechar();
});
