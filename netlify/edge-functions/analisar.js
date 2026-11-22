// DifCal — análise da refeição com a API do Claude.
// Roda como Edge Function porque o tempo de espera pela IA não conta no limite de CPU
// (as Functions comuns cortam em 10 s, e uma análise com fotos pode passar disso).

const enc = new TextEncoder();
async function hmac(msg, segredo) {
  const key = await crypto.subtle.importKey("raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function tokenValido(t, segredo) {
  if (!t || !segredo) return false;
  const [exp, sig] = String(t).split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return (await hmac(exp, segredo)) === sig;
}
const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function prompt(desc, temPrato, nBalanca) {
  return `Você é um nutricionista brasileiro especialista em estimar a composição de refeições.
Estime calorias e proteínas de cada alimento.

IMAGENS: ${temPrato ? "a 1ª imagem é a FOTO DO PRATO/ALIMENTO" : "não há foto do prato"}${nBalanca ? `; as ${nBalanca} imagem(ns) seguinte(s) são FOTOS DO VISOR DA BALANÇA DE COZINHA, na ordem "balança 1, balança 2…" (leia o número em gramas no visor)` : ""}.
DESCRIÇÃO/DITADO DO USUÁRIO: "${String(desc || "").replace(/"/g, "'").slice(0, 1500)}"

PRIORIDADE PARA A QUANTIDADE (gramas):
1. Peso lido na balança → fonte "balanca" (associe pela descrição do usuário; se ele informar a tara do pote, desconte).
2. Quantidade dita/escrita pelo usuário (ex.: "4 colheres de arroz", "1 pão francês", "150 g de frango") → converta com medidas caseiras brasileiras → fonte "ditado".
3. Só sem nada acima, estime pela foto (tamanho do prato e talheres como referência) → fonte "foto".
Use valores da tabela TACO para alimentos como preparados (arroz cozido, feijão cozido, carne grelhada etc.). Considere óleo e molhos visíveis.

Responda SOMENTE com JSON válido, sem texto antes ou depois:
{"itens":[{"nome":"nome curto","gramas":0,"kcal":0,"proteina_g":0,"fonte":"balanca|ditado|foto"}],
 "titulo":"nome curto da refeição",
 "confianca":"alta|media|baixa",
 "observacao":"1 frase: principal incerteza ou dica para melhorar a precisão"}`;
}

export default async (req) => {
  if (req.method !== "POST") return json({ erro: "Use POST" }, 405);
  const segredo = Netlify.env.get("APP_SEGREDO");
  const chave = Netlify.env.get("ANTHROPIC_API_KEY");
  const modelo = Netlify.env.get("MODELO") || "claude-sonnet-5-5";
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!(await tokenValido(token, segredo))) return json({ erro: "Não autorizado" }, 401);
  if (!chave) return json({ erro: "ANTHROPIC_API_KEY não configurada na Netlify" }, 500);

  let corpo;
  try { corpo = await req.json(); } catch { return json({ erro: "JSON inválido" }, 400); }
  const prato = corpo.prato || null;                 // base64 jpeg, sem prefixo
  const balancas = Array.isArray(corpo.balancas) ? corpo.balancas.slice(0, 6) : [];
  const desc = corpo.desc || "";
  if (!prato && !balancas.length && !desc.trim()) return json({ erro: "Envie foto ou descrição" }, 400);

  const content = [];
  for (const img of [prato, ...balancas].filter(Boolean)) {
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: img } });
  }
  content.push({ type: "text", text: prompt(desc, !!prato, balancas.length) });

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": chave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: modelo, max_tokens: 1200, messages: [{ role: "user", content }] }),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) return json({ erro: (dados.error && dados.error.message) || `Erro da API (${r.status})` }, 502);

  const texto = (dados.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  const m = texto.match(/\{[\s\S]*\}/);
  if (!m) return json({ erro: "Resposta da IA sem JSON" }, 502);
  try {
    const out = JSON.parse(m[0]);
    out.uso = dados.usage || null;
    return json(out);
  } catch {
    return json({ erro: "JSON da IA inválido" }, 502);
  }
};

export const config = { path: "/api/analisar" };
