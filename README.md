# DifCal — Diferença Calórica

App web (instalável no celular) para registrar refeições por foto, voz e balança, com cálculo de calorias e proteínas pela API do Claude.

## Estrutura
- `public/` — o app (HTML/CSS/JS, manifesto e ícones)
- `netlify/functions/api.mjs` — login, perfil, refeições, fotos e backup (dados no Netlify Blobs)
- `netlify/edge-functions/analisar.js` — análise da refeição com o Claude (chave da API fica só no servidor)

## Variáveis de ambiente (Netlify → Project configuration → Environment variables)
| Nome | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | chave criada no Claude Console |
| `APP_SENHA` | senha para entrar no app |
| `APP_SEGREDO` | texto aleatório longo (40+ caracteres) para assinar o login |
| `MODELO` | opcional; padrão `claude-sonnet-5-5` |

Depois de criar ou alterar variáveis, faça um novo deploy (Deploys → Trigger deploy).

## Dados
Ficam no Netlify Blobs do próprio site: `perfil`, `meses/AAAA-MM` (refeições do mês) e `fotos/<id>` (miniaturas).
Faça backup periódico em Relatórios → Backup completo (JSON).
