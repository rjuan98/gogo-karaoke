// "Solta a voz", a música de teste do gogó. A melodia é a de "Brilha, brilha,
// estrelinha" (domínio público: é a de "Ah! vous dirai-je, maman", do século
// XVIII); a letra é nossa. É um dueto: a parte 1 canta as duas primeiras
// linhas, a parte 2 as duas do meio, tem um solo instrumental, e no fim os dois
// cantam juntos. O solo tem duas frases (quase 10 segundos) de propósito: com
// uma só, as notas da volta já entravam na tela antes de as da ida saírem, e o
// visualizador grande nunca aparecia.
//
// Está escrita no formato do UltraStar, igual às músicas de verdade, pra o
// leitor ser testado com ela. Um tempo (semínima) = 8 batidas = 0,6 segundo.
export const BATIDAS_POR_TEMPO = 8;

export const TEXTO = `#TITLE:Solta a voz
#ARTIST:gogó
#BPM:200
#GAP:2400
#DUETSINGERP1:Parte 1
#DUETSINGERP2:Parte 2
P1
: 0 7 0 Sol
: 8 7 0 ta a
: 16 7 7  voz,
: 24 7 7  a
: 32 7 9 mi
: 40 7 9 go
* 48 15 7  meu
- 64
: 64 7 5 Can
: 72 7 5 ta
: 80 7 4  for
: 88 7 4 te
: 96 7 2  sem
: 104 7 2  pa
* 112 15 0 rar
- 384
: 384 7 0 Sol
: 392 7 0 ta a
: 400 7 7  voz,
: 408 7 7  a
: 416 7 9 mi
: 424 7 9 go
* 432 15 7  meu
- 448
: 448 7 5 Ho
: 456 7 5 je o
: 464 7 4  go
: 472 7 4 gó
: 480 7 2  vai
: 488 7 2  bri
* 496 15 0 lhar
P2
: 128 7 7 Se a
: 136 7 7 fi
: 144 7 5 nar,
: 152 7 5  ga
: 160 7 4 nha
: 168 7 4  pon
* 176 15 2 to
- 192
: 192 7 7 Er
: 200 7 7 rou a
: 208 7 5  no
: 216 7 5 ta?
: 224 7 4  Tu
: 232 7 4 do
* 240 15 2  bem
- 384
: 384 7 0 Sol
: 392 7 0 ta a
: 400 7 7  voz,
: 408 7 7  a
: 416 7 9 mi
: 424 7 9 go
* 432 15 7  meu
- 448
: 448 7 5 Ho
: 456 7 5 je o
: 464 7 4  go
: 472 7 4 gó
: 480 7 2  vai
: 488 7 2  bri
* 496 15 0 lhar
E
`;

// O acompanhamento, que só a música de teste tem (a de verdade vem pronta no
// áudio): um acorde a cada dois tempos, com o baixo marcando cada tempo.
const VOZES = {
  C: { baixo: 36, notas: [48, 52, 55] },
  F: { baixo: 41, notas: [48, 53, 57] },
  G: { baixo: 43, notas: [47, 50, 55] },
};
const HARMONIA = { A: ["C", "C", "F", "C"], A2: ["F", "C", "G", "C"], B: ["C", "F", "C", "G"] };
const FRASES = [
  ["A", 0], ["A2", 64], ["B", 128], ["B", 192], ["A", 256], ["A2", 320], ["A", 384], ["A2", 448],
];

export const ACORDES = [
  ...FRASES.flatMap(([frase, batida]) =>
    HARMONIA[frase].map((nome, i) => ({ batida: batida + i * 16, duracao: 16, ...VOZES[nome] }))),
  { batida: 512, duracao: 16, ...VOZES.C },  // o acorde final
];

// O solo instrumental entre a parte 2 e o final: as duas primeiras frases da
// melodia, uma oitava acima.
function frase(batida, tons) {
  return tons.map((tom, i) => ({ batida: batida + i * 8, duracao: i === 6 ? 15 : 7, midi: 72 + tom }));
}
export const SOLO = [...frase(256, [0, 0, 7, 7, 9, 9, 7]), ...frase(320, [5, 5, 4, 4, 2, 2, 0])];
