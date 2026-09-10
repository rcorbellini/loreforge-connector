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
  // 2.5-flash foi DESCONTINUADO pra chaves novas em 09/2026 (a API responde
  // 404 recomendando a família 3.x) — medido ao vivo, não por aviso de doc.
  geminiModel: "gemini-3.5-flash",
  // o conector, nao mais o navegador
  mundo: "http://0.0.0.0:8777",
  // O ENDERECO DO MUNDO **PARA AS TELAS** (spec 072).
  //
  // Nao e o mesmo campo, e confundi-los quebra a sala inteira: `mundo` e por onde ESTE
  // PROCESSO alcanca o server (tipicamente `localhost:8777`), e o navegador de um
  // convidado, noutra maquina, nao alcanca localhost nenhum. Este e o endereco que o
  // conector PUBLICA para as telas — o tunel, ou o IP na LAN.
  //
  // Vazio = usa `mundo`, que e o certo para quem joga na propria maquina.
  mundoPublico: "",
  // `personagem` SAIU daqui (spec 072). O conector nao serve mais UM personagem: ele
  // serve uma SALA, e quem entra nela sao os assentos. O que resta de `--personagem` e
  // uma semente opcional na linha de comando.
  sala: null,
  canal: 8899,
  log: true,
  // O MODELO DE EMBEDDING é OPCIONAL (spec 060, US2), e vazio de propósito.
  //
  // Ele serve à camada SEMÂNTICA da resolução de alvo — a que recupera paráfrase
  // ("a mulher que vende água" -> odila-aguadeira) quando a camada literal não
  // casou. Sem ele o conector resolve menos e REJEITA mais, e diz isso: não é o
  // fallback silencioso que o Princípio VIII proíbe, é uma camada a menos,
  // declarada. Quem quiser: `ollama pull nomic-embed-text` e aponte aqui.
  embeddingModel: "",
};

// O JWT do jogador pareado (spec 056) e credencial igual as outras: quem o
// possui age no mundo pela conta dele, sem expiracao (FR-002 da spec 056). Por
// isso entra em SEGREDOS — mesma trava estrutural, nao so disciplina.
//
// SPEC 072: `jwt` (uma string, um dono) virou `jwtPorMembro` (um MAPA `sub -> jwt`).
//
// E ele e um MAPA PLANO de proposito, e nao um campo dentro de `sala.membros[]`. A
// trava aqui e plana — um `defineProperty` por NOME —, entao uma credencial aninhada
// num array voltaria a ser enumeravel justamente quando passa a haver credencial de
// TERCEIRO para proteger. O roster (`cfg.sala`) nao guarda token nenhum.
const SEGREDOS = ["apiKey", "openrouterKey", "geminiKey", "jwtPorMembro"];

// Segredo que e MAPA nasce `{}`; os outros nascem `""`.
const _MAPAS = new Set(["jwtPorMembro"]);
const _vazioDe = (nome) => (_MAPAS.has(nome) ? {} : "");

// A MIGRACAO DO FORMATO DE UM DONO SO (spec 072, contracts/sala-config.md).
//
// Silenciosa e automatica: um `conector.json` de antes da sala sobe como uma sala de UM
// membro e UM assento — que e exatamente o que ele ja era. Ninguem reconfigura nada.
function _migrar(bruto) {
  const b = { ...(bruto || {}) };
  if (b.sala || (!b.personagem && !b.jwt && !b.authSub)) return b;
  const sub = b.authSub || "local";
  b.sala = {
    nome: "Minha sala",
    anfitriao: sub,
    tetoCustoTokens: null,
    membros: [{ sub, email: b.authEmail || "", nome: b.authName || "",
                entrouEm: new Date().toISOString() }],
    assentos: b.personagem
      ? [{ personagem: b.personagem, dono: sub, nome: b.personagem,
           // a autonomia do formato antigo era um booleano do PROCESSO; vira a vontade
           // do dono daquele assento, com o teto aberto.
           autonomia: { permitido: true, ligado: b.autonomia !== false, motivo: null },
           intervaloMs: 45000 }]
      : [],
  };
  if (b.jwt) b.jwtPorMembro = { ...(b.jwtPorMembro || {}), [sub]: b.jwt };
  delete b.jwt;
  delete b.personagem;
  return b;
}

function _montar(bruto) {
  const migrado = _migrar(bruto);
  const cfg = {};
  for (const [k, v] of Object.entries({ ...DEFAULTS, ...migrado })) {
    if (SEGREDOS.includes(k)) continue;
    cfg[k] = v;
  }
  for (const nome of SEGREDOS) {
    Object.defineProperty(cfg, nome, {
      value: migrado[nome] || _vazioDe(nome),
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

// --- as credenciais dos membros, como PORTA (spec 072) ---------------------- //
//
// `sala.js` nunca guarda um token em campo proprio: pede por aqui quando precisa. E o
// que permite testar o roster inteiro sem nenhum segredo em memoria — e o que mantem a
// trava acima como o UNICO lugar que enxerga chave.
function credenciais(cfg) {
  const c = cfg || carregar();
  return {
    ler: (sub) => (sub && c.jwtPorMembro && c.jwtPorMembro[sub]) || null,
    gravar: (sub, jwt) => {
      if (!sub || !jwt) return;
      c.jwtPorMembro = { ...(c.jwtPorMembro || {}), [sub]: jwt };
      gravar(c);
    },
    apagar: (sub) => {
      if (!sub || !c.jwtPorMembro) return;
      const copia = { ...c.jwtPorMembro };
      delete copia[sub];
      c.jwtPorMembro = copia;
      gravar(c);
    },
  };
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
  if (cfg.runtime === "gemini") return cfg.geminiKey;
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
  // `personagem` NAO e mais exigencia (spec 072, FR-008): a sala sobe VAZIA e espera
  // alguem entrar. Cobrar um personagem no boot era a marca do conector de um dono so.
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
  if (cfg.runtime === "gemini" && !cfg.geminiKey) {
    faltas.push({ campo: "geminiKey",
                  diga: "a chave do Gemini",
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
  const sala = c.sala || null;
  return {
    mundo: c.mundo, mundoPublico: c.mundoPublico || "", canal: c.canal,
    runtime: c.runtime, model: c.model, endpoint: c.endpoint,
    remoteModel: c.remoteModel,
    openrouterModel: c.openrouterModel, openrouterEndpoint: c.openrouterEndpoint,
    geminiModel: c.geminiModel,
    embeddingModel: c.embeddingModel,
    temChaveAnthropic: !!c.apiKey,
    temChaveOpenrouter: !!c.openrouterKey,
    temChaveGemini: !!c.geminiKey,
    // A SALA, sem credencial nenhuma — nem mascarada (spec 072). `pareado` deixou de
    // ser um booleano do processo e virou um por MEMBRO: com N contas, "o conector esta
    // pareado" nao responde mais a pergunta de ninguem.
    sala: sala ? {
      nome: sala.nome, anfitriao: sala.anfitriao,
      tetoCustoTokens: sala.tetoCustoTokens || null,
      membros: (sala.membros || []).map((m) => ({
        sub: m.sub, email: m.email, nome: m.nome,
        ehAnfitriao: m.sub === sala.anfitriao,
        pareado: !!(c.jwtPorMembro && c.jwtPorMembro[m.sub]) })),
      assentos: (sala.assentos || []).map((a) => ({
        personagem: a.personagem, dono: a.dono, autonomia: a.autonomia })),
    } : null,
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
  // `personagem` SAIU da lista (spec 072, FR-009): trocar o personagem do processo pela
  // pagina de configuracao era a "troca ao vivo", e ela morreu com a sala. Quem troca de
  // personagem entra e sai da sala.
  ["mundo", "runtime", "model", "endpoint", "remoteModel",
   "openrouterModel", "openrouterEndpoint", "geminiModel"].forEach(texto);
  // `mundoPublico` e a EXCECAO da regra "vazio mantem": aqui vazio significa "volte a
  // usar o endereco interno", e sem isso nao haveria como desfazer um endereco publico
  // errado pela pagina — so editando o arquivo a mao.
  if (typeof vindo.mundoPublico === "string") {
    cfg.mundoPublico = vindo.mundoPublico.trim();
  }
  if (Number(vindo.canal)) cfg.canal = Number(vindo.canal);
  if (typeof vindo.apiKey === "string" && vindo.apiKey.trim()) {
    cfg.apiKey = vindo.apiKey.trim();
  }
  if (typeof vindo.openrouterKey === "string" && vindo.openrouterKey.trim()) {
    cfg.openrouterKey = vindo.openrouterKey.trim();
  }
  if (typeof vindo.geminiKey === "string" && vindo.geminiKey.trim()) {
    cfg.geminiKey = vindo.geminiKey.trim();
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

// Grava o roster da sala. Separado de `gravar` porque a sala muda por outros gatilhos
// (alguem entrou, alguem foi expulso) que nao passam pela pagina de configuracao.
function gravarSala(cfg, sala) {
  cfg.sala = sala ? sala.paraConfig() : null;
  return gravar(cfg);
}

module.exports = { DEFAULTS, SEGREDOS, carregar, gravar, credencialDe, faltando,
                   paraPagina, aplicar, gravarAdiado, credenciais, gravarSala };
