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
const Mente = require("../mente");
const { Mundo } = require("../mundo");
const { Laco } = require("../laco");
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

  loreforge --mundo <url> --personagem <id>        joga pelo terminal
  loreforge --headless --turnos 50                 a Mente joga sozinha
  loreforge --canal 8899                           serve a tela nesta porta
  loreforge --canal 8899 --expor                   ...e aceita a tela de outro aparelho
  loreforge --canal 8899 --expor --config-remota   ...e deixa CONFIGURAR de fora
  loreforge --configurar                           grava a configuração e sai
  loreforge --verificar                            testa mundo, personagem e modelo
  loreforge --personagens                          lista quem existe no mundo

Opções de modelo (guardadas na sua máquina, nunca enviadas ao mundo):
  --runtime local|remote|openrouter    --modelo <nome>
  --endpoint <url>                     --chave <credencial>

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
    `      loreforge --configurar --mundo <url> --personagem <id>\n` +
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
    const existe = chars.some((c) => (c.id || c) === cfg.personagem);
    if (existe) linhas.push(`  ✓ personagem '${cfg.personagem}' existe`);
    else { linhas.push(`  ✗ personagem '${cfg.personagem}' não existe neste mundo`); tudoBem = false; }
  } catch (e) {
    linhas.push(`  ✗ mundo inalcançável em ${cfg.mundo}: ${e.message}`);
    tudoBem = false;
  }

  const m = await Mente.check();
  linhas.push(m.ok ? `  ✓ modelo: ${m.reason}` : `  ✗ modelo: ${m.reason}`);
  if (!m.ok) tudoBem = false;

  // TOOL-CALLING é o que separa um turno com schema imposto de um turno de
  // adivinhação. Vale conferir explicitamente, e não descobrir jogando.
  try {
    const tools = await mundo.listarCapacidades();
    linhas.push(tools.length
      ? `  ✓ a cena oferece ${tools.length} capacidades`
      : `  ✗ a cena não ofereceu capacidade nenhuma`);
    if (!tools.length) tudoBem = false;
  } catch (e) {
    linhas.push(`  ✗ não consegui ler as capacidades da cena: ${e.message}`);
    tudoBem = false;
  }

  process.stdout.write("\n" + linhas.join("\n") + "\n\n");
  return tudoBem;
}

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
  if (args.personagem) cfg.personagem = String(args.personagem);
  if (args.runtime) cfg.runtime = String(args.runtime);
  if (args.modelo) cfg.model = String(args.modelo);
  if (args.endpoint) cfg.endpoint = String(args.endpoint);
  if (args.canal) cfg.canal = Number(args.canal) || cfg.canal;
  if (args.chave) {
    if (cfg.runtime === "openrouter") cfg.openrouterKey = String(args.chave);
    else cfg.apiKey = String(args.chave);
  }

  if (args.configurar) {
    const onde = configuracao.gravar(cfg);
    process.stdout.write(`\nConfiguração gravada em ${onde}\n`);
    cobraConfiguracao(configuracao.carregar(true));
    return 0;
  }

  if (args.personagens) {
    const mundo = new Mundo(cfg.mundo, cfg.personagem);
    const chars = await mundo.personagens();
    process.stdout.write("\n" + chars.map((c) =>
      `  ${c.id || c}${c.name ? "  — " + c.name : ""}`).join("\n") + "\n\n");
    return 0;
  }

  if (cobraConfiguracao(cfg)) return 1;

  const mundo = new Mundo(cfg.mundo, cfg.personagem);
  Mente.usarMundo(mundo);

  if (args.verificar) return (await verificar(cfg, mundo)) ? 0 : 1;

  const ext = extensoes.criar(path.join(__dirname, "..", "extensoes"));
  Mente.usarExtensoes(ext);
  const reg = registro.criar({ mundo, cfg, extensoes: ext, mente: Mente });

  const noTerminal = saidaDeTerminal();
  let paraOCanal = null;

  // O que ficou esperando o turno acabar (ver `painel.salvar`).
  let pendente = null;

  function aplicarConfig(vindo) {
    const antes = cfg.personagem;
    configuracao.aplicar(cfg, vindo);
    configuracao.gravar(cfg);

    // TROCA DE PERSONAGEM AO VIVO. Um conector serve UM personagem; sem isto
    // trocar exigiria reiniciar o processo, e a tela ficaria mostrando um dono
    // que já não é o que joga.
    if (cfg.personagem !== antes) {
      mundo.personagem = cfg.personagem;
      mundo.capacidadesDaCena = null;   // a face agora é de OUTRA cena
      laco.numeroTurno = 0;
    }
    // o relógio da autonomia: ligar/desligar sem reiniciar nada
    if (typeof vindo.autonomia === "boolean") {
      if (vindo.autonomia && !laco.autonomia) laco.iniciarAutonomia();
      else if (laco.autonomia) laco.autonomia.pausar(!vindo.autonomia);
    }
    laco._emite("estado", { ocupado: laco.ocupado });
  }

  const laco = new Laco({
    mundo, mente: Mente, extensoes: ext, registro: reg,
    emitir: (ev, d) => {
      if (!args.canal || args.eco) noTerminal(ev, d);
      if (paraOCanal) paraOCanal(ev, d);
      // O turno acabou: é agora que o que ficou guardado entra em vigor.
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
    },
  });

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
          autonomia: laco.autonomia
            ? { ligada: true, pausado: laco.autonomia.pausado }
            : { ligada: false, pausado: true },
          turnos: laco.numeroTurno,
          ocupado: laco.ocupado,
          // HÁ QUANTO TEMPO está ocupado. `ocupado` sozinho não distingue um turno
          // normal de um pendurado, e é o pendurado que precisa de aviso na tela.
          // Vão os DOIS: os segundos para quem só lê, e o instante para a tela poder
          // continuar contando sozinha — um turno pendurado não emite evento nenhum,
          // e é justamente o silêncio que precisa virar aviso.
          ocupadoDesde: laco.ocupadoDesde || null,
          ocupadoSegundos: laco.ocupadoDesde
            ? Math.round((Date.now() - laco.ocupadoDesde) / 1000) : 0,
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
      // O que de fato não pode mudar no meio de um turno é o ALVO — trocar o
      // personagem com propostas a caminho faria o resto do turno cair em cima
      // de outra pessoa. Então: DISCO AGORA (a edição não se perde nem se o
      // processo morrer), MEMÓRIA quando o turno acabar.
      async salvar(vindo) {
        if (laco.ocupado) {
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
      // que sumiu) trava o conector INTEIRO em silêncio. `ocupado` nunca volta a
      // false, então a autonomia para de tickar e a configuração adiada — a troca
      // de personagem, inclusive — fica presa no disco sem nunca entrar em vigor.
      // Sem este botão, a única saída é ir ao terminal matar o processo; e quem
      // joga a tela de outro aparelho (`--expor`) não tem terminal nenhum.
      //
      // NÃO é "reiniciar o turno" nem "reiniciar o mundo": nada do mundo é tocado,
      // e o que estava gravado no disco é justamente o que volta a valer, porque o
      // processo novo LÊ a configuração ao subir. É por isso que reiniciar resolve
      // a configuração encalhada em vez de perdê-la.
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

    const c = await require("../canal").servir({ porta: cfg.canal, laco, cfg,
                                                expor: !!args.expor, painel,
                                                permitirConfigRemota:
                                                  !!args["config-remota"] });
    paraOCanal = c.emitir;
    // Com tela aberta, a Mente continua tendo iniciativa própria — o relógio é
    // daqui agora, não da aba. `--sem-autonomia` desliga.
    if (!args["sem-autonomia"]) laco.iniciarAutonomia();
    if (args.expor) {
      process.stdout.write(
        `\n⚠  ABERTO NA REDE LOCAL (--expor). Qualquer aparelho da sua rede alcança\n` +
        `   este conector — e ele age no mundo com o SEU personagem e gasta o SEU\n` +
        `   modelo. A sua credencial não é servida por aqui, mas quem alcançar esta\n` +
        `   porta joga no seu lugar. Use em rede de casa, nunca em rede pública.\n`);
    }
    process.stdout.write(
      `\nA Mente de '${cfg.personagem}' está no ar em ` +
      `http://${args.expor ? "0.0.0.0" : "127.0.0.1"}:${cfg.canal}\n` +
      `  mundo: ${cfg.mundo}\n` +
      `  modelo: ${registro.rotuloDoModelo(cfg)}\n` +
      `\n  configurar: http://127.0.0.1:${cfg.canal}/\n` +
      `\nA tela agora pode conectar. Ctrl+C encerra.\n\n`);
  }

  if (args.headless) {
    const total = Number(args.turnos) || 0;
    process.stdout.write(
      `\nA Mente de '${cfg.personagem}' joga sozinha` +
      (total ? ` por ${total} turnos` : " até você interromper") + ".\n");
    let n = 0;
    for (;;) {
      if (total && n >= total) break;
      n++;
      await laco.talvezAgirSozinho();
      await new Promise((r) => setTimeout(r, Number(args.intervalo) || 3000));
    }
    process.stdout.write(`\n${n} turnos jogados.\n`);
    return 0;
  }

  if (args.canal) {
    await new Promise(() => {});   // serve até Ctrl+C
    return 0;
  }

  // Modo interativo de terminal.
  process.stdout.write(
    `\nVocê guia '${cfg.personagem}'. Sussurre o que ele deve fazer.\n` +
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
    if (!texto) await laco.talvezAgirSozinho();
    else await laco.sussurrar(texto, "manual");
  }
  rl.close();
  process.stdout.write("\n");
  return 0;
}

main().then((c) => process.exit(c || 0)).catch((e) => {
  process.stderr.write(`\n⚠ ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
