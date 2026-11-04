# MatchMind AI

Polskojęzyczna aplikacja PWA do analizy statystyk piłkarskich. Ten starter stanowi punkt wyjścia do rozwoju produktu.

## Stack
- Node.js + Express (API)
- PWA (HTML/CSS/JavaScript)
- API-FOOTBALL / API-SPORTS jako źródło danych
- OpenAI API do interpretacji danych
- PostgreSQL jako docelowa baza danych

## Uruchomienie
Wymagany Node.js 20+.

```bash
cp .env.example .env
npm install
npm start
```

Następnie otwórz http://localhost:4000.

## Bezpieczeństwo
Klucze API przechowuj wyłącznie w zmiennych środowiskowych backendu. Nie commituj pliku `.env`.

## Ważne
Dane i prawdopodobieństwa muszą pochodzić z rzeczywistych statystyk i jawnie opisanych modeli. Raport AI jest interpretacją, nie gwarancją wyniku wydarzenia sportowego.
