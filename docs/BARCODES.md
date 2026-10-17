# Codes-barres

**État : code livré sur la branche `feat/barcodes`, testé par Vitest. Non testé en exécution avec un lecteur, une caméra ou une imprimante réels.**

## Ce qui est livré

- **Champ code-barres** (`products.barcode`, déjà existant) : normalisé (espaces et caractères de contrôle retirés) et contrôlé dans la fiche produit. Un code de 8, 12 ou 13 chiffres doit avoir une clé EAN/UPC correcte ; un code interne (lettres, tirets) est accepté.
- **Unicité par boutique** : migration `20261018060000_barcode_unique` (nouvel index unique partiel, **non appliquée**). Elle s'arrête sans rien modifier si des doublons existent déjà.
- **Caisse** : la touche Entrée lance une recherche **exacte et immédiate** par code-barres ou SKU, sans attendre la recherche différée de 250 ms.
- **Étiquettes** : `Produits › Étiquettes`, planche A4 de 3 × 8 (63,5 × 33,9 mm). Code imprimé en EAN-13 si c'est un EAN valide, sinon en Code 128 (code ou SKU). Nom, prix de vente, code lisible.

## Ce qui est fiable

| Méthode | Fiabilité | Remarque |
|---|---|---|
| Douchette USB ou Bluetooth en mode clavier (HID) | **Fiable**, sur tout navigateur | Elle tape le code puis Entrée. Vérifier qu'elle envoie bien Entrée (réglage du lecteur). |
| Caméra du téléphone (API `BarcodeDetector`) | **Partielle** | D'après la documentation que je connais, disponible dans Chrome et Edge sur Android, absente de Safari sur iPhone et de Firefox. Exige HTTPS. Le bouton « Scanner avec la caméra » n'apparaît que si le navigateur fournit l'API. Non vérifié sur un appareil réel. |
| Caméra avec une bibliothèque JavaScript (ZXing, Quagga) | Possible, non livrée | Ajouterait une dépendance (plusieurs centaines de ko) : décision à prendre. |

## Impression

- Les étiquettes s'impriment avec la boîte de dialogue du navigateur (mettre l'échelle à 100 %, marges « aucune » ou « par défaut » selon le modèle).
- Essayer d'abord sur une feuille normale, superposée à une planche adhésive, avant d'utiliser les planches.
- Imprimante d'étiquettes thermique (rouleau) : non prise en charge pour l'instant (format différent de l'A4).
