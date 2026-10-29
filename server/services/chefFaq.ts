const FAQ_ANSWERS: Array<{ key: string; match: RegExp; answer: string }> = [
  {
    key: "煎牛扒幾耐",
    match: /煎.*(牛扒|牛排).*(幾耐|多久|時間)|(牛扒|牛排).*(煎|幾耐|多久)/i,
    answer: "煎牛扒先將鍋燒熱，落少少油。厚約 2–3 cm 嘅牛扒，大火每面煎約 1–2 分鐘至表面上色，再轉中火煎到理想熟度；之後靜置 3–5 分鐘先切，肉汁會更鎖得住。",
  },
  {
    key: "蒸魚幾耐",
    match: /蒸.*魚.*(幾耐|多久|時間)|魚.*蒸.*(幾耐|多久)/i,
    answer: "蒸魚要水滾後落鍋。一般約 500–600g 嘅魚，大火蒸 8–10 分鐘；每增加約 200g，加 1–2 分鐘。蒸好後熄火焗 1 分鐘，再淋豉油同熟油。",
  },
  {
    key: "白灼蝦幾耐",
    match: /白灼.*蝦.*(幾耐|多久|時間)|蝦.*(白灼|灼).*(幾耐|多久)/i,
    answer: "白灼蝦水滾後落鍋，細蝦約 1–2 分鐘，中蝦約 2–3 分鐘，大蝦約 3–4 分鐘；蝦身轉紅、捲曲就撈起，過凍水會更爽口。",
  },
  {
    key: "氣炸雞翼幾耐",
    match: /氣炸.*雞翼.*(幾耐|多久|時間)|雞翼.*氣炸.*(幾耐|多久)/i,
    answer: "氣炸雞翼預熱 180°C，約 12–15 分鐘，中途翻面一次；想脆啲最後 2–3 分鐘可調到 200°C。實際時間要視乎雞翼大小同氣炸鍋型號。",
  },
];

function normalize(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\s，,。．.、!！?？:：;；/\\()（）【】\[\]{}<>《》'"“”‘’·—-]+/g, "")
    .trim();
}

/** Verified, deterministic FAQ answers. Never calls an LLM. */
export function lookupFaqAnswer(text: string): string | null {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const normalized = normalize(raw);
  for (const entry of FAQ_ANSWERS) {
    if (entry.match.test(raw) || normalized.includes(normalize(entry.key))) return entry.answer;
  }
  return null;
}

export const FAQ_KEYS = FAQ_ANSWERS.map((entry) => entry.key);
