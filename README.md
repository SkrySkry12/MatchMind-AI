# MatchMind AI

Polskojęzyczna PWA do analizy danych piłkarskich. Backend pobiera dane z API-FOOTBALL v3, ogranicza liczbę zapytań cache'em i używa lokalnego modelu Ollama do tworzenia opisowych raportów.

## Uruchomienie
1. Skopiuj `.env.example` do `.env`.
2. Wstaw nowy klucz API-FOOTBALL do `FOOTBALL_API_KEY`.
3. Uruchom `docker compose up --build -d`.
4. Aplikacja działa na porcie 4000.

## Lokalny LLM (opcjonalny)
Ollama jest w profilu Docker `local-ai`, aby nie pobierać kilku GB modelu bez zgody operatora:
```bash
docker compose --profile local-ai up -d ollama
docker compose exec ollama ollama pull qwen3:4b
```
W `.env` ustaw `OLLAMA_BASE_URL=http://ollama:11434` i `OLLAMA_MODEL=qwen3:4b`, a następnie zrestartuj usługę app.

Qwen3:4b wymaga mniej zasobów niż wariant 8B. Przy mocniejszym serwerze można zmienić model na `qwen3:8b`.

## API
- `GET /api/health` — status API i lokalnego LLM
- `GET /api/usage` — liczniki zapytań i cache
- `GET /api/fixtures?date=YYYY-MM-DD` — mecze
- `GET /api/matches/:id/stats` — statystyki meczu
- `POST /api/matches/:id/analyze` — raport na podstawie dostępnych danych

## Cache
Terminarze: 60 s; statystyki i zdarzenia: 5 min; składy: 15 min; kontuzje: 4 h; predykcje: 1 h. Czasy są celowo różne, zgodnie z częstotliwością aktualizacji poszczególnych danych. Cache jest obecnie pamięciowy i czyści się przy restarcie procesu.

## Bezpieczeństwo
Klucze API wyłącznie w środowisku serwera. Nigdy nie commituj `.env`. Nie umieszczaj kluczy w frontendzie. Dane API mogą być niepełne w zależności od ligi i sezonu.
