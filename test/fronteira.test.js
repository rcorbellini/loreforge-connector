// A FRONTEIRA — o que sustenta a promessa de que este conector pode ir embora.
//
// O destino declarado do conector é outro repositório. Se ele importar qualquer
// coisa de `client/` ou de `server/`, "migrar" deixa de ser um `git mv` e vira
// uma cirurgia — e essa degradação acontece no primeiro dia de pressa, não num
// momento de decisão.
//
// O repo já tem o precedente: há um teste que afirma que o servidor de protocolo
// não importa o Motor. Este é o mesmo movimento, do outro lado da fronteira.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");

function arquivosJs(dir, achados = []) {
  for (const nome of fs.readdirSync(dir)) {
    if (nome === "node_modules" || nome === "test") continue;
    const p = path.join(dir, nome);
    const st = fs.statSync(p);
    if (st.isDirectory()) arquivosJs(p, achados);
    else if (nome.endsWith(".js")) achados.push(p);
  }
  return achados;
}

test("nenhum arquivo do conector importa client/ ou server/", () => {
  const suspeitos = [];
  for (const arq of arquivosJs(RAIZ)) {
    const texto = fs.readFileSync(arq, "utf8");
    const requires = [...texto.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)]
                       .map((m) => m[1]);
    for (const r of requires) {
      if (!r.startsWith(".")) continue;               // builtin do Node: ok
      const alvo = path.resolve(path.dirname(arq), r);
      if (!alvo.startsWith(RAIZ)) {
        suspeitos.push(`${path.relative(RAIZ, arq)} → ${r}`);
      }
    }
  }
  assert.deepStrictEqual(suspeitos, [],
    "o conector alcançou código de fora da própria pasta");
});

test("o conector não depende de pacote de terceiro", () => {
  const pkg = require("../package.json");
  assert.deepStrictEqual(pkg.dependencies || {}, {},
    "dependência de terceiro entrou — e com ela morre o 'leia antes de rodar'");
  assert.deepStrictEqual(pkg.devDependencies || {}, {});
});

test("nada do conector menciona caminho de dentro do server ou do client", () => {
  const proibidos = [/\.\.\/server\//, /\.\.\/client\//, /require\(["']motor/];
  const suspeitos = [];
  for (const arq of arquivosJs(RAIZ)) {
    const texto = fs.readFileSync(arq, "utf8");
    // comentários citam `client/app.js` e `server/app.py` de propósito, para
    // dizer de onde o código veio — o que se proíbe é ALCANÇAR, não citar.
    const semComentarios = texto.replace(/\/\/[^\n]*/g, "")
                                .replace(/\/\*[\s\S]*?\*\//g, "");
    for (const p of proibidos) {
      if (p.test(semComentarios)) suspeitos.push(path.relative(RAIZ, arq));
    }
  }
  assert.deepStrictEqual(suspeitos, []);
});
