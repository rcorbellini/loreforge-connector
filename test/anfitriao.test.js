// OS PODERES DO ANFITRIÃO, pelas rotas de verdade (spec 072, US5).
//
// Duas coisas aqui não são "comportamento", são garantias:
//
//  · **expulsar apaga a credencial.** Achado da Fase 0: o JWT do mundo não tem `exp`
//    (`auth.py`) e o mundo não tem revogação individual. A cópia guardada nesta máquina
//    é permanente até alguém apagá-la, e expulsar é o único caminho que apaga.
//  · **bloquear não silencia o jogador.** Conter o gasto e conter a pessoa são atos
//    diferentes; só o segundo é expulsão. Um bloqueio que também calasse o dono seria
//    uma expulsão disfarçada, e ninguém entenderia por que o sussurro parou.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "anfitriao-"));
process.env.LOREFORGE_CONFIG = path.join(TMP, "conector.json");
process.env.LOREFORGE_LOG = "0";

const { Sala } = require("../sala");
const { Fila } = require("../fila");
const { servir } = require("../canal");
const configuracao = require("../config");

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function mesa() {
  // config de verdade: é ela que prova que a credencial some do DISCO, não só da memória
  fs.writeFileSync(process.env.LOREFORGE_CONFIG, JSON.stringify({
    mundo: "http://x", canal: 0 }), "utf8");
  const cfg = configuracao.carregar(true);
  const creds = configuracao.credenciais(cfg);

  const jwts = { "jwt-A": { sub: "sub-A", email: "a@x", name: "A" },
                 "jwt-B": { sub: "sub-B", email: "b@x", name: "B" } };
  const mundoFalso = {
    validarToken: async (t) => jwts[t] || null,
    personagensDe: async (t) => (t === "jwt-A" ? [{ id: "elga" }] : [{ id: "draven" }]),
    personagens: async () => [],
  };
  const jogadas = [];
  const sala = new Sala({
    nome: "Taverna", credenciais: creds,
    fabricas: {
      assento: async ({ personagem }) => ({
        nome: personagem, mundo: { personagem },
        mente: { custoDoTurno: () => ({ entrada: 0, saida: 0, chamadas: 0 }) },
        laco: { ocupado: false, ultimoTurnoAplicou: true,
                sussurrar: async (t) => { jogadas.push([personagem, t]); },
                talvezAgirSozinho: async () => { jogadas.push([personagem, null]); } },
      }),
    },
  });
  sala.acrescentarMembro({ sub: "sub-A", email: "a@x", nome: "A", jwt: "jwt-A" });
  sala.acrescentarMembro({ sub: "sub-B", email: "b@x", nome: "B", jwt: "jwt-B" });
  await sala.assentar({ personagem: "elga", sub: "sub-A" });
  await sala.assentar({ personagem: "draven", sub: "sub-B" });

  const fila = new Fila({ sala });
  const c = await servir({
    porta: 0, sala, fila, cfg, expor: false, authAtivo: true,
    mundo: mundoFalso, configuracao,
    painel: { ler: async () => ({}), salvar: async () => ({ ok: true }),
              gravarPrompt: () => ({ ok: true }), reiniciar: async () => ({ ok: true }) },
  });
  const base = `http://127.0.0.1:${c.servidor.address().port}`;
  const post = (rota, corpo, token) => fetch(base + rota, {
    method: "POST", headers: { "Content-Type": "application/json",
                               ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: JSON.stringify(corpo || {}) });
  return { sala, fila, c, cfg, base, post, jogadas };
}


test("072/US5: bloquear tira da fila e NÃO toca a vontade do dono", async () => {
  const { sala, fila, c, post } = await mesa();
  await post("/autonomia", { personagem: "draven", ligado: true }, "jwt-B");
  // A PISTA OCUPADA VEM ANTES: com ela livre, `enfileirar` serve na hora e a entrada
  // sai da fila antes de o bloqueio chegar — não haveria o que este teste observa.
  fila.jogando = "elga";
  fila.enfileirar({ personagem: "draven", classe: "autonoma" });
  assert.strictEqual(fila.entradas.length, 1);

  const r = await post("/sala/autonomia-permitida",
                       { personagem: "draven", permitido: false, motivo: "mesa lenta" });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(fila.entradas.length, 0, "o bloqueado continuou na fila");
  const a = sala.assentoDe("draven").autonomia;
  assert.strictEqual(a.permitido, false);
  assert.strictEqual(a.ligado, true, "o bloqueio apagou a vontade do dono");
  assert.strictEqual(a.motivo, "mesa lenta");
  await c.fechar();
});

test("072/US5: bloqueio SEM motivo é recusado — silêncio é o que o VIII proíbe", async () => {
  const { c, post } = await mesa();
  const r = await post("/sala/autonomia-permitida",
                       { personagem: "draven", permitido: false });
  assert.strictEqual(r.status, 400);
  assert.match((await r.json()).erro, /motivo/);
  await c.fechar();
});

test("072/US5: bloquear autonomia NÃO silencia o jogador", async () => {
  const { c, post, jogadas } = await mesa();
  await post("/sala/autonomia-permitida",
             { personagem: "draven", permitido: false, motivo: "segura aí" });
  const r = await post("/sussurro", { personagem: "draven", texto: "eu falo mesmo assim" },
                       "jwt-B");
  assert.strictEqual(r.status, 202);
  await espera(60);
  assert.ok(jogadas.some(([p, t]) => p === "draven" && t === "eu falo mesmo assim"),
            "bloquear a autonomia calou o dono — isso é expulsão, não bloqueio");
  await c.fechar();
});

test("072/US6: o dono não liga o autônomo por cima do bloqueio (409 com o motivo)", async () => {
  const { c, post } = await mesa();
  await post("/sala/autonomia-permitida",
             { personagem: "draven", permitido: false, motivo: "castigo" });
  const r = await post("/autonomia", { personagem: "draven", ligado: true }, "jwt-B");
  assert.strictEqual(r.status, 409);
  assert.match((await r.json()).erro, /castigo/);
  await c.fechar();
});

test("072/US5: expulsar apaga o JWT do PROCESSO e do DISCO (SC-011)", async () => {
  const { sala, c, cfg, post } = await mesa();
  assert.strictEqual(sala.jwtDe("sub-B"), "jwt-B");

  const r = await post("/sala/expulsar", { sub: "sub-B" });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual((await r.json()).personagens, ["draven"]);

  assert.strictEqual(sala.membro("sub-B"), null);
  assert.strictEqual(sala.assentoDe("draven"), null);
  assert.strictEqual(sala.jwtDe("sub-B"), null);
  assert.strictEqual((cfg.jwtPorMembro || {})["sub-B"], undefined);

  const noDisco = fs.readFileSync(process.env.LOREFORGE_CONFIG, "utf8");
  assert.ok(!noDisco.includes("jwt-B"),
            "a credencial do expulso ficou no disco — e ela não expira");
  await c.fechar();
});

test("072/US5: o expulso não joga mais, e nem lê a sala", async () => {
  const { c, post } = await mesa();
  await post("/sala/expulsar", { sub: "sub-B" });

  const sussurro = await post("/sussurro", { personagem: "draven", texto: "oi" }, "jwt-B");
  assert.strictEqual(sussurro.status, 403);
  const sala = await fetch(c.servidor.address()
    ? `http://127.0.0.1:${c.servidor.address().port}/sala` : "",
    { headers: { Authorization: "Bearer jwt-B" } });
  assert.strictEqual(sala.status, 403);
  await c.fechar();
});

test("072/US5: o anfitrião não pode ser expulso", async () => {
  const { sala, c, post } = await mesa();
  const r = await post("/sala/expulsar", { sub: "sub-A" });
  assert.strictEqual(r.status, 403);
  assert.ok(sala.membro("sub-A"), "o anfitrião sumiu da própria sala");
  await c.fechar();
});

test("072/US1: ninguém joga com personagem alheio — 403 sem chamada de modelo", async () => {
  const { c, post, jogadas } = await mesa();
  const r = await post("/sussurro", { personagem: "elga", texto: "sou o B" }, "jwt-B");
  assert.strictEqual(r.status, 403);
  assert.match((await r.json()).erro, /outro jogador/);
  await espera(40);
  assert.deepStrictEqual(jogadas, [], "a recusa custou um turno");
  await c.fechar();
});

test("072/US1: `/sala` nunca serializa credencial", async () => {
  const { c, base } = await mesa();
  const r = await fetch(base + "/sala", { headers: { Authorization: "Bearer jwt-A" } });
  const texto = JSON.stringify(await r.json());
  assert.ok(!texto.includes("jwt-A") && !texto.includes("jwt-B"),
            "o roster serviu um token para a tela");
  await c.fechar();
});

test("072/US2: `/sussurro` devolve a POSIÇÃO — espera não pode parecer travamento", async () => {
  const { c, fila, post } = await mesa();
  fila.jogando = "elga";                       // pista ocupada
  const r = await post("/sussurro", { personagem: "draven", texto: "minha vez" }, "jwt-B");
  assert.strictEqual(r.status, 202);
  const d = await r.json();
  assert.strictEqual(d.aceito, true);
  assert.ok(d.posicao >= 1, `sem posição: ${JSON.stringify(d)}`);
  await c.fechar();
});

test("072/US1: entrar na sala confere a posse com o JWT de QUEM ENTRA", async () => {
  const { sala, c, post } = await mesa();
  sala.desassentar("draven");
  // B tenta sentar num personagem que é de A: o mundo (falso) responde a lista de B,
  // que não tem `elga` — é o 403 que evita o assento nascer com o dono errado
  const errado = await post("/sala/entrar", { personagem: "elga" }, "jwt-B");
  assert.strictEqual(errado.status, 403);
  const certo = await post("/sala/entrar", { personagem: "draven" }, "jwt-B");
  assert.strictEqual(certo.status, 200);
  assert.strictEqual(sala.dono("draven"), "sub-B");
  await c.fechar();
});
