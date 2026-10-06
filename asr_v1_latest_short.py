#!/usr/bin/env python3
"""Test Speech-to-Text V1 latest_short using only an API key (Python stdlib).

Example:
  python3 asr_v1_latest_short.py --audio wav_out/01-please-speak.wav \
      --language en-US --hotword 'Please speak' --output tmp/latest-short.json
"""

import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request
import wave


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audio', type=Path, required=True)
    parser.add_argument('--language', required=True)
    parser.add_argument('--hotword', action='append', default=[])
    parser.add_argument('--boost', type=float, default=10)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not 0 <= args.boost <= 20:
        parser.error('--boost must be between 0 and 20')

    key = os.environ.get('GOOGLE_API_KEY', '').strip()
    if not key:
        key = Path(__file__).with_name('api_key.txt').read_text().strip()
    if not key:
        parser.error('API key is empty')
    audio = args.audio.read_bytes()
    with wave.open(str(args.audio), 'rb') as wav:
        rate, channels = wav.getframerate(), wav.getnchannels()
        duration = wav.getnframes() / rate
        if wav.getsampwidth() != 2 or channels != 1 or wav.getcomptype() != 'NONE':
            parser.error('Expected uncompressed 16-bit mono PCM WAV')
        if duration > 60:
            parser.error('Synchronous recognition requires audio of at most 60 seconds')
    config = {
        'encoding': 'LINEAR16',
        'sampleRateHertz': rate,
        'languageCode': args.language,
        'model': 'latest_short',
        'enableAutomaticPunctuation': True,
    }
    if args.hotword:
        config['adaptation'] = {'phraseSets': [{
            'boost': args.boost,
            'phrases': [{'value': word} for word in args.hotword],
        }]}
    endpoint = 'https://speech.googleapis.com/v1/speech:recognize'
    request = urllib.request.Request(
        endpoint,
        data=json.dumps({'config': config, 'audio': {
            'content': base64.b64encode(audio).decode('ascii'),
        }}).encode(),
        headers={'Content-Type': 'application/json', 'x-goog-api-key': key},
        method='POST',
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            status, result = response.status, json.load(response)
    except urllib.error.HTTPError as error:
        status, result = error.code, json.load(error)
    report = {
        'testedAt': datetime.now(timezone.utc).isoformat(),
        'endpoint': endpoint,
        'authentication': 'API key only; no OAuth token or ADC',
        'audio': str(args.audio.resolve()),
        'audioSha256': hashlib.sha256(audio).hexdigest(),
        'audioSeconds': duration,
        'config': config,
        'httpStatus': status,
        'elapsedMs': round((time.perf_counter() - started) * 1000, 1),
        'response': result,
    }
    # Never persist the API key, including in a server error that might echo it.
    serialized = json.dumps(report, ensure_ascii=False, indent=2).replace(key, '[REDACTED]')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(serialized + '\n')
    print(serialized)
    return 0 if status == 200 else 1


if __name__ == '__main__':
    raise SystemExit(main())
