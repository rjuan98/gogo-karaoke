// Música de verdade: o .txt do UltraStar e o áudio, escolhidos do aparelho do
// palco. Ficam só nele — o site é público e não pode guardar música de ninguém.
import { lerMusica } from "./musica.js";
import { saidaComAnalisador } from "./sintetizador.js";

const AUDIO = /\.(mp3|m4a|aac|ogg|opus|wav|flac|webm)$/i;

// Entre os arquivos que a pessoa escolheu, qual tocar: o instrumental (sem a
// voz original) se ele veio junto; senão o áudio da música; senão qualquer
// áudio. Com a voz original tocando, o celular pode ouvir a cantora da caixa.
// "qualquer" deixa usar um áudio de nome diferente — só faz sentido com uma
// música sozinha; com várias, adivinhar trocaria o áudio de uma pela outra.
export function escolherAudio(nomes, musica, qualquer = true) {
  const tem = (nome) => (nome && nomes.includes(nome) ? nome : null);
  return tem(musica.arquivos.instrumental) ?? tem(musica.arquivos.audio)
    ?? (qualquer ? nomes.find((n) => AUDIO.test(n)) ?? null : null);
}

// Muitas músicas de uma vez (a pasta inteira): cada .txt com o seu áudio.
// Recebe [{ nome, musica, ... }] e devolve os mesmos itens com "audio".
export function parearArquivos(txts, nomes) {
  const sozinha = txts.length === 1;
  return txts.map((t) => ({ ...t, audio: escolherAudio(nomes, t.musica, sozinha) }));
}

// A pasta de músicas inteira: cada .txt só pode pegar áudio da própria pasta
// (duas pastas podem ter arquivos de mesmo nome, como a versão antiga e a nova
// da mesma música). Recebe caminhos "pasta/arquivo" e devolve [pasta, nomes]
// em ordem alfabética — "Música (1)" vem depois de "Música" e fica valendo.
export function separarPorPasta(caminhos) {
  const pastas = new Map();
  for (const caminho of caminhos) {
    const corte = caminho.lastIndexOf("/");
    const pasta = corte < 0 ? "" : caminho.slice(0, corte);
    if (!pastas.has(pasta)) pastas.set(pasta, []);
    pastas.get(pasta).push(caminho.slice(corte + 1));
  }
  return [...pastas.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
}

export async function abrirMusica(arquivos, audio) {
  const lista = [...arquivos];
  const txt = lista.find((f) => /\.txt$/i.test(f.name));
  if (!txt) throw new Error("Faltou o arquivo .txt da música. Escolha o .txt e o áudio juntos.");
  const musica = lerMusica(await txt.text());
  const nome = escolherAudio(lista.map((f) => f.name), musica);
  if (!nome) throw new Error("Faltou o áudio da música. Escolha o .txt e o áudio juntos.");
  const arquivo = lista.find((f) => f.name === nome);
  const som = await audio.decodeAudioData(await arquivo.arrayBuffer());
  return { musica, som, semVoz: nome === musica.arquivos.instrumental };
}

// Quanto aumentar ou abaixar esta música pra ela soar no volume das outras:
// "Dancing Queen" veio bem mais alta que a música de teste e quase ensurdeceu
// o primeiro a cantar. Mede o volume médio (amostrando, que é rápido) e
// aproxima de um alvo, sem exagerar nem pra cima nem pra baixo.
export function ganhoParaIgualar(canais, alvo = 0.1) {
  let soma = 0, contadas = 0;
  for (const amostras of canais) {
    for (let i = 0; i < amostras.length; i += 64) {
      soma += amostras[i] * amostras[i];
      contadas++;
    }
  }
  const volume = Math.sqrt(soma / Math.max(1, contadas));
  if (!volume) return 1;
  return Math.min(1.5, Math.max(0.25, alvo / volume));
}

// Mesma cara do sintetizador: quando começou, um analisador e um jeito de
// parar. Com "voz" (o [Vocals]), a voz da artista toca junto, no mesmo
// instante, num volume que dá pra mudar durante a música.
export function tocarSom(audio, som, { voz = null, volumeVoz = 0, volumeMusica = 1, destino } = {}) {
  const canais = Array.from({ length: som.numberOfChannels }, (_, c) => som.getChannelData(c));
  const { saida, analisador } = saidaComAnalisador(audio, destino, ganhoParaIgualar(canais));
  const inicio = audio.currentTime + 0.3;
  const fontes = [];
  const ganhoDaMusica = audio.createGain();
  ganhoDaMusica.gain.value = volumeMusica;
  ganhoDaMusica.connect(saida);
  const tocarJunto = (buffer, destino) => {
    const fonte = audio.createBufferSource();
    fonte.buffer = buffer;
    fonte.connect(destino);
    fonte.start(inicio);
    fontes.push(fonte);
  };
  tocarJunto(som, ganhoDaMusica);
  let ganhoDaVoz = null;
  if (voz) {
    ganhoDaVoz = audio.createGain();
    ganhoDaVoz.gain.value = volumeVoz;
    ganhoDaVoz.connect(saida);
    tocarJunto(voz, ganhoDaVoz);
  }
  return {
    inicio,
    analisador,
    duracao: som.duration,
    temVoz: Boolean(voz),
    ajustarMusica(volume) {
      ganhoDaMusica.gain.setTargetAtTime(Math.min(1, Math.max(0, volume)), audio.currentTime, 0.1);
    },
    ajustarVoz(volume) {
      ganhoDaVoz?.gain.setTargetAtTime(Math.min(1, Math.max(0, volume)), audio.currentTime, 0.1);
    },
    parar() {
      saida.gain.setTargetAtTime(0, audio.currentTime, 0.05);
      setTimeout(() => {
        for (const fonte of fontes) {
          try { fonte.stop(); } catch { /* já tinha parado */ }
        }
        saida.disconnect();
      }, 400);
    },
  };
}
