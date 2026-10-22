# Ordo

Osobní seznam, nástěnka a poznámky v jednom. Jedna položka má jednu domovskou složku a může se objevit v dnešku, nákupu i u člověka.

## Spuštění

```bash
npm install
npm run dev
```

Aplikace běží na http://localhost:5177. Data zůstávají v tomhle prohlížeči (IndexedDB). Zálohu stáhneš v Nastavení jako JSON a stejnou cestou ji zase načteš.

## Hlasová zkratka

Otevři `/add?text=…`. První řádek je název, zbytek popis. Volitelně `folder` a `due=RRRR-MM-DD`.

## Synchronizace

Evolu se zatím nezapíná. Až přijde na řadu, nahradí se modul `src/data/store.tsx`. Rozhraní dál čte stejný snímek a zapisuje stejné operace.

## Google Kalendář

Ordo čte události ze všech tvých kalendářů a ukáže je v kalendáři a v přehledu Dnes. Úkoly s termínem nebo plánem zapisuje do vlastního kalendáře „Ordo“, který si samo založí. Ten se synchronizuje oběma směry:

- Změna názvu, termínu, priority nebo popisu v Ordo se propíše do Googlu. Hotový úkol dostane fajfku, smazaný nebo zrušený úkol událost ztratí.
- Přejmenování nebo posun události v Googlu se vrátí do úkolu. Smazání události přesune úkol do koše.
- Když se mezi dvěma synchronizacemi změní obě strany, vyhraje novější změna.

Připojení, mezipaměť událostí i stav synchronizace patří vždy jednomu zařízení. Do zálohy ani do Evolu se nic z Googlu nedostane.

Přihlášení obsluhuje Vercel funkce `api/gcal/[op].js`. Refresh token drží zašifrovaný v httpOnly cookie a prohlížeč od ní dostává jen hodinový přístupový token. Ordo žádá čtení všech kalendářů a zápis jen do kalendářů, které samo vytvořilo.

### Nastavení

1. V [Google Cloud Console](https://console.cloud.google.com/) založ projekt a zapni Google Calendar API.
2. Otevři Google Auth Platform. Když vidíš jen tlačítko Get started, projdi nejdřív úvodní nastavení: název aplikace, e-mail, publikum Externí a kontakt. V části Audience se přidej jako testovacího uživatele.
3. V levém menu Google Auth Platform otevři Data Access a klikni na Add or remove scopes. V panelu vyfiltruj „calendar“ a zaškrtni oba scopy níže. Když v seznamu nejsou, vlož je do pole Manually add scopes dole v panelu a klikni na Add to table. Pak Update a nakonec Save.

   ```
   https://www.googleapis.com/auth/calendar.readonly
   https://www.googleapis.com/auth/calendar.app.created
   ```

4. V Clients vytvoř klienta typu Web application a povol tyto redirect URI:
   - `https://<tvoje-doména>/api/gcal/callback`
   - `http://localhost:5177/api/gcal/callback`
5. Ve Vercelu nastav proměnné prostředí a nasaď znovu:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GCAL_COOKIE_SECRET`, volitelný náhodný řetězec. Bez něj se klíč cookie odvodí z client secret.
6. Lokálně dej stejné proměnné do `.env.local` a spusť `npm run dev`. Dev server obslouží `/api/gcal/*` sám.
7. V Ordo otevři Nastavení a klikni na Připojit Google Kalendář.

V režimu Testing vydává Google refresh token jen na 7 dní, potom je potřeba se připojit znovu. Po přepnutí aplikace do produkce (Publish app) token nevyprší. Google pak při připojení jednou ukáže varování o neověřené aplikaci.
