// Confere uma música gerada pelo UltraSinger antes de levar pra festa: põe a
// voz original (o arquivo [Vocals] que vem junto) pra "cantar" no gogó e mostra
// quantos pontos ela faria. Se nem a cantora original pontua bem, as notas do
// .txt estão erradas — e ninguém vai conseguir pontuar.
//
// Uso:  node conferir_musica.mjs "pasta/Artista - Musica.txt" [caminho do ffmpeg] [--corrigir]
// Com --corrigir, se a letra estiver adiantada ou atrasada em relação à voz,
// ajusta o #GAP do .txt pra ela cair no tempo.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { lerMusica, batidaNoTempo, notaNoTempo, parteSolo } from "./site/js/musica.js";
import { ouvir, hzParaMidi } from "./site/js/nota.js";
import { Placar, DIFICULDADES } from "./site/js/pontuacao.js";

const TAXA = 48000;
const JANELA = 2048;      // o mesmo pedaço que o celular analisa
const PASSO_SEG = 0.05;   // e a mesma frequência: 20 leituras por segundo

const argumentos = process.argv.slice(2);
const corrigir = argumentos.includes("--corrigir");
const [arquivoTxt, ffmpeg = "ffmpeg"] = argumentos.filter((a) => a !== "--corrigir");
if (!arquivoTxt) {
  console.log('Uso: node conferir_musica.mjs "pasta/Artista - Musica.txt" [caminho do ffmpeg]');
  process.exit(1);
}

const musica = lerMusica(readFileSync(arquivoTxt, "utf8"));
const parte = parteSolo(musica);
const arquivoVoz = musica.arquivos.voz && path.join(path.dirname(arquivoTxt), musica.arquivos.voz);
if (!arquivoVoz || !existsSync(arquivoVoz)) {
  console.log("Não achei a voz separada (#VOCALS) ao lado do .txt; sem ela não dá pra conferir.");
  process.exit(1);
}

// O ffmpeg abre qualquer áudio e entrega as amostras cruas, em mono.
const decodificado = spawnSync(ffmpeg, ["-v", "error", "-i", arquivoVoz, "-ac", "1", "-ar", String(TAXA), "-f", "f32le", "-"],
  { maxBuffer: 1 << 30 });
if (decodificado.status !== 0) {
  console.log(`O ffmpeg não conseguiu abrir a voz: ${decodificado.stderr}`);
  process.exit(1);
}
const b = decodificado.stdout;
const amostras = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));

// A voz original nota por nota, uma vez só (é a parte demorada).
const leituras = [];
for (let inicio = 0; inicio + JANELA <= amostras.length; inicio += Math.round(PASSO_SEG * TAXA)) {
  const r = ouvir(amostras.subarray(inicio, inicio + JANELA), TAXA);
  leituras.push({ seg: (inicio + JANELA / 2) / TAXA, midi: r.hz ? hzParaMidi(r.hz) : null, voz: r.voz });
}

function pontuar(dificuldade, deslocamento = 0) {
  const placar = new Placar(parte, dificuldade);
  for (const l of leituras) {
    placar.registrar(notaNoTempo(parte, batidaNoTempo(musica, l.seg + deslocamento)), l.midi, l.voz);
  }
  return placar.resumo();
}

const porcento = (x) => `${Math.round(x * 100)}%`;
const notas = parte.linhas.reduce((n, ln) => n + ln.notas.length, 0);
console.log(`\n${musica.artista} — ${musica.titulo}`);
console.log(`${parte.linhas.length} linhas, ${notas} notas, ${Math.round(amostras.length / TAXA)} s de voz\n`);
console.log("A cantora original no gogó:");
for (const d of Object.keys(DIFICULDADES)) {
  const r = pontuar(d);
  console.log(`  ${DIFICULDADES[d].nome.padEnd(8)} ${String(r.pontos).padStart(5)} pontos · notas ${porcento(r.notas)} · no tempo ${porcento(r.tempo)}`);
}

// Se as notas estiverem adiantadas ou atrasadas em relação à voz, algum
// deslocamento pontua melhor que zero. Aqui é o lugar de descobrir isso.
let melhor = { deslocamento: 0, pontos: pontuar("medio").pontos };
for (let ms = -400; ms <= 400; ms += 50) {
  const pontos = pontuar("medio", ms / 1000).pontos;
  if (pontos > melhor.pontos) melhor = { deslocamento: ms, pontos };
}
console.log(melhor.deslocamento === 0
  ? "\nO tempo das notas bate com a voz (nenhum deslocamento pontua melhor)."
  : `\nAs notas pontuam melhor deslocadas ${melhor.deslocamento} ms (${melhor.pontos} pontos no médio).`);

// Deslocamento negativo = a voz canta depois do que o .txt marca: o #GAP
// aumenta e todas as notas vão junto pra frente. Só mexe se valer a pena.
const semMexer = pontuar("medio").pontos;
if (corrigir && melhor.deslocamento !== 0 && melhor.pontos > semMexer * 1.02) {
  const novoGap = Math.round(musica.gap - melhor.deslocamento);
  const texto = readFileSync(arquivoTxt, "utf8").replace(/^#GAP:.*$/m, `#GAP:${novoGap}`);
  writeFileSync(arquivoTxt, texto, "utf8");
  console.log(`Corrigido: #GAP de ${musica.gap} pra ${novoGap} ms.`);
}
