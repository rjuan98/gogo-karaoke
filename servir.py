"""Serve o app e, opcionalmente, uma biblioteca compartilhada de músicas.

Por padrão o repertório fica na pasta musicas/ do projeto. Para outra pasta use
--musicas. No acesso pela internet, use um túnel HTTPS apontando para localhost;
--sem-https limita o servidor local ao próprio PC.

Rodar:  python servir.py
        python servir.py --sem-https --musicas "D:/Karaoke/musicas"
"""
from __future__ import annotations

import argparse
import hashlib
import http.server
import json
import mimetypes
import re
import socket
import ssl
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit

PORTA = 5443
PASTA = Path(__file__).parent / "site"
PASTA_MUSICAS = Path(__file__).parent / "musicas"
EXTENSOES_AUDIO = {".mp3", ".m4a", ".aac", ".ogg", ".opus", ".wav", ".flac", ".webm"}


def caminho_seguro(valor: str) -> Path | None:
    """Resolve um caminho relativo sem permitir sair da biblioteca."""
    try:
        raiz = PASTA_MUSICAS.resolve()
        arquivo = (raiz / valor).resolve(strict=True)
        return arquivo if arquivo.is_relative_to(raiz) and arquivo.is_file() else None
    except (OSError, ValueError):
        return None


def indice_musicas() -> list[dict]:
    """Monta um índice leve dos arquivos UltraStar guardados no PC."""
    if not PASTA_MUSICAS.is_dir():
        return []

    resultado = []
    for txt in sorted(PASTA_MUSICAS.rglob("*"), key=lambda p: str(p).casefold()):
        if not txt.is_file() or txt.suffix.casefold() != ".txt":
            continue
        txt_seguro = caminho_seguro(txt.relative_to(PASTA_MUSICAS).as_posix())
        if not txt_seguro:
            continue
        try:
            conteudo = txt_seguro.read_text(encoding="utf-8-sig", errors="replace")
        except OSError:
            continue

        cabecalho = {}
        partes = set()
        for linha in conteudo.splitlines():
            marcador_parte = re.match(r"^P\s*(\d+)\s*$", linha.strip(), flags=re.IGNORECASE)
            if marcador_parte:
                partes.add(int(marcador_parte.group(1)))
            if not linha.startswith("#") or ":" not in linha:
                continue
            chave, valor = linha[1:].split(":", 1)
            cabecalho[chave.strip().upper()] = valor.strip()

        pasta = txt_seguro.parent
        por_nome = {p.name.casefold(): p for p in pasta.iterdir() if p.is_file()}

        def parente(valor: str | None) -> Path | None:
            if not valor:
                return None
            candidato = por_nome.get(Path(valor.replace("\\", "/")).name.casefold())
            if not candidato:
                return None
            return caminho_seguro(candidato.relative_to(PASTA_MUSICAS.resolve()).as_posix())

        instrumental = parente(cabecalho.get("INSTRUMENTAL"))
        audio = instrumental or parente(cabecalho.get("AUDIO")) or parente(cabecalho.get("MP3"))
        voz = parente(cabecalho.get("VOCALS")) if instrumental else None
        if not audio:
            candidatos = [p for p in por_nome.values() if p.suffix.casefold() in EXTENSOES_AUDIO]
            if len(candidatos) == 1:
                audio = caminho_seguro(candidatos[0].relative_to(PASTA_MUSICAS.resolve()).as_posix())
        if not audio:
            continue

        rel_txt = txt_seguro.relative_to(PASTA_MUSICAS.resolve()).as_posix()
        chave_id = hashlib.sha256(rel_txt.casefold().encode("utf-8")).hexdigest()[:20]
        arquivos = [txt_seguro, audio] + ([voz] if voz else [])
        revisao = hashlib.sha256("|".join(
            f"{p.name}:{p.stat().st_size}:{p.stat().st_mtime_ns}" for p in arquivos
        ).encode("utf-8")).hexdigest()[:16]

        def url_arquivo(arquivo: Path) -> str:
            relativo = arquivo.relative_to(PASTA_MUSICAS.resolve()).as_posix()
            return "/api/midia?caminho=" + quote(relativo, safe="") + "&v=" + revisao

        resultado.append({
            "id": f"pc-{chave_id}",
            "titulo": cabecalho.get("TITLE") or txt_seguro.stem,
            "artista": cabecalho.get("ARTIST") or "Artista desconhecido",
            "dueto": len(partes) >= 2 or any(k in cabecalho for k in ("P2", "DUETSINGERP2")),
            "semVoz": instrumental is not None,
            "temVoz": voz is not None,
            "revisao": revisao,
            "textoUrl": url_arquivo(txt_seguro),
            "audioUrl": url_arquivo(audio),
            "vozUrl": url_arquivo(voz) if voz else None,
        })
    return resultado


class Entrega(http.server.SimpleHTTPRequestHandler):
    # O Windows às vezes registra .js como text/plain, e aí o navegador recusa
    # carregar os módulos.
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PASTA), **kwargs)

    def end_headers(self):
        # Manda o navegador conferir se o arquivo mudou toda vez. Sem isso ele
        # guarda um script velho e mistura com os novos depois de uma mudança
        # (aconteceu: "nota.js não tem limiarDoSilencio").
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path == "/api/catalogo":
            corpo = json.dumps(indice_musicas(), ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(corpo)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(corpo)
            return
        if url.path == "/api/midia":
            parametros = parse_qs(url.query)
            arquivo = caminho_seguro(parametros.get("caminho", [""])[0])
            if not arquivo:
                self.send_error(404, "Arquivo não encontrado na biblioteca")
                return
            try:
                tamanho = arquivo.stat().st_size
                self.send_response(200)
                self.send_header("Content-Type", mimetypes.guess_type(arquivo.name)[0] or "application/octet-stream")
                self.send_header("Content-Length", str(tamanho))
                self.send_header("Cache-Control", "private, max-age=3600")
                self.end_headers()
                with arquivo.open("rb") as entrada:
                    self.copyfile(entrada, self.wfile)
            except OSError:
                self.send_error(404, "Arquivo não encontrado na biblioteca")
            return
        super().do_GET()


class ServidorHttps(http.server.ThreadingHTTPServer):
    """O aperto de mão do https acontece na thread de cada conexão, e não na fila
    de entrada: lá, um aparelho que conecta e fica mudo trava todo mundo atrás
    dele (medido: o próximo esperou até desistir)."""

    def __init__(self, endereco, handler, contexto: ssl.SSLContext):
        super().__init__(endereco, handler)
        self.contexto = contexto

    def finish_request(self, request, client_address):
        request.settimeout(15)
        try:
            seguro = self.contexto.wrap_socket(request, server_side=True)
        except OSError:
            return  # celular recusou o certificado, ou desistiu no meio
        try:
            super().finish_request(seguro, client_address)
        finally:
            seguro.close()


def ips_da_rede() -> list[str]:
    """Os IPs deste notebook, o da rota padrão primeiro. Abrir um socket UDP não
    manda pacote nenhum; só faz o Windows dizer qual placa usaria pra sair — e
    assim a VPN não passa na frente do Wi-Fi."""
    ips = []
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            ips.append(s.getsockname()[0])
    except OSError:
        pass
    for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
        if ip not in ips and not ip.startswith(("127.", "169.254.")):
            ips.append(ip)
    return ips or ["127.0.0.1"]


def main() -> None:
    global PASTA_MUSICAS
    argumentos = argparse.ArgumentParser(description="Servidor do gogó e da biblioteca compartilhada.")
    argumentos.add_argument("--sem-https", action="store_true", help="serve apenas em localhost por HTTP (útil com um túnel HTTPS)")
    argumentos.add_argument("--musicas", type=Path, default=PASTA_MUSICAS, help="pasta com músicas no formato UltraStar")
    args = argumentos.parse_args()
    PASTA_MUSICAS = args.musicas.expanduser().resolve()
    if args.sem_https:
        servidor = http.server.ThreadingHTTPServer(("127.0.0.1", PORTA), Entrega)
        print(f"\ngogó no ar, só neste notebook:  http://localhost:{PORTA}/\n")
    else:
        import certificado  # A biblioteca só é necessária para o HTTPS local.

        ips = ips_da_rede()
        cert, chave = certificado.garantir(ips + ["127.0.0.1"])
        contexto = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        contexto.load_cert_chain(cert, chave)
        servidor = ServidorHttps(("0.0.0.0", PORTA), Entrega, contexto)
        print("\ngogó no ar, na rede de casa.")
        print(f"  Palco, abra no notebook:  https://{ips[0]}:{PORTA}/palco.html")
        if len(ips) > 1:
            print("  Outros endereços deste notebook:")
            for ip in ips[1:]:
                print(f"    https://{ip}:{PORTA}/palco.html")
        print("  Use esse endereço, não localhost: é ele que vai no QR code do celular.")
        print("  O número pode mudar quando o Wi-Fi reconectar; confira aqui ou na tela do palco.")
        print("  O navegador vai avisar que a conexão não é particular:")
        print("  toque em Avançado e depois em Continuar. É o nosso certificado.")
        print("  Depois de publicado na internet, esse aviso some.\n")
    servidor.serve_forever()


if __name__ == "__main__":
    main()
