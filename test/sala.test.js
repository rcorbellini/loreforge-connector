// A SALA — o roster, a posse e a migração (spec 072).
//
// O que este arquivo guarda, e por que cada um importa:
//
//  · **o JWT certo por assento.** É o defeito mais fácil de introduzir e o mais caro:
//    mandar o token do anfitrião por conta de personagem alheio faz o server responder
//    403 em TODO turno de convidado (`app.py`, `_authorize_character`). Silencioso do
//    lado do conector, fatal do lado do jogo.
//  · **a expulsão apagando a credencial.** Achado da Fase 0: o JWT do mundo não tem
//    `exp` e o mundo não tem revogação individual — apagar a cópia é tudo o que este
//    lado pode fazer, e deixar de fazê-lo é abandonar uma credencial permanente de
//    outra pessoa no disco do anfitrião.
//  · **os dois bits.** Bloquear não pode apagar a vontade do dono, senão liberar vira
//    chute (FR-037, SC-010).

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "sala-"));
process.env.LOREFORGE_CONFIG = path.join(TMP, "conector.json");
process.env.LOREFORGE_LOG = "0";

const { Sala } = require("../sala");
const configuracao = require("../config");


// Uma fábrica de assento SEM rede e SEM modelo: devolve peças de mentira que só
// registram o que receberam. É o que permite exercitar o roster inteiro sem subir nada.
function fabricasFalsas(registrador) {
  return {
    assento: async ({ personagem, dono, jwt }) => {
      if (registrador) registrador.push({ personagem, dono, jwt });
      return {
        nome: personagem,
        mundo: { personagem, jwt },
        mente: { custoDoTurno: () => ({ entrada: 10, saida: 5, chamadas: 1 }) },
        laco: { ocupado: false },
      };
    },
  };
}

function credenciaisFalsas() {
  const mapa = new Map();
  return {
    ler: (sub) => mapa.get(sub) || null,
    gravar: (sub, jwt) => mapa.set(sub, jwt),
    apagar: (sub) => mapa.delete(sub),
    _mapa: mapa,
  };
}

function salaComDois() {
  const creds = credenciaisFalsas();
  const pedidos = [];
  const s = new Sala({ nome: "Taverna", credenciais: creds,
                       fabricas: fabricasFalsas(pedidos) });
  s.acrescentarMembro({ sub: "sub-A", email: "a@x", nome: "A", jwt: "jwt-de-A" });
  s.acrescentarMembro({ sub: "sub-B", email: "b@x", nome: "B", jwt: "jwt-de-B" });
  return { s, creds, pedidos };
}


test("072/US1: o primeiro a parear vira anfitrião, e só ele", () => {
  const { s } = salaComDois();
  assert.strictEqual(s.anfitriao, "sub-A");
  assert.ok(s.ehAnfitriao("sub-A"));
  assert.ok(!s.ehAnfitriao("sub-B"));
});

test("072/US1: cada assento fala com o mundo pelo JWT do PRÓPRIO dono", async () => {
  const { s, pedidos } = salaComDois();
  await s.assentar({ personagem: "elga", sub: "sub-A" });
  await s.assentar({ personagem: "draven", sub: "sub-B" });

  // o que a fábrica recebeu na hora de montar o `Mundo` de cada um
  assert.deepStrictEqual(pedidos.map((p) => [p.personagem, p.jwt]),
                         [["elga", "jwt-de-A"], ["draven", "jwt-de-B"]]);
  // e a consulta que o canal usa a cada chamada
  assert.strictEqual(s.jwtDoAssento("elga"), "jwt-de-A");
  assert.strictEqual(s.jwtDoAssento("draven"), "jwt-de-B");
  // NUNCA o do anfitrião por conta de personagem alheio — é o 403 em todo turno
  assert.notStrictEqual(s.jwtDoAssento("draven"), "jwt-de-A");
});

test("072/US1: personagem de outro membro tem dono conhecido (a base do 403)", async () => {
  const { s } = salaComDois();
  await s.assentar({ personagem: "draven", sub: "sub-B" });
  assert.strictEqual(s.dono("draven"), "sub-B");
  assert.notStrictEqual(s.dono("draven"), "sub-A");
  // quem não está assentado não tem dono NESTA SALA, ainda que tenha no mundo
  assert.strictEqual(s.dono("ninguem"), null);
});

test("072/US1: o mesmo personagem não senta duas vezes", async () => {
  const { s } = salaComDois();
  await s.assentar({ personagem: "elga", sub: "sub-A" });
  const r = await s.assentar({ personagem: "elga", sub: "sub-B" });
  assert.match(r.erro, /outro jogador/);
});

test("072/US1: quem não é membro ativo não senta", async () => {
  const { s } = salaComDois();
  assert.match((await s.assentar({ personagem: "x", sub: "sub-Z" })).erro, /não é membro/);
  s.falhou401("sub-B"); s.falhou401("sub-B");
  assert.match((await s.assentar({ personagem: "y", sub: "sub-B" })).erro, /não é membro/);
});

test("072/US1: `paraTela` NUNCA carrega credencial (nem do anfitrião)", async () => {
  const { s } = salaComDois();
  await s.assentar({ personagem: "elga", sub: "sub-A" });
  const texto = JSON.stringify(s.paraTela());
  assert.ok(!texto.includes("jwt-de-A"), "o JWT do anfitrião vazou para a tela");
  assert.ok(!texto.includes("jwt-de-B"), "o JWT do convidado vazou para a tela");
  assert.ok(!/"jwt"/.test(texto), "a chave `jwt` apareceu no roster");
  // e o mesmo vale para o que vai ao disco
  assert.ok(!JSON.stringify(s.paraConfig()).includes("jwt-de-"));
});

test("072/US1: dois 401 seguidos desautenticam o MEMBRO, não o personagem", () => {
  const { s } = salaComDois();
  assert.strictEqual(s.falhou401("sub-B"), false, "um 401 isolado não derruba ninguém");
  assert.ok(s.ehMembroAtivo("sub-B"));
  assert.strictEqual(s.falhou401("sub-B"), true);
  assert.strictEqual(s.membro("sub-B").estado, "desautenticado");
  // e uma resposta boa no meio zera a contagem
  const outra = salaComDois();
  outra.s.falhou401("sub-B");
  outra.s.respondeuBem("sub-B");
  assert.strictEqual(outra.s.falhou401("sub-B"), false);
});

test("072/US1: parear de novo ressuscita o desautenticado sem perder assento", async () => {
  const { s } = salaComDois();
  await s.assentar({ personagem: "draven", sub: "sub-B" });
  s.falhou401("sub-B"); s.falhou401("sub-B");
  assert.strictEqual(s.membro("sub-B").estado, "desautenticado");

  s.acrescentarMembro({ sub: "sub-B", jwt: "jwt-de-B-novo" });
  assert.strictEqual(s.membro("sub-B").estado, "ativo");
  assert.strictEqual(s.assentoDe("draven").dono, "sub-B", "o assento sobreviveu");
});

test("072/US5: expulsar tira os assentos E APAGA a credencial", async () => {
  const { s, creds } = salaComDois();
  await s.assentar({ personagem: "draven", sub: "sub-B" });
  assert.strictEqual(creds.ler("sub-B"), "jwt-de-B");

  const r = s.expulsar("sub-B");
  assert.deepStrictEqual(r.personagens, ["draven"]);
  assert.strictEqual(s.assentoDe("draven"), null);
  assert.strictEqual(s.membro("sub-B"), null);
  assert.strictEqual(creds.ler("sub-B"), null,
                     "a credencial do expulso ficou para trás — e ela não expira");
});

test("072/US5: o anfitrião não pode ser expulso", () => {
  const { s } = salaComDois();
  assert.match(s.expulsar("sub-A").erro, /anfitrião/);
  assert.ok(s.membro("sub-A"), "o anfitrião sumiu da própria sala");
});

test("072/US5: bloquear NÃO apaga a vontade do dono; liberar devolve o que era", async () => {
  const { s } = salaComDois();
  await s.assentar({ personagem: "elga", sub: "sub-A" });

  s.ligarAutonomia("elga", true);
  assert.deepStrictEqual(s.assentoDe("elga").autonomia,
                         { permitido: true, ligado: true, motivo: null });

  s.permitirAutonomia("elga", false, "a mesa está lenta");
  const bloqueado = s.assentoDe("elga").autonomia;
  assert.strictEqual(bloqueado.permitido, false);
  assert.strictEqual(bloqueado.ligado, true, "o bloqueio apagou a vontade do dono");
  assert.strictEqual(bloqueado.motivo, "a mesa está lenta");
  assert.strictEqual(s.assentoDe("elga").querAgirSozinho(), false);

  s.permitirAutonomia("elga", true);
  assert.deepStrictEqual(s.assentoDe("elga").autonomia,
                         { permitido: true, ligado: true, motivo: null });
  assert.strictEqual(s.assentoDe("elga").querAgirSozinho(), true);
});

test("072/US5: 3 ciclos de bloqueia/libera × ligado/desligado voltam certo (SC-010)", async () => {
  const { s } = salaComDois();
  await s.assentar({ personagem: "elga", sub: "sub-A" });
  for (const vontade of [true, false, true]) {
    s.ligarAutonomia("elga", vontade);
    s.permitirAutonomia("elga", false, "pausa");
    assert.strictEqual(s.assentoDe("elga").autonomia.ligado, vontade);
    s.permitirAutonomia("elga", true);
    assert.strictEqual(s.assentoDe("elga").autonomia.ligado, vontade);
    assert.strictEqual(s.assentoDe("elga").querAgirSozinho(), vontade);
  }
});

test("072/US6: o dono não liga a autonomia por cima de um bloqueio", async () => {
  const { s } = salaComDois();
  await s.assentar({ personagem: "elga", sub: "sub-A" });
  s.permitirAutonomia("elga", false, "segura aí");
  const r = s.ligarAutonomia("elga", true);
  assert.ok(r.bloqueado);
  assert.match(r.erro, /segura aí/);
  assert.strictEqual(s.assentoDe("elga").autonomia.ligado, false);
});

test("072/US6: personagem novo entra com `ligado: false` e `permitido: true`", async () => {
  const { s } = salaComDois();
  await s.assentar({ personagem: "elga", sub: "sub-A" });
  assert.deepStrictEqual(s.assentoDe("elga").autonomia,
                         { permitido: true, ligado: false, motivo: null });
});

test("072: sair e voltar preserva a vontade E o bloqueio do anfitrião", async () => {
  const { s } = salaComDois();
  await s.assentar({ personagem: "elga", sub: "sub-A" });
  s.ligarAutonomia("elga", true);
  s.permitirAutonomia("elga", false, "castigo");
  s.desassentar("elga");

  await s.assentar({ personagem: "elga", sub: "sub-A" });
  const a = s.assentoDe("elga").autonomia;
  assert.strictEqual(a.ligado, true, "a vontade do dono se perdeu ao reentrar");
  assert.strictEqual(a.permitido, false,
                     "sair e voltar apagou o bloqueio — seria a saída de escape dele");
});

test("072/US7: o intervalo recua quando N turnos autônomos não aplicam nada", async () => {
  const { s } = salaComDois();
  await s.assentar({ personagem: "elga", sub: "sub-A" });
  const a = s.assentoDe("elga");
  const base = a.intervaloEfetivo();

  for (let i = 0; i < 2; i++) a.fecharTurno({ aplicou: false, autonomo: true });
  assert.strictEqual(a.intervaloEfetivo(), base, "recuou cedo demais");

  for (let i = 0; i < 4; i++) a.fecharTurno({ aplicou: false, autonomo: true });
  assert.ok(a.intervaloEfetivo() > base, "não recuou depois de vários turnos vazios");

  a.fecharTurno({ aplicou: true, autonomo: true });
  assert.strictEqual(a.intervaloEfetivo(), base, "um turno com efeito não zerou o recuo");
});

test("072/US7: o teto de custo pausa a mesa INTEIRA e avisa", async () => {
  const avisos = [];
  const s = new Sala({ credenciais: credenciaisFalsas(), fabricas: fabricasFalsas(),
                       tetoCustoTokens: 20,
                       emitir: (ev, d) => avisos.push([ev, d]) });
  s.acrescentarMembro({ sub: "sub-A", jwt: "j" });
  await s.assentar({ personagem: "elga", sub: "sub-A" });

  assert.strictEqual(s.conferirTeto(), false);
  s.assentoDe("elga").fecharTurno({ aplicou: true, autonomo: false });  // +15
  assert.strictEqual(s.conferirTeto(), false);
  s.assentoDe("elga").fecharTurno({ aplicou: true, autonomo: false });  // +15 = 30
  assert.strictEqual(s.conferirTeto(), true);
  assert.ok(avisos.some(([ev, d]) => ev === "sistema" && /teto de gasto/.test(d.texto)),
            "o teto foi alcançado em silêncio");
});

test("072: a migração do formato de UM DONO SÓ é automática e silenciosa", () => {
  const antigo = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "..", "specs", "072-room-and-turn-queue",
              "baseline-config-antigo.json"), "utf8"));
  fs.writeFileSync(process.env.LOREFORGE_CONFIG, JSON.stringify(antigo), "utf8");

  const cfg = configuracao.carregar(true);

  assert.ok(cfg.sala, "o conector antigo não virou sala nenhuma");
  assert.strictEqual(cfg.sala.anfitriao, antigo.authSub);
  assert.strictEqual(cfg.sala.membros.length, 1);
  assert.strictEqual(cfg.sala.membros[0].email, antigo.authEmail);
  assert.strictEqual(cfg.sala.assentos.length, 1);
  assert.strictEqual(cfg.sala.assentos[0].personagem, antigo.personagem);
  assert.strictEqual(cfg.sala.assentos[0].dono, antigo.authSub);
  // a autonomia do PROCESSO virou a vontade daquele assento, com o teto aberto
  assert.deepStrictEqual(cfg.sala.assentos[0].autonomia,
                         { permitido: true, ligado: true, motivo: null });
  // o JWT plano virou entrada do mapa, e continua fora do espalhamento
  assert.strictEqual(cfg.jwtPorMembro[antigo.authSub], antigo.jwt);
  assert.strictEqual(cfg.jwt, undefined, "o campo plano sobreviveu à migração");
  assert.ok(!JSON.stringify(cfg).includes(antigo.jwt));

  // e o roster restaurado guarda os bits para quem reentrar
  const s = require("../sala").Sala.deConfig(cfg.sala, {
    credenciais: configuracao.credenciais(cfg), fabricas: fabricasFalsas() });
  assert.strictEqual(s.anfitriao, antigo.authSub);
  assert.strictEqual(s.jwtDe(antigo.authSub), antigo.jwt);
});

// A GUARDA NÃO PODE SER INERTE. `sala.falhou401` existia e ninguém a chamava — o
// mecanismo estaria lá, verde na suíte, e nunca dispararia em jogo. É o modo de falha
// que este projeto já pagou caro para aprender a reconhecer, então ele tem teste.
test("072/R6: o 401 do mundo CHEGA à sala pelo fio do `Mundo`", async () => {
  const { Mundo } = require("../mundo");
  const vistos = [];
  const m = new Mundo("http://127.0.0.1:9", "elga");
  m.onIdentidade = (status) => vistos.push(status);

  // sem servidor do outro lado, `fetch` estoura ANTES da resposta — então o fio não é
  // chamado, e isso é o certo: rede caída não é identidade recusada.
  await m.contexto().catch(() => {});
  assert.deepStrictEqual(vistos, [],
    "rede caída foi tratada como token recusado");

  // e com uma resposta de verdade, o status atravessa
  const http = require("http");
  const srv = http.createServer((_, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const m2 = new Mundo(`http://127.0.0.1:${srv.address().port}`, "elga");
  m2.onIdentidade = (status) => vistos.push(status);
  await m2.contexto().catch(() => {});
  await new Promise((r) => srv.close(r));
  assert.deepStrictEqual(vistos, [401]);
});
