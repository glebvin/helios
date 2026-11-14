#!/usr/bin/env python3
"""Synthetic R46 contour: real pg_dump, real pg_restore, separate database and files.

The script owns 127.0.0.1:54502 and 127.0.0.1:54512. It does not use 54339, 54441
or 4357 and does not send the copy anywhere but the local destination it created.
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / 'deploy' / 'backup' / 'helios_backup.py'
PINS = ROOT / 'deploy' / 'backup' / 'postgres-17.12.0.json'
WORK = ROOT / '.data' / 'r46'
SQL_DIR = ROOT / 'apps' / 'api' / 'sql'
SOURCE_PORT = 54502
DEST_PORT = 54512
TENANT = '11111111-1111-4111-8111-111111111111'
USER = '22222222-2222-4222-8222-222222222222'
ORG = '33333333-3333-4333-8333-333333333333'
EMPLOYEE = '44444444-4444-4444-8444-444444444444'
PROJECT = '55555555-5555-4555-8555-555555555555'
TASK = '66666666-6666-4666-8666-666666666666'
SHIFT = '77777777-7777-4777-8777-777777777777'
REQUEST = '88888888-8888-4888-8888-888888888888'
REPORT = '99999999-9999-4999-8999-999999999999'
FILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
PAYLOAD = b'%PDF-1.4\n%HELIOS-R46-SYNTHETIC\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'
SECRETS: list[str] = []


def fail(message: str) -> None:
    raise SystemExit(scrub(message))


def scrub(text: str) -> str:
    for secret in SECRETS:
        if secret:
            text = text.replace(secret, '[redacted]')
    return text


def remember(secret: str) -> str:
    SECRETS.append(secret)
    return secret


def run(cmd: list[str], env: dict, stdin: bytes | None = None) -> str:
    result = subprocess.run(cmd, env=env, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout = result.stdout.decode('utf-8', 'replace')
    stderr = result.stderr.decode('utf-8', 'replace')
    if result.returncode != 0:
        fail(f'{Path(cmd[0]).name} failed: {scrub(stderr or stdout)}')
    if any(secret and secret in stdout + stderr for secret in SECRETS):
        fail('a generated password appeared in command output')
    return stdout


def port_open(port: int) -> bool:
    with socket.socket() as probe:
        probe.settimeout(0.2)
        return probe.connect_ex(('127.0.0.1', port)) == 0


def platform_key() -> str:
    machine = platform.machine().lower()
    if sys.platform == 'darwin' and machine in {'arm64', 'aarch64'}:
        return 'darwin-arm64'
    if sys.platform == 'linux' and machine in {'x86_64', 'amd64'}:
        return 'linux-x64'
    fail(f'no pinned PostgreSQL client for {sys.platform}/{machine}; restore was not simulated')
    return ''


def library_env(lib: Path) -> dict:
    env = {
        'PATH': os.environ.get('PATH', ''),
        'HOME': os.environ.get('HOME', ''),
        'LANG': 'C',
        'LC_ALL': 'C',
        'TMPDIR': os.environ.get('TMPDIR', '/tmp'),
    }
    variable = 'DYLD_LIBRARY_PATH' if sys.platform == 'darwin' else 'LD_LIBRARY_PATH'
    env[variable] = str(lib)
    return env


def ensure_binaries() -> tuple[Path, Path]:
    pins = json.loads(PINS.read_text())
    spec = pins['archives'][platform_key()]
    cache = WORK / 'cache' / f'{platform_key()}.tar.gz'
    cache.parent.mkdir(parents=True, exist_ok=True)
    if not cache.exists() or hashlib.sha256(cache.read_bytes()).hexdigest() != spec['sha256']:
        request = urllib.request.Request(spec['url'], headers={'User-Agent': 'helios-r46-restore'})
        with urllib.request.urlopen(request, timeout=300) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != spec['sha256']:
            fail('PostgreSQL archive checksum does not match the pin')
        cache.write_bytes(data)
    dest = WORK / 'pgsql' / pins['version'] / platform_key()
    marker = dest / '.ready'
    if not marker.exists():
        if dest.exists():
            shutil.rmtree(dest)
        dest.mkdir(parents=True)
        with tarfile.open(cache, mode='r:gz') as archive:
            dest_root = dest.resolve()
            for member in archive.getmembers():
                if member.name.startswith('/') or '..' in Path(member.name).parts:
                    fail('PostgreSQL archive contains an unsafe path')
                link = getattr(member, 'linkname', '') or ''
                if link.startswith('/') or '..' in Path(link).parts:
                    fail('PostgreSQL archive contains an unsafe link')
                archive.extract(member, dest)
                extracted = dest / member.name
                if dest_root not in extracted.resolve().parents and extracted.resolve() != dest_root:
                    fail('PostgreSQL archive escaped its directory')
        marker.write_text('ok\n')
    dumps = list(dest.rglob('pg_dump'))
    if not dumps:
        fail('pinned archive has no pg_dump')
    dump = dumps[0]
    bindir = dump.parent
    lib = bindir.parent / 'lib'
    if not (bindir / 'pg_restore').is_file() or not (bindir / 'psql').is_file():
        fail('pinned archive has no pg_restore or psql')
    return bindir, lib


class Cluster:
    def __init__(self, name: str, port: int, password: str, bindir: Path, lib: Path):
        self.name = name
        self.port = port
        self.password = password
        self.data = WORK / name
        self.env = library_env(lib)
        self.bindir = bindir
        self.started = False

    def start(self) -> None:
        if self.data.exists():
            shutil.rmtree(self.data)
        self.data.mkdir(mode=0o700)
        pwfile = WORK / f'{self.name}.pwfile'
        fd = os.open(pwfile, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            with os.fdopen(fd, 'w') as handle:
                handle.write(self.password + '\n')
            run([
                str(self.bindir / 'initdb'), '-D', str(self.data), '--username=helios',
                '--pwfile', str(pwfile), '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C',
            ], self.env)
        finally:
            pwfile.unlink(missing_ok=True)
        options = f'-c listen_addresses=127.0.0.1 -c port={self.port} -c log_statement=none'
        run([
            str(self.bindir / 'pg_ctl'), '-D', str(self.data), '-w', '-t', '60',
            '-l', str(self.data / 'server.log'), '-o', options, 'start',
        ], self.env)
        self.started = True

    def stop(self) -> None:
        if (self.data / 'PG_VERSION').exists():
            subprocess.run(
                [str(self.bindir / 'pg_ctl'), '-D', str(self.data), '-w', '-t', '60', '-m', 'fast', 'stop'],
                env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        self.started = False
        shutil.rmtree(self.data, ignore_errors=True)

    def psql(self, database: str, sql: str, stdin: bool = False) -> str:
        env, directory = pg_env(self, database)
        try:
            cmd = [str(self.bindir / 'psql'), '--no-password', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '-At']
            if stdin:
                return run(cmd, env, sql.encode())
            return run(cmd + ['-c', sql], env).strip()
        finally:
            shutil.rmtree(directory, ignore_errors=True)


def pg_env(cluster: Cluster, database: str) -> tuple[dict, Path]:
    directory = Path(tempfile.mkdtemp(prefix='helios-r46-'))
    os.chmod(directory, 0o700)
    pgpass = directory / 'pgpass'
    fd = os.open(pgpass, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as handle:
        handle.write(f'127.0.0.1:{cluster.port}:*:helios:{cluster.password}\n')
    env = dict(cluster.env)
    env.update({
        'PGHOST': '127.0.0.1', 'PGPORT': str(cluster.port), 'PGUSER': 'helios',
        'PGDATABASE': database, 'PGPASSFILE': str(pgpass), 'PGCLIENTENCODING': 'UTF8',
    })
    return env, directory


def config(bindir: Path, lib: Path, source_files: Path, dest_port: int, dest_database: str, dest_files: Path) -> dict:
    return {
        'consistency': 'writers-stopped',
        'pg_bin': str(bindir),
        'pg_lib': str(lib),
        'source': {
            'host': '127.0.0.1', 'port': SOURCE_PORT, 'database': 'helios_r46', 'user': 'helios',
            'password_env': 'HELIOS_R46_SOURCE_PASSWORD', 'files': str(source_files),
        },
        'destination': {
            'host': '127.0.0.1', 'port': dest_port, 'database': dest_database, 'user': 'helios',
            'password_env': 'HELIOS_R46_DEST_PASSWORD', 'files': str(dest_files),
        },
    }


def write_config(path: Path, body: dict) -> None:
    path.write_text(json.dumps(body, ensure_ascii=False, indent=2) + '\n')
    os.chmod(path, 0o600)


def invoke(args: list[str], source_password: str, dest_password: str, fault: str | None = None) -> tuple[int, str, str]:
    env = os.environ.copy()
    env['HELIOS_R46_SOURCE_PASSWORD'] = source_password
    env['HELIOS_R46_DEST_PASSWORD'] = dest_password
    env.pop('HELIOS_BACKUP_INJECT_FAULT', None)
    if fault:
        env['HELIOS_BACKUP_INJECT_FAULT'] = fault
    result = subprocess.run([sys.executable, str(TOOL), *args], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout = result.stdout.decode('utf-8', 'replace')
    stderr = result.stderr.decode('utf-8', 'replace')
    if any(secret and secret in stdout + stderr for secret in SECRETS):
        fail('backup tool printed a generated password')
    return result.returncode, stdout, stderr


def require_refusal(code: int, stderr: str, phrase: str) -> None:
    if code == 0 or phrase not in stderr:
        fail(f'expected refusal containing {phrase!r}, got {code}: {scrub(stderr)}')


def apply_migrations(cluster: Cluster) -> None:
    cluster.psql('helios_r46', """
        CREATE TABLE IF NOT EXISTS schema_migrations (
          filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    for path in sorted(SQL_DIR.glob('[0-9]*.sql')):
        statement = (
            'BEGIN;\n' + path.read_text() +
            "\nREVOKE ALL ON schema_migrations FROM helios_app;\n"
            f"INSERT INTO schema_migrations (filename) VALUES ('{path.name}');\nCOMMIT;\n"
        )
        cluster.psql('helios_r46', statement, stdin=True)


def seed(cluster: Cluster, evidence: Path) -> str:
    digest = hashlib.sha256(PAYLOAD).hexdigest()
    target = evidence / TENANT / FILE_ID
    target.parent.mkdir(parents=True, mode=0o700)
    os.chmod(evidence, 0o700)
    os.chmod(target.parent, 0o700)
    target.write_bytes(PAYLOAD)
    os.chmod(target, 0o600)
    command = hashlib.sha256(b'r46-synthetic-command').hexdigest()
    cluster.psql('helios_r46', f"""
        INSERT INTO tenants (id, name) VALUES ('{TENANT}', 'R46 synthetic');
        INSERT INTO users (id, email, name, password_hash)
          VALUES ('{USER}', 'r46-synthetic@example.test', 'R46 synthetic', 'synthetic-r46-not-a-login');
        INSERT INTO organizations (tenant_id, id, kind, name)
          VALUES ('{TENANT}', '{ORG}', 'own', 'R46 synthetic org');
        INSERT INTO memberships (tenant_id, user_id, role) VALUES ('{TENANT}', '{USER}', 'director');
        INSERT INTO employees (tenant_id, id, organization_id, user_id, full_name, phone, document_number)
          VALUES ('{TENANT}', '{EMPLOYEE}', '{ORG}', '{USER}', 'Синтетический работник R46', '+70000000046', 'R46-SYNTH');
        INSERT INTO projects (tenant_id, id, name) VALUES ('{TENANT}', '{PROJECT}', 'R46 synthetic project');
        INSERT INTO daily_tasks (tenant_id, id, project_id, title, work_date, planned_quantity, unit, assignee_employee_id, status)
          VALUES ('{TENANT}', '{TASK}', '{PROJECT}', 'Синтетическое задание R46', DATE '2026-11-14', 2.000, 'м3', '{EMPLOYEE}', 'published');
        INSERT INTO managed_execution_streams (tenant_id, employee_id, version) VALUES ('{TENANT}', '{EMPLOYEE}', 1);
        INSERT INTO managed_shifts (tenant_id, project_id, employee_id, id, started_at, ended_at)
          VALUES ('{TENANT}', '{PROJECT}', '{EMPLOYEE}', '{SHIFT}', '2026-11-14 08:00:00+00', '2026-11-14 17:00:00+00');
        INSERT INTO people_command_receipts (tenant_id, actor_user_id, request_id, operation, command_hash, status, result)
          VALUES ('{TENANT}', '{USER}', '{REQUEST}', 'submit_volume', '{command}', 201, '{{}}'::jsonb);
        INSERT INTO managed_execution_events (
          tenant_id, actor_user_id, request_id, employee_id, project_id, shift_id, kind, version,
          occurred_at, received_at, original_payload, command_hash, review_flags)
          VALUES ('{TENANT}', '{USER}', '{REQUEST}', '{EMPLOYEE}', '{PROJECT}', '{SHIFT}', 'submit_volume', 1,
            '2026-11-14 12:00:00+00', '2026-11-14 12:00:00+00', '{{}}'::jsonb, '{command}', '{{}}'::jsonb);
        INSERT INTO managed_execution_reports (
          tenant_id, project_id, employee_id, shift_id, report_id, task_id, actor_user_id, request_id, submitted_quantity)
          VALUES ('{TENANT}', '{PROJECT}', '{EMPLOYEE}', '{SHIFT}', '{REPORT}', '{TASK}', '{USER}', '{REQUEST}', 1.500);
        INSERT INTO private_evidence_files (
          tenant_id, id, project_id, employee_id, filename, content_type, size_bytes, sha256, state, reserved_by, ready_by, ready_at)
          VALUES ('{TENANT}', '{FILE_ID}', '{PROJECT}', '{EMPLOYEE}', 'report.pdf', 'application/pdf', {len(PAYLOAD)},
            '{digest}', 'ready', '{USER}', '{USER}', '2026-11-14 12:01:00+00');
        INSERT INTO private_evidence_attachments (
          tenant_id, file_id, project_id, employee_id, target_kind, report_id, attached_by)
          VALUES ('{TENANT}', '{FILE_ID}', '{PROJECT}', '{EMPLOYEE}', 'final_report', '{REPORT}', '{USER}');
    """, stdin=True)
    return digest


def linked_row(cluster: Cluster, database: str) -> str:
    sql = f"""
        BEGIN;
        SET LOCAL ROLE helios_app;
        SELECT set_config('app.tenant_id', '{TENANT}', true);
        SELECT e.full_name || '|' || t.title || '|' || r.submitted_quantity::text || '|' || f.sha256 || '|' || a.report_id::text || '|' || f.state
        FROM employees e
        JOIN daily_tasks t ON t.tenant_id = e.tenant_id AND t.assignee_employee_id = e.id
        JOIN managed_execution_reports r ON r.tenant_id = t.tenant_id AND r.project_id = t.project_id AND r.task_id = t.id AND r.employee_id = e.id
        JOIN private_evidence_attachments a ON a.tenant_id = r.tenant_id AND a.project_id = r.project_id AND a.employee_id = r.employee_id AND a.report_id = r.report_id
        JOIN private_evidence_files f ON f.tenant_id = a.tenant_id AND f.id = a.file_id
        WHERE e.id = '{EMPLOYEE}';
        COMMIT;
    """
    lines = [line for line in cluster.psql(database, sql, stdin=True).splitlines() if '|' in line]
    if len(lines) != 1:
        fail(f'expected one linked row, got {lines!r}')
    return lines[0]


def hidden_without_tenant(cluster: Cluster, database: str) -> str:
    sql = """
        BEGIN;
        SET LOCAL ROLE helios_app;
        SELECT count(*)::text FROM employees;
        COMMIT;
    """
    lines = [line.strip() for line in cluster.psql(database, sql, stdin=True).splitlines() if line.strip().isdigit()]
    if lines != ['0'] and lines != ['1']:
        fail(f'unexpected tenant-hidden count {lines!r}')
    return lines[0]


def create_role(cluster: Cluster) -> None:
    role_password = remember(os.urandom(18).hex())
    cluster.psql('postgres', f"CREATE ROLE helios_app LOGIN PASSWORD '{role_password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB", stdin=True)


def main() -> None:
    for port in (SOURCE_PORT, DEST_PORT):
        if port_open(port):
            fail(f'127.0.0.1:{port} is already in use; the R46 contour was not started')
    WORK.mkdir(parents=True, exist_ok=True)
    for child in WORK.iterdir():
        if child.name in {'cache', 'pgsql'}:
            continue
        shutil.rmtree(child) if child.is_dir() else child.unlink()
    bindir, lib = ensure_binaries()
    version = run([str(bindir / 'pg_dump'), '--version'], library_env(lib)).strip()
    if '17.12' not in version:
        fail(f'pg_dump is {version}, expected the pinned 17.12 client')
    source_password = remember(os.urandom(24).hex())
    dest_password = remember(os.urandom(24).hex())
    evidence = WORK / 'evidence'
    restored = WORK / 'restored'
    backup = WORK / 'backup-a'
    for path in (evidence, restored, backup):
        if path.exists():
            shutil.rmtree(path)
    evidence.mkdir(parents=True, mode=0o700)
    source = Cluster('source-pg', SOURCE_PORT, source_password, bindir, lib)
    destination = Cluster('dest-pg', DEST_PORT, dest_password, bindir, lib)
    checks: list[str] = []
    try:
        source.start()
        destination.start()
        create_role(source)
        create_role(destination)
        source.psql('postgres', 'CREATE DATABASE helios_r46 OWNER helios')
        apply_migrations(source)
        digest = seed(source, evidence)
        base = config(bindir, lib, evidence, DEST_PORT, 'helios_r46', restored)
        base_path = WORK / 'contour.json'
        write_config(base_path, base)

        live = dict(base, consistency='live')
        live_path = WORK / 'live.json'
        write_config(live_path, live)
        code, _stdout, stderr = invoke(['snapshot', '--config', str(live_path), '--output', str(WORK / 'should-not-exist')], source_password, dest_password)
        require_refusal(code, stderr, 'writers-stopped')
        if (WORK / 'should-not-exist').exists():
            fail('rejected snapshot created an output directory')
        checks.append('live-copy-refused')

        forbidden = json.loads(json.dumps(base))
        forbidden['source']['port'] = 54339
        forbidden_path = WORK / 'forbidden.json'
        write_config(forbidden_path, forbidden)
        code, _stdout, stderr = invoke(['snapshot', '--config', str(forbidden_path), '--output', str(WORK / 'forbidden-output')], source_password, dest_password)
        require_refusal(code, stderr, '54339')
        checks.append('forbidden-port-refused')

        kept = WORK / 'existing-output'
        kept.mkdir(mode=0o700)
        (kept / 'keep.txt').write_text('previous\n')
        code, _stdout, stderr = invoke(['snapshot', '--config', str(base_path), '--output', str(kept)], source_password, dest_password)
        require_refusal(code, stderr, 'already exists')
        if (kept / 'keep.txt').read_text() != 'previous\n' or (kept / 'COMPLETE').exists():
            fail('refused snapshot changed the existing directory')
        checks.append('existing-output-kept')

        overlap = WORK / 'evidence' / 'nested-backup'
        code, _stdout, stderr = invoke(['snapshot', '--config', str(base_path), '--output', str(overlap)], source_password, dest_password)
        require_refusal(code, stderr, 'overlap')
        checks.append('overlapping-output-refused')

        sleeper_env, sleeper_dir = pg_env(source, 'helios_r46')
        sleeper = subprocess.Popen(
            [str(bindir / 'psql'), '--no-password', '--no-psqlrc', '-c', 'SELECT pg_sleep(120)'],
            env=sleeper_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        try:
            deadline = time.time() + 10
            while time.time() < deadline:
                count = source.psql('helios_r46', "SELECT count(*) FROM pg_stat_activity WHERE datname = 'helios_r46' AND query LIKE '%pg_sleep%'")
                if count != '0':
                    break
                time.sleep(0.1)
            else:
                fail('writer session did not appear')
            quiet_output = WORK / 'quiet-output'
            code, _stdout, stderr = invoke(['snapshot', '--config', str(base_path), '--output', str(quiet_output)], source_password, dest_password)
            require_refusal(code, stderr, 'another client')
            if quiet_output.exists():
                fail('refused copy created an output directory')
            checks.append('writers-not-stopped-refused')
        finally:
            source.psql('helios_r46', "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'")
            sleeper.kill()
            sleeper.wait(timeout=10)
            shutil.rmtree(sleeper_dir, ignore_errors=True)
            quiet = "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'"
            deadline = time.time() + 10
            while time.time() < deadline and source.psql('helios_r46', quiet) != '0':
                time.sleep(0.1)
            if source.psql('helios_r46', quiet) != '0':
                detail = source.psql('helios_r46', "SELECT coalesce(state,'') || ' ' || left(query, 60) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()")
                fail(f'writer session stayed connected after the refusal: {detail}')

        started = time.perf_counter()
        code, stdout, stderr = invoke(['snapshot', '--config', str(base_path), '--output', str(backup)], source_password, dest_password)
        snapshot_seconds = round(time.perf_counter() - started, 3)
        if code != 0 or (backup / 'COMPLETE').read_text() != 'ok\n':
            fail(scrub(stderr or stdout))
        manifest = json.loads((backup / 'manifest.json').read_text())
        if manifest['atomic'] is not False or manifest['consistency'] != 'writers-stopped':
            fail('manifest described the sequential copy as atomic')
        original_dump = hashlib.sha256((backup / 'database.dump').read_bytes()).hexdigest()
        original_tar = hashlib.sha256((backup / 'files.tar').read_bytes()).hexdigest()
        checks.append('snapshot')

        started = time.perf_counter()
        code, stdout, stderr = invoke(['restore', '--config', str(base_path), '--backup', str(backup)], source_password, dest_password)
        restore_seconds = round(time.perf_counter() - started, 3)
        if code != 0:
            fail(scrub(stderr or stdout))
        restored_bytes = (restored / TENANT / FILE_ID).read_bytes()
        if restored_bytes != PAYLOAD or hashlib.sha256(restored_bytes).hexdigest() != digest:
            fail('restored attachment bytes differ')
        expected = f'Синтетический работник R46|Синтетическое задание R46|1.500|{digest}|{REPORT}|ready'
        if linked_row(destination, 'helios_r46') != expected:
            fail(f'restored link was {linked_row(destination, "helios_r46")!r}')
        hidden = hidden_without_tenant(destination, 'helios_r46')
        if hidden != '0':
            detail = destination.psql('helios_r46', "SELECT relrowsecurity::text || ' ' || relforcerowsecurity::text FROM pg_class WHERE relname = 'employees'")
            role = destination.psql('helios_r46', "SELECT rolsuper::text || ' ' || rolbypassrls::text FROM pg_roles WHERE rolname = 'helios_app'")
            fail(f'restored rows were visible without a tenant: {hidden!r} rls={detail!r} role={role!r}')
        source_schema = source.psql('helios_r46', 'SELECT filename FROM schema_migrations ORDER BY filename')
        dest_schema = destination.psql('helios_r46', 'SELECT filename FROM schema_migrations ORDER BY filename')
        if source_schema != dest_schema:
            fail('restored schema_migrations differ')
        checks.append('restore-bytes-and-links')

        same_db = json.loads(json.dumps(base))
        same_db['destination']['port'] = SOURCE_PORT
        same_db['destination']['files'] = str(WORK / 'unused-files')
        same_path = WORK / 'same-db.json'
        write_config(same_path, same_db)
        code, _stdout, stderr = invoke(['restore', '--config', str(same_path), '--backup', str(backup)], source_password, dest_password)
        require_refusal(code, stderr, 'source contour')
        if linked_row(source, 'helios_r46') != expected:
            fail('refused restore changed the source rows')
        checks.append('same-database-refused')

        same_files = json.loads(json.dumps(base))
        same_files['destination']['database'] = 'helios_r46_other'
        same_files['destination']['files'] = str(evidence)
        same_files_path = WORK / 'same-files.json'
        write_config(same_files_path, same_files)
        code, _stdout, stderr = invoke(['restore', '--config', str(same_files_path), '--backup', str(backup)], source_password, dest_password)
        require_refusal(code, stderr, 'source catalog')
        if (evidence / TENANT / FILE_ID).read_bytes() != PAYLOAD:
            fail('refused restore changed the source file')
        checks.append('same-files-refused')

        destination.psql('postgres', 'CREATE DATABASE helios_r46_taken OWNER helios')
        destination.psql('helios_r46_taken', 'CREATE TABLE keep_r46 (id int); INSERT INTO keep_r46 VALUES (7)')
        occupied_db = json.loads(json.dumps(base))
        occupied_db['destination']['database'] = 'helios_r46_taken'
        occupied_db['destination']['files'] = str(WORK / 'occupied-db-files')
        occupied_db_path = WORK / 'occupied-db.json'
        write_config(occupied_db_path, occupied_db)
        code, _stdout, stderr = invoke(['restore', '--config', str(occupied_db_path), '--backup', str(backup)], source_password, dest_password)
        require_refusal(code, stderr, 'already exists')
        if destination.psql('helios_r46_taken', 'SELECT id::text FROM keep_r46') != '7':
            fail('refused restore changed the occupied database')
        checks.append('occupied-database-kept')

        occupied_files = WORK / 'occupied-files'
        occupied_files.mkdir(mode=0o700)
        (occupied_files / 'keep.txt').write_text('keep\n')
        occupied_files_body = json.loads(json.dumps(base))
        occupied_files_body['destination']['database'] = 'helios_r46_files'
        occupied_files_body['destination']['files'] = str(occupied_files)
        occupied_files_path = WORK / 'occupied-files.json'
        write_config(occupied_files_path, occupied_files_body)
        code, _stdout, stderr = invoke(['restore', '--config', str(occupied_files_path), '--backup', str(backup)], source_password, dest_password)
        require_refusal(code, stderr, 'already exists')
        if (occupied_files / 'keep.txt').read_text() != 'keep\n':
            fail('refused restore changed the occupied catalog')
        if destination.psql('postgres', "SELECT 1 FROM pg_database WHERE datname = 'helios_r46_files'") == '1':
            fail('refused restore created a database for an occupied catalog')
        checks.append('occupied-files-kept')

        def corrupt(name: str, mutate) -> None:
            copy = WORK / name
            if copy.exists():
                shutil.rmtree(copy)
            shutil.copytree(backup, copy)
            mutate(copy / 'files.tar')
            (copy / 'COMPLETE').write_text('ok\n')
            target_db = name.replace('-', '_')
            target_files = WORK / f'{name}-files'
            body = json.loads(json.dumps(base))
            body['destination']['database'] = target_db
            body['destination']['files'] = str(target_files)
            path = WORK / f'{name}.json'
            write_config(path, body)
            code, _stdout, stderr = invoke(['restore', '--config', str(path), '--backup', str(copy)], source_password, dest_password)
            require_refusal(code, stderr, 'checksum')
            if target_files.exists() or destination.psql('postgres', f"SELECT 1 FROM pg_database WHERE datname = '{target_db}'") == '1':
                fail(f'{name} restore created a destination')
            if hashlib.sha256((backup / 'files.tar').read_bytes()).hexdigest() != original_tar:
                fail(f'{name} changed the original archive')

        def flip(path: Path) -> None:
            data = bytearray(path.read_bytes())
            data[len(data) // 2] ^= 0x01
            path.write_bytes(data)

        def shorten(path: Path) -> None:
            data = path.read_bytes()
            path.write_bytes(data[:-32])

        corrupt('bitflip', flip)
        checks.append('bitflip-refused')
        corrupt('truncated', shorten)
        checks.append('truncated-refused')

        failed = WORK / 'backup-failed'
        code, _stdout, stderr = invoke(
            ['snapshot', '--config', str(base_path), '--output', str(failed)],
            source_password, dest_password, fault='after-dump',
        )
        require_refusal(code, stderr, 'injected copy failure')
        if (failed / 'COMPLETE').exists() or (failed / 'manifest.json').exists():
            fail('failed copy left a success marker')
        if hashlib.sha256((backup / 'database.dump').read_bytes()).hexdigest() != original_dump:
            fail('failed copy changed the previous dump')
        if hashlib.sha256((backup / 'files.tar').read_bytes()).hexdigest() != original_tar:
            fail('failed copy changed the previous archive')
        if (evidence / TENANT / FILE_ID).read_bytes() != PAYLOAD or linked_row(source, 'helios_r46') != expected:
            fail('source contour changed after the failed copy')
        checks.append('copy-failure-keeps-previous')

        result = {
            'postgres_client': version,
            'source': f'127.0.0.1:{SOURCE_PORT}/helios_r46',
            'destination': f'127.0.0.1:{DEST_PORT}/helios_r46',
            'snapshot_seconds': snapshot_seconds,
            'restore_seconds': restore_seconds,
            'manifest_snapshot_seconds': manifest['duration_seconds'],
            'attachment_sha256': digest,
            'schema_migrations': len(source_schema.splitlines()),
            'checks': checks,
            'consistency': 'writers-stopped',
            'atomic': False,
        }
        result_path = WORK / 'result.json'
        result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps(result, ensure_ascii=False))
    finally:
        source.stop()
        destination.stop()


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except Exception as error:
        fail(str(error))
