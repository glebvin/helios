"""Filesystem safety regressions; no database or real credential is used."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('backup', Path(__file__).resolve().parents[1] / 'deploy/backup/helios_backup.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class RestoreSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='helios-r46-safety-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / 'source'
        self.source.mkdir()
        self.target = self.root / 'target'
        self.copy = self.root / 'copy'
        self.copy.mkdir()
        binaries = self.root / 'bin'
        binaries.mkdir()
        for name in ['psql', 'pg_dump', 'pg_restore']:
            (binaries / name).touch()
        (self.copy / 'database.dump').write_bytes(b'synthetic-dump')
        with tarfile.open(self.copy / 'files.tar', 'w'):
            pass
        manifest = {'format': 1, 'consistency': 'writers-stopped', 'atomic': False,
                    'source': {'host': '127.0.0.1', 'port': 54502, 'database': 'source_db', 'files': str(self.source)}}
        for key, name in [('dump', 'database.dump'), ('files', 'files.tar')]:
            path = self.copy / name
            manifest[key] = {'file': name, 'bytes': path.stat().st_size, 'sha256': backup.sha256_file(path)}
        manifest['files']['entries'] = []
        (self.copy / 'manifest.json').write_text(json.dumps(manifest))
        (self.copy / 'COMPLETE').write_text('ok\n')
        self.config = {'consistency': 'writers-stopped', 'pg_bin': str(binaries)}
        for name, port, database, files in [('source', 54502, 'source_db', self.source), ('destination', 54512, 'target_db', self.target)]:
            self.config[name] = {'host': '127.0.0.1', 'port': port, 'database': database, 'user': 'helios',
                                 'files': str(files), 'password_env': 'HELIOS_SAFETY_' + name.upper()}
        self.env = patch.dict(os.environ, {'HELIOS_SAFETY_SOURCE': 'synthetic-source-value', 'HELIOS_SAFETY_DESTINATION': 'synthetic-dest-value'})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_recorded_source_stays_protected_when_config_source_changes(self):
        self.config['source']['files'] = str(self.root / 'other-source')
        self.config['destination']['files'] = str(self.source / 'nested')
        with patch.object(backup, 'psql', side_effect=AssertionError('must refuse before connecting')):
            with self.assertRaisesRegex(backup.Refusal, 'source catalog'):
                backup.restore(self.config, self.copy)
        self.assertFalse((self.source / 'nested').exists())

    def test_directory_created_by_someone_else_is_never_removed(self):
        statements = []
        real_exists = Path.exists
        raced = False
        def exists(path):
            nonlocal raced
            if path == self.target and not raced:
                raced = True
                self.target.mkdir()
                (self.target / 'keep').write_text('foreign-data')
                return False
            return real_exists(path)
        def psql(*args):
            sql = args[-1]
            statements.append(sql)
            return ''
        with patch.object(Path, 'exists', exists), patch.object(backup, 'psql', side_effect=psql), patch.object(backup, 'run', side_effect=backup.Refusal('synthetic restore failure')):
            with self.assertRaises(backup.Refusal):
                backup.restore(self.config, self.copy)
        self.assertTrue(raced, 'the directory race must actually be exercised')
        self.assertTrue((self.target / 'keep').exists(), 'foreign destination was deleted')
        self.assertEqual((self.target / 'keep').read_text(), 'foreign-data')
        self.assertFalse(any(sql.startswith('CREATE DATABASE') for sql in statements))

    def test_pgpass_does_not_follow_a_precreated_predictable_symlink(self):
        predictable = self.root / f'helios-backup-{os.getpid()}'
        predictable.mkdir()
        sentinel = self.root / 'keep-secret-free'
        sentinel.write_text('keep')
        (predictable / 'pgpass').symlink_to(sentinel)
        item = backup.endpoint(self.config, 'source')
        with patch.dict(os.environ, {'TMPDIR': str(self.root)}):
            env, directory = backup.child_env(item, 'synthetic-password-value', None, 'source_db')
        self.addCleanup(lambda: shutil.rmtree(directory, ignore_errors=True))
        self.assertEqual(sentinel.read_text(), 'keep')
        self.assertNotEqual(directory, predictable)
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
        self.assertEqual(Path(env['PGPASSFILE']).stat().st_mode & 0o777, 0o600)


if __name__ == '__main__':
    unittest.main()
