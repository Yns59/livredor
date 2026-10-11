// validation.js, les regles du livre d'or, dans leur propre module
const PSEUDO_MAX = 40;
const TEXTE_MAX = 200;

function nettoyerPseudo(pseudo) {
  const p = (pseudo || '').trim();
  if (p === '') return 'anonyme';
  return p.slice(0, PSEUDO_MAX);
}

function nettoyerTexte(texte) {
  return (texte || '').trim().slice(0, TEXTE_MAX);
}

function messageValide(texte) {
  return nettoyerTexte(texte).length > 0;
}

module.exports = { nettoyerPseudo, nettoyerTexte, messageValide, PSEUDO_MAX, TEXTE_MAX };
