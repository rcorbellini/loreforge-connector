// O MUNDO, visto do conector — as portas do DESEJO (spec 075, contrato 03).
//
// Opção 2: o world GUARDA a intenção, o harness DECIDE. O harness escreve pelas MESMAS
// portas que o client usa (`/api/intention/*`), com o JWT do DONO do assento. Este
// teste é de LIGAÇÃO: sobe um servidor HTTP falso e confere o que atravessa o fio —
// a rota, o corpo (inclusive o `status` novo, `concluida`) e o cabeçalho de identidade.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const http = require("http");

const { Mundo } = require("../mundo");

async function comServidor(fn) {
  const recebidos = [];
  const srv = http.createServer((req, res) => {
    let corpo = "";
    req.on("data", (c) => { corpo += c; });
    req.on("end", () => {
      recebidos.push({ url: req.url, auth: req.headers.authorization || null,
                       corpo: corpo ? JSON.parse(corpo) : null });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, id: "int-novo" }));
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const m = new Mundo(`http://127.0.0.1:${srv.address().port}`, "draven-vigia");
    m.jwt = "jwt-do-dono";
    await fn(m);
  } finally {
    await new Promise((r) => srv.close(r));
  }
  return recebidos;
}

test("criar o desejo: POST /api/intention/create com o content e o JWT do dono", async () => {
  const r = await comServidor((m) => m.criarIntencao("Matar a fome.\n- Comer o Bocado"));
  assert.strictEqual(r[0].url, "/api/intention/create");
  assert.strictEqual(r[0].auth, "Bearer jwt-do-dono");
  assert.deepStrictEqual(r[0].corpo, { character_id: "draven-vigia", content: "Matar a fome.\n- Comer o Bocado" });
});

test("replanejar: POST /api/intention/update com o id e o content novo", async () => {
  const r = await comServidor((m) => m.atualizarIntencao("int-1", "A.\n- b"));
  assert.strictEqual(r[0].url, "/api/intention/update");
  assert.deepStrictEqual(r[0].corpo, { character_id: "draven-vigia", intention_id: "int-1", content: "A.\n- b" });
});

test("LIGAÇÃO: fechar CONCLUÍDO leva `status: concluida` pelo fio (o status novo da opção 2)", async () => {
  const r = await comServidor((m) => m.fecharIntencao("int-1", "concluida"));
  assert.strictEqual(r[0].url, "/api/intention/close");
  assert.strictEqual(r[0].corpo.status, "concluida");
  assert.strictEqual(r[0].corpo.lembrar, false);
});

test("desistir leva `status: abandonada` e `lembrar: true` — a desistência vira memória", async () => {
  const r = await comServidor((m) => m.fecharIntencao("int-1", "abandonada", { lembrar: true }));
  assert.strictEqual(r[0].corpo.status, "abandonada");
  assert.strictEqual(r[0].corpo.lembrar, true);
});
