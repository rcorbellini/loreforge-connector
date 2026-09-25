// ATRIBUIÇÃO — sucessor de `faixas.test.js` (spec 072/US3), depois de FR-008/FR-009
// (2026-09-23, spec 074) derrubarem a privacidade por "dono" dentro da sala.
//
// O QUE MUDOU: a mesa ouvia FATOS e cada jogador lia a INTERPRETAÇÃO do próprio
// personagem — dois canais, um privado. Isso caiu: qualquer cliente sentado à mesa
// agora pode abrir a sessão ACP de QUALQUER assento presente, narração/recusa/sistema
// inclusos (a analogia de RPG clássica do mantenedor — não existe canal secreto
// estrutural entre a mesa e um jogador específico).
//
// O QUE NÃO MUDOU, e é o que este arquivo garante no lugar da privacidade (SC-006 do
// spec.md): todo `session/update` carrega o `sessionId` CERTO — nunca a resposta de
// um personagem aterrissando na sessão de outro. É o mesmo defeito de fundo que
// `laco.js` já documentava ("um sussurro para o Coppo... fazia a resposta aparecer na
// boca de outro"), só que a garantia agora é sobre `sessionId`, não sobre `escopo`.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.LOREFORGE_CONFIG =
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "atribuicao-")), "conector.json");
process.env.LOREFORGE_LOG = "0";

const { Sala } = require("../sala");
const { Fila } = require("../fila");
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

test("074/FR-008: recusa/narração de UM personagem chegam a QUALQUER cliente da sala " +
     "(a privacidade por dono caiu)", async () => {
  const { sala, c, porta } = await mesaServida();
  const url = `http://127.0.0.1:${porta}/eventos`;
  const a = await ouvir(url, "jwt-A");   // dono só de "elga"
  const b = await ouvir(url, "jwt-B");   // dono só de "draven"
  await espera(60);

  c.emitir("recusa", { personagem: "draven", texto: "não deu" });
  c.emitir("beat", { personagem: "elga", texto: "a Elga serve a mesa" });
  await espera(100);
  a.parar(); b.parar();
  await c.fechar();

  const sessDraven = sala.sessoes.sessionIdDe("draven");
  const sessElga = sala.sessoes.sessionIdDe("elga");
  const recusasQueA_recebeu = a.recebidos.filter((r) => r.evento === "session-update"
    && r.dados.params.sessionId === sessDraven
    && r.dados.params.update.status === "completed");
  assert.ok(recusasQueA_recebeu.length > 0,
    "o cliente de A (dono só de elga) NÃO recebeu a sessão de draven — privacidade " +
    "por dono não deveria mais existir dentro da sala (FR-008)");
  const beatsQueB_recebeu = b.recebidos.filter((r) => r.evento === "session-update"
    && r.dados.params.sessionId === sessElga);
  assert.ok(beatsQueB_recebeu.length > 0,
    "o cliente de B (dono só de draven) NÃO recebeu a sessão de elga");
});

test("074/FR-006: todo session-update carrega o sessionId CERTO — nunca " +
     "a resposta de um personagem na sessão de outro", async () => {
  const { sala, c, porta } = await mesaServida();
  const url = `http://127.0.0.1:${porta}/eventos`;
  const a = await ouvir(url, "jwt-A");
  await espera(60);

  for (let i = 0; i < 10; i++) {
    c.emitir("beat", { personagem: "elga", texto: `elga ${i}` });
    c.emitir("beat", { personagem: "draven", texto: `draven ${i}` });
  }
  await espera(120);
  a.parar();
  await c.fechar();

  const sessDraven = sala.sessoes.sessionIdDe("draven");
  const sessElga = sala.sessoes.sessionIdDe("elga");
  const atualizacoes = a.recebidos.filter((r) => r.evento === "session-update");
  assert.ok(atualizacoes.length >= 20, "esperava pelo menos 20 session-update");
  for (const r of atualizacoes) {
    const texto = JSON.stringify(r.dados.params.update.content || "");
    if (texto.includes("\"elga")) {
      assert.equal(r.dados.params.sessionId, sessElga,
        `um beat da elga chegou com o sessionId de outro assento: ${r.dados.params.sessionId}`);
    }
    if (texto.includes("\"draven")) {
      assert.equal(r.dados.params.sessionId, sessDraven,
        `um beat do draven chegou com o sessionId de outro assento: ${r.dados.params.sessionId}`);
    }
  }
});

test("074: eventos FORA DE BANDA (sala/fila/entrou/saiu) continuam no formato de sempre, " +
     "para todo mundo", async () => {
  const { c, porta } = await mesaServida();
  const url = `http://127.0.0.1:${porta}/eventos`;
  const a = await ouvir(url, "jwt-A");
  await espera(60);

  c.emitir("sala", { nome: "Taverna" });
  c.emitir("beat", { personagem: "elga", texto: "x" });
  await espera(100);
  a.parar();
  await c.fechar();

  const salaEv = a.recebidos.find((r) => r.evento === "sala");
  assert.ok(salaEv, "evento 'sala' não chegou no formato de sempre");
  assert.equal(salaEv.dados.nome, "Taverna");
  const sessionUpdates = a.recebidos.filter((r) => r.evento === "session-update");
  assert.ok(sessionUpdates.length > 0, "o beat deveria ter virado session-update");
});

test("074/US1: quem não é membro não abre o fluxo de eventos (autenticação de SALA " +
     "não mudou)", async () => {
  const { c, porta } = await mesaServida();
  const r = await fetch(`http://127.0.0.1:${porta}/eventos`,
                        { headers: { Authorization: "Bearer jwt-de-estranho" } });
  assert.strictEqual(r.status, 401);
  await c.fechar();
});
