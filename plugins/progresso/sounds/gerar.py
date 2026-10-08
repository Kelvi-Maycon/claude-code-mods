"""Gera os três avisos sonoros do progresso: concluido.wav, erro.wav e decisao.wav.

Senoides curtas com harmônico leve e envelope de ataque rápido e decaimento
exponencial. PCM 16 bit, mono, 44,1 kHz. Rode com `python3 gerar.py` dentro
desta pasta; só usa a biblioteca padrão.
"""

import math
import struct
import wave
from pathlib import Path

TAXA = 44100
PASTA = Path(__file__).resolve().parent


def nota(freq: float, dur: float, inicio: float, ganho: float = 0.5):
    """Uma nota: (início em s, amostras em float de -1 a 1)."""
    n = int(TAXA * dur)
    ataque = int(TAXA * 0.008)
    amostras = []
    for i in range(n):
        t = i / TAXA
        env = min(1.0, i / ataque) * math.exp(-t * 7.0)
        onda = math.sin(2 * math.pi * freq * t) + 0.25 * math.sin(2 * math.pi * freq * 2 * t)
        amostras.append(ganho * env * onda / 1.25)
    return inicio, amostras


def mixar(notas, cauda: float = 0.15):
    fim = max(ini + len(a) / TAXA for ini, a in notas) + cauda
    total = [0.0] * int(TAXA * fim)
    for ini, a in notas:
        k = int(TAXA * ini)
        for i, v in enumerate(a):
            total[k + i] += v
    pico = max(abs(v) for v in total) or 1.0
    escala = min(1.0, 0.8 / pico)
    return [v * escala for v in total]


def gravar(nome: str, amostras):
    with wave.open(str(PASTA / nome), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(TAXA)
        w.writeframes(b''.join(struct.pack('<h', int(v * 32767)) for v in amostras))


# Concluído: terça maior subindo (Dó6, Mi6, Sol6).
gravar('concluido.wav', mixar([nota(1046.5, 0.35, 0.0), nota(1318.5, 0.35, 0.09), nota(1568.0, 0.45, 0.18)]))
# Erro: duas notas descendo, mais graves (Mi4, Si3).
gravar('erro.wav', mixar([nota(329.6, 0.3, 0.0, 0.6), nota(246.9, 0.45, 0.16, 0.6)]))
# Decisão: dois toques iguais, médios (Lá5), pedindo atenção sem alarme.
gravar('decisao.wav', mixar([nota(880.0, 0.22, 0.0), nota(880.0, 0.3, 0.2)]))
