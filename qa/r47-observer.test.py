"""Local HTTP fixtures for the readiness observer. No application and no outbound message."""
from __future__ import annotations

import importlib.util
import json
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('observer', Path(__file__).resolve().parents[1] / 'deploy/readiness/observe.py')
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)

READY = {'ok': True, 'ms': 1, 'checks': {'db': 'ok', 'evidence': 'ok', 'queue': 'ok', 'worker': 'ok', 'backup': 'not_configured'}}
SECRET = 's3cret-token'
EMAIL = 'person@example.test'


class ReadyFixture(BaseHTTPRequestHandler):
    def do_GET(self):
        mode = self.server.mode
        if mode == 'slow':
            time.sleep(self.server.delay)
        if mode == 'ready':
            body = json.dumps(READY).encode()
            status = 200
        elif mode == 'down':
            body = json.dumps({**READY, 'ok': False, 'note': SECRET, 'email': EMAIL}).encode()
            status = 503
        elif mode == 'text':
            body = f'hello {SECRET}'.encode()
            status = 200
        elif mode == 'false':
            body = json.dumps({**READY, 'ok': False}).encode()
            status = 200
        else:
            body = b''
            status = 404
        self.send_response(status)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return


class Observer(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), ReadyFixture)
        self.server.mode = 'ready'
        self.server.delay = 0.4
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.server.server_port}/api/ready'
        self.temp = tempfile.TemporaryDirectory(prefix='helios-r47-')
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.root = Path(self.temp.name)
        self.state = self.root / 'state.json'
        self.events = self.root / 'events.jsonl'

    def at(self, hour, minute=0):
        return datetime.fromisoformat(f'2026-11-14T{hour:02d}:{minute:02d}:00+03:00')

    def once(self, when, url=None):
        observer.run_once(url or self.url, 0.2, 3, self.state, self.events, when)

    def records(self):
        if not self.events.exists():
            return []
        return [json.loads(line) for line in self.events.read_text().splitlines() if line]

    def test_success_failure_recovery_and_restart(self):
        morning = self.at(10)
        self.once(morning)
        self.assertEqual(self.records(), [])
        self.server.mode = 'down'
        self.once(morning)
        self.once(morning)
        self.assertEqual(self.records(), [])
        self.once(morning)
        self.once(morning)
        down = self.records()
        self.assertEqual([item['kind'] for item in down], ['down'])
        self.assertEqual(down[0]['reason'], 'http-503')
        self.assertEqual(down[0]['status'], 503)
        self.assertEqual(down[0]['window'], 'inside')
        self.assertNotIn(SECRET, self.events.read_text())
        self.assertNotIn(EMAIL, self.state.read_text())
        again = subprocess.run([sys.executable, str(Path(observer.__file__)), '--url', self.url, '--interval', '30', '--timeout', '1', '--threshold', '3', '--state', str(self.state), '--events', str(self.events), '--probes', '1', '--at', '2026-11-14T10:05:00+03:00'], check=True, capture_output=True, text=True)
        self.assertNotIn(SECRET, again.stdout + again.stderr)
        self.assertEqual([item['kind'] for item in self.records()], ['down'])
        self.server.mode = 'ready'
        recovered = subprocess.run([sys.executable, str(Path(observer.__file__)), '--url', self.url, '--interval', '30', '--timeout', '1', '--threshold', '3', '--state', str(self.state), '--events', str(self.events), '--probes', '1', '--at', '2026-11-14T10:06:00+03:00'], check=True, capture_output=True, text=True)
        self.assertIn('signal recovered', recovered.stderr)
        self.assertEqual([item['kind'] for item in self.records()], ['down', 'recovered'])
        quiet = subprocess.run([sys.executable, str(Path(observer.__file__)), '--url', self.url, '--interval', '30', '--timeout', '1', '--threshold', '3', '--state', str(self.state), '--events', str(self.events), '--probes', '1', '--at', '2026-11-14T10:07:00+03:00'], check=True, capture_output=True, text=True)
        self.assertNotIn('signal', quiet.stderr)
        self.assertEqual([item['kind'] for item in self.records()], ['down', 'recovered'])

    def test_timeout_unreachable_and_invalid(self):
        self.server.mode = 'slow'
        self.once(self.at(10))
        self.assertEqual(observer.load_state(self.state)['reason'], 'timeout')
        closed_socket = socket.socket()
        closed_socket.bind(('127.0.0.1', 0))
        closed_port = closed_socket.getsockname()[1]
        closed_socket.close()
        closed = observer.probe(f'http://127.0.0.1:{closed_port}/api/ready', 0.2)
        self.assertEqual(closed['kind'], 'unreachable')
        self.server.mode = 'text'
        self.once(self.at(10))
        self.assertEqual(observer.load_state(self.state)['reason'], 'invalid')
        self.server.mode = 'false'
        self.once(self.at(10))
        signal = self.records()
        self.assertEqual(signal[0]['reason'], 'invalid')
        self.assertEqual(signal[0]['status'], 200)
        self.assertNotIn(SECRET, self.events.read_text() + self.state.read_text())

    def test_moscow_window_holds_signal_until_morning(self):
        self.server.mode = 'down'
        for _ in range(3):
            self.once(self.at(21))
        self.assertEqual(self.records(), [])
        self.assertTrue(observer.load_state(self.state)['pending'])
        self.once(self.at(6, 59))
        self.assertEqual(self.records(), [])
        self.once(self.at(7))
        self.assertEqual(self.records()[0]['window'], 'inside')
        self.assertEqual(self.records()[0]['kind'], 'down')

    def test_open_incident_recovers_outside_the_window(self):
        self.server.mode = 'down'
        for _ in range(3):
            self.once(self.at(20))
        self.server.mode = 'ready'
        self.once(self.at(22))
        self.assertEqual([item['kind'] for item in self.records()], ['down', 'recovered'])
        self.assertEqual(self.records()[1]['window'], 'outside')

    def test_night_recovery_does_not_invent_a_signal(self):
        self.server.mode = 'down'
        for _ in range(3):
            self.once(self.at(22))
        self.server.mode = 'ready'
        self.once(self.at(23))
        self.assertEqual(self.records(), [])
        self.assertFalse(observer.load_state(self.state)['open'])

    def test_credentials_do_not_reach_logs(self):
        self.server.mode = 'down'
        url = f'http://user:{SECRET}@{self.url.split("//", 1)[1]}'
        completed = subprocess.run([sys.executable, str(Path(observer.__file__)), '--url', url, '--interval', '30', '--timeout', '1', '--threshold', '1', '--state', str(self.state), '--events', str(self.events), '--probes', '1', '--at', '2026-11-14T12:00:00+03:00'], check=True, capture_output=True, text=True)
        combined = completed.stdout + completed.stderr + self.events.read_text() + self.state.read_text()
        self.assertNotIn(SECRET, combined)
        self.assertNotIn('user:', combined)

    def test_corrupt_http_stays_a_failed_probe_and_recovers(self):
        garbage = self.raw(lambda conn: (conn.recv(4096), conn.sendall(b'garbage\r\n\r\n')))
        broken = observer.probe(garbage, 1)
        self.assertEqual(broken, {'kind': 'invalid'})
        closed = self.raw(lambda conn: conn.shutdown(socket.SHUT_RDWR))
        self.assertEqual(observer.probe(closed, 1)['kind'], 'unreachable')
        chunked = self.raw(lambda conn: (conn.recv(4096), conn.sendall(b'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n5\r\nhello')))
        self.assertEqual(observer.probe(chunked, 1), {'kind': 'invalid'})
        morning = '2026-11-14T10:00:00+03:00'
        command = [sys.executable, str(Path(observer.__file__)), '--url', garbage, '--interval', '0.05', '--timeout', '1', '--threshold', '3', '--state', str(self.state), '--events', str(self.events), '--probes', '3', '--at', morning]
        failed = subprocess.run(command, check=True, capture_output=True, text=True)
        self.assertNotIn('garbage', failed.stdout + failed.stderr)
        self.assertEqual([item['kind'] for item in self.records()], ['down'])
        self.assertEqual(self.records()[0]['failures'], 3)
        self.server.mode = 'ready'
        recovered = subprocess.run([sys.executable, str(Path(observer.__file__)), '--url', self.url, '--interval', '30', '--timeout', '1', '--threshold', '3', '--state', str(self.state), '--events', str(self.events), '--probes', '1', '--at', '2026-11-14T10:05:00+03:00'], check=True, capture_output=True, text=True)
        self.assertEqual(recovered.returncode, 0)
        self.assertEqual([item['kind'] for item in self.records()], ['down', 'recovered'])

    def raw(self, respond):
        sock = socket.socket()
        sock.bind(('127.0.0.1', 0))
        sock.listen(8)
        stop = threading.Event()

        def loop():
            sock.settimeout(0.2)
            while not stop.is_set():
                try:
                    conn, _ = sock.accept()
                except socket.timeout:
                    continue
                with conn:
                    try:
                        respond(conn)
                    except OSError:
                        pass

        thread = threading.Thread(target=loop, daemon=True)
        thread.start()
        self.addCleanup(stop.set)
        self.addCleanup(sock.close)
        return f'http://127.0.0.1:{sock.getsockname()[1]}/api/ready'

    def test_corrupt_state_is_refused(self):
        self.state.write_text('not-json')
        with self.assertRaises(SystemExit):
            observer.load_state(self.state)


if __name__ == '__main__':
    unittest.main()
