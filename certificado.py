"""Certificado próprio, pro celular aceitar a página como https.

O navegador só libera o microfone em página segura, e o celular chega no
notebook pelo IP da rede de casa — nenhuma autoridade assina um certificado
pra isso. Então o notebook assina o seu: o celular avisa "não é particular" uma
vez, a pessoa toca em Continuar, e o microfone libera.

Se o IP do notebook mudar (outra rede, outro roteador), o certificado é refeito
sozinho na próxima vez que o app subir.
"""
from __future__ import annotations

import ipaddress
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

PASTA = Path(__file__).parent / "certificado"


def _cobre(arquivo: Path, ips: list[str]) -> bool:
    try:
        cert = x509.load_pem_x509_certificate(arquivo.read_bytes())
        nomes = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    except (ValueError, x509.ExtensionNotFound):
        return False
    tem = {str(ip) for ip in nomes.get_values_for_type(x509.IPAddress)}
    vence = cert.not_valid_after_utc - datetime.now(timezone.utc)
    return set(ips) <= tem and vence > timedelta(days=7)


def garantir(ips: list[str]) -> tuple[str, str]:
    cert, chave = PASTA / "cert.pem", PASTA / "chave.pem"
    if cert.exists() and chave.exists() and _cobre(cert, ips):
        return str(cert), str(chave)

    PASTA.mkdir(exist_ok=True)
    privada = ec.generate_private_key(ec.SECP256R1())
    nome = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Karaoke da casa")])
    agora = datetime.now(timezone.utc)
    novo = (
        x509.CertificateBuilder()
        .subject_name(nome)
        .issuer_name(nome)
        .public_key(privada.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(agora - timedelta(days=1))
        .not_valid_after(agora + timedelta(days=365))
        .add_extension(
            x509.SubjectAlternativeName(
                [x509.DNSName("localhost")]
                + [x509.IPAddress(ipaddress.ip_address(ip)) for ip in ips]
            ),
            critical=False,
        )
        .sign(privada, hashes.SHA256())
    )
    chave.write_bytes(privada.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ))
    cert.write_bytes(novo.public_bytes(serialization.Encoding.PEM))
    return str(cert), str(chave)
