# gogó

Karaokê pra usar com os amigos: qualquer tela com navegador vira o palco (TV,
notebook, tablet), e o celular de cada um vira o microfone.

Por enquanto tem uma música só, a de teste ("Solta a voz": melodia de "Brilha,
brilha, estrelinha", letra nossa), que o próprio palco toca sintetizada. Ela já
é um dueto, com solo instrumental no meio, então dá pra testar tudo: as notas
vindo no estilo Guitar Hero, a pontuação nas três dificuldades, as cores de
cada cantor, o visualizador e o resultado.

- **Fácil:** conta cantar uma nota firme na hora certa; qual nota, não importa.
- **Médio:** conta a nota, com folga de meio tom.
- **Difícil:** conta a nota exata.

Em todas, cantar uma oitava acima ou abaixo vale igual.

## Como funciona

O app pode ser publicado como arquivos estáticos (`site/`). Opcionalmente, o
`servir.py` entrega também uma biblioteca grande que fica no disco do PC.

- O palco abre uma sala com um código de 5 letras (tipo `LUMEN`) e mostra o QR code.
- O celular entra pelo QR code ou digitando o código.
- Quem apresenta um aparelho ao outro é o servidor público e gratuito do
  [PeerJS](https://peerjs.com). Depois disso as notas vão **direto** do celular
  pro palco (WebRTC). Se esse servidor cair, sala nova não abre; quem já está
  conectado continua.

## Músicas de verdade

O servidor também pode manter um repertório grande numa pasta do PC. Assim, os
palcos que abrirem o gogó pelo servidor encontram as mesmas músicas; quando uma
faixa entra na fila, o palco baixa automaticamente o áudio e deixa pronta a
próxima. Os celulares recebem só o catálogo e continuam usando o microfone.
Por padrão, coloque as pastas UltraStar em `musicas/` na raiz do projeto. Para
usar outra pasta, inicie o servidor com `--musicas "D:/Karaoke/musicas"`.
Essa pasta é ignorada pelo Git para os áudios não entrarem no repositório.

As notas e a letra são geradas pelo [UltraSinger](https://github.com/rakuri255/UltraSinger),
que fica instalado separadamente, junto com o Python, o ffmpeg e os modelos.

1. **Gerar** (uns 15 minutos por música, no processador):
   `<pasta-do-ultrasinger>\gerar_musica.cmd "link da música" en`
   O último pedaço é o idioma (`en`, `pt`…); sem ele, o Whisper descobre.
2. **Conferir antes da festa:** põe a voz original pra cantar no gogó e mostra
   quantos pontos ela faria. Se nem a cantora pontua bem, as notas estão erradas.
   `node conferir_musica.mjs "...\musicas\Artista - Musica\Artista - Musica.txt" "...\ultrasinger\ffmpeg\bin\ffmpeg.exe"`
3. **Guardar localmente (opcional):** sem biblioteca compartilhada, no
   computador use "Adicionar uma pasta inteira" e escolha
   a pasta `musicas`. No celular (que não escolhe pasta), rode antes
   `<pasta-do-ultrasinger>\juntar_para_o_celular.cmd`, copie a pasta
   `para_o_celular` pro celular e, no palco, "Adicionar arquivos" e selecione
   tudo. Ficam guardadas no navegador do aparelho. Se o servidor do PC estiver
   com `--musicas`, pule esta etapa: o repertório aparece sozinho e o palco
   carrega cada faixa quando ela entra na fila.

Músicas do USDB (letra feita à mão, bem melhor que a do Whisper): baixe com o
USDB Syncer na pasta `musicas` e rode
`<pasta-do-ultrasinger>\preparar_usdb.cmd`.
Ele separa o instrumental e a voz e acerta o tempo da letra com o áudio.

## Na festa

- Cada um escolhe a música pelo celular (sozinho ou com alguém da sala, e a
  dificuldade) e entra na fila. Quem cantou menos passa na frente.
- Antes de controlar pelo celular, toque em "Ativar som do palco" na TV ou no
  computador e confirme que o navegador liberou o áudio.
- No palco ou no celular, "Começar a próxima". Durante a música, a aba Fila do
  celular também permite pular para a próxima. Depois do resultado, a próxima começa
  sozinha em 15 segundos (dá pra esperar).
- "Tela cheia" esconde a barra do navegador na TV. Em tela baixa (celular
  deitado), o palco se arruma em três colunas.
- Se o palco recarregar, ele reabre a mesma sala e os celulares voltam sozinhos.

### Duas festas, um catálogo

O mesmo servidor pode atender duas festas ao mesmo tempo. Ele só entrega as
páginas e os arquivos das músicas; cada aparelho que abrir `palco.html` cria
sua própria sala, com código e fila separados. Assim, você e seu amigo usam o
mesmo endereço e repertório, mas cada festa tem seu QR code e sua fila. Não
precisa copiar as músicas para o GitHub nem para os celulares.

Para isso, deixe este PC ligado com `servir.py` e o túnel ativos. Configure um
túnel Cloudflare com um nome fixo, por exemplo `gogo.seudominio.com`, apontando
para `http://localhost:5443`. Nas duas festas, o anfitrião abre
`https://gogo.seudominio.com/palco.html` no computador ligado à TV. Cada palco
mostra o próprio código para os celulares daquela festa. O palco carrega as
músicas do seu PC quando são escolhidas; por isso, as duas festas dependem da
internet e de o PC servidor continuar ligado.

O endereço do GitHub Pages continua sendo útil para conhecer/testar a versão
de demonstração, mas não contém o catálogo do PC. Um Quick Tunnel serve para
testar; como o endereço muda quando ele reinicia, use um túnel nomeado para as
festas. O domínio fixo é configurado uma vez na conta Cloudflare e pode ser
reutilizado nas duas datas.

## Publicar na internet

Qualquer hospedagem de site estático serve, porque é só subir a pasta `site/`.
Ela já vem com https, e aí some o aviso de certificado no celular.

O app também está disponível no [GitHub Pages](https://rjuan98.github.io/gogo-karaoke/).
Para testar com a música de demonstração, abra o [palco](https://rjuan98.github.io/gogo-karaoke/palco.html)
no computador e leia o QR code com o celular. A biblioteca de músicas que fica
no PC não acompanha essa versão estática; para usar esse repertório, mantenha o
servidor do PC ligado e compartilhe o endereço HTTPS do túnel.

Para servir também o catálogo que está no seu PC, rode o servidor local e
coloque um túnel HTTPS apontando para ele. Um exemplo para testar com Cloudflare
Quick Tunnel:

```
iniciar_servidor.bat --musicas "D:/Karaoke/musicas"
cloudflared tunnel --url http://localhost:5443
```

Se as músicas estiverem na pasta padrão `musicas/`, basta abrir
`iniciar_servidor.bat` sem argumentos. Essa janela e a do túnel precisam ficar
abertas enquanto o catálogo estiver em uso.

Abra o endereço HTTPS que o túnel mostrar e acrescente `/palco.html`. O Quick
Tunnel troca de endereço quando é iniciado de novo; para uma festa, configure
um túnel com endereço estável. Não encaminhe a porta do servidor diretamente
no roteador. O PC precisa ficar ligado e conectado. O palco carrega as músicas
da fila para o próprio navegador; não precisa importar faixas em cada celular.

## Testar antes de publicar

```
python -m pip install -r requisitos.txt
python servir.py
```

- **Palco:** abra no notebook o endereço que o `servir.py` mostra, tipo
  `https://<ip-do-notebook>:5443/palco.html`. **Não use localhost**: o QR code iria
  junto, e no celular "localhost" é o próprio celular. O endereço também
  aparece na tela do palco.
- **Celular:** leia o QR code do palco. Precisa estar no mesmo Wi-Fi do notebook
  (só os arquivos saem daqui; a conexão entre os aparelhos já é pela internet).
- O navegador vai avisar que a conexão não é particular: **Avançado → Continuar**.
  É o certificado que o próprio notebook assinou (`certificado.py` explica por quê).
- Na primeira vez, o Windows pode perguntar se o Python pode usar a rede.
  Permita em **redes privadas**.

O IP pode mudar quando o notebook troca de Wi-Fi ou o roteador renova o endereço.
Use sempre o endereço mostrado pelo servidor; não precisa alterar o aplicativo.
Deixe a janela do servidor aberta durante a brincadeira. Para evitar a troca na
festa, reserve um endereço para o notebook nas configurações do roteador.

### Jogar com amigos pelo Discord

O endereço `192.168...` só abre para aparelhos no mesmo Wi-Fi. Para amigos em
outra casa, compartilhe o endereço HTTPS do servidor/túnel. O palco e os
celulares usam a mesma página; quem apresenta abre `palco.html` e compartilha a
tela/áudio no Discord. Antes da festa, façam uma chamada de teste com pelo menos
um celular fora do seu Wi-Fi.

Sem celular por perto: abra `cel.html?sala=CODIGO&teste` em outra aba. Ela toca
uma melodia por dentro, no lugar do microfone.

Sem ninguém pra cantar: `palco.html?robo` põe na sala um cantor de mentira que
canta a música de teste sozinho (uma oitava abaixo, errando de vez em quando).

Só no notebook, sem certificado: `python servir.py --sem-https`.

Se depois de uma atualização alguma coisa parecer quebrada no celular, abra o
link numa **aba nova** (ou anônima): o navegador pode ter guardado um pedaço
da versão velha.

## Testes

```
node testes.mjs
```

Testam a detecção de nota (nota pura, voz com harmônicos, fundamental fraca,
silêncio, ruído, barulho de ventilador), as regras da sala (código pronunciável
e sem palavra feia, cores, nomes, a conferência do que chega do celular), o
leitor de música no formato do UltraStar, a música de teste e a pontuação.

## Como está montado

| arquivo | o que faz |
|---|---|
| `site/index.html` | entrada: abrir o palco ou entrar com o código |
| `site/palco.html`, `js/palco.js` | o palco: abre a sala, toca a música, conta os pontos e mostra o resultado |
| `site/js/cantando.js` | a tela de cantar: notas vindo, voz, letra e visualizador |
| `site/js/pauta.js` | a pauta livre da sala, pra aquecer antes de cantar |
| `site/js/musica.js` | lê música no formato do UltraStar (o mesmo que o UltraSinger gera) |
| `site/js/pontuacao.js` | as dificuldades, o placar e os títulos do resultado |
| `site/js/musicaDeTeste.js`, `js/sintetizador.js` | a música de teste e o instrumental tocado pelo navegador |
| `site/js/arquivoDeMusica.js` | pareia cada .txt com o seu áudio e toca |
| `site/js/biblioteca.js` | guarda as músicas no navegador do palco (IndexedDB) |
| `site/js/fila.js` | as regras da fila: conferir pedidos, ordem justa, quem saiu |
| `conferir_musica.mjs` | mede a qualidade de uma música gerada, com a voz original cantando |
| `site/cel.html`, `js/cel.js` | o celular: aprende o barulho da sala, ouve, detecta a nota e manda só o número, 20 vezes por segundo |
| `site/js/sala.js` | a conexão entre palco e celulares (PeerJS) |
| `site/js/protocolo.js` | as regras da sala, sem rede: códigos, cores, conferência das mensagens |
| `site/js/nota.js` | descobre a nota (método YIN); vai servir pro microfone de verdade também |
| `servir.py`, `certificado.py` | só pra testar na rede de casa antes de publicar |
