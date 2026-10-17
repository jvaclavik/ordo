# Ordo

Osobní seznam, nástěnka a poznámky v jednom. Jedna položka má jednu domovskou složku a může se objevit v dnešku, nákupu i u člověka.

## Spuštění

```bash
npm install
npm run dev
```

Aplikace běží na adrese, kterou vypíše Vite. Data zůstávají v tomhle prohlížeči (IndexedDB). Zálohu stáhneš v Nastavení jako JSON a stejnou cestou ji zase načteš.

## Hlasová zkratka

Otevři `/add?text=…`. První řádek je název, zbytek popis. Volitelně `folder` a `due=RRRR-MM-DD`.

## Synchronizace

Evolu se zatím nezapíná. Až přijde na řadu, nahradí se modul `src/data/store.tsx`. Rozhraní dál čte stejný snímek a zapisuje stejné operace.
