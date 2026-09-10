// A FILA DA MESA (spec 072, US2 e US7).
//
// O que este arquivo guarda:
//
//  · **manual na frente de autônoma.** Sem isso, um humano espera atrás de quatro robôs,
//    e a mesa fica intragável justamente para quem está prestando atenção nela.
//  · **a substituição, não a soma.** Sussurrar num assento com autônoma pendente tem de
//    render UMA jogada. Duas fariam a segunda cair numa cena que a primeira mudou.
//  · **o invariante de tamanho.** `entradas <= 2 × assentos`, sempre. Uma fila que possa
//    crescer sem limite é uma conta de modelo que pode crescer sem limite.
//  · **o tempo de quem espera não conta.** É o que impede a fila de encher sozinha.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.LOREFORGE_CONFIG =
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fila-")), "conector.json");
process.env.LOREFORGE_LOG = "0";

const { Sala } = require("../sala");
const { Fila } = require("../fila");

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Um laço de mentira que registra o que jogou e demora o que mandarem.
function lacoFalso(diario, personagem, { demoraMs = 0, aplicou = true } = {}) {
  const l = {
    ocupado: false,
    ultimoTurnoAplicou: aplicou,
    async sussurrar(texto) {
      l.ocupado = true;
      diario.push({ personagem, classe: "manual", texto });
      if (demoraMs) await espera(demoraMs);
      l.ocupado = false;
    },
    async talvezAgirSozinho() {
      l.ocupado = true;
      diario.push({ personagem, classe: "autonoma" });
      if (demoraMs) await espera(demoraMs);
      l.ocupado = false;
    },
  };
  return l;
}

async function mesa({ quantos = 2, demoraMs = 0, aplicou = true,
                      intervaloMs = 1000 } = {}) {
  const diario = [];
  const creds = { ler: () => "jwt", gravar: () => {}, apagar: () => {} };
  const s = new Sala({
    credenciais: creds,
    fabricas: {
      assento: async ({ personagem }) => ({
        nome: personagem, mundo: { personagem },
        mente: { custoDoTurno: () => ({ entrada: 0, saida: 0, chamadas: 0 }) },
        laco: lacoFalso(diario, personagem, { demoraMs, aplicou }),
      }),
    },
  });
  s.acrescentarMembro({ sub: "sub-A", jwt: "jwt" });
  const nomes = [];
  for (let i = 0; i < quantos; i++) {
    const p = `p${i + 1}`;
    nomes.push(p);
    await s.assentar({ personagem: p, sub: "sub-A" });
    s.assentoDe(p).intervaloMs = intervaloMs;
    s.assentoDe(p).restanteMs = intervaloMs;
  }
  const eventos = [];
  const f = new Fila({ sala: s, emitir: (ev, d) => eventos.push([ev, d]),
                       passoMs: 20 });
  return { s, f, diario, eventos, nomes };
}


test("072/US2: manual é servida antes de qualquer autônoma pendente", async () => {
  const { s, f, diario } = await mesa({ quantos: 3, demoraMs: 10 });
  // duas autônomas entram primeiro; a manual chega depois e passa na frente
  f.enfileirar({ personagem: "p1", classe: "autonoma" });
  f.enfileirar({ personagem: "p2", classe: "autonoma" });
  f.enfileirar({ personagem: "p3", classe: "manual", texto: "eu falo agora" });
  await espera(120);

  const ordem = diario.map((d) => `${d.personagem}:${d.classe}`);
  // a p1 já estava em voo quando as outras chegaram; entre as que ESPERARAM, a manual
  // tem de vir antes da autônoma
  const iManual = ordem.indexOf("p3:manual");
  const iAuto2 = ordem.indexOf("p2:autonoma");
  assert.ok(iManual >= 0 && iAuto2 >= 0, ordem.join(", "));
  assert.ok(iManual < iAuto2, `a manual esperou atrás do robô: ${ordem.join(", ")}`);
  assert.strictEqual(s.assentoDe("p1").personagem, "p1");
});

test("072/US2: a manual SUBSTITUI a autônoma pendente — uma jogada, não duas", async () => {
  const { f, diario } = await mesa({ quantos: 2, demoraMs: 30 });
  f.enfileirar({ personagem: "p1", classe: "autonoma" });   // entra em voo
  f.enfileirar({ personagem: "p2", classe: "autonoma" });   // espera
  f.enfileirar({ personagem: "p2", classe: "manual", texto: "muda de ideia" });
  await espera(150);

  const doP2 = diario.filter((d) => d.personagem === "p2");
  assert.strictEqual(doP2.length, 1, `p2 jogou ${doP2.length} vezes`);
  assert.strictEqual(doP2[0].classe, "manual");
});

test("072/US2: um turno por vez — nunca dois laços ocupados juntos", async () => {
  const { s, f } = await mesa({ quantos: 3, demoraMs: 40 });
  f.enfileirar({ personagem: "p1", classe: "autonoma" });
  f.enfileirar({ personagem: "p2", classe: "autonoma" });
  f.enfileirar({ personagem: "p3", classe: "autonoma" });

  let maxSimultaneos = 0;
  for (let i = 0; i < 20; i++) {
    const ocupados = [...s.assentos.values()].filter((a) => a.laco.ocupado).length;
    maxSimultaneos = Math.max(maxSimultaneos, ocupados);
    await espera(10);
  }
  assert.strictEqual(maxSimultaneos, 1, "dois turnos correram ao mesmo tempo");
});

test("072/US2: a fila nunca passa de 2 × assentos", async () => {
  const { f } = await mesa({ quantos: 2, demoraMs: 200 });
  // insiste MUITO em ambas as classes dos dois assentos
  for (let i = 0; i < 50; i++) {
    f.enfileirar({ personagem: "p1", classe: "autonoma" });
    f.enfileirar({ personagem: "p1", classe: "manual", texto: `t${i}` });
    f.enfileirar({ personagem: "p2", classe: "autonoma" });
    f.enfileirar({ personagem: "p2", classe: "manual", texto: `t${i}` });
  }
  assert.ok(f.entradas.length <= 2 * 2,
            `a fila cresceu para ${f.entradas.length}`);
});

test("072/US2: o relógio de quem joga ou espera NÃO anda", async () => {
  const { s, f } = await mesa({ quantos: 2, demoraMs: 60, intervaloMs: 5000 });
  f.iniciar();
  f.enfileirar({ personagem: "p1", classe: "autonoma" });   // p1 em voo
  f.enfileirar({ personagem: "p2", classe: "autonoma" });   // p2 esperando
  const antesP2 = s.assentoDe("p2").restanteMs;
  await espera(80);
  assert.strictEqual(s.assentoDe("p2").restanteMs, antesP2,
                     "o relógio de quem está na fila continuou correndo");
  f.parar();
});

test("072/US2: o relógio rearma no FIM do turno, com o intervalo cheio", async () => {
  const { s, f } = await mesa({ quantos: 1, demoraMs: 10, intervaloMs: 5000 });
  const a = s.assentoDe("p1");
  a.restanteMs = 1;
  f.enfileirar({ personagem: "p1", classe: "autonoma" });
  await espera(60);
  assert.strictEqual(a.restanteMs, 5000, "o relógio não rearmou no fim do turno");
});

test("072/US2: o relógio vence e a jogada autônoma nasce sozinha", async () => {
  const { s, f, diario } = await mesa({ quantos: 1, demoraMs: 5, intervaloMs: 40 });
  // FR-030: o assento NASCE com o autônomo desligado — entrar numa sala não começa a
  // gastar a chave do anfitrião sem alguém dizer que sim. Ligar é parte do cenário.
  s.ligarAutonomia("p1", true);
  f.iniciar();
  await espera(150);
  f.parar();
  assert.ok(diario.some((d) => d.classe === "autonoma"),
            "o relógio venceu e ninguém jogou");
});

test("072/US2: assento bloqueado ou de membro caído não entra na fila sozinho", async () => {
  const { s, f, diario } = await mesa({ quantos: 2, demoraMs: 5, intervaloMs: 30 });
  s.ligarAutonomia("p1", true);
  s.ligarAutonomia("p2", true);
  s.permitirAutonomia("p1", false, "segura aí");
  f.iniciar();
  await espera(160);
  f.parar();
  assert.ok(!diario.some((d) => d.personagem === "p1"),
            "o bloqueado entrou na fila sozinho");
  assert.ok(diario.some((d) => d.personagem === "p2"),
            "o liberado deixou de jogar");
});

test("072/US2: bloquear tira da fila o que já estava pendente", async () => {
  const { s, f } = await mesa({ quantos: 2, demoraMs: 100 });
  f.enfileirar({ personagem: "p1", classe: "autonoma" });   // em voo
  f.enfileirar({ personagem: "p2", classe: "autonoma" });   // pendente
  assert.strictEqual(f.entradas.length, 1);
  f.removerPersonagem("p2");                                 // o que o bloqueio faz
  assert.strictEqual(f.entradas.length, 0);
});

test("072/US7: o prazo solta a pista e a mesa segue", async () => {
  const { f, diario, eventos } = await mesa({ quantos: 2, demoraMs: 400 });
  f.prazoMs = 40;
  f.enfileirar({ personagem: "p1", classe: "autonoma" });
  f.enfileirar({ personagem: "p2", classe: "autonoma" });
  await espera(200);

  assert.ok(diario.some((d) => d.personagem === "p2"),
            "o turno pendurado congelou a mesa");
  assert.ok(eventos.some(([ev, d]) => ev === "sistema" && /demorou demais/.test(d.texto)),
            "a mesa seguiu em silêncio");
  // e o aviso do prazo é do DONO, não da mesa: é diagnóstico, não fato de mundo
  const aviso = eventos.find(([ev]) => ev === "sistema")[1];
  assert.strictEqual(aviso.escopo, "dono");
});

test("072/US7: turno sem efeito conta para o recuo; com efeito zera", async () => {
  const { s, f } = await mesa({ quantos: 1, demoraMs: 5, aplicou: false });
  const a = s.assentoDe("p1");
  for (let i = 0; i < 3; i++) {
    f.enfileirar({ personagem: "p1", classe: "autonoma" });
    await espera(40);
  }
  assert.ok(a.semEfeito >= 3, `semEfeito=${a.semEfeito}`);
  a.laco.ultimoTurnoAplicou = true;
  f.enfileirar({ personagem: "p1", classe: "autonoma" });
  await espera(40);
  assert.strictEqual(a.semEfeito, 0);
});

test("072: o evento `fila` é de MESA — quem espera é público numa roda", async () => {
  const { f, eventos } = await mesa({ quantos: 2, demoraMs: 5 });
  f.enfileirar({ personagem: "p1", classe: "manual", texto: "oi" });
  await espera(40);
  const daFila = eventos.filter(([ev]) => ev === "fila");
  assert.ok(daFila.length > 0);
  assert.ok(daFila.every(([, d]) => d.escopo === "mesa"));
});
