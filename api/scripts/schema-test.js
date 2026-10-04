// Tests de l'edition du schema (page admin) : colonnes "formule" vides,
// creation / renommage / suppression de tables et de colonnes, changement de
// type avec reconversion des valeurs, persistance apres rechargement.
//
//   node scripts/schema-test.js   (lance aussi par npm test)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';

const tmp = path.join(os.tmpdir(), `2gatcha-schema-${process.pid}.sqlite`);
const clean = () => { for (const sfx of ['', '-wal', '-shm']) fs.rmSync(tmp + sfx, { force: true }); };
clean();

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(' ok  ' + name); } catch (e) { console.log('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; }
}

// Base "importee de Grist" avant le correctif : colonnes vides marquees formule.
let store = new Store(tmp);
store.defineTable('Users', {
  Pseudo: { type: 'Text', isFormula: false, formula: '' },
  ExpeditionUntil: { type: 'Numeric', isFormula: true, formula: '' },
  Computed: { type: 'Numeric', isFormula: true, formula: '$A + 1' }
});
store.defineTable('Pulls', { User: { type: 'Ref:Users', isFormula: false }, Tags: { type: 'ChoiceList', isFormula: false } });
store.create('Users', { Pseudo: 'A' });
store.create('Pulls', { User: 1, Tags: ['L', 'x', 'y'] });
store.db.close();

store = new Store(tmp);

test('colonne formule vide -> colonne de donnees (ecriture acceptee, persistee)', () => {
  store.update('Users', 1, { ExpeditionUntil: '1700000000' });
  assert.equal(store.get('Users', 1).ExpeditionUntil, 1700000000);
  const saved = JSON.parse(store.db.prepare("SELECT columns FROM meta_tables WHERE name = 'Users'").get().columns);
  assert.equal(saved.ExpeditionUntil.isFormula, false);
});

test('vraie formule toujours refusee, puis convertie en donnees', () => {
  assert.throws(() => store.update('Users', 1, { Computed: 3 }), /formula column/);
  store.updateColumn('Users', 'Computed', { formula: false });
  store.update('Users', 1, { Computed: 3 });
  assert.equal(store.get('Users', 1).Computed, 3);
});

test('renommer une colonne garde sa position et ses valeurs', () => {
  store.updateColumn('Users', 'ExpeditionUntil', { id: 'ExpUntil' });
  assert.deepEqual(Object.keys(store.table('Users').columns), ['Pseudo', 'ExpUntil', 'Computed']);
  const row = store.get('Users', 1);
  assert.equal(row.ExpUntil, 1700000000);
  assert.ok(!('ExpeditionUntil' in row));
  assert.throws(() => store.updateColumn('Users', 'ExpUntil', { id: 'Pseudo' }), /already exists/);
  assert.throws(() => store.updateColumn('Users', 'ExpUntil', { id: '1bad' }), /Invalid column/);
});

test('changer le type reconvertit les valeurs', () => {
  store.updateColumn('Users', 'ExpUntil', { type: 'Text' });
  assert.equal(store.get('Users', 1).ExpUntil, '1700000000');
  store.updateColumn('Users', 'ExpUntil', { type: 'Numeric' });
  assert.equal(store.get('Users', 1).ExpUntil, 1700000000);
  store.updateColumn('Users', 'ExpUntil', { type: 'DateTime' });
  store.updateColumn('Users', 'ExpUntil', { type: 'Text' });
  assert.equal(store.get('Users', 1).ExpUntil, '2023-11-14 22:13:20');
  store.updateColumn('Pulls', 'Tags', { type: 'Text' });
  assert.equal(store.get('Pulls', 1).Tags, 'x, y');
  store.updateColumn('Pulls', 'User', { type: 'RefList:Users' });
  assert.deepEqual(store.get('Pulls', 1).User, ['L', 1]);
  store.updateColumn('Pulls', 'User', { type: 'Ref:Users' });
  assert.equal(store.get('Pulls', 1).User, 1);
});

test('supprimer une colonne retire la valeur de chaque ligne', () => {
  store.dropColumn('Users', 'Computed');
  assert.ok(!('Computed' in store.get('Users', 1)));
  assert.throws(() => store.update('Users', 1, { Computed: 1 }), /Invalid column/);
});

test('creer, renommer (Ref suivies) et supprimer une table', () => {
  store.createTable('Pets', { Name: { type: 'Text' }, Owner: { type: 'Ref:Users' } });
  store.create('Pets', { Name: 'Rex', Owner: 1 });
  assert.throws(() => store.createTable('Pets'), /already exists/);
  store.renameTable('Users', 'Players');
  assert.equal(store.table('Pets').columns.Owner.type, 'Ref:Players');
  assert.equal(store.table('Pulls').columns.User.type, 'Ref:Players');
  assert.equal(store.get('Players', 1).Pseudo, 'A');
  assert.throws(() => store.table('Users'), /not found/);
  store.dropTable('Pets');
  assert.throws(() => store.table('Pets'), /not found/);
});

test('tout est persiste apres rechargement', () => {
  store.db.close();
  store = new Store(tmp);
  assert.deepEqual(Object.keys(store.table('Players').columns), ['Pseudo', 'ExpUntil']);
  assert.equal(store.get('Players', 1).ExpUntil, '2023-11-14 22:13:20');
  assert.equal(store.table('Pulls').columns.User.type, 'Ref:Players');
  assert.ok(!store.tables.has('Pets') && !store.tables.has('Users'));
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM rows WHERE tbl = 'Users'").get().n, 0);
});

store.db.close();
clean();
console.log(process.exitCode ? '\nSchema : echec(s).' : `\nSchema : ${passed} tests passes.`);
