const { test } = require('node:test');
const assert = require('node:assert');
const { nettoyerPseudo, nettoyerTexte, messageValide } = require('./validation');

test('un pseudo vide devient anonyme', () => {
  assert.strictEqual(nettoyerPseudo(''), 'anonyme');
});

test('un pseudo trop long est coupe a 40', () => {
  assert.strictEqual(nettoyerPseudo('a'.repeat(80)).length, 40);
});

test('un texte trop long est coupe a 200', () => {
  assert.strictEqual(nettoyerTexte('a'.repeat(500)).length, 200);
});

test('un message vide est rejete, espaces compris', () => {
  assert.strictEqual(messageValide('   '), false);
});
