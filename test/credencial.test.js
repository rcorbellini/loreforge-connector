// A CREDENCIAL É A RAZÃO DE O CONECTOR EXISTIR.
//
// Toda a cisão do client foi feita para que a chave do jogador não precisasse ser
// colada num site de terceiro. Se ela vazar daqui — num log, num registro, numa
// requisição ao mundo — o artefato perdeu o sentido, mesmo que o jogo funcione.
//
// Por isso a proteção é estrutural (propriedade não-enumerável) e não uma regra
// escrita num README: vazamento de credencial acontece por DESCUIDO, e descuido
// não lê README.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "conector-"));
process.env.LOREFORGE_CONFIG = path.join(TMP, "conector.json");

const configuracao = require("../config");
const registro = require("../registro");

test("JSON.stringify da configuração não leva a credencial junto", () => {
  const cfg = configuracao.carregar(true);
  cfg.apiKey = "sk-ant-SEGREDO-NAO-VAZAR";
  cfg.openrouterKey = "or-SEGREDO-NAO-VAZAR";

  const serializado = JSON.stringify(cfg);
  assert.ok(!serializado.includes("SEGREDO"),
            "a chave apareceu no JSON da configuração");
});

test("espalhar a configuração ({...cfg}) não leva a credencial junto", () => {
  const cfg = configuracao.carregar(true);
  cfg.apiKey = "sk-ant-SEGREDO-NAO-VAZAR";

  const copia = { ...cfg };
  assert.strictEqual(copia.apiKey, undefined,
                     "o espalhamento copiou a chave");
  assert.ok(!JSON.stringify(copia).includes("SEGREDO"));
});

test("quem PRECISA da credencial continua enxergando", () => {
  const cfg = configuracao.carregar(true);
  cfg.apiKey = "sk-ant-SEGREDO-NAO-VAZAR";
  // não-enumerável não é inacessível: os runtimes leem `cfg.apiKey` normalmente
  assert.strictEqual(cfg.apiKey, "sk-ant-SEGREDO-NAO-VAZAR");
  assert.strictEqual(configuracao.credencialDe({ ...cfg, runtime: "remote",
                                                 apiKey: cfg.apiKey }),
                     "sk-ant-SEGREDO-NAO-VAZAR");
});

test("gravar e reler preserva a credencial (senão o jogador reconfigura toda vez)", () => {
  const cfg = configuracao.carregar(true);
  cfg.apiKey = "sk-ant-SEGREDO-NAO-VAZAR";
  // O VEÍCULO DO ROUND-TRIP ERA `personagem`, e ele morreu com a spec 072 (FR-009): o
  // conector não serve mais UM personagem. Troca-se o campo comum, não a asserção — o
  // que este teste guarda é a credencial sobreviver ao disco, e isso segue igual.
  cfg.mundo = "http://exemplo:8777";
  configuracao.gravar(cfg);

  const relido = configuracao.carregar(true);
  assert.strictEqual(relido.apiKey, "sk-ant-SEGREDO-NAO-VAZAR");
  assert.strictEqual(relido.mundo, "http://exemplo:8777");
  assert.ok(!JSON.stringify(relido).includes("SEGREDO"));
});

// spec 072: a credencial do MEMBRO tem a mesma trava da chave de modelo — e ela é a que
// mais importa proteger agora, porque é de OUTRA PESSOA. O achado da Fase 0 (o JWT do
// mundo não tem `exp` e não há revogação individual) faz um vazamento aqui ser permanente.
test("o JWT de cada membro é não-enumerável e sobrevive ao disco", () => {
  const cfg = configuracao.carregar(true);
  const creds = configuracao.credenciais(cfg);
  creds.gravar("sub-convidado", "eyJ-SEGREDO-DE-OUTRO");

  assert.strictEqual(creds.ler("sub-convidado"), "eyJ-SEGREDO-DE-OUTRO");
  assert.ok(!JSON.stringify(cfg).includes("SEGREDO"),
            "o JWT do convidado apareceu no espalhamento da configuração");
  assert.strictEqual({ ...cfg }.jwtPorMembro, undefined,
                     "o espalhamento copiou o mapa de credenciais");

  const relido = configuracao.carregar(true);
  assert.strictEqual(relido.jwtPorMembro["sub-convidado"], "eyJ-SEGREDO-DE-OUTRO");
  assert.ok(!JSON.stringify(relido).includes("SEGREDO"));

  // expulsar apaga a CÓPIA — é tudo o que este lado pode fazer (FR-042)
  configuracao.credenciais(relido).apagar("sub-convidado");
  assert.strictEqual(configuracao.carregar(true).jwtPorMembro["sub-convidado"], undefined);
});

test("a linha do registro que sobe ao mundo não contém credencial", async () => {
  const cfg = configuracao.carregar(true);
  cfg.apiKey = "sk-ant-SEGREDO-NAO-VAZAR";

  let enviado = null;
  const mundoFalso = { registrar: async (linha) => { enviado = linha; return true; } };
  const reg = registro.criar({ mundo: mundoFalso, cfg, extensoes: null,
                               mente: null });
  const t = reg.abrir();
  t.sussurro("pega a corda", "manual");
  t.pensou({ pensamento: "preciso da corda" });
  await t.fechar();

  assert.ok(enviado, "o registro não subiu");
  assert.ok(!JSON.stringify(enviado).includes("SEGREDO"),
            "a chave vazou dentro do registro do turno");
});
