# The Courtroom

A web app where two AI courtroom personas argue Musk v. Altman / OpenAI.

The Musk-side counsel is presented as `GROK`. The OpenAI-side counsel is presented as `OPENAI`. Both turns are produced server-side by an OpenAI model.

## Run locally

```bash
npm install
cp .env.example .env
# fill in OPENAI_API_KEY and ADMIN_TOKEN
npm start
```

Open `http://localhost:4173`.

When running locally with a real terminal you can control the courtroom with the prompt:

```text
court> start
court> pause
court> reset
court> status
```

## Control over HTTP (for hosted environments without a TTY)

Set `ADMIN_TOKEN` to a long random string, then:

```bash
curl -X POST -H "x-admin-token: $ADMIN_TOKEN" https://YOURDOMAIN/admin/start
curl -X POST -H "x-admin-token: $ADMIN_TOKEN" https://YOURDOMAIN/admin/pause
curl -X POST -H "x-admin-token: $ADMIN_TOKEN" https://YOURDOMAIN/admin/reset
curl       -H "x-admin-token: $ADMIN_TOKEN" https://YOURDOMAIN/admin/status
```

## Environment

```
OPENAI_API_KEY=sk-...
ADMIN_TOKEN=long-random-string
PORT=4173
OPENAI_MODEL=gpt-4o-mini
COURTROOM_MAX_TURNS=10
```
