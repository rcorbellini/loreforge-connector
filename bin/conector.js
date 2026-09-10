#!/usr/bin/env node
// O CONECTOR — a Mente do seu personagem, rodando na sua máquina.
//
// Você baixa, lê, e roda. A chave do seu modelo fica aqui e não vai a lugar
// nenhum: é a razão de este programa existir separado da tela.
//
// Três modos, o mesmo laço por baixo:
//   interativo  — você sussurra pelo terminal
//   headless    — a Mente joga sozinha, sem tela nenhuma  (--headless)
//   com tela    — a interface fala com este processo       (--canal)

"use strict";

const readline = require("readline");
const path = require("path");

const configuracao = require("../config");
const armazenamento = require("../armazenamento");
const Mente = require("../mente");   // spec 072: o módulo agora exporta `criarMente`
const { Mundo } = require("../mundo");
const { Laco } = require("../laco");
const { Sala } = require("../sala");
const { Fila } = require("../fila");
const extensoes = require("../extensoes");
const registro = require("../registro");
const { log } = require("../log");

// --------------------------------------------------------------------------- //
// Argumentos
// --------------------------------------------------------------------------- //

function lerArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith("--")) { a._.push(t); continue; }
    const nome = t.slice(2);
    const prox = argv[i + 1];
    if (prox && !prox.startsWith("--")) { a[nome] = prox; i++; }
    else a[nome] = true;
  }
  return a;
}

const AJUDA = `
O conector da Mente — Loreforge

  loreforge --canal 8899                           abre a SALA nesta porta
  loreforge --canal 8899 --expor                   ...e aceita telas de outros aparelhos
  loreforge --canal 8899 --expor --config-remota   ...e deixa MANDAR na sala de fora
  loreforge --parear                               gera o código pra alguém entrar
  loreforge --mundo <url> --personagem <id>        joga UM personagem pelo terminal
  loreforge --headless --personagem <id>           a Mente joga sozinha, sem tela
  loreforge --configurar                           grava a configuração e sai
  loreforge --verificar                            testa mundo, personagem e modelo
  loreforge --personagens                          lista quem existe no mundo
  --sala "<nome>"                                  batiza a mesa

Opções de modelo (guardadas na sua máquina, nunca enviadas ao mundo):
  --runtime local|remote|openrouter|gemini    --modelo <nome>
  --endpoint <url>                            --chave <credencial>

Configuração em: ${armazenamento.caminho()}
`;

// --------------------------------------------------------------------------- //
// Saída no terminal — o que o laço emite, aqui vira texto
// --------------------------------------------------------------------------- //

function saidaDeTerminal() {
  let narrando = false;
  return (evento, d) => {
    switch (evento) {
      case "decidiu":
        process.stdout.write(`\n· ele decide: “${d.texto}”\n`);
        break;
      case "beat":
        process.stdout.write(`\n  — ${d.texto}\n`);
        break;
      case "recusa":
        process.stdout.write(`\n  ✗ ${d.texto}\n`);
        break;
      case "narracao_inicio":
        process.stdout.write("\n");
        narrando = true;
        break;
      case "narracao":
        if (narrando) process.stdout.write(d.pedaco || "");
        break;
      case "narracao_fim":
        narrando = false;
        process.stdout.write("\n");
        break;
      case "sistema":
        process.stdout.write(`\n  (${d.texto})\n`);
        break;
      case "erro":
        process.stdout.write(`\n  ⚠ ${d.texto}\n`);
        break;
      default:
        break;   // intencao/estado: ruído no terminal
    }
  };
}

// --------------------------------------------------------------------------- //
// Primeira execução: dizer o que falta, e como (FR-009)
// --------------------------------------------------------------------------- //

function cobraConfiguracao(cfg) {
  const faltas = configuracao.faltando(cfg);
  if (!faltas.length) return false;
  process.stdout.write("\nFalta configurar antes de jogar:\n\n");
  for (const f of faltas) {
    process.stdout.write(`  • ${f.diga}\n      ${f.como}\n`);
  }
  process.stdout.write(
    `\n  Para gravar de uma vez:\n` +
    `      loreforge --configurar --mundo <url>\n` +
    `\n  A configuração fica em ${armazenamento.caminho()} (só na sua máquina).\n\n`);
  return true;
}

// --------------------------------------------------------------------------- //
// Diagnóstico
// --------------------------------------------------------------------------- //

async function verificar(cfg, mundo) {
  const linhas = [];
  let tudoBem = true;

  try {
    const chars = await mundo.personagens();
    linhas.push(`  ✓ mundo alcançável (${chars.length} personagens)`);
  } catch (e) {
    linhas.push(`  ✗ mundo inalcançável em ${cfg.mundo}: ${e.message}`);
    tudoBem = false;
  }

  // spec 056: mundo com login ligado exige pareamento E posse — sem isto, o
  // conector so descobriria o 403 no meio de um turno de LLM já gasto.
  try {
    const authCfg = await mundo.authConfig();
    if (authCfg && authCfg.google_client_id) {
      // spec 072: a posse é POR ASSENTO agora, conferida na hora de entrar na sala
      // (`/sala/entrar`, com o JWT de quem entra). O que o diagnóstico ainda pode dizer
      // é se ALGUÉM pareou — sem anfitrião, a sala não tem como aceitar ninguém.
      const membros = (cfg.sala && cfg.sala.membros) || [];
      if (!membros.length) {
        linhas.push("  ✗ este mundo exige login e ninguém pareou nesta sala " +
                    "(rode `loreforge --parear`)");
        tudoBem = false;
      } else {
        linhas.push(`  ✓ ${membros.length} membro(s) pareado(s): ` +
                    membros.map((m) => m.email || m.sub).join(", "));
      }
    } else {
      linhas.push("  · mundo sem login exigido (modo legado)");
    }
  } catch (e) {
    linhas.push(`  ✗ não consegui checar autenticação: ${e.message}`);
    tudoBem = false;
  }

  const m = await Mente.check();
  linhas.push(m.ok ? `  ✓ modelo: ${m.reason}` : `  ✗ modelo: ${m.reason}`);
  if (!m.ok) tudoBem = false;

  // TOOL-CALLING é o que separa um turno com schema imposto de um turno de
  // adivinhação. Vale conferir explicitamente, e não descobrir jogando.
  const primeiro = (cfg.sala && cfg.sala.assentos || [])[0];
  if (!primeiro) {
    linhas.push("  · sala vazia: sem assento não há cena para checar capacidades");
  } else {
    try {
      const m = new Mundo(cfg.mundo, primeiro.personagem);
      m.jwt = (cfg.jwtPorMembro || {})[primeiro.dono] || null;
      const tools = await m.listarCapacidades();
      linhas.push(tools.length
        ? `  ✓ a cena de '${primeiro.personagem}' oferece ${tools.length} capacidades`
        : `  ✗ a cena de '${primeiro.personagem}' não ofereceu capacidade nenhuma`);
      if (!tools.length) tudoBem = false;
    } catch (e) {
      linhas.push(`  ✗ não consegui ler as capacidades da cena: ${e.message}`);
      tudoBem = false;
    }
  }

  process.stdout.write("\n" + linhas.join("\n") + "\n\n");
  return tudoBem;
}

// A GUARDA DE POSSE (spec 056) SAIU DAQUI (spec 072).
//
// Ela conferia, no boot, se O personagem do processo era da conta pareada — a pergunta
// certa quando havia um dono e um personagem. Numa sala a pergunta é outra e acontece
// em outro momento: cada assento confere a posse NA HORA DE ENTRAR (`/sala/entrar`), e
// com o JWT de QUEM ESTÁ ENTRANDO. Conferir no boot não teria o que conferir — a sala
// sobe vazia.
//
// O que continua valendo é o motivo: recusar antes de gastar turno de LLM à toa.

// --------------------------------------------------------------------------- //
// Principal
// --------------------------------------------------------------------------- //

async function main() {
  const args = lerArgs(process.argv.slice(2));
  if (args.ajuda || args.help || args.h) {
    process.stdout.write(AJUDA);
    return 0;
  }

  // O que veio na linha de comando pesa mais que o arquivo — e, com
  // `--configurar`, vira o arquivo.
  const cfg = configuracao.carregar();
  if (args.mundo) cfg.mundo = String(args.mundo);
  // `--personagem` deixou de virar configuracao (spec 072): e SEMENTE de assento,
  // lida direto de `args` la embaixo. O conector nao tem mais "o personagem dele".
  if (args.runtime) cfg.runtime = String(args.runtime);
  if (args.modelo) cfg.model = String(args.modelo);
  if (args.endpoint) cfg.endpoint = String(args.endpoint);
  if (args.canal) cfg.canal = Number(args.canal) || cfg.canal;
  if (args.chave) {
    if (cfg.runtime === "openrouter") cfg.openrouterKey = String(args.chave);
    else if (cfg.runtime === "gemini") cfg.geminiKey = String(args.chave);
    else cfg.apiKey = String(args.chave);
  }

  if (args.configurar) {
    const onde = configuracao.gravar(cfg);
    process.stdout.write(`\nConfiguração gravada em ${onde}\n`);
    cobraConfiguracao(configuracao.carregar(true));
    return 0;
  }

  if (args.personagens) {
    const mundo = new Mundo(cfg.mundo, null);
    const chars = await mundo.personagens();
    process.stdout.write("\n" + chars.map((c) =>
      `  ${c.id || c}${c.name ? "  — " + c.name : ""}`).join("\n") + "\n\n");
    return 0;
  }

  // --parear é ação própria (como --configurar/--personagens): não precisa de
  // --personagem, só de --mundo, e não compõe com --headless/--canal na mesma
  // chamada — pareia e sai. Sobe o canal só pra ISSO, e derruba no final.
  if (args.parear) {
    if (!cfg.mundo) {
      process.stdout.write(
        "\nDefina --mundo antes de parear (ex.: --mundo http://localhost:8777).\n\n");
      return 1;
    }
    const mundoP = new Mundo(cfg.mundo, null);
    let authCfg;
    try {
      authCfg = await mundoP.authConfig();
    } catch (e) {
      process.stdout.write(
        `\nNão consegui alcançar o mundo em ${cfg.mundo}: ${e.message}\n\n`);
      return 1;
    }
    if (!authCfg || !authCfg.google_client_id) {
      process.stdout.write(
        "\nEste mundo não exige login (auth desligada) — não há o que parear.\n\n");
      return 0;
    }
    const porta = Number(args.canal) || cfg.canal;
    const painelVazio = {
      ler: async () => ({}), salvar: async () => ({ ok: true }),
      gravarPrompt: () => ({ ok: true }), reiniciar: async () => ({ ok: true }),
    };
    // Uma sala de verdade, restaurada do disco: quem parear aqui ENTRA NELA e fica
    // gravado. Antes isto escrevia num campo único do processo; agora acrescenta membro,
    // e o segundo a parear é convidado, não substituto do primeiro.
    const salaP = Sala.deConfig(cfg.sala, {
      credenciais: configuracao.credenciais(cfg),
      fabricas: { assento: async () => ({}) },
    });
    let resolverPareado;
    const aguardarPareado = new Promise((resolve) => { resolverPareado = resolve; });
    const c = await require("../canal").servir({
      porta, sala: salaP, fila: new Fila({ sala: salaP }), cfg, expor: !!args.expor,
      painel: painelVazio, permitirConfigRemota: false,
      mundo: mundoP, configuracao, authAtivo: true,
      onPareado: (quem) => resolverPareado({ ok: true, quem }),
    });
    const { codigo, expiraEm } = c.gerarCodigoPareamento();
    const primeiro = !salaP.anfitriao;
    process.stdout.write(
      `\nCódigo de pareamento: ${codigo}\n` +
      `  Cole no client, em Configurações → Pareamento do Conector, em até ` +
      `${Math.round((expiraEm - Date.now()) / 60000)} minutos.\n` +
      (primeiro ? "  Quem parear primeiro vira o ANFITRIÃO da sala.\n"
                : `  A sala já tem ${salaP.membros.size} membro(s); este entra como convidado.\n`) +
      `  Escutando em http://${args.expor ? "0.0.0.0" : "127.0.0.1"}:${porta}\n\n`);
    const resultado = await Promise.race([
      aguardarPareado,
      new Promise((resolve) => setTimeout(() => resolve({ ok: false }),
                                           expiraEm - Date.now() + 500)),
    ]);
    await c.fechar();
    if (resultado.ok) {
      process.stdout.write(
        `\nPareado com ${resultado.quem.email}. Pronto pra entrar na sala.\n` +
        `  A credencial de mundo dessa conta fica GUARDADA nesta máquina — é o que\n` +
        `  permite o personagem jogar com a tela fechada. Expulsar é o que a apaga.\n\n`);
      return 0;
    }
    process.stdout.write(
      "\nExpirou sem ninguém parear. Rode --parear de novo quando quiser.\n\n");
    return 1;
  }
  if (cobraConfiguracao(cfg)) return 1;

  // O CLIENTE DE SALA — sem personagem nenhum. Serve só ao que é da MESA: validar
  // token, perguntar a configuração de auth, listar personagens. Quem fala com o mundo
  // POR CONTA de um personagem é o `Mundo` daquele assento, com o JWT do dono dele.
  const mundo = new Mundo(cfg.mundo, null);

  if (args.verificar) return (await verificar(cfg, mundo)) ? 0 : 1;

  // Computado uma vez: se o mundo troca de auth.secret no meio da sessão, a
  // reinicialização (já existente, `/api/reiniciar`) é o caminho — não vale a
  // pena checar de novo a cada sussurro por uma mudança que não acontece ao
  // vivo.
  let authAtivo = false;
  try {
    const authCfg = await mundo.authConfig();
    authAtivo = !!(authCfg && authCfg.google_client_id);
  } catch (_) { /* mundo fora do ar agora: o erro de verdade aparece adiante */ }

  const ext = extensoes.criar(path.join(__dirname, "..", "extensoes"));

  const noTerminal = saidaDeTerminal();
  let paraOCanal = null;

  // O que ficou esperando o turno acabar (ver `painel.salvar`).
  let pendente = null;

  // A EMISSÃO DE TODO ASSENTO passa por aqui. O laço já carimba `personagem` e `escopo`
  // (spec 072, FR-017); este ponto só decide PARA ONDE vai.
  const emitir = (ev, d) => {
    if (!args.canal || args.eco) noTerminal(ev, d);
    if (paraOCanal) paraOCanal(ev, d);
    if (ev === "estado" && d && d.ocupado === false && pendente) {
      const agora = pendente;
      pendente = null;
      try {
        aplicarConfig(agora);
        log("CONFIGURAÇÃO ADIADA APLICADA", Object.keys(agora).join(", "));
      } catch (e) {
        log("NÃO CONSEGUI APLICAR A CONFIGURAÇÃO ADIADA", e.message);
      }
    }
  };

  // A FÁBRICA DE ASSENTO — o único lugar que conhece o mundo, a Mente e as extensões ao
  // mesmo tempo, e por isso é daqui que ela vem, não de dentro de `sala.js`.
  //
  // CADA ASSENTO GANHA O SEU (FR-006/FR-007): `Mundo` próprio (a tabela de resolução é da
  // CENA daquele personagem e não pode vazar para outro), `Mente` própria (a fatura é do
  // jogador dele) e `Laco` próprio. E o JWT que vai é o do DONO — nunca o do anfitrião,
  // que é o que faria o server responder 403 em todo turno de convidado.
  const fabricaDeAssento = async ({ personagem, dono, jwt }) => {
    const meuMundo = new Mundo(cfg.mundo, personagem);
    meuMundo.jwt = jwt || null;
    // O 401 DO MUNDO CHEGA À SALA (research R6). Sem este fio, `sala.falhou401` seria
    // guarda inerte — o mecanismo existiria e ninguém o chamaria, que é o modo de falha
    // que este projeto já pagou caro para aprender a evitar.
    meuMundo.onIdentidade = (status) => {
      if (status === 401 || status === 403) {
        if (sala.falhou401(dono)) {
          fila.removerDe(dono);
          emitir("sistema", { personagem, escopo: "dono", texto:
            "O mundo deixou de aceitar a sua identidade. Seus personagens saíram da " +
            "fila — pareie de novo para voltar." });
        }
      } else if (status >= 200 && status < 300) {
        sala.respondeuBem(dono);
      }
    };
    const minhaMente = Mente.criarMente({ mundo: meuMundo, extensoes: ext });
    const reg = registro.criar({ mundo: meuMundo, cfg: { ...cfg, personagem },
                                 extensoes: ext, mente: minhaMente,
                                 sala: sala.nome, membro: dono });
    const laco = new Laco({ mundo: meuMundo, mente: minhaMente, extensoes: ext,
                            registro: reg, emitir });
    // O NOME do personagem, para a tela da mesa. Falhar aqui não impede sentar: o id
    // serve de nome, e o mundo fora do ar agora não é motivo para recusar a cadeira.
    let nome = personagem;
    try {
      const ctx = await meuMundo.contexto();
      nome = (ctx && ctx.self && ctx.self.name) || personagem;
    } catch (_) { /* segue com o id */ }
    return { mundo: meuMundo, mente: minhaMente, laco, nome };
  };

  // A SALA — restaurada do que estava gravado, ou nova e vazia. Ela SOBE VAZIA de
  // propósito (FR-008): cobrar um personagem no boot era a marca do conector de um dono
  // só, e agora quem enche a mesa é quem entra nela.
  const sala = Sala.deConfig(cfg.sala, {
    credenciais: configuracao.credenciais(cfg),
    fabricas: { assento: fabricaDeAssento },
    emitir: (ev, d) => emitir(ev, { ...d, escopo: d && d.escopo ? d.escopo : "mesa" }),
  });
  if (args.sala) sala.nome = String(args.sala);

  // MODO LEGADO: mundo sem `auth.secret` não tem pareamento — e sem pareamento não
  // haveria membro nenhum, então a sala recusaria TODO MUNDO, inclusive o dono da
  // máquina. O jogo local não pode ficar mais difícil por causa da sala: aqui existe um
  // membro único e implícito, que é exatamente o que o conector de um dono só era.
  if (!authAtivo && !sala.anfitriao) {
    sala.acrescentarMembro({ sub: "local", nome: "local" });
  }

  const fila = new Fila({ sala, emitir });
  if (!args["sem-autonomia"]) fila.iniciar();

  function aplicarConfig(vindo) {
    configuracao.aplicar(cfg, vindo);
    configuracao.gravar(cfg);
    // A "TROCA DE PERSONAGEM AO VIVO" MORREU AQUI (spec 072, FR-009).
    //
    // Ela existia porque um conector servia UM personagem, e trocar exigiria reiniciar o
    // processo. Com a sala não se troca o personagem do processo: entra-se e sai-se da
    // mesa (`/sala/entrar`, `/sala/sair`). Manter as duas vias seria a duplicação que o
    // Princípio I proíbe — então a antiga saiu, não ficou em paralelo.
    if (typeof vindo.tetoCustoTokens !== "undefined") {
      sala.tetoCustoTokens = Number(vindo.tetoCustoTokens) || null;
      sala.pausadaPorCusto = false;
      configuracao.gravarSala(cfg, sala);
    }
  }

  // A SEMENTE (FR-008). `--personagem` deixou de ser exigência e virou conveniência:
  // quem joga sozinho não quer passar por tela de sala nenhuma para começar. Só funciona
  // se já houver um anfitrião pareado (ou se o mundo não exigir login).
  async function semear(personagem) {
    if (!personagem) return null;
    const dono = sala.anfitriao;
    if (!dono) {
      process.stdout.write(
        `\nNão dá para semear '${personagem}': este mundo exige login e ninguém pareou.\n` +
        `  Rode \`loreforge --parear\` primeiro.\n\n`);
      return null;
    }
    const r = await sala.assentar({ personagem, sub: dono });
    if (r.erro) {
      process.stdout.write(`\nNão consegui sentar '${personagem}': ${r.erro}\n\n`);
      return null;
    }
    configuracao.gravarSala(cfg, sala);
    return sala.assentoDe(personagem);
  }

  const semeado = await semear(args.personagem
    || (cfg.sala && cfg.sala.assentos && cfg.sala.assentos.length === 1
        ? cfg.sala.assentos[0].personagem : null));

  if (args.canal) {
    // O PAINEL: o que a página de configuração pode ler e escrever. Fica aqui,
    // e não dentro do canal, porque só este ponto conhece a Mente, o mundo e as
    // extensões ao mesmo tempo — o canal é transporte, não dono de nada.
    const painel = {
      async ler() {
        let personagens = [];
        try { personagens = await mundo.personagens(); } catch (_) {}
        let modelo = { ok: false, reason: "não verificado" };
        try { modelo = await Mente.check(); } catch (e) { modelo = { ok: false, reason: e.message }; }
        return {
          config: configuracao.paraPagina(cfg),
          personagens,
          modelo,
          rotinas: Mente.ROTINAS,
          padroes: Mente.promptsPadrao(),
          extensoes: ext.inventario(),
          // A MESA no lugar do laço único: quem está sentado, quem joga, quem espera, e
          // — o que o anfitrião mais precisa ver — o custo por membro.
          mesa: { ...sala.paraTela(), ...fila.estado() },
          // HÁ QUANTO TEMPO o turno em voo está correndo. `ocupado` sozinho não distingue
          // um turno normal de um pendurado, e é o pendurado que precisa de aviso na
          // tela. Um turno pendurado não emite evento nenhum, e é justamente o silêncio
          // que precisa virar aviso.
          ocupadoDesde: (() => {
            const a = fila.jogando && sala.assentoDe(fila.jogando);
            return (a && a.laco && a.laco.ocupadoDesde) || null;
          })(),
          // o que já está no disco mas ainda não entrou em vigor
          pendente: pendente ? Object.keys(pendente) : [],
        };
      },

      // SALVAR NUNCA É RECUSADO.
      //
      // A primeira versão devolvia erro com um turno correndo, e isso é castigo:
      // a edição é do jogador, e mandá-lo digitar tudo de novo porque a Mente
      // estava pensando não protege nada que importe.
      //
      // O que de fato não pode mudar no meio de um turno é o ALVO do turno em voo.
      // Então: DISCO AGORA (a edição não se perde nem se o processo morrer), MEMÓRIA
      // quando o turno acabar.
      async salvar(vindo) {
        if (fila.jogando) {
          configuracao.gravarAdiado(cfg, vindo);
          pendente = { ...(pendente || {}), ...vindo };
          return { ok: true, adiado: true, ...(await painel.ler()) };
        }
        aplicarConfig(vindo);
        return { ok: true, ...(await painel.ler()) };
      },

      gravarPrompt: (nome, texto) => ext.gravarPrompt(nome, texto),

      // REINICIAR O PRÓPRIO PROCESSO.
      //
      // Por que isto existe: um turno pendurado (o modelo que não responde, a rede
      // que sumiu) trava a mesa INTEIRA em silêncio. Com a spec 072 o prazo do turno
      // (`fila.js`) já solta a pista sozinho, mas o botão continua sendo a saída para o
      // processo que enrolou de outro jeito — e quem joga a tela de outro aparelho
      // (`--expor`) não tem terminal nenhum.
      //
      // NÃO é "reiniciar o turno" nem "reiniciar o mundo": nada do mundo é tocado,
      // e o que estava gravado no disco é justamente o que volta a valer, porque o
      // processo novo LÊ a configuração ao subir — o roster da sala inclusive.
      //
      // Re-exec com o MESMO argv: as flags de quem subiu o processo (--canal,
      // --expor, --config-remota) têm de sobreviver, senão "reiniciar" mudaria
      // silenciosamente o modo de operação — e o pior caso seria fechar o acesso
      // de rede de quem está justamente usando a tela por ele.
      async reiniciar() {
        // A ORDEM É O QUE FAZ FUNCIONAR: primeiro devolve-se a resposta HTTP (quem
        // clicou precisa saber que o pedido chegou), depois fecha-se a porta, e só
        // então nasce o filho — que precisa da porta livre para escutar. Nascer
        // antes de fechar era colisão de bind: o filho morria e ninguém voltava.
        setTimeout(async () => {
          log("REINICIANDO A PEDIDO DA TELA", process.argv.slice(1).join(" "));
          try { fila.parar(); } catch (_) {}
          try { await c.fechar(); } catch (_) {}
          try {
            const filho = require("child_process")
              .spawn(process.argv[0], process.argv.slice(1),
                     // `inherit` mantém o log indo para onde já ia (arquivo do
                     // nohup, ou o terminal); `detached` é o que faz o filho
                     // sobreviver à morte do pai.
                     { detached: true, stdio: "inherit", cwd: process.cwd() });
            filho.unref();
          } catch (e) {
            // Falhar aqui é o pior caso possível: a porta já fechou e nenhum filho
            // subiu, então não há mais tela para avisar. Fica no log, que é o único
            // canal que resta, e o processo SEGUE VIVO em vez de morrer calado.
            log("NÃO CONSEGUI REINICIAR — o processo segue no ar sem a tela", e.message);
            return;
          }
          process.exit(0);
        }, 300);
        return { ok: true, reiniciando: true };
      },
    };

    const c = await require("../canal").servir({ porta: cfg.canal, sala, fila, cfg,
                                                expor: !!args.expor, painel,
                                                permitirConfigRemota:
                                                  !!args["config-remota"],
                                                mundo, configuracao, authAtivo });
    paraOCanal = c.emitir;
    if (args.expor) {
      process.stdout.write(
        `\n⚠  ABERTO NA REDE (--expor). Qualquer aparelho que alcance esta porta pode\n` +
        `   entrar na sala com o código de pareamento — e cada jogada gasta o SEU\n` +
        `   modelo. A sua chave não é servida por aqui, mas a conta é sua.\n` +
        `   E as credenciais de mundo de quem entrar ficam GUARDADAS nesta máquina:\n` +
        `   expulsar é a única forma de tirá-las. Use com gente que você conhece.\n`);
    }
    process.stdout.write(
      `\nA sala '${sala.nome}' está no ar em ` +
      `http://${args.expor ? "0.0.0.0" : "127.0.0.1"}:${cfg.canal}\n` +
      `  mundo: ${cfg.mundo}\n` +
      `  modelo: ${registro.rotuloDoModelo(cfg)}\n` +
      `  à mesa: ${sala.assentos.size} assento(s), ${sala.membros.size} membro(s)\n` +
      (sala.anfitriao ? "" : "  (ninguém pareou ainda — gere um código no painel)\n") +
      `\n  painel: http://127.0.0.1:${cfg.canal}/\n` +
      `\nAs telas agora podem conectar. Ctrl+C encerra.\n\n`);
  }

  // --- os modos de UM jogador só ------------------------------------------- //
  //
  // `--headless` e o terminal interativo continuam sendo de UM personagem: são as portas
  // de quem joga sozinho, e a sala não muda isso. O que muda é que eles agora operam
  // sobre um ASSENTO da mesa em vez de sobre "o personagem do processo".

  if (args.headless) {
    if (!semeado) {
      process.stdout.write(
        "\n--headless precisa de um personagem: use --personagem <id>.\n\n");
      return 1;
    }
    const total = Number(args.turnos) || 0;
    process.stdout.write(
      `\nA Mente de '${semeado.nome}' joga sozinha` +
      (total ? ` por ${total} turnos` : " até você interromper") + ".\n");
    let n = 0;
    for (;;) {
      if (total && n >= total) break;
      n++;
      await semeado.laco.talvezAgirSozinho();
      await new Promise((r) => setTimeout(r, Number(args.intervalo) || 3000));
    }
    process.stdout.write(`\n${n} turnos jogados.\n`);
    return 0;
  }

  if (args.canal) {
    await new Promise(() => {});   // serve até Ctrl+C
    return 0;
  }

  if (!semeado) {
    process.stdout.write(
      "\nO terminal interativo precisa de um personagem: use --personagem <id>.\n" +
      "  (ou suba com --canal e entre na sala por uma tela)\n\n");
    return 1;
  }

  // Modo interativo de terminal.
  process.stdout.write(
    `\nVocê guia '${semeado.nome}'. Sussurre o que ele deve fazer.\n` +
    `  (linha vazia: ele decide sozinho · Ctrl+C encerra)\n\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // Entrada FECHADA (Ctrl+D, ou um roteiro canalizado por pipe) é fim de sessão,
  // não defeito. Sem isto o processo morria com um rastro de pilha na cara de
  // quem só quis rodar um roteiro — e a primeira impressão do conector é
  // justamente o que esta spec trata como requisito.
  let acabou = false;
  rl.on("close", () => { acabou = true; });
  const pergunta = () => new Promise((r) => {
    if (acabou) return r(null);
    rl.question("› ", r);
  });
  for (;;) {
    const linha = await pergunta();
    if (linha === null || acabou) break;
    const texto = linha.trim();
    if (texto === "sair" || texto === "/sair") break;
    if (!texto) await semeado.laco.talvezAgirSozinho();
    else await semeado.laco.sussurrar(texto, "manual");
  }
  rl.close();
  process.stdout.write("\n");
  return 0;
}

main().then((c) => process.exit(c || 0)).catch((e) => {
  process.stderr.write(`\n⚠ ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
