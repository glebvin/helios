#!/usr/bin/env python3
"""Copy one quiescent PostgreSQL database and its file catalog, then restore both elsewhere.

The database dump and the file archive are taken one after another. They are a
matching pair only when the caller has already stopped writers. This is not an
atomic snapshot of the database and the files together.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import time
from pathlib import Path

FORMAT = 1
FORBIDDEN_PORTS = {54339, 54441, 4357}
IDENT = re.compile(r'^[a-z][a-z0-9_]{0,62}$')
RESERVED_DATABASES = {'postgres', 'template0', 'template1'}


class Refusal(Exception):
    """The copy or restore stopped before changing a protected contour."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def durable(path: Path) -> None:
    with path.open('rb') as handle:
        os.fsync(handle.fileno())
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def load_config(path: Path) -> dict:
    config = json.loads(path.read_text())
    if config.get('consistency') != 'writers-stopped':
        raise Refusal(
            'consistency must be writers-stopped: a dump and a later file archive '
            'are not an atomic snapshot while anything is still writing'
        )
    return config


def endpoint(config: dict, name: str) -> dict:
    value = config.get(name)
    if not isinstance(value, dict):
        raise Refusal(f'{name} is required')
    host = value.get('host')
    if host != '127.0.0.1':
        raise Refusal(f'{name} host must be 127.0.0.1; this version does not copy off the machine')
    try:
        port = int(value.get('port'))
    except (TypeError, ValueError):
        raise Refusal(f'{name} port is invalid')
    if port in FORBIDDEN_PORTS or not 1024 <= port <= 65535:
        raise Refusal(f'{name} port {port} is not a contour this tool may use')
    database = value.get('database')
    user = value.get('user')
    if not isinstance(database, str) or not IDENT.fullmatch(database):
        raise Refusal(f'{name} database name is invalid')
    if not isinstance(user, str) or not IDENT.fullmatch(user):
        raise Refusal(f'{name} user is invalid')
    password_env = value.get('password_env')
    if not isinstance(password_env, str) or not re.fullmatch(r'[A-Z][A-Z0-9_]{2,60}', password_env):
        raise Refusal(f'{name} password_env must name an environment variable')
    files = value.get('files')
    if not isinstance(files, str) or not Path(files).is_absolute():
        raise Refusal(f'{name} files must be an absolute path')
    return {
        'host': host,
        'port': port,
        'database': database,
        'user': user,
        'password_env': password_env,
        'files': Path(files).resolve(),
    }


def nested(left: Path, right: Path) -> bool:
    try:
        left.resolve().relative_to(right.resolve())
        return True
    except ValueError:
        return False


def same_database(left: dict, right: dict) -> bool:
    return (left['host'], left['port'], left['database']) == (right['host'], right['port'], right['database'])


def secret(endpoint_value: dict) -> str:
    value = os.environ.get(endpoint_value['password_env'], '')
    if not value or '\n' in value or '\x00' in value:
        raise Refusal(f'{endpoint_value["password_env"]} must be set to one line and is not printed')
    return value


def assert_config_has_no_secret(config: dict, endpoints: list[dict]) -> None:
    encoded = json.dumps(config)
    for item in endpoints:
        if secret(item) in encoded:
            raise Refusal('config contains a password; put only password_env in the file')


def pg_bin(config: dict) -> Path:
    raw = config.get('pg_bin')
    if not isinstance(raw, str) or not Path(raw).is_absolute():
        raise Refusal('pg_bin must be the absolute directory with pg_dump, pg_restore and psql')
    directory = Path(raw)
    for name in ('pg_dump', 'pg_restore', 'psql'):
        if not (directory / name).is_file():
            raise Refusal(f'{name} is missing from pg_bin')
    return directory


def pg_lib(config: dict) -> str | None:
    raw = config.get('pg_lib')
    if raw is None:
        return None
    if not isinstance(raw, str) or not Path(raw).is_absolute():
        raise Refusal('pg_lib must be an absolute directory')
    return raw


def child_env(item: dict, password: str, library: str | None, database: str) -> tuple[dict, Path]:
    directory = Path(os.environ.get('TMPDIR', '/tmp')) / f'helios-backup-{os.getpid()}'
    directory.mkdir(mode=0o700, exist_ok=True)
    pgpass = directory / 'pgpass'
    escaped = password.replace('\\', '\\\\').replace(':', '\\:')
    fd = os.open(pgpass, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as handle:
        handle.write(f"{item['host']}:{item['port']}:*:{item['user']}:{escaped}\n")
    env = {
        'PATH': os.environ.get('PATH', ''),
        'HOME': os.environ.get('HOME', ''),
        'LANG': 'C',
        'LC_ALL': 'C',
        'TMPDIR': os.environ.get('TMPDIR', '/tmp'),
        'PGHOST': item['host'],
        'PGPORT': str(item['port']),
        'PGUSER': item['user'],
        'PGDATABASE': database,
        'PGPASSFILE': str(pgpass),
        'PGCLIENTENCODING': 'UTF8',
    }
    if library:
        variable = 'DYLD_LIBRARY_PATH' if sys.platform == 'darwin' else 'LD_LIBRARY_PATH'
        env[variable] = library
    return env, directory


def run(cmd: list[str], env: dict, password: str, **kwargs) -> subprocess.CompletedProcess:
    result = subprocess.run(cmd, env=env, text=False, **kwargs)
    if result.returncode != 0:
        stderr = (result.stderr or b'').decode('utf-8', 'replace').replace(password, '[redacted]')
        raise Refusal(f'command failed ({result.returncode}): {cmd[0]} {stderr.strip()}')
    return result


def psql(binary: Path, item: dict, password: str, library: str | None, database: str, sql: str) -> str:
    env, directory = child_env(item, password, library, database)
    try:
        result = run(
            [str(binary / 'psql'), '--no-password', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '-At', '-c', sql],
            env,
            password,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        return result.stdout.decode('utf-8', 'replace').strip()
    finally:
        shutil.rmtree(directory, ignore_errors=True)


def other_clients(binary: Path, item: dict, password: str, library: str | None) -> int:
    sql = (
        "SELECT count(*) FROM pg_stat_activity "
        "WHERE datname = current_database() AND pid <> pg_backend_pid() "
        "AND backend_type = 'client backend'"
    )
    return int(psql(binary, item, password, library, item['database'], sql))


def archive_files(source: Path, dest: Path) -> list[dict]:
    if not source.is_dir():
        raise Refusal('source files directory does not exist')
    entries = []
    with tarfile.open(dest, 'w', format=tarfile.PAX_FORMAT) as archive:
        for path in sorted(source.rglob('*')):
            relative = path.relative_to(source).as_posix()
            if path.is_symlink():
                raise Refusal(f'refusing to archive symlink {relative}')
            if not path.is_file():
                continue
            info = archive.gettarinfo(path, arcname=relative)
            info.uid = info.gid = 0
            info.uname = info.gname = ''
            info.mtime = 0
            with path.open('rb') as handle:
                archive.addfile(info, handle)
            entries.append({'path': relative, 'sha256': sha256_file(path), 'bytes': path.stat().st_size})
    return entries


def snapshot(config: dict, output: Path) -> dict:
    source = endpoint(config, 'source')
    checked = [source]
    if isinstance(config.get('destination'), dict):
        checked.append(endpoint(config, 'destination'))
    assert_config_has_no_secret(config, checked)
    binary = pg_bin(config)
    library = pg_lib(config)
    password = secret(source)
    if output.exists():
        raise Refusal('output already exists; a new copy must use a new directory and does not replace an old one')
    if nested(output, source['files']) or nested(source['files'], output):
        raise Refusal('output and source files overlap')
    if other_clients(binary, source, password, library):
        raise Refusal('another client is connected; stop writers before copying. Two sequential copies are not an atomic snapshot')
    output.mkdir(mode=0o700)
    started = time.perf_counter()
    try:
        version = psql(binary, source, password, library, source['database'], 'SELECT current_setting(\'server_version\')')
        names = psql(binary, source, password, library, source['database'], 'SELECT filename FROM schema_migrations ORDER BY filename')
        migrations = [line for line in names.splitlines() if line]
        if not migrations:
            raise Refusal('schema_migrations is empty')
        dump = output / 'database.dump'
        env, directory = child_env(source, password, library, source['database'])
        try:
            run(
                [str(binary / 'pg_dump'), '--format=custom', '--no-password', '--file', str(dump)],
                env,
                password,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        finally:
            shutil.rmtree(directory, ignore_errors=True)
        if os.environ.get('HELIOS_BACKUP_INJECT_FAULT') == 'after-dump':
            raise Refusal('injected copy failure after the database dump and before the success marker')
        archive = output / 'files.tar'
        entries = archive_files(source['files'], archive)
        manifest = {
            'format': FORMAT,
            'tool': 'helios-backup',
            'consistency': 'writers-stopped',
            'atomic': False,
            'note': 'pg_dump and the file archive are sequential. They match only if writers stayed stopped for both. This is not an atomic snapshot.',
            'created_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'duration_seconds': round(time.perf_counter() - started, 3),
            'source': {
                'host': source['host'],
                'port': source['port'],
                'database': source['database'],
                'files': str(source['files']),
            },
            'postgres_version': version,
            'schema_migrations': migrations,
            'schema_sha256': hashlib.sha256('\n'.join(migrations).encode()).hexdigest(),
            'dump': {'file': 'database.dump', 'sha256': sha256_file(dump), 'bytes': dump.stat().st_size},
            'files': {'file': 'files.tar', 'sha256': sha256_file(archive), 'bytes': archive.stat().st_size, 'entries': entries},
        }
        manifest_path = output / 'manifest.json'
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        durable(manifest_path)
        marker = output / 'COMPLETE'
        marker.write_text('ok\n')
        durable(marker)
        return manifest
    except Exception:
        if (output / 'COMPLETE').exists():
            (output / 'COMPLETE').unlink()
        raise


def require_archive(manifest: dict, backup: Path) -> None:
    if manifest.get('format') != FORMAT or manifest.get('consistency') != 'writers-stopped' or manifest.get('atomic') is not False:
        raise Refusal('manifest is not a writers-stopped, non-atomic helios backup')
    for key, filename in (('dump', 'database.dump'), ('files', 'files.tar')):
        described = manifest[key]
        path = backup / filename
        if described.get('file') != filename or not path.is_file():
            raise Refusal(f'{filename} is missing')
        if path.stat().st_size != described['bytes'] or sha256_file(path) != described['sha256']:
            raise Refusal(f'{filename} checksum or size does not match the manifest; restore was not started')


def extract_files(archive: Path, dest: Path, entries: list[dict]) -> None:
    dest.mkdir(mode=0o700)
    expected = {item['path']: item for item in entries}
    with tarfile.open(archive, 'r:') as handle:
        members = handle.getmembers()
        names = []
        for member in members:
            name = member.name
            if name.startswith('/') or '..' in Path(name).parts or member.issym() or member.islnk() or not member.isfile():
                raise Refusal('archive contains an unsafe member; destination was not kept')
            names.append(name)
            handle.extract(member, dest)
        if set(names) != set(expected):
            raise Refusal('archive file list does not match the manifest')
    for name, item in expected.items():
        path = dest / name
        if path.stat().st_size != item['bytes'] or sha256_file(path) != item['sha256']:
            raise Refusal(f'restored file {name} does not match the manifest')
        os.chmod(path, 0o600)


def restore(config: dict, backup: Path) -> dict:
    source = endpoint(config, 'source')
    destination = endpoint(config, 'destination')
    assert_config_has_no_secret(config, [source, destination])
    binary = pg_bin(config)
    library = pg_lib(config)
    marker = backup / 'COMPLETE'
    if not marker.is_file() or marker.read_text() != 'ok\n':
        raise Refusal('backup has no success marker; an incomplete copy is not restored')
    manifest = json.loads((backup / 'manifest.json').read_text())
    require_archive(manifest, backup)
    recorded = manifest.get('source') or {}
    recorded_files = Path(str(recorded.get('files', ''))).resolve()
    if destination['database'] in RESERVED_DATABASES:
        raise Refusal('destination database is reserved')
    if (destination['host'], destination['port'], destination['database']) == (
        recorded.get('host'), recorded.get('port'), recorded.get('database')
    ) or same_database(source, destination):
        raise Refusal('destination database is the source contour; restore does not overwrite it')
    if destination['files'] == recorded_files or nested(destination['files'], source['files']) or nested(source['files'], destination['files']):
        raise Refusal('destination files overlap the source catalog; restore does not overwrite it')
    password = secret(destination)
    exists = psql(binary, destination, password, library, 'postgres',
                  f"SELECT 1 FROM pg_database WHERE datname = '{destination['database']}'")
    if exists == '1':
        raise Refusal('destination database already exists; restore does not replace it')
    if destination['files'].exists():
        raise Refusal('destination files path already exists; restore does not replace it')
    created_database = False
    try:
        psql(binary, destination, password, library, 'postgres',
             f"CREATE DATABASE {destination['database']} OWNER {destination['user']}")
        created_database = True
        env, directory = child_env(destination, password, library, destination['database'])
        try:
            run(
                [str(binary / 'pg_restore'), '--no-password', '--exit-on-error', '--dbname', destination['database'], str(backup / 'database.dump')],
                env,
                password,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        finally:
            shutil.rmtree(directory, ignore_errors=True)
        extract_files(backup / 'files.tar', destination['files'], manifest['files']['entries'])
    except Exception:
        if created_database:
            psql(binary, destination, password, library, 'postgres',
                 f"DROP DATABASE IF EXISTS {destination['database']}")
        if destination['files'].exists():
            shutil.rmtree(destination['files'])
        raise
    return {
        'restored_database': destination['database'],
        'restored_files': str(destination['files']),
        'postgres_version': manifest.get('postgres_version'),
        'schema_sha256': manifest.get('schema_sha256'),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='Copy or restore a stopped HELIOS database and file catalog')
    commands = parser.add_subparsers(dest='command', required=True)
    snap = commands.add_parser('snapshot')
    snap.add_argument('--config', type=Path, required=True)
    snap.add_argument('--output', type=Path, required=True)
    back = commands.add_parser('restore')
    back.add_argument('--config', type=Path, required=True)
    back.add_argument('--backup', type=Path, required=True)
    args = parser.parse_args()
    try:
        config = load_config(args.config)
        if args.command == 'snapshot':
            result = snapshot(config, args.output)
        else:
            result = restore(config, args.backup)
    except Refusal as error:
        print(f'helios-backup: {error}', file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
