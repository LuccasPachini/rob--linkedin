// src/index.js
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

/* ================== ENV ================== */
const {
  LINKEDIN_EMAIL,
  LINKEDIN_PASSWORD,
  HEADLESS,
  SERVICES_PAGE_URL,
  MAX_REQUESTS: MAX_REQUESTS_ENV,
  FAST_MODE: FAST_MODE_ENV,
  PROTOCOL_TIMEOUT: PROTOCOL_TIMEOUT_ENV,
} = process.env;

const FAST = String(FAST_MODE_ENV ?? 'true').toLowerCase() === 'true';
const PROTOCOL_TIMEOUT = Number(PROTOCOL_TIMEOUT_ENV || 180000);                 // 180s
const MAX_REQUESTS = Number.isFinite(Number(MAX_REQUESTS_ENV)) ? Number(MAX_REQUESTS_ENV) : 0; // 0 = sem limite

// Tempos
const WAIT_SUCCESS_MODAL_MS = FAST ? 1200 : 8000;   // aguardo modal "Proposta enviada"
const WAIT_DECLINE_MODAL_MS = FAST ? 800  : 7000;   // aguardo modal "Recusar"
const BETWEEN_ITEMS_BASE_MS = FAST ? 900  : 9000;   // intervalo entre itens
const BETWEEN_ITEMS_SPREAD_MS = FAST ? 400 : 4000;

// Delays específicos (4 passos de 6s)
const D_APAGAR   = 6000; // depois de abrir a mensagem, antes de apagar
const D_COLAR    = 6000; // depois de apagar, antes de colar
const D_DESTRAVO = 6000; // depois de colar, antes de clicar no container
const D_ENVIAR   = 6000; // depois de clicar no container, antes de clicar em Enviar

const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const jitter = (base, plus = 4000) => base + Math.floor(Math.random() * plus);

function ensureDirs() {
  try { fs.mkdirSync('screenshots', { recursive: true }); } catch {}
  try { fs.mkdirSync('logs', { recursive: true }); } catch {}
}

/* ================== TEMPLATES ================== */
const TEMPLATES = {
  PT: {
    GERAL:
`Olá,

Agradeço o seu contato e o interesse na mentoria para elaboração de CV. Quero poder contribuir para o seu sucesso profissional!

Entendo a importância de um currículo bem elaborado para abrir portas no mercado de trabalho. Por isso, estruturei algumas opções de mentoria para maximizar suas chances de conquistar a vaga desejada: Apresento essas opções nesse video: https://youtube.com/shorts/5X7uRlbW77E

a) Interação por mensagem com revisão de CV e sugestões (R$350): O candidato envia o CV e objetivos profissionais.  Devolvo o CV revisado e preparado para os sistemas (ATS) de recrutamento com comentários. Ou você pode escolher reformular seu perfil no linkedIn

b) Interação online com revisão de CV e sugestões (R$550): Inclui uma conversa online de 30 min para melhor compreender objetivos de carreira. Devolvo o CV revisado com comentários e dicas

c) Mentoria com análise e devolutiva online (R$800): Duas conversas online, a primeira de 30 min para compreender objetivos de carreira. E a segunda de 20 min para comentar as melhorias no CV e orientações

d) Mentoria personalizada (R$550 por sessão, mínimo 2; R$500 a partir de 4 sessões): Encontros online para discutir objetivos de carreira, desafios e adaptar o CV para vagas específicas, geralmente de 2 a 4 sessões de 50 min

Se quiser saber mais sobre mim gravei esse video https://youtube.com/shorts/vUmLA4n9Mx

 e tem o meu perfil no instagram com conteúdo sobre carreira. https://www.instagram.com/campos_daniel/

Att

DANIEL`,
    ESTUDANTE:
`Olá,

Agradeço o seu contato e o interesse na mentoria para elaboração de currículos. Fico muito feliz em poder contribuir ativamente para o seu sucesso profissional!

Entendo a importância de um currículo bem elaborado para abrir portas no mercado de trabalho. Para você que está querendo elaborar um currículo do zero tenho uma proposta.

Antes de contratar qualquer mentoria você precisa ter um currículo bem elaborado.

Eu preparei um ebook com dicas de como preparar um currículo usando inteligência artificial que vai elevar a qualidade do seu CV.

O ebook está na Hotmart https://go.hotmart.com/P87724501E?dp=1 por R$9,97. Mas vou deixar aqui para você o cupom LINKEDIN que o preço cai para R$1,20.

Te convido a baixar meu ebook, aprimorar o seu CV.

E se precisar de mais ajuda podemos falar sobre minhas mentorias.

Sucesso na carreira!

Abraços

Daniel

OBS: Se quiser saber um pouco mais sobre mim gravei esse video https://youtube.com/shorts/vUmLA4n9Mxk e tem o meu perfil no instagram com muito conteúdo sobre carreira. https://www.instagram.com/campos_daniel/`
  },
  EN: {
    ALL:
`Hello,

Thank you for your contact and interest in the resume writing mentorship. I am very happy to actively contribute to your professional success!

I understand the importance of a well-crafted resume in opening doors in the job market. Therefore, I have structured some mentorship options to meet your specific needs and maximize your chances of securing the desired position: I present these options in this video: https://youtube.com/shorts/C3n3bLyz8OA

a) Message interaction with CV review and suggestions (USD 80): The candidate sends the CV and professional objectives. I return the revised CV, ATS Compliant with tips and comments or you can choose to revamp or linkedin profile

b) Online interaction with CV review and suggestions (USD 160): Includes a 30-minute online conversation to better understand career objectives. I return the revised CV with comments and tips.

c) Mentorship with online analysis and feedback (USD 240): Two online conversations, the first 30 minutes to understand career objectives. And the second 20 minutes to comment on the improvements and guide the maintenance of the CV.

d) Personalized mentorship (USD 150 per session, minimum 2; USD 130 from 4 sessions on): Online meetings to discuss career objectives, challenges, and adapt the CV for specific vacancies, usually 2 to 4 sessions of 50 minutes.

If you want to know a little more about me, I recorded this video: https://youtube.com/shorts/YmBlSV6Qe_w

Sincerely,

DANIEL`
  },
  DECLINE: {
    PT:
`Olá,

Obrigado pelo interesse! No momento não estou aceitando projetos cujo escopo foi marcado como “Outros”. Para garantir a melhor entrega, foco nas frentes onde consigo gerar mais valor ao cliente.

Desejo sucesso no processo e fico à disposição para dúvidas futuras.

DANIEL`,
    EN:
`Hello,

Thanks for reaching out! At this time I’m not taking projects whose scope was marked as “Other”. I prioritize engagements where I can add the most value.

Wish you success in your search, and I remain available for future questions.

DANIEL`
  }
};

/* ================== HELPERS DOM ================== */
async function gotoSafe(page, url, label = 'nav', wait = 'domcontentloaded') {
  console.log(`➡️  Indo para: ${label} → ${url}`);
  await page.goto(url, { waitUntil: wait, timeout: 60_000 });
}

async function clickByTextLoose(page, texts, timeoutMs = 5000) {
  const wants = (Array.isArray(texts) ? texts : [texts]).map(t =>
    (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim()
  );
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const handles = await page.$$('button, a, [role="button"], [role="tab"]');
    for (const h of handles) {
      const it = (await (await h.getProperty('innerText')).jsonValue()) || '';
      const tc = (await (await h.getProperty('textContent')).jsonValue()) || '';
      const txt = (it || tc).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
      if (wants.some(w => txt.includes(w))) {
        try { await h.click(); return true; } catch {}
      }
    }
    await sleep(80);
  }
  return false;
}

async function clickByTextInsideDialog(page, texts, timeoutMs = 3000) {
  const wants = (Array.isArray(texts) ? texts : [texts]).map(t =>
    (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim()
  );
  const deadline = Date.now() + timeoutMs;

  await page.waitForSelector('div[role="dialog"]', { timeout: Math.min(timeoutMs, 1200) }).catch(()=>{});

  while (Date.now() < deadline) {
    const dlg = await page.$('div[role="dialog"]');
    if (!dlg) { await sleep(80); continue; }

    const buttons = await dlg.$$('button, a[role="button"]');
    for (const b of buttons) {
      const it = (await (await b.getProperty('innerText')).jsonValue()) || '';
      const tc = (await (await b.getProperty('textContent')).jsonValue()) || '';
      const txt = (it || tc).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
      if (wants.some(w => txt.includes(w))) {
        try { await b.click(); return true; } catch {}
      }
    }
    await sleep(80);
  }
  return false;
}

async function openServices(page) {
  if (!SERVICES_PAGE_URL) throw new Error('SERVICES_PAGE_URL não definido no .env');
  await gotoSafe(page, SERVICES_PAGE_URL, 'página de serviços (pública)');
  console.log('✅ Página de serviços aberta:', page.url());
  console.log('📁 Procurando “Solicitações / Requests” nesta página...');
  const clicked = await clickByTextLoose(page, ['Solicitações', 'Requests'], 4000).catch(()=>false);
  if (clicked) {
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(()=>{});
  } else {
    const link = await page.$('a[href*="requests"]');
    if (link) {
      await Promise.all([
        link.click(),
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(()=>{})
      ]);
    } else {
      await gotoSafe(page, 'https://www.linkedin.com/services/admin/requests/', 'serviços → solicitações (admin)');
    }
  }
  console.log('✅ Solicitações:', page.url());
}

async function listSelectorAndCount(page) {
  const sels = [
    'ul.scaffold-finite-scroll__content li.artdeco-list__item',
    'ul li.artdeco-list__item',
    '.services-requests__list li'
  ];
  for (const sel of sels) {
    const els = await page.$$(sel);
    if (els?.length) return { sel, count: els.length };
  }
  return { sel: null, count: 0 };
}

async function clickFirstListItem(page) {
  const { sel, count } = await listSelectorAndCount(page);
  if (!count) return false;
  const item = (await page.$$(sel))[0];
  await item.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(()=>{});
  await item.click().catch(()=>{});
  await sleep(300);
  return true;
}

/* ================== Heurísticas & Scrape ================== */
function stripAccents(s = "") { return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim(); }
function countHits(textNoAcc, phrasesNoAcc) {
  let hits = 0;
  for (const p of phrasesNoAcc) {
    const pat = p.replace(/\s+/g, "\\s+");
    const re = new RegExp(`\\b${pat}\\b`, "g");
    const m = textNoAcc.match(re);
    if (m) hits += m.length;
  }
  return hits;
}
function detectLangFromText(txt = "") {
  const raw = txt || "";
  const tn = stripAccents(raw);
  const accentCount = (raw.match(/[áâãéêíóôõúç]/gi) || []).length;
  const EN_SIGNS = ["resume","profile","from scratch","recent graduate","late career","mid career","entry level","human resources","traditional resume","financial services","sales","marketing","cover letter"];
  const PT_SIGNS = ["curriculo","perfil","etapa","fase de carreira","recem-formado","pleno","junior","senior","setores","outra opcao","preciso","revisar","existente","inicio de carreira"];
  const enHits = countHits(tn, EN_SIGNS.map(stripAccents));
  const ptHits = countHits(tn, PT_SIGNS.map(stripAccents));
  if (enHits > ptHits) return "EN";
  if (ptHits > enHits) return "PT";
  if (accentCount >= 1) return "PT";
  if (/\b(the|and|from|with|need)\b/i.test(tn)) return "EN";
  return "EN";
}
function detectLangPreferAnswers(answers = [], raw = "") {
  const answersText = (answers || []).filter(Boolean).join(" ").trim();
  if (answersText.length >= 4) return detectLangFromText(answersText);
  return detectLangFromText(raw);
}
function levelFromCareerStage(faseRaw) {
  const t = (faseRaw || '').toLowerCase();
  if (/(in[ií]cio|come[cç]o|early|entry|est[aá]gio|intern|recent graduate)/i.test(t)) return 'JR';
  if (/(meio|mid|intermedi[aá]rio|middle|mid career)/i.test(t)) return 'PL';
  if (/(tarde|late|s[eê]nior|senior|lead|principal|executive|alta lideran[cç]a)/i.test(t)) return 'SR';
  return 'PL';
}
function normalizeResumeType(rawAnswer = "") {
  const n = (rawAnswer || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (/\blinkedin\b/.test(n) || /\bperfil do linkedin\b/.test(n)) return { enum: "LINKEDIN", labelPT: "Perfil do LinkedIn", labelEN: "LinkedIn profile" };
  if (/\btraditional\b/.test(n) || /curriculo tradicional/.test(n) || /\bcurriculo\b/.test(n)) return { enum: "TRADITIONAL", labelPT: "Currículo tradicional", labelEN: "Traditional resume" };
  if (/\bother\b/.test(n) || /outra opcao/.test(n) || /\boutra\b/.test(n)) return { enum: "OTHER", labelPT: "Outra opção", labelEN: "Other" };
  if (/\bperfil\b/.test(n)) return { enum: "LINKEDIN", labelPT: "Perfil do LinkedIn", labelEN: "LinkedIn profile" };
  return { enum: "UNKNOWN", labelPT: rawAnswer || "", labelEN: rawAnswer || "" };
}

async function scrapeRequestDetailsToJSON(page) {
  const panelSel = ['[data-test-services-request-detail]', '.scaffold-layout__detail', 'main'];
  let used = null;
  for (const sel of panelSel) {
    const ok = await page.$(sel);
    if (ok) { used = sel; break; }
  }
  if (!used) throw new Error('Painel de detalhes não encontrado.');

  const rawText = await page.$eval(used, el => el.innerText || '').catch(() => '');
  if (!rawText) throw new Error('Não consegui ler o texto dos detalhes.');

  const lines = rawText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const Q = [
    { key: 'tipo',    match: /^(que tipo de curr[ií]culo\??|what type of resume\??)$/i },
    { key: 'etapa',   match: /^(em qual etapa do curr[ií]culo voc[eê] est[aá] trabalhando\??|what stage of the resume are you working on\??)$/i },
    { key: 'fase',    match: /^(em qual fase de carreira voc[eê] se encontra\??|what career stage are you in\??)$/i },
    { key: 'setores', match: /^(quais setores s[aã]o seu foco\??|which industries are your focus\??)$/i },
    { key: 'detalhes',match: /^(detalhes do projeto|project details)$/i }
  ];
  const mapped = { tipo: '', etapa: '', fase: '', setores: '', detalhes: '' };
  const qa = [];

  for (let i = 0; i < lines.length; i++) {
    for (const q of Q) {
      if (q.match.test(lines[i])) {
        const ans = lines[i+1] || '';
        qa.push({ question: lines[i], answer: ans });
        if (q.key in mapped) mapped[q.key] = ans;
      }
    }
  }

  const answersOnly = qa.map(p => p.answer);
  const lang = detectLangPreferAnswers(answersOnly, rawText);
  const level = levelFromCareerStage(mapped.fase || answersOnly.join(' ') || rawText);

  const norm = normalizeResumeType(mapped.tipo || "");
  const resumeType = norm.enum;
  const resumeTypeLabel = (lang === "PT") ? norm.labelPT : norm.labelEN;

  return {
    header: { name: '', title: 'Solicitações', timeAgo: '' },
    qa,
    mapped,
    rawText,
    lang,
    level,
    resumeType,
    resumeTypeLabel
  };
}

/* ================== DECISOR ================== */
const isOther = (v='') => /(^|\b)(other|outra opc|outros?)($|\b)/i.test(v || '');
const isStudentPhase = (fase='') =>
  /(estud|in[ií]cio de carreira|rec[eé]m[- ]?formado|est[aá]gio|student|early career|recent graduate|entry level|intern)/i.test(fase || '');

function decideAction(details) {
  const { lang, mapped } = details;
  const fase = mapped.fase || '';
  const setores = mapped.setores || '';

  if (isOther(fase) && isOther(setores)) {
    return { kind: 'DECLINE', lang: lang === 'EN' ? 'EN' : 'PT', templatePath: ['DECLINE', lang === 'EN' ? 'EN' : 'PT'] };
  }
  if (lang === 'EN') return { kind: 'SEND', lang: 'EN', templatePath: ['EN', 'ALL'] };
  if (lang === 'PT' && isStudentPhase(fase)) return { kind: 'SEND', lang: 'PT', templatePath: ['PT', 'ESTUDANTE'] };
  return { kind: 'SEND', lang: 'PT', templatePath: ['PT', 'GERAL'] };
}

function buildMessage(details, decision) {
  const [ns, key] = decision.templatePath;
  let tpl = (TEMPLATES[ns] && TEMPLATES[ns][key]) ? TEMPLATES[ns][key] : '';
  tpl = tpl.replaceAll('{{nameComma}}', '');
  return tpl.length > 1499 ? tpl.slice(0, 1499) : tpl;
}

/* ================== Localizar chat composer ================== */
async function findLatestVisibleBubble(page, maxMs = 7000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const bubbles = await page.$$('.msg-overlay-conversation-bubble');
    if (bubbles.length) {
      // pega a última visível
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        const visible = await b.evaluate(el => {
          const s = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 120 && r.height > 100;
        }).catch(()=>false);
        if (visible) return b;
      }
    }
    await sleep(120);
  }
  return null;
}

async function getBubbleElements(page) {
  const bubble = await findLatestVisibleBubble(page, 7000);
  if (!bubble) return null;

  const contentEditable = await bubble.$('.msg-form__contenteditable[contenteditable="true"][role="textbox"]');
  const unlockContainer = await bubble.$('.msg-form__msg-content-container'); // seletor informado
  const sendButton = await bubble.$('.msg-form__send-button.artdeco-button');

  return { bubble, contentEditable, unlockContainer, sendButton };
}

/* ================== UI: abrir modal de proposta ================== */
async function openSendProposalModal(page) {
  await page.bringToFront().catch(()=>{});
  const clicked = await clickByTextLoose(page, ['Enviar proposta', 'Send proposal'], 3500);
  if (!clicked) return false;
  await page.waitForSelector('div[role="dialog"]', { timeout: 6000 }).catch(()=>{});
  return true;
}

/* ================== Fluxo pós-proposta (delays 6s) ================== */
async function handleSuccessModalAction(page, message) {
  await sleep(WAIT_SUCCESS_MODAL_MS);

  const dlg = await page.$('div[role="dialog"]');
  if (!dlg) { console.log('ℹ️ Modal de sucesso não apareceu.'); return; }

  // Clica "Enviar mensagem"
  let clicked = await clickByTextInsideDialog(page, ['Enviar mensagem','Send message'], 2200).catch(()=>false);
  if (!clicked) {
    const btns = await dlg.$$('button');
    for (const b of btns) {
      const t = ((await (await b.getProperty('innerText')).jsonValue()) || '').toLowerCase();
      if (t.includes('enviar mensagem') || t.includes('send message')) { await b.click().catch(()=>{}); clicked = true; break; }
    }
  }
  if (!clicked) {
    console.log('⚠️ Não achei "Enviar mensagem". Fechando modal e seguindo.');
    const closeBtn = await dlg.$('button[aria-label*="Fechar"], button[aria-label*="Close"], .artdeco-modal__dismiss');
    if (closeBtn) await closeBtn.click().catch(()=>{});
    return;
  }

  // Delay 1: apagar
  console.log('⏳ Delay para apagar:', D_APAGAR, 'ms');
  await sleep(D_APAGAR);

  const els1 = await getBubbleElements(page);
  if (!els1 || !els1.contentEditable) { console.log('❌ Composer não encontrado.'); return; }

  // Apaga uma vez
  await els1.contentEditable.evaluate(el => {
    el.focus();
    el.innerHTML = '';
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }).catch(()=>{});
  console.log('🧹 Texto padrão apagado.');

  // Delay 2: colar
  console.log('⏳ Delay para colar:', D_COLAR, 'ms');
  await sleep(D_COLAR);

  // Cola o texto
  await els1.contentEditable.evaluate((el, msg) => {
    el.focus();
    if (document.queryCommandSupported && document.queryCommandSupported('insertText')) {
      document.execCommand('insertText', false, msg);
    } else {
      el.textContent = msg;
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }, message).catch(()=>{});
  console.log('📄 Texto colado no composer.');

  // Delay 3: destravar
  console.log('⏳ Delay para destravar (click no container):', D_DESTRAVO, 'ms');
  await sleep(D_DESTRAVO);

  const els2 = await getBubbleElements(page);
  if (els2?.unlockContainer) {
    await els2.unlockContainer.click({ delay: 20 }).catch(()=>{});
    await els2.unlockContainer.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' })).catch(()=>{});
    console.log('🖱️ Clique no container da mensagem (destravar enviar).');
  } else {
    console.log('⚠️ Container para destravar não encontrado.');
  }

  // Delay 4: enviar
  console.log('⏳ Delay antes de clicar Enviar:', D_ENVIAR, 'ms');
  await sleep(D_ENVIAR);

  const els3 = await getBubbleElements(page);
  if (els3?.sendButton) {
    const disabled = await els3.sendButton.evaluate(el => el.hasAttribute('disabled')).catch(()=>false);
    if (disabled) {
      console.log('⚠️ Enviar desabilitado; forçando evento de input.');
      if (els3.contentEditable) {
        await els3.contentEditable.evaluate(el => {
          el.focus();
          el.dispatchEvent(new InputEvent('input', { bubbles: true }));
        }).catch(()=>{});
        await sleep(400);
      }
    }
    await els3.sendButton.click({ delay: 30 }).catch(()=>{});
    console.log('📨 Clique em Enviar executado.');
  } else {
    console.log('❌ Botão Enviar não encontrado.');
  }

  // Fecha a bolha
  const bubble = els3?.bubble || els2?.bubble || els1?.bubble || await findLatestVisibleBubble(page, 3000);
  if (bubble) {
    const closeBtn = await bubble.$('.msg-overlay-bubble-header__control.artdeco-button--circle');
    if (closeBtn) { await closeBtn.click().catch(()=>{}); console.log('✅ Bolha fechada.'); }
  }

  // Fecha modal remanescente
  const dlg2 = await page.$('div[role="dialog"]');
  if (dlg2) {
    const n = await clickByTextInsideDialog(page, ['Não', 'No'], 600).catch(()=>false);
    if (!n) {
      const c = await dlg2.$('button[aria-label*="Fechar"], button[aria-label*="Close"], .artdeco-modal__dismiss');
      if (c) await c.click().catch(()=>{});
    }
    await page.waitForFunction(() => !document.querySelector('div[role="dialog"]'), { timeout: 3000 }).catch(()=>{});
  }

  console.log('💬 Mensagem tratada com delays e bolha fechada.');
}

/* ================== Envio da proposta ================== */
async function findEditableInDialog(page, maxMs = 6000) {
  const deadline = Date.now() + maxMs;

  while (Date.now() < deadline) {
    const dlg = await page.$('div[role="dialog"]');
    if (!dlg) { await sleep(80); continue; }

    await clickByTextInsideDialog(page, [
      'Adicionar mensagem','Adicionar uma mensagem','Adicionar nota',
      'Add message','Add a message','Add note'
    ], 400).catch(()=>{});

    const selectors = [
      'textarea',
      '[contenteditable="true"]',
      'div[contenteditable]:not([contenteditable="false"])',
      '[role="textbox"]',
      'div.msg-form__contenteditable'
    ];
    for (const sel of selectors) {
      const nodes = await dlg.$$(sel);
      for (const h of nodes) {
        const visible = await h.evaluate(el => {
          const s = window.getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const vis = s && s.visibility !== 'hidden' && s.display !== 'none';
          return vis && r && r.width > 2 && r.height > 2;
        }).catch(()=>false);
        if (visible) {
          await h.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(()=>{});
          return h;
        }
      }
    }
    await sleep(100);
  }
  return null;
}

async function fillEditableFast(page, handle, message) {
  const tagName = await page.evaluate(el => el.tagName, handle).catch(()=>null);
  const isTextarea = String(tagName || '').toLowerCase() === 'textarea';

  if (isTextarea) {
    await page.evaluate((el, msg) => {
      el.focus();
      el.value = msg;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, handle, message);
    return;
  }

  await page.evaluate((el, msg) => {
    el.focus();
    el.innerHTML = '';
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, msg);
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }, handle, message);
}

async function typeMessageAndSend(page, message) {
  const dialog = await page.$('div[role="dialog"]');
  if (!dialog) throw new Error('Modal de proposta não abriu.');

  const input = await findEditableInDialog(page, 6000);
  if (!input) {
    try {
      const snap = `screenshots/no-textarea-${Date.now()}.png`;
      await page.screenshot({ path: snap, fullPage: true });
      const dump = await dialog.evaluate(el => (el.innerText || '').slice(0, 2000)).catch(()=> '');
      console.log('⚠️ Dump modal (parcial):\n', dump);
      console.log('📸 Screenshot salvo em:', snap);
    } catch {}
    throw new Error('Textarea da proposta não encontrado.');
  }

  await input.click({ clickCount: 1 }).catch(()=>{});
  await fillEditableFast(page, input, message);

  const buttons = await dialog.$$('button');
  let sendBtn = null;
  for (const b of buttons) {
    const t = ((await (await b.getProperty('innerText')).jsonValue()) || '').trim().toLowerCase();
    if (t.includes('enviar') || t === 'send' || t.includes('send')) { sendBtn = b; break; }
  }
  if (!sendBtn) throw new Error('Botão Enviar/Send não encontrado.');
  await sendBtn.click().catch(()=>{});

  await page.waitForFunction(() => !document.querySelector('div[role="dialog"] .artdeco-modal'), { timeout: 5000 }).catch(()=>{});

  await handleSuccessModalAction(page, message);
}

async function clickDecline(page) {
  await page.bringToFront().catch(()=>{});
  const clickedNo = await clickByTextLoose(page, ['Não', 'No'], 3500);
  if (!clickedNo) throw new Error('Botão "Não/No" não encontrado para recusar.');

  await page.waitForSelector('div[role="dialog"]', { timeout: WAIT_DECLINE_MODAL_MS }).catch(()=>{});
  await sleep(WAIT_DECLINE_MODAL_MS);

  let ok = await clickByTextInsideDialog(page, ['Recusar', 'Decline'], 1500).catch(() => false);
  if (!ok) ok = await clickByTextInsideDialog(page, ['Confirmar', 'Confirm'], 1200).catch(() => false);
  if (!ok) {
    const dlg = await page.$('div[role="dialog"]');
    const btn = dlg && await dlg.$('button.artdeco-button--primary');
    if (btn) await btn.click().catch(()=>{});
  }
  await page.waitForFunction(() => !document.querySelector('div[role="dialog"]'), { timeout: 6000 }).catch(() => {});
}

/* ================== MAIN ================== */
async function main() {
  ensureDirs();

  const browser = await puppeteer.launch({
    protocolTimeout: PROTOCOL_TIMEOUT,
    headless: HEADLESS !== 'false',
    slowMo: HEADLESS === 'false' ? (FAST ? 5 : 50) : 0,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--window-size=1366,900',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
    defaultViewport: { width: 1366, height: 900 }
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(40_000);
  page.setDefaultNavigationTimeout(40_000);

  try {
    await gotoSafe(page, 'https://www.linkedin.com/login', 'login');
    await page.type('#username', LINKEDIN_EMAIL, { delay: FAST ? 0 : 15 });
    await page.type('#password', LINKEDIN_PASSWORD, { delay: FAST ? 0 : 15 });
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 25_000 })
    ]);

    // >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
    // Aguardar 2FA/código após o login (até 60s)
    console.log('⏳ Aguardando até 60s para inserir código/2FA do LinkedIn...');
    await sleep(60_000);
    console.log('✅ Prosseguindo após janela de 2FA.');
    // <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

    // Vai direto para as solicitações (evita entrar no perfil do usuário)
    await openServices(page);

    let processed = 0;
    while (true) {
      if (MAX_REQUESTS > 0 && processed >= MAX_REQUESTS) break;

      const { count } = await listSelectorAndCount(page);
      if (!count) { console.log('✅ Lista vazia.'); break; }

      const clicked = await clickFirstListItem(page);
      if (!clicked) { console.log('⚠️ Não consegui clicar o item 0.'); break; }

      let details;
      try {
        details = await scrapeRequestDetailsToJSON(page);
      } catch (e) {
        console.log('⚠️ Falha no scrape, atualizando e seguindo:', e.message);
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(()=>{});
        continue;
      }
      console.log('🧩 Detalhes extraídos:\n', JSON.stringify(details, null, 2));

      const decision = decideAction(details);
      const message = buildMessage(details, decision);
      console.log(`🧠 Decisão: ${decision.kind} | lang=${decision.lang} | tpl=${decision.templatePath.join('.')}`);

      try {
        if (decision.kind === 'DECLINE') {
          await clickDecline(page);
          console.log('🚫 Pedido recusado.');
        } else {
          const ok = await openSendProposalModal(page);
          if (!ok) throw new Error('Não abriu modal de proposta.');
          await typeMessageAndSend(page, message);  // envia proposta + mensagem com delays e fecha a bolha
          console.log('📨 Proposta enviada + Mensagem tratada.');
        }
      } catch (e) {
        console.log('❌ Falha ao enviar/recusar:', e.message);
      }

      processed += 1;
      await sleep(jitter(BETWEEN_ITEMS_BASE_MS, BETWEEN_ITEMS_SPREAD_MS));
    }

    console.log(`🏁 Finalizado. Processados: ${processed}`);

  } catch (err) {
    console.error('❌ Erro geral:', err.message);
    try { await page.screenshot({ path: `screenshots/debug-${Date.now()}.png`, fullPage: true }); } catch {}
  } finally {
    await browser.close().catch(()=>{});
  }
}

main();
