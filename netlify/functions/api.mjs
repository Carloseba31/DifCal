// DifCal — API de dados (Netlify Functions v2 + Netlify Blobs)
import { getStore } from "@netlify/blobs";

const SENHA = process.env.APP_SENHA || "";
const SEGREDO = process.env.APP_SEGREDO || "";
const VALIDADE_DIAS = 60;

const enc = new TextEncoder();
async function hmac(msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(SEGREDO), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function criarToken() {
  const exp = Date.now() + VALIDADE_DIAS * 864e5;
  return `${exp}.${await hmac(String(exp))}`;
}
async function tokenValido(t) {
  if (!t || !SEGREDO) return false;
  const [exp, sig] = String(t).split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return (await hmac(exp)) === sig;
}

const json = (data, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const erro = (msg, status = 400) => json({ erro: msg }, status);
const store = () => getStore({ name: "difcal", consistency: "strong" });
const mesDe = dia => dia.slice(0, 7);
const validoDia = d => /^\d{4}-\d{2}-\d{2}$/.test(d || "");

function mesesEntre(de, ate) {
  const out = [];
  let [y, m] = de.slice(0, 7).split("-").map(Number);
  const [y2, m2] = ate.slice(0, 7).split("-").map(Number);
  while (y < y2 || (y === y2 && m <= m2)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
    if (out.length > 60) break;
  }
  return out;
}
async function lerMes(s, mes) {
  return (await s.get(`meses/${mes}`, { type: "json" })) || { refeicoes: [] };
}

export default async (req) => {
  const url = new URL(req.url);
  const rota = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const metodo = req.method;

  if (!SENHA || !SEGREDO) return erro("Configure APP_SENHA e APP_SEGREDO nas variáveis de ambiente da Netlify.", 500);

  // ---- login (público) ----
  if (rota[0] === "login" && metodo === "POST") {
    const { senha } = await req.json().catch(() => ({}));
    if (senha !== SENHA) { await new Promise(r => setTimeout(r, 800)); return erro("Senha incorreta", 401); }
    return json({ token: await criarToken() });
  }

  // ---- autenticação ----
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "") || url.searchParams.get("t");
  if (!(await tokenValido(auth))) return erro("Não autorizado", 401);

  const s = store();

  // ---- perfil ----
  if (rota[0] === "perfil") {
    if (metodo === "GET") return json((await s.get("perfil", { type: "json" })) || null);
    if (metodo === "PUT") {
      const p = await req.json();
      if (!p || typeof p !== "object") return erro("Perfil inválido");
      await s.setJSON("perfil", p);
      return json({ ok: true });
    }
  }

  // ---- refeições ----
  if (rota[0] === "refeicoes") {
    if (metodo === "GET") {
      const de = url.searchParams.get("de"), ate = url.searchParams.get("ate");
      if (!validoDia(de) || !validoDia(ate)) return erro("Use ?de=AAAA-MM-DD&ate=AAAA-MM-DD");
      const meses = await Promise.all(mesesEntre(de, ate).map(m => lerMes(s, m)));
      const lista = meses.flatMap(m => m.refeicoes).filter(r => r.day >= de && r.day <= ate);
      return json(lista);
    }
    if (metodo === "POST") {
      const { refeicao, foto } = await req.json();
      if (!refeicao || !refeicao.id || !validoDia(refeicao.day)) return erro("Refeição inválida");
      if (foto && typeof foto === "string" && foto.startsWith("data:image/")) {
        await s.set(`fotos/${refeicao.id}`, foto);
        refeicao.temFoto = true;
      }
      delete refeicao.thumb;
      const mes = mesDe(refeicao.day);
      const doc = await lerMes(s, mes);
      doc.refeicoes = doc.refeicoes.filter(r => r.id !== refeicao.id).concat(refeicao);
      await s.setJSON(`meses/${mes}`, doc);
      return json({ ok: true });
    }
    if (metodo === "DELETE" && rota[1]) {
      const dia = url.searchParams.get("dia");
      if (!validoDia(dia)) return erro("Informe ?dia=");
      const mes = mesDe(dia);
      const doc = await lerMes(s, mes);
      doc.refeicoes = doc.refeicoes.filter(r => r.id !== rota[1]);
      await s.setJSON(`meses/${mes}`, doc);
      await s.delete(`fotos/${rota[1]}`);
      return json({ ok: true });
    }
  }

  // ---- foto (miniatura) ----
  if (rota[0] === "foto" && rota[1] && metodo === "GET") {
    const dataUrl = await s.get(`fotos/${rota[1]}`);
    if (!dataUrl) return new Response("", { status: 404 });
    const [meta, b64] = dataUrl.split(",");
    const tipo = (meta.match(/data:([^;]+)/) || [])[1] || "image/jpeg";
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return new Response(bin, { headers: { "content-type": tipo, "cache-control": "private, max-age=31536000, immutable" } });
  }

  // ---- backup completo ----
  if (rota[0] === "backup" && metodo === "GET") {
    const perfil = await s.get("perfil", { type: "json" });
    const { blobs } = await s.list({ prefix: "meses/" });
    const meses = await Promise.all(blobs.map(b => s.get(b.key, { type: "json" })));
    return json({ geradoEm: new Date().toISOString(), perfil, refeicoes: meses.flatMap(m => (m && m.refeicoes) || []) });
  }

  return erro("Rota não encontrada", 404);
};

export const config = { path: "/api/*" };
