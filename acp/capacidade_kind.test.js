"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { kindDe, tituloDe } = require("./capacidade_kind");

test("kindDe() acerta as famílias documentadas em data-model.md", () => {
  assert.equal(kindDe("travel_to"), "move");
  assert.equal(kindDe("enter_route"), "move");
  assert.equal(kindDe("investigate"), "search");
  assert.equal(kindDe("ask_about"), "search");
  assert.equal(kindDe("write"), "edit");
  assert.equal(kindDe("attack"), "other");
  assert.equal(kindDe("persuade_give"), "other");
});

test("kindDe() nunca lança e cai em 'other' para capacidade desconhecida", () => {
  assert.equal(kindDe("uma_capacidade_que_nao_existe_ainda"), "other");
  assert.equal(kindDe(undefined), "other");
  assert.equal(kindDe(""), "other");
});

test("tituloDe() nunca devolve o nome técnico da capacidade como substring solta (FR-016)", () => {
  const t = tituloDe("attack", "Golpear um personagem presente na cena.");
  assert.equal(/\battack\b/.test(t), false);
  assert.equal(t, "Golpear um personagem presente na cena.");
});

test("tituloDe() sem descrição cai num rótulo genérico, nunca no nome cru", () => {
  const t = tituloDe("persuade_give", "");
  assert.equal(t.includes("persuade_give"), false);
  assert.equal(typeof t, "string");
  assert.ok(t.length > 0);
});
