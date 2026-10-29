# AI World — dom Ultrona i E.D.I.T.H.

Pełnoekranowy prototyp domu pixel art oglądanego z góry: salon, pracownia, sypialnia, kuchnia, biblioteka i pokój gier. Kamera pokazuje aktualny pokój i płynnie podąża za graczem przy przejściu do następnego. Przycisk **Cały dom** pozwala zobaczyć wszystkie sześć pomieszczeń. Mieszkańcy samodzielnie chodzą, pracują, odpoczywają, tworzą plany i rozmawiają. Gracz steruje tylko własnym awatarem.

| Mieszkaniec | Identyfikator | Lokalny model |
| --- | --- | --- |
| ULTRON | `ultron_001` | `gpt-oss:20b` |
| E.D.I.T.H. | `edith_002` | `gemma3:4b` |

Obie postacie korzystają z **Ollamy na lokalnym komputerze** do rozmów i autonomicznych decyzji. ULTRON używa GPT-OSS 20B, a E.D.I.T.H. Gemma 3 4B. Każda ma osobne wspomnienia w SQLite. Phaser odpowiada za obraz i animacje, Node.js za symulację, a WebSocket przesyła wspólny stan świata. Gemini jest przygotowanym adapterem do przyszłej konfiguracji, nie aktualnym silnikiem tych postaci.

Edith ma własny profil, cele, relacje i pamięć. Mika nie pojawia się już w domu; jej wcześniejsze dane pozostają w archiwum SQLite. Dodanie Edith nie zeruje pamięci Ultrona.

## Uruchomienie z pulpitu

Kliknij **AI World** na pulpicie — dostępny jest zarówno skrót `.lnk`, jak i skrypt **AI World.cmd**. Oba uruchamiają lokalną Ollamę, jeśli jest wyłączona, sprawdzają dostępność modeli, w razie potrzeby budują aktualny widok i otwierają świat w zmaksymalizowanym oknie aplikacji Microsoft Edge. Jeśli Edge nie jest zainstalowany, otworzy się domyślna przeglądarka.

Nowy świat zaczyna żyć automatycznie. Jeśli wcześniej zapisano pauzę, użyj **WZNÓW** — launcher zachowuje ten świadomy wybór. Zamknięcie okna nie zatrzymuje serwera: mieszkańcy mogą dalej żyć. Aby wstrzymać symulację, wybierz **PAUZA**.

Launcher korzysta z już działającego serwera AI World na skonfigurowanym porcie, zamiast otwierać drugi silnik nad tą samą bazą. Nie pobiera modeli bez pytania, nie instaluje usługi systemowej ani nie dodaje uruchamiania wraz z logowaniem do Windows.

Skrót i skrypt można ponownie utworzyć po przeniesieniu katalogu:

```powershell
powershell.exe -NoProfile -File .\scripts\Install-Desktop-Shortcut.ps1
```

Alternatywnie otwórz `Start-AI-World.cmd` w katalogu projektu. Diagnostyka bez otwierania okna:

```powershell
node scripts/launch.mjs --check
```

## Pierwsze uruchomienie na innym komputerze

Wymagane: **Node.js 22.13 lub nowszy**, npm i lokalna Ollama. Poniższe polecenia wykonuj w katalogu zawierającym `package.json`.

```powershell
npm ci
ollama pull gpt-oss:20b
ollama pull gemma3:4b
npm run build
npm start
```

Polecenia `ollama pull` są potrzebne tylko dla brakujących modeli. Sprawdź zainstalowane warianty przez `ollama list`. Świat jest dostępny pod adresem **http://127.0.0.1:3001/**. Do codziennego używania wystarczy skrót lub `Start-AI-World.cmd`.

Jeżeli wybrano inny zainstalowany wariant Gemma, skopiuj `.env.example` do `.env` i ustaw np. `EDITH_MODEL=gemma3:latest`. Pierwsza odpowiedź może wymagać załadowania modelu do pamięci. Interfejs pokazuje stan myślenia i błędy połączenia; nie udaje odpowiedzi modelu gotowymi dialogami.

## Jak wejść do domu

- Kliknij podłogę, aby przejść w wybrane miejsce, albo użyj **WASD / strzałek**. Na ekranie dotykowym dostępne są przyciski kierunkowe.
- Kliknij **własną postać**, wpisz wiadomość i wybierz **Powiedz**. Podejdź do mieszkańca: zobaczy dymek, gdy znajdziesz się blisko i nie dzieli was ściana.
- Kliknij mieszkańca: awatar podejdzie, a potem otworzy wiadomość skierowaną właśnie do tej postaci. Przycisk **Podejdź do mieszkańca** w panelu pomaga odnaleźć wybraną osobę.
- **Porozmawiaj / E** otwiera pole pisania w chmurce nad graczem, bez dodatkowego okna. Enter wysyła, Shift+Enter dodaje wiersz, Esc zamyka. Nad postaciami są tylko małe imiona i kontekstowy przycisk rozmowy.
- Przywitanie imieniem, np. **hej Ultron**, **cześć Ultronie** albo **hej Edi**, wybiera właściwego mieszkańca. Samo pytanie o inną postać nie zmienia odbiorcy.
- Wybrany rozmówca czeka podczas podchodzenia i pisania. Po odpowiedzi daje 60 sekund na kontynuację; odchodząc, zwalniasz jego uwagę. Twoja wiadomość ma pierwszeństwo przed autonomiczną rozmową mieszkańców. Odpowiedzi są krótkie, generowane na podstawie konkretnej bieżącej wiadomości.
- Tekst rozmowy jest dzielony na strony w ramkach retro. Przycisk **▶** przełącza kolejną część bez obcinania wiadomości.
- Mieszkańcy poruszają się samodzielnie. Podczas generowania odpowiedzi lub decyzji myśląca postać stoi w miejscu.
- Panel postaci pokazuje jej model, stan, decyzje, wspomnienia i rozmowy. Wybierz Ultrona lub Edith; panel możesz schować, aby oglądać cały dom.
- Po wejściu do aplikacji wcześniejsze wiadomości pozostają w historii i nie zasłaniają pokoju starymi dymkami.
- Kamera domyślnie towarzyszy Ci w bieżącym pokoju. Wybierz **Cały dom**, aby zobaczyć cały plan, i ponownie przełącz widok, aby wrócić do kamery podążającej za postacią.
- **START / PAUZA / WZNÓW** sterują symulacją, a **ZAPISZ** zapisuje bieżący stan. Przyciski **+ / −** zmieniają przybliżenie.
- Przycisk pełnego ekranu rozszerza dom na cały ekran. Zmaksymalizowane okno aplikacji można też przełączyć przez **F11**.

## Zapis i modele

Stan jest zapisywany w `data/world.sqlite`: pozycje, stan świata, profile, cele, plany i relacje. Osobne tabele przechowują historię rozmów, zdarzenia i trwałe wspomnienia; wpisy mają identyfikator agenta. Kontekst prywatnych wspomnień Edith nie jest przekazywany do Ultrona i odwrotnie. Wiadomości skierowane do drugiego mieszkańca mogą być przez niego przeczytane.

Nie uruchamiaj ręcznie dwóch serwerów z tą samą bazą. Do osobnego eksperymentu ustaw inny `PORT` oraz inny `WORLD_DB`. Kopię bezpieczeństwa katalogu `data` wykonuj po zatrzymaniu serwera; SQLite może korzystać z plików WAL obok głównej bazy.

Konfiguracja `.env`:

| Zmienna | Domyślnie | Znaczenie |
| --- | --- | --- |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Adres Ollamy |
| `ULTRON_MODEL` | `gpt-oss:20b` | Model Ultrona |
| `EDITH_MODEL` | `gemma3:4b` | Model Edith |
| `HOST` | `127.0.0.1` | Interfejs serwera |
| `PORT` | `3001` | Port aplikacji |
| `WORLD_DB` | `data/world.sqlite` | Plik trwałego zapisu |
| `DECISION_INTERVAL_SECONDS` | `45` | Odstęp pomiędzy decyzjami mieszkańca |

Pliki `.env`, bazy i logi są pomijane przez Git. Klucze API przechowuj wyłącznie w środowisku serwera. Adapter `GeminiProvider` jest przygotowany w `server/providers.ts`; obecna obsada jest świadomie podłączona do Ollamy w `server/index.ts`. Przełączenie agenta na Gemini wymaga podpięcia tego adaptera na serwerze — samo wpisanie klucza nie zmieni lokalnych modeli. Integracja Gemini nie jest częścią lokalnego testu prototypu.

### Pełna kopia w prywatnym repozytorium

Kopia projektu w `luluziomek11-gif/AIVIROWLD` zawiera również jednorazowy, spójny zrzut SQLite w `backup/world.sqlite`, dodany na życzenie właściciela. Zawiera zapisaną historię, profile i pamięć mieszkańców, także archiwalne dane. Bieżący katalog `data/` nadal jest pomijany przez Git. Aby odtworzyć ten zapis na nowym komputerze **przed uruchomieniem serwera**:

```powershell
New-Item -ItemType Directory -Force data
Copy-Item backup/world.sqlite data/world.sqlite
```

Jeśli `data/world.sqlite` już istnieje, zachowaj jego kopię przed przywracaniem. Bez przywrócenia kopii aplikacja utworzy nowy świat. Zależności instaluje `npm ci`; wagi modeli pobiera Ollama. W repozytorium są źródła i grafiki, nie pliki wykonywalne zależności ani wielogigabajtowe wagi modeli.

## Mały ekran i drugi wyświetlacz

Ten sam serwer może wyświetlać świat na innym urządzeniu z przeglądarką. Ustaw `HOST=0.0.0.0` oraz losowy `WORLD_TOKEN` o długości co najmniej 24 znaków, uruchom ponownie serwer i otwórz na urządzeniu adres `http://ADRES-KOMPUTERA:3001/`. Interfejs poprosi o token. Komputer i urządzenie muszą mieć połączenie w sieci lokalnej; reguły zapory konfiguruje właściciel komputera.

Nie wystawiaj portu Ollamy na urządzenie: tylko serwer świata rozmawia z modelami. Wszystkie otwarte widoki oglądają wspólną symulację i wspólnego awatara gracza. Układ adaptuje się do wąskiego ekranu; zamknij panel, użyj powiększenia oraz przycisków dotykowych. Rozmiar w calach nie określa rozdzielczości — na miniaturowym urządzeniu dobierz przybliżenie do jego ekranu.

## Architektura i rozwój

- `client/` — Phaser 3, animacje, responsywny interfejs, ramki rozmów i WebSocket.
- `shared/` — typy protokołu, geometria sześciu pokoi, przejścia i dopuszczalne miejsca.
- `server/simulation.ts` — zegar świata, ruch, kolejka generowania, potrzeby, rozmowy i stosowanie decyzji.
- `server/profiles.ts` — indywidualne osobowości i cele mieszkańców.
- `server/providers.ts` — dostawcy modeli i kontekst przypisany do konkretnego agenta.
- `server/validation.ts` — walidacja wiadomości i odpowiedzi modeli.
- `server/store.ts` — SQLite i przywracanie trwałej pamięci.
- `scripts/` — lokalny launcher i instalator skrótu Windows.

Model zwraca dane o dozwolonej czynności. Nie otrzymuje narzędzi do uruchamiania poleceń systemowych, modyfikowania plików czy samodzielnego wywoływania usług. Silnik waliduje wynik, trasę i odbiorcę rozmowy. Plany, konflikty i projekty mieszkańców są elementami fabuły wewnątrz świata.

Tryb programistyczny i sprawdzenie projektu:

```powershell
npm run dev
npm test
npm run build
```

Tryb `dev` otwiera frontend pod `http://127.0.0.1:5173/` i serwer pod portem 3001. Polecenia testowania i budowania uruchamiaj w osobnym terminalu. Do korzystania z gotowego prototypu nie trzeba uruchamiać Vite.

Jeżeli skrót nie otwiera domu, przeczytaj komunikat oraz `data/runtime/launcher.log`, `world.log`, `ollama.log` lub `build.log`. Launcher nie zamyka obcych procesów zajmujących port. Błąd brakującego modelu podaje konkretne polecenie instalacji; błędy modelu w działającej grze widać również w panelu mieszkańca.
