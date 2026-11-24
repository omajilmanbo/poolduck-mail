import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syntheticSeedDatabaseUrls } from './synthetic-subscriptions-test-db.mjs';

test('builds both local targets from approved fields for CI and query-free inputs', () => {
  const names = new Set();
  for (const [source, port] of [
    ['postgresql://fixture:p%40ss@localhost:55432/ignored?schema=public', '55432'],
    ['postgres://fixture:p%40ss@127.0.0.1/ignored', '5432'],
  ]) {
    const { adminUrl, databaseUrl, databaseName } = syntheticSeedDatabaseUrls(source);
    const authority = `postgresql://fixture:p%40ss@127.0.0.1:${port}`;
    assert.equal(adminUrl.href, `${authority}/postgres`);
    assert.match(databaseName, /^poolduck_seed_test_[a-f0-9]{32}$/);
    assert.equal(databaseUrl.href, `${authority}/${databaseName}`);
    names.add(databaseName);
  }
  assert.equal(names.size, 2);
});

test('rejects unsupported protocols, hosts, ports and query options offline', () => {
  for (const source of [
    'https://localhost:5432/ignored',
    'postgresql://fixture.example.invalid:5432/ignored',
    'postgresql://localhost:0/ignored',
    ...['host=localhost', 'port=55432', 'dbname=postgres', '%68ost=localhost',
      'schema=private', 'schema=public&schema=public', 'schema=public&options=test',
    ].map(query => `postgresql://localhost:5432/ignored?${query}`),
  ]) {
    assert.throws(() => syntheticSeedDatabaseUrls(source), assert.AssertionError);
  }
});
