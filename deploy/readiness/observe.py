#!/usr/bin/env python3
"""External readiness observer. It does not import or restart the application."""
from __future__ import annotations

import argparse
import http.client
import json
import os
import signal
import socket
import sys
import tempfile
import time
import urllib.parse
from datetime import datetime, time as clock, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

MSK = ZoneInfo('Europe/Moscow')
WINDOW_START = clock(7, 0)
WINDOW_END = clock(21, 0)
CHECK_NAMES = ('db', 'evidence', 'queue', 'worker', 'backup')


def in_window(now: datetime) -> bool:
    local = now.astimezone(MSK).time()
    return WINDOW_START <= local < WINDOW_END


def redacted_target(url: str) -> str:
    parts = urllib.parse.urlsplit(url)
    host = parts.hostname or ''
    port = f':{parts.port}' if parts.port else ''
    return urllib.parse.urlunsplit((parts.scheme, f'{host}{port}', parts.path or '/', '', ''))


def probe(url: str, timeout: float) -> dict:
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in {'http', 'https'} or not parts.hostname:
        raise SystemExit('address must be http or https')
    port = parts.port or (443 if parts.scheme == 'https' else 80)
    path = parts.path or '/'
    if parts.query:
        path = f'{path}?{parts.query}'
    connection = http.client.HTTPSConnection(parts.hostname, port, timeout=timeout) if parts.scheme == 'https' else http.client.HTTPConnection(parts.hostname, port, timeout=timeout)
    try:
        connection.request('GET', path, headers={'Accept': 'application/json', 'Connection': 'close'})
        response = connection.getresponse()
        status = response.status
        raw = response.read(65536)
    except (socket.timeout, TimeoutError):
        return {'kind': 'timeout'}
    except http.client.RemoteDisconnected:
        return {'kind': 'unreachable'}
    except http.client.HTTPException:
        return {'kind': 'invalid'}
    except OSError:
        return {'kind': 'unreachable'}
    finally:
        connection.close()
    if status == 503:
        return {'kind': 'http-503', 'status': 503}
    if status != 200:
        return {'kind': 'invalid', 'status': status}
    try:
        body = json.loads(raw.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {'kind': 'invalid', 'status': 200}
    checks = body.get('checks') if isinstance(body, dict) else None
    if not isinstance(body, dict) or body.get('ok') is not True or not isinstance(checks, dict):
        return {'kind': 'invalid', 'status': 200}
    if any(not isinstance(checks.get(name), str) for name in CHECK_NAMES):
        return {'kind': 'invalid', 'status': 200}
    return {'kind': 'up', 'status': 200}


def fresh_state() -> dict:
    return {'phase': 'up', 'failures': 0, 'open': False, 'pending': False, 'reason': ''}


def load_state(path: Path) -> dict:
    if not path.exists():
        return fresh_state()
    if path.stat().st_size > 8192:
        raise SystemExit('state is unreadable')
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        raise SystemExit('state is unreadable')
    if data.get('phase') not in {'up', 'down'} or not isinstance(data.get('failures'), int) or data['failures'] < 0:
        raise SystemExit('state is unreadable')
    if not isinstance(data.get('open'), bool) or not isinstance(data.get('pending'), bool):
        raise SystemExit('state is unreadable')
    return data


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix='.observer-')
    try:
        os.chmod(descriptor, 0o600)
        with os.fdopen(descriptor, 'w') as handle:
            json.dump({key: state[key] for key in ('phase', 'failures', 'open', 'pending', 'reason')}, handle)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise
    os.chmod(path, 0o600)


def step(state: dict, sample: dict, now: datetime, threshold: int) -> list[dict]:
    inside = in_window(now)
    if sample['kind'] == 'up':
        state['failures'] = 0
        state['reason'] = ''
        if state['open']:
            state['open'] = False
            state['pending'] = False
            state['phase'] = 'up'
            return [event('recovered', sample, now, inside, 0)]
        state['pending'] = False
        state['phase'] = 'up'
        return []
    state['failures'] += 1
    state['reason'] = sample['kind']
    state['phase'] = 'down'
    if state['failures'] < threshold or state['open']:
        return []
    if not inside:
        state['pending'] = True
        return []
    state['open'] = True
    state['pending'] = False
    return [event('down', sample, now, inside, state['failures'])]


def event(kind: str, sample: dict, now: datetime, inside: bool, failures: int) -> dict:
    record = {'kind': kind, 'reason': sample['kind'] if kind == 'down' else 'up', 'window': 'inside' if inside else 'outside', 'at': now.astimezone(timezone.utc).isoformat(), 'failures': failures}
    if 'status' in sample and kind == 'down':
        record['status'] = sample['status']
    return record


def emit(record: dict, events: Path | None) -> None:
    line = json.dumps(record, ensure_ascii=True, separators=(',', ':'))
    print(line, flush=True)
    if events is not None:
        with events.open('a') as handle:
            handle.write(line + '\n')


def log(sample: dict, records: list[dict]) -> None:
    print(f"probe {sample['kind']}", file=sys.stderr, flush=True)
    for record in records:
        print(f"signal {record['kind']}", file=sys.stderr, flush=True)


def run_once(url: str, timeout: float, threshold: int, state_path: Path, events: Path | None, now: datetime) -> int:
    state = load_state(state_path)
    sample = probe(url, timeout)
    records = step(state, sample, now, threshold)
    save_state(state_path, state)
    for record in records:
        emit(record, events)
    log(sample, records)
    return 0


def parse(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Watch GET /api/ready and record dry-run signals.')
    parser.add_argument('--url', required=True)
    parser.add_argument('--interval', type=float, default=30)
    parser.add_argument('--timeout', type=float, default=2)
    parser.add_argument('--threshold', type=int, default=3)
    parser.add_argument('--state', required=True, type=Path)
    parser.add_argument('--events', type=Path)
    parser.add_argument('--probes', type=int)
    parser.add_argument('--at')
    args = parser.parse_args(argv)
    if args.interval <= 0 or args.timeout <= 0 or args.threshold < 1:
        parser.error('interval, timeout and threshold must be positive')
    if args.probes is None and args.timeout >= args.interval:
        parser.error('timeout must be shorter than interval')
    if args.probes is not None and args.probes < 1:
        parser.error('probes must be at least 1')
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse(sys.argv[1:] if argv is None else argv)
    stopping = False

    def stop(signum, frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    count = 0
    while not stopping:
        now = datetime.fromisoformat(args.at) if args.at else datetime.now(timezone.utc)
        if now.tzinfo is None:
            now = now.replace(tzinfo=MSK)
        run_once(args.url, args.timeout, args.threshold, args.state, args.events, now)
        count += 1
        if args.probes is not None and count >= args.probes:
            break
        remaining = args.interval
        while remaining > 0 and not stopping:
            pause = min(0.2, remaining)
            time.sleep(pause)
            remaining -= pause
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except BrokenPipeError:
        raise SystemExit(0)
