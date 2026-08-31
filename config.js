// A configuracao do conector — e o cofre da credencial.
//
// A CREDENCIAL E A RAZAO DE ESTE ARTEFATO EXISTIR. Toda a cisao do client existe
// para que a chave do jogador nunca precise ser colada num site de terceiro. Por
// isso a protecao aqui nao e por disciplina, e ESTRUTURAL:
//
//   `apiKey` e `openrouterKey` sao definidas como NAO-ENUMERAVEIS.
//
// Consequencia pratica: `JSON.stringify(cfg)` e `{...cfg}` simplesmente NAO as
// veem. Quem quiser vazar a chave num log, num registro ou numa requisicao ao
// mundo tem de escrever o nome dela de proposito — nao da para fazer isso por
// descuido, que e como esse tipo de coisa acontece de verdade.
//
// Quem PRECISA delas (os runtimes, em `mente.js`) le `cfg.apiKey` normalmente:
// nao-enumeravel nao e inacessivel.

"use strict";

const armazenamento = require("./armazenamento");

const DEFAULTS = {
  runtime: "local",
  endpoint: "http://localhost:11434",
  model: "llama3.1:8b",
  remoteModel: "claude-haiku-4-5-20251001",
  openrouterModel: "poolside/laguna-m.1:free",
  openrouterEndpoint: "https://openrouter.ai/api/v1",
  // o conector, nao mais o navegador
  mundo: "http://0.0.0.0:8777",
  personagem: "",
  canal: 8899,
  log: true,
};

// O JWT do jogador pareado (spec 056) e credencial igual as outras: quem o
// possui age no mundo pela conta dele, sem expiracao (FR-002 da spec 056). Por
// isso entra em SEGREDOS — mesma trava estrutural, nao so disciplina.
const SEGREDOS = ["apiKey", "openrouterKey", "jwt"];

function _montar(bruto) {
  const cfg = {};
  for (const [k, v] of Object.entries({ ...DEFAULTS, ...bruto })) {
    if (SEGREDOS.includes(k)) continue;
    cfg[k] = v;
  }
  for (const nome of SEGREDOS) {
    Object.defineProperty(cfg, nome, {
      value: bruto[nome] || "",
      enumerable: false,   // <- a trava
      writable: true,
      configurable: true,
    });
  }
  return cfg;
}

let _cache = null;

function carregar(recarregar) {
  if (!_cache || recarregar) _cache = _montar(armazenamento.ler());
  return _cache;
}

function gravar(cfg) {
  // a gravacao e o UNICO lugar que enxerga os segredos de proposito — por isso
  // ela os nomeia explicitamente, em vez de espalhar o objeto.
  const dados = { ...cfg };
  for (const nome of SEGREDOS) if (cfg[nome]) dados[nome] = cfg[nome];
  const alvo = armazenamento.gravar(dados);
  _cache = _montar(dados);
  return alvo;
}

// Qual credencial este runtime exige, se exigir alguma.
function credencialDe(cfg) {
  if (cfg.runtime === "remote") return cfg.apiKey;
  if (cfg.runtime === "openrouter") return cfg.openrouterKey;
  return null;                       // Ollama local nao pede chave
}

// O que falta para jogar, em linguagem de gente (FR-009). Lista vazia = pronto.
function faltando(cfg) {
  const faltas = [];
  if (!cfg.mundo) {
    faltas.push({ campo: "mundo",
                  diga: "o endereco do mundo",
                  como: "--mundo http://localhost:8777" });
  }
  if (!cfg.personagem) {
    faltas.push({ campo: "personagem",
                  diga: "qual personagem esta Mente joga",
                  como: "--personagem <id>  (use --personagens para listar)" });
  }
  if (cfg.runtime === "remote" && !cfg.apiKey) {
    faltas.push({ campo: "apiKey",
                  diga: "a chave da Anthropic",
                  como: "--chave <sua-chave>  (fica so na sua maquina)" });
  }
  if (cfg.runtime === "openrouter" && !cfg.openrouterKey) {
    faltas.push({ campo: "openrouterKey",
                  diga: "a chave do OpenRouter",
                  como: "--chave <sua-chave>  (fica so na sua maquina)" });
  }
  return faltas;
}

// O QUE A PÁGINA DE CONFIGURAÇÃO PODE VER. A credencial NUNCA sai daqui — nem
// para a própria página de configuração. Ela diz apenas SE existe uma chave, o
// que é tudo o que alguém precisa saber para decidir se digita outra.
//
// Não é excesso de zelo: com `--expor` ligado, esta resposta viaja pela rede de
// casa. Uma página de configuração que devolve a chave para preencher o campo é
// exatamente como chaves vazam.
function paraPagina(cfg) {
  const c = cfg || carregar();
  return {
    mundo: c.mundo, personagem: c.personagem, canal: c.canal,
    runtime: c.runtime, model: c.model, endpoint: c.endpoint,
    remoteModel: c.remoteModel,
    openrouterModel: c.openrouterModel, openrouterEndpoint: c.openrouterEndpoint,
    temChaveAnthropic: !!c.apiKey,
    temChaveOpenrouter: !!c.openrouterKey,
    // pareamento (spec 056): so o email aparece — nunca o JWT.
    pareado: !!c.jwt,
    logadoComo: c.authEmail || null,
    arquivo: require("./armazenamento").caminho(),
  };
}

// Aplica o que veio da página. Campo ausente NÃO apaga o que já existe — e chave
// vazia não zera a que está gravada, senão salvar qualquer outra coisa faria o
// jogador perder a credencial sem perceber.
function aplicar(cfg, vindo) {
  const texto = (k) => {
    if (typeof vindo[k] === "string" && vindo[k].trim()) cfg[k] = vindo[k].trim();
  };
  ["mundo", "personagem", "runtime", "model", "endpoint", "remoteModel",
   "openrouterModel", "openrouterEndpoint"].forEach(texto);
  if (Number(vindo.canal)) cfg.canal = Number(vindo.canal);
  if (typeof vindo.apiKey === "string" && vindo.apiKey.trim()) {
    cfg.apiKey = vindo.apiKey.trim();
  }
  if (typeof vindo.openrouterKey === "string" && vindo.openrouterKey.trim()) {
    cfg.openrouterKey = vindo.openrouterKey.trim();
  }
  return cfg;
}

// Grava no DISCO sem tocar a configuração VIVA.
//
// Serve ao caso em que o jogador salva com um turno correndo: a edição dele não
// pode se perder (é dele, e digitar de novo é castigo), mas também não pode
// entrar no meio de um turno que já começou — trocar o personagem no meio faria
// as propostas restantes caírem em cima de outra pessoa.
//
// Então: disco agora, memória quando o turno acabar. O disco é a verdade; a
// configuração viva é uma cópia de trabalho.
function gravarAdiado(cfg, vindo) {
  const futuro = {};
  for (const [k, v] of Object.entries(cfg)) futuro[k] = v;
  for (const nome of SEGREDOS) if (cfg[nome]) futuro[nome] = cfg[nome];
  aplicar(futuro, vindo);
  armazenamento.gravar(futuro);
  return futuro;
}

module.exports = { DEFAULTS, SEGREDOS, carregar, gravar, credencialDe, faltando,
                   paraPagina, aplicar, gravarAdiado };
