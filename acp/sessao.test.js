"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Sessoes, cwdSintetico } = require("./sessao");

test("criar() dá um sessionId, sessionIdDe()/personagemDe() são inversos", () => {
  const s = new Sessoes({ salaId: "taverna-do-gancho" });
  const id = s.criar("draven");
  assert.match(id, /^sess-draven-[0-9a-f]{8}$/);
  assert.equal(s.sessionIdDe("draven"), id);
  assert.equal(s.personagemDe(id), "draven");
});

test("duas sessões nunca compartilham sessionId", () => {
  const s = new Sessoes({ salaId: "taverna-do-gancho" });
  const a = s.criar("draven");
  const b = s.criar("elga");
  assert.notEqual(a, b);
  assert.equal(s.personagemDe(a), "draven");
  assert.equal(s.personagemDe(b), "elga");
});

test("criar() é idempotente para o mesmo personagem (reconexão não duplica sessão)", () => {
  const s = new Sessoes();
  const primeira = s.criar("draven");
  const segunda = s.criar("draven");
  assert.equal(primeira, segunda);
});

test("encerrar() apaga o mapeamento nos dois sentidos e libera para um sessionId novo", () => {
  const s = new Sessoes();
  const id1 = s.criar("draven");
  s.encerrar("draven");
  assert.equal(s.sessionIdDe("draven"), null);
  assert.equal(s.personagemDe(id1), null);
  const id2 = s.criar("draven");
  assert.notEqual(id1, id2, "a sessão reencarnada nunca reaproveita o sessionId antigo");
});

test("newSessionRequest() sempre inclui cwd sintético e mcpServers vazio", () => {
  const s = new Sessoes({ salaId: "taverna-do-gancho" });
  const req = s.newSessionRequest("draven");
  assert.equal(req.cwd, "/loreforge/sala/taverna-do-gancho/assento/draven");
  assert.deepEqual(req.mcpServers, []);
});

test("cwdSintetico() cai em 'local' sem salaId", () => {
  assert.equal(cwdSintetico({ personagem: "draven" }), "/loreforge/sala/local/assento/draven");
});
