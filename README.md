# MatchMind AI

Polskojęzyczna PWA do analizy danych piłkarskich. Backend pobiera dane z API-FOOTBALL v3, ogranicza liczbę zapytań cache'em i może używać lokalnego modelu Ollama do opisowych raportów.

## VPS 4 vCPU / 4 GB RAM
Domyślny model: `qwen3:0.6b` (CPU, bez GPU), kontekst 2048 tokenów, jedna równoległa generacja. To świadomie mały model — matematyka i statystyki powinny być liczone deterministycznie w backendzie, a LLM ma jedynie opisywać wnioski. Model 1.7B może być testowany dopiero po zwiększeniu RAM do 8 GB lub przeniesieniu inference na osobny host.

## Uruchomienie
1. Skopiuj `.env.example` do `.env`.
2. Wstaw nowy klucz API-FOOTBALL do `FOOTBALL_API_KEY`.
3. Uruchom aplikację i bazę: `docker compose up --build -d`.
4. Aplikacja działa na porcie 4000.

## Lokalny LLM (opcjonalny)
LLM jest domyślnie wyłączony, żeby nie obciążał małego VPS bez świadomej decyzji. Włącz Ollama:
```bash
docker compose --profile local-ai up -d ollama
docker compose exec ollama ollama pull qwen3:0.6b
```
W pliku `.env` ustaw `LLM_ENABLED=true`, następnie:
```bash
docker compose up -d --force-recreate app
```
Ollama działa wewnątrz sieci Dockera i nie publikuje portu 11434 na publiczny interfejs. Nie wystawiaj API Ollama bezpośrednio do internetu.

## API
- `GET /api/health` — status aplikacji i API
- `GET /api/usage` — liczniki zapytań i cache
- `GET /api/fixtures?date=YYYY-MM-DD` — mecze
- `GET /api/matches/:id/stats` — statystyki meczu
- `POST /api/matches/:id/analyze` — raport na podstawie dostępnych danych

## Cache
Terminarze: 60 s; statystyki i zdarzenia: 5 min; składy: 15 min; kontuzje: 4 h; predykcje: 1 h. Cache jest obecnie pamięciowy i czyści się po restarcie procesu.

## Bezpieczeństwo
Klucze API wyłącznie w środowisku serwera. Nigdy nie commituj `.env`. Nie umieszczaj kluczy w frontendzie. Pokrycie statystyk zależy od ligi i sezonu.
